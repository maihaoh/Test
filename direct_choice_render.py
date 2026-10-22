"""Choice transport observer + WinGo collector; reviewed V14.

This module is intentionally limited to the supplied protocol evidence. A successful
WebSocket handshake and send() do not confer game access. 77829 is normally sent
only after successful CLIENT_LOGIN_GAME_PROTO(77826). The actual authorized 77826
request/launch bootstrap is not available in the user's captured materials.

This reviewed version makes a BOUNDED subscription probe (not an invented login),
reports whether any frame or 143365 reply arrives, then parks Choice without
spamming the server while WinGo and the Render API continue functioning.
"""
from __future__ import annotations

import json
import os
import struct
import threading
import time
from collections import Counter
from pathlib import Path
from urllib.parse import urlsplit

import websocket

import bot
from choice_result_decoder import (
    BAC_FULL_RESULT_LIST,
    DEFAULT_VIDS,
    DecodeError,
    PacketAssembler,
    build_subscribe_packet,
    decode_result_packet,
)

CHOICE_WS_URL = str(os.getenv("CHOICE_WS_URL") or "wss://ng211.mdvuz.com:5000").strip()
CHOICE_ORIGIN = str(os.getenv("CHOICE_ORIGIN") or "https://gci.arvideo.video").strip()
HEARTBEAT_SECONDS = max(10, int(os.getenv("CHOICE_APP_HEARTBEAT_SECONDS") or 25))
ACK_TIMEOUT_SECONDS = max(30, int(os.getenv("CHOICE_ACK_TIMEOUT_SECONDS") or 90))
NO_SNAPSHOT_SECONDS = max(90, int(os.getenv("CHOICE_NO_SNAPSHOT_SECONDS") or 240))
RETRY_SECONDS = max(15, int(os.getenv("CHOICE_RETRY_SECONDS") or 30))
MAX_UNACKED_ATTEMPTS = max(1, min(5, int(os.getenv("CHOICE_MAX_UNACKED_ATTEMPTS") or 2)))
STATUS_PATH = Path(__file__).resolve().parent / "choice_status.json"

CLIENT_LOGIN_GAME_PROTO_R = 143362
SUBSCRIBE_VIDEO_LIST_R = 143365
APP_HEARTBEAT_ID = 1


def build_app_heartbeat(seq_no: int = 0) -> bytes:
    if not isinstance(seq_no, int) or isinstance(seq_no, bool) or not 0 <= seq_no <= 0xFFFFFFFF:
        raise ValueError("heartbeat sequence must fit uint32")
    return struct.pack(">III", APP_HEARTBEAT_ID, 12, seq_no)


def parse_subscribe_ack(packet: bytes) -> dict:
    if len(packet) < 20:
        raise DecodeError("subscription acknowledgement too short")
    resp_id, declared, seq_no = struct.unpack_from(">III", packet)
    if resp_id != SUBSCRIBE_VIDEO_LIST_R or declared != len(packet):
        raise DecodeError("not a complete subscription acknowledgement")
    ret_code, count = struct.unpack_from(">II", packet, 12)
    # Reject implausible counts early; don't allocate proportional to untrusted data.
    bytes_each = 4 if seq_no == 0 else 5
    if count > 1024 or count > (len(packet) - 20) // bytes_each:
        raise DecodeError("invalid subscription acknowledgement count")
    offset = 20
    vids = []
    for _ in range(count):
        group = 1
        if seq_no != 0:
            group = packet[offset]
            offset += 1
        try:
            vid = packet[offset:offset + 4].decode("ascii")
        except UnicodeDecodeError as exc:
            raise DecodeError("invalid subscription vid") from exc
        offset += 4
        vids.append({"vid": vid, "group": group})
    return {"retCode": ret_code, "seqNo": seq_no, "vids": vids}


def parse_login_ack(packet: bytes) -> dict:
    if len(packet) < 17:
        raise DecodeError("login acknowledgement too short")
    resp_id, declared, seq_no = struct.unpack_from(">III", packet)
    if resp_id != CLIENT_LOGIN_GAME_PROTO_R or declared != len(packet):
        raise DecodeError("not a complete game login acknowledgement")
    return {
        "retCode": struct.unpack_from(">I", packet, 12)[0],
        "version": struct.unpack_from(">b", packet, 16)[0],
        "seqNo": seq_no,
        "opaquePayloadBytes": len(packet) - 17,
    }


class DirectChoiceCollector:
    def __init__(self) -> None:
        self.assembler = PacketAssembler()
        self.packet_counts: Counter[int] = Counter()
        self.last_snapshot_at = 0.0
        self.last_frame_at = 0.0
        self.connected_at = 0.0
        self.ack_seen = False
        self.ack_ok = False
        self.ack_rejected = False
        self.login_ack_seen = False
        self.subscription_sent = False
        self.rx_frames = 0
        self.rx_bytes = 0
        self.results = 0
        self._ws = None
        self._heart_stop = threading.Event()
        self._status_lock = threading.Lock()
        self._stage = "starting"
        self._error = ""
        self._last_log_summary = 0.0
        self._close_reason = ""

    def _write_status(self, stage: str | None = None, error: str = "") -> None:
        with self._status_lock:
            if stage is not None:
                self._stage = stage
            if error:
                self._error = error[:180]
            status = {
                "mode": "V14-audited-bounded-probe",
                "status": self._stage,
                "updated_at": int(time.time()),
                "websocket_connected": self.connected_at > 0 and self._ws is not None and bool(self._ws.keep_running),
                "game_login_request_sent": False,
                "game_login_ack_seen": self.login_ack_seen,
                "subscription_sent": self.subscription_sent,
                "subscription_ack_seen": self.ack_seen,
                "subscription_ack_accepted": self.ack_ok,
                "received_frames": self.rx_frames,
                "received_bytes": self.rx_bytes,
                "received_packets": sum(self.packet_counts.values()),
                "result_snapshots": self.results,
                "last_result_at": int(self.last_snapshot_at),
                "last_error": self._error,
                "note": "Browser metadata confirms 77826 on 7101 and 135176 on 5000; authorized login payload/bootstrap is not available to this Render process",
            }
            tmp = STATUS_PATH.with_suffix(".json.tmp")
            try:
                tmp.write_text(json.dumps(status, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
                os.replace(tmp, STATUS_PATH)
            except OSError as exc:
                print(f"[Choice/Status] failed to write status: {type(exc).__name__}", flush=True)

    def _send_heartbeat_loop(self, ws, stop: threading.Event) -> None:
        seq = 0
        while not stop.wait(HEARTBEAT_SECONDS):
            if self._ws is not ws or not ws.keep_running:
                return
            try:
                ws.send(build_app_heartbeat(seq), opcode=websocket.ABNF.OPCODE_BINARY)
                print(f"[Choice/Direct] app heartbeat sent seq={seq}", flush=True)
                seq = (seq + 1) & 0xFFFFFFFF
            except Exception as exc:
                print(f"[Choice/Direct] heartbeat failed: {type(exc).__name__}", flush=True)
                return

    def on_open(self, ws) -> None:
        self._ws = ws
        self.assembler.reset()
        self.packet_counts.clear()
        self.connected_at = time.time()
        self.last_frame_at = 0.0
        self.last_snapshot_at = 0.0
        self.rx_frames = 0
        self.rx_bytes = 0
        self.results = 0
        self.ack_seen = self.ack_ok = self.ack_rejected = False
        self.login_ack_seen = False
        self.subscription_sent = False
        self._error = ""
        self._close_reason = ""
        self._last_log_summary = self.connected_at
        self._heart_stop = threading.Event()
        parsed = urlsplit(CHOICE_WS_URL)
        safe_host = parsed.hostname or "unknown"
        try:
            safe_port = parsed.port or 443
        except ValueError:
            safe_port = "unknown"
        print(f"[Choice/Direct] WebSocket connected: {safe_host}:{safe_port}", flush=True)
        print("[Choice/Direct] TCP/WS CONNECTED != game login authenticated", flush=True)
        self._write_status("websocket_connected_not_authenticated")
        # Evidence-based V15: the browser sends 77826 on port 7101, while
        # 135176 arrives on port 5000. Neither an ID=1 heartbeat nor an
        # unauthenticated 77829 probe is justified by the captured trace.
        # Observe only; do not replay session-bearing login payloads.
        self._write_status("awaiting_authorized_game_bootstrap")
        print("[Choice/Direct] OBSERVE ONLY: no fabricated heartbeat or unauthenticated 77829", flush=True)
        print("[Choice/Direct] browser evidence: 7101 login/subscribe; 5000 results", flush=True)
        threading.Thread(target=self._watchdog, args=(ws, self._heart_stop), daemon=True).start()

    def on_message(self, ws, message) -> None:
        if isinstance(message, str):
            self.rx_frames += 1
            self.rx_bytes += len(message.encode("utf-8"))
            self.last_frame_at = time.time()
            if self.rx_frames <= 3:
                print(f"[Choice/Direct] incoming TEXT frame #{self.rx_frames} len={len(message)} (content hidden)", flush=True)
            self._write_status()
            return
        if not isinstance(message, (bytes, bytearray)) or not message:
            return
        raw = bytes(message)
        self.rx_frames += 1
        self.rx_bytes += len(raw)
        self.last_frame_at = time.time()
        if self.rx_frames <= 5:
            print(f"[Choice/Direct] incoming BINARY frame #{self.rx_frames} len={len(raw)} (content hidden)", flush=True)
        try:
            packets = self.assembler.feed(raw)
        except DecodeError as exc:
            self.assembler.reset()
            print(f"[Choice/Direct] unrecognized plaintext framing: {exc}", flush=True)
            self._write_status("unrecognized_application_framing", "incoming bytes do not match expected plaintext framing")
            return
        for packet in packets:
            resp_id, _, seq_no = struct.unpack_from(">III", packet, 0)
            self.packet_counts[resp_id] += 1
            if self.packet_counts[resp_id] <= 3:
                print(f"[Choice/Direct] received app packet id={resp_id} length={len(packet)} seq={seq_no}", flush=True)
            if resp_id == CLIENT_LOGIN_GAME_PROTO_R:
                self.login_ack_seen = True
                try:
                    ack = parse_login_ack(packet)
                    print(f"[Choice/Direct] unsolicited login ack 143362 retCode={ack['retCode']}", flush=True)
                    self._write_status("unsolicited_game_login_ack")
                except DecodeError as exc:
                    print(f"[Choice/Direct] invalid login ack: {exc}", flush=True)
                continue
            if resp_id == SUBSCRIBE_VIDEO_LIST_R:
                self.ack_seen = True
                try:
                    ack = parse_subscribe_ack(packet)
                    self.ack_ok = ack["retCode"] == 0
                    self.ack_rejected = not self.ack_ok
                    status = "ACCEPTED" if self.ack_ok else "REJECTED"
                    print(f"[Choice/Direct] 143365 subscription {status}: retCode={ack['retCode']} vids={len(ack['vids'])}", flush=True)
                    self._write_status("subscription_accepted" if self.ack_ok else "subscription_rejected")
                except DecodeError as exc:
                    print(f"[Choice/Direct] malformed subscription ack: {exc}", flush=True)
                    self._write_status("invalid_subscription_ack", str(exc))
                continue
            if resp_id != BAC_FULL_RESULT_LIST:
                continue
            try:
                snap = decode_result_packet(packet, allowed_vids=DEFAULT_VIDS)
            except DecodeError as exc:
                print(f"[Choice/Direct] BAC rejected: {exc}", flush=True)
                continue
            if snap.get("has_invalid_rows"):
                print("[Choice/Direct] BAC contains ambiguous result rows; not publishing", flush=True)
                continue
            self.last_snapshot_at = time.time()
            self.results += 1
            self._write_status("result_received")
            print(f"[Choice/Direct] BAC 135176 verified vid={snap.get('vid')} count={len(snap.get('results') or [])}", flush=True)
            bot.update_choice_snapshot(snap)
        if self.rx_frames <= 5:
            self._write_status()

    def on_error(self, ws, exc) -> None:
        # Exception text can include a connection URL with a private ticket.
        print(f"[Choice/Direct] error: {type(exc).__name__} (details hidden)", flush=True)
        self._write_status(error=type(exc).__name__)

    def on_close(self, ws, status, reason) -> None:
        self._heart_stop.set()
        self._ws = None
        self._write_status("disconnected")
        print(f"[Choice/Direct] closed status={status} reason_length={len(str(reason or ''))}; frames={self.rx_frames} packets={sum(self.packet_counts.values())} ack={self.ack_seen} results={self.results}", flush=True)
        if not self.ack_seen:
            print("[Choice/Direct] no 143365 ack received; do NOT infer success from websocket connect or send()", flush=True)

    def _watchdog(self, ws, stop: threading.Event) -> None:
        while not stop.wait(5):
            if self._ws is not ws or not ws.keep_running:
                return
            now = time.time()
            if now - self._last_log_summary >= 60:
                print(f"[Choice/Direct] 60s summary: rx_frames={self.rx_frames} app_packets={sum(self.packet_counts.values())} ack_seen={self.ack_seen} ack_ok={self.ack_ok} results={self.results}", flush=True)
                self._last_log_summary = now
                self._write_status()
            if self.ack_rejected:
                self._close_reason = "explicit_subscription_rejection"
                ws.close()
                return
            if not self.ack_seen and now - self.connected_at >= ACK_TIMEOUT_SECONDS:
                self._close_reason = "subscription_ack_timeout"
                print(f"[Choice/Direct] ACK_TIMEOUT: no 143365 after {int(now - self.connected_at)}s; rx_frames={self.rx_frames}", flush=True)
                self._write_status("subscription_ack_timeout")
                ws.close()
                return
            if self.ack_seen and self.ack_ok and now - (self.last_snapshot_at or self.connected_at) >= NO_SNAPSHOT_SECONDS:
                self._close_reason = "no_recent_bac_result_after_ack"
                print("[Choice/Direct] no recent 135176 result despite accepted subscription; reconnecting", flush=True)
                ws.close()
                return

    def run_once(self) -> None:
        # Reset before attempting TCP/WS. on_open might never run after a failure,
        # so retaining a previously accepted ACK would cause an infinite retry loop.
        self.ack_seen = False
        self.ack_ok = False
        self.ack_rejected = False
        self.login_ack_seen = False
        ws = websocket.WebSocketApp(
            CHOICE_WS_URL,
            on_open=self.on_open,
            on_message=self.on_message,
            on_error=self.on_error,
            on_close=self.on_close,
        )
        ws.run_forever(origin=CHOICE_ORIGIN, ping_interval=0, skip_utf8_validation=True)

    def run_forever(self) -> None:
        unacked = 0
        while True:
            try:
                self.run_once()
            except KeyboardInterrupt:
                raise
            except Exception as exc:
                print(f"[Choice/Direct] connection failed: {type(exc).__name__} (details hidden)", flush=True)
                self._write_status("connection_error", type(exc).__name__)
            if self.ack_rejected:
                print("[Choice/Direct] explicit nonzero ack; stopping Choice attempts until authorized login configuration is available", flush=True)
                break
            if self.ack_seen and self.ack_ok:
                unacked = 0
            else:
                unacked += 1
            if unacked >= MAX_UNACKED_ATTEMPTS:
                print(f"[Choice/Direct] STOPPED repeated unauthenticated subscription probes after {unacked} attempts. WinGo/API remain active.", flush=True)
                print("[Choice/Direct] metadata confirms browser 77826, but contains no reusable authorized login bootstrap", flush=True)
                break
            print(f"[Choice/Direct] retry in {RETRY_SECONDS}s", flush=True)
            time.sleep(RETRY_SECONDS)
        self._write_status("awaiting_authorized_game_login")
        # Keep the main collector process alive for the WinGo daemon thread and API.
        threading.Event().wait()


def main() -> None:
    print("=" * 67, flush=True)
    print("Render WinGo + K3/5D/TRX + Choice D51 自动只读 + 手动百家乐", flush=True)
    print("Choice 使用官方授权入口；不发送投注指令", flush=True)
    print("=" * 67, flush=True)

    bot.initialize_data()
    threading.Thread(target=bot.wingo_loop, name="wingo", daemon=True).start()

    # Reuse ONE locked MZPlay client for K3/5D/TRX and signed Choice launch.
    # This avoids competing RefreshToken and Login attempts in the same worker.
    from mzplay_multi import MZPlayClient, load_config
    shared_client = MZPlayClient(load_config())

    # Independently fetch K3/5D/TRX via their authorized official web APIs.
    # Uses a separate file so /api/ingest from GitHub and bot.py cannot stomp
    # each other's results. No credentials are exposed to the frontend.
    if str(os.getenv("MULTI_GAMES_ENABLED", "1")).strip().lower() not in {"0", "false", "off"}:
        from multi_runtime import run as run_multi
        threading.Thread(target=run_multi, args=(shared_client,), name="k3-5d-trx", daemon=True).start()

    # V32: official signed Choice launch, separate from manual baccarat.
    # Existing CHOICE_MANUAL_ONLY=1 does not disable the new D51 read-only feed.
    # Explicit CHOICE_AUTO_ENABLED=0 opts out without affecting other games.
    auto_enabled = str(os.getenv("CHOICE_AUTO_ENABLED", "1")).strip().lower() not in {"0", "false", "off", "no"}
    if auto_enabled:
        from choice_collector import ChoiceHeadlessCollector
        from choice_runtime import ChoiceRuntime
        runtime = ChoiceRuntime()
        collector = ChoiceHeadlessCollector(shared_client, runtime.accept_snapshot, runtime.set_stage)
        print("[Choice/D51] server auto observer enabled; signed official launch; no wagering", flush=True)
        collector.run()
    else:
        STATUS_PATH.write_text(json.dumps({
            "release": "V32", "stage": "stopped", "room": "D51",
            "note": "Auto Choice disabled by CHOICE_AUTO_ENABLED=0; other games continue"
        }, ensure_ascii=False), encoding="utf-8")
        print("[Choice/D51] disabled by CHOICE_AUTO_ENABLED=0; WinGo/K3/5D/TRX continue", flush=True)
        threading.Event().wait()


if __name__ == "__main__":
    main()
