"""Render-side WinGo + source-derived Choice protocol collector (V14).

This runner intentionally does NOT attempt to bypass MZPlay/Cloudflare or invent a
CLIENT_LOGIN_GAME_PROTO payload.  It uses only structures recovered from the
user-supplied protocol report:

* WebSocket endpoint/origin already observed by the user.
* 12-byte application heartbeat packet (id=1, length=12, seq=0).
* SUBSCRIBE_VIDEO_LIST=77829 for D051-D058.
* SUBSCRIBE_VIDEO_LIST_R=143365 acknowledgement parsing.
* CLIENT_LOGIN_GAME_PROTO_R=143362 acknowledgement parsing if one is ever seen.
* BAC_FULL_RESULT_LIST=135176 result decoding.

The report explicitly says 77829 is sent after successful game login, while the
actual 77826 login packet/session bootstrap was not recovered.  V14 therefore
keeps the socket alive with the application heartbeat, sends the verified 77829
packet, and reports the server acknowledgement (or lack of one) precisely.
"""
from __future__ import annotations

import os
import struct
import threading
import time
from collections import Counter
from typing import Iterable

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
RETRY_SECONDS = max(10, int(os.getenv("CHOICE_RETRY_SECONDS") or 20))
NO_SNAPSHOT_SECONDS = max(90, int(os.getenv("CHOICE_NO_SNAPSHOT_SECONDS") or 240))
HEARTBEAT_SECONDS = max(10, int(os.getenv("CHOICE_APP_HEARTBEAT_SECONDS") or 25))

CLIENT_LOGIN_GAME_PROTO_R = 143362
SUBSCRIBE_VIDEO_LIST_R = 143365
APP_HEARTBEAT_ID = 1
HEADER_SIZE = 12


def build_app_heartbeat(seq_no: int = 0) -> bytes:
    """Observed application heartbeat: id=1, length=12, sequence number."""
    if not 0 <= int(seq_no) <= 0xFFFFFFFF:
        raise ValueError("seq_no must fit uint32")
    return struct.pack(">III", APP_HEARTBEAT_ID, HEADER_SIZE, int(seq_no))


def parse_subscribe_ack(packet: bytes) -> dict:
    """Parse source-derived SUBSCRIBE_VIDEO_LIST_R response.

    ResponseBase consumes 12-byte header first.  SubscribeVidListResp then reads
    retCode(uint32), count(uint32), and for seqNo==0 four-byte vids without a
    group byte.  For nonzero seqNo the original JS reads one group byte per vid.
    """
    if len(packet) < 20:
        raise DecodeError("subscription acknowledgement too short")
    resp_id, declared, seq_no = struct.unpack_from(">III", packet, 0)
    if resp_id != SUBSCRIBE_VIDEO_LIST_R or declared != len(packet):
        raise DecodeError("not a complete SUBSCRIBE_VIDEO_LIST_R packet")
    ret_code, count = struct.unpack_from(">II", packet, 12)
    pos = 20
    vids = []
    for _ in range(count):
        group = 1
        if seq_no != 0:
            if pos >= len(packet):
                raise DecodeError("truncated subscription group")
            group = packet[pos]
            pos += 1
        if pos + 4 > len(packet):
            raise DecodeError("truncated subscription vid")
        try:
            vid = packet[pos:pos + 4].decode("ascii")
        except UnicodeDecodeError as exc:
            raise DecodeError("invalid subscription vid") from exc
        pos += 4
        vids.append({"vid": vid, "group": group})
    return {"retCode": ret_code, "seqNo": seq_no, "vids": vids}


def parse_login_ack(packet: bytes) -> dict:
    """Parse the verified fixed prefix of CLIENT_LOGIN_GAME_PROTO_R.

    Source: retCode(uint32), version(int8), then CommonProto.ClientConnR protobuf.
    The protobuf body is deliberately kept opaque because its schema was not
    recovered in the supplied report.
    """
    if len(packet) < 17:
        raise DecodeError("login acknowledgement too short")
    resp_id, declared, seq_no = struct.unpack_from(">III", packet, 0)
    if resp_id != CLIENT_LOGIN_GAME_PROTO_R or declared != len(packet):
        raise DecodeError("not a complete CLIENT_LOGIN_GAME_PROTO_R packet")
    ret_code = struct.unpack_from(">I", packet, 12)[0]
    version = struct.unpack_from(">b", packet, 16)[0]
    return {
        "retCode": ret_code,
        "version": version,
        "seqNo": seq_no,
        "opaquePayloadBytes": max(0, len(packet) - 17),
    }


class DirectChoiceCollector:
    def __init__(self) -> None:
        self.assembler = PacketAssembler()
        self.last_snapshot_at = 0.0
        self.last_frame_at = 0.0
        self.packet_counts: Counter[int] = Counter()
        self.subscription_ack_seen = False
        self.subscription_ack_ok = False
        self.login_ack_seen = False
        self._ws = None
        self._heartbeat_stop = threading.Event()

    def _heartbeat_loop(self, ws) -> None:
        seq = 0
        while not self._heartbeat_stop.wait(HEARTBEAT_SECONDS):
            if not ws.keep_running:
                return
            try:
                ws.send(build_app_heartbeat(seq), opcode=websocket.ABNF.OPCODE_BINARY)
                print(
                    f"💓 [Choice/Direct] app heartbeat sent id=1 seq={seq} interval={HEARTBEAT_SECONDS}s",
                    flush=True,
                )
                seq = (seq + 1) & 0xFFFFFFFF
            except Exception as exc:
                print(f"⚠️ [Choice/Direct] heartbeat send failed: {type(exc).__name__}: {exc}", flush=True)
                return

    def _send_subscription(self, ws) -> None:
        payload = build_subscribe_packet(DEFAULT_VIDS)
        cmd_id = int.from_bytes(payload[:4], "big")
        ws.send(payload, opcode=websocket.ABNF.OPCODE_BINARY)
        print(
            f"📤 [Choice/Direct] subscribe D051-D058 cmd={cmd_id} bytes={len(payload)}",
            flush=True,
        )
        print("ℹ️ [Choice/Direct] waiting for SUBSCRIBE_VIDEO_LIST_R(143365) acknowledgement", flush=True)

    def on_open(self, ws) -> None:
        self._ws = ws
        self.assembler.reset()
        self.last_frame_at = time.time()
        self.subscription_ack_seen = False
        self.subscription_ack_ok = False
        self.login_ack_seen = False
        self._heartbeat_stop.clear()
        print(f"🟢 [Choice/Direct] WebSocket connected: {CHOICE_WS_URL}", flush=True)
        print(f"🌐 [Choice/Direct] Origin: {CHOICE_ORIGIN}", flush=True)

        # Send the observed application heartbeat immediately; this replaces the
        # WebSocket control ping that the Choice server did not answer reliably.
        ws.send(build_app_heartbeat(0), opcode=websocket.ABNF.OPCODE_BINARY)
        print("💓 [Choice/Direct] initial app heartbeat sent id=1 len=12", flush=True)
        threading.Thread(target=self._heartbeat_loop, args=(ws,), daemon=True).start()

        # The source report confirms this exact 77829 packet builder, but also says
        # it normally follows successful 77826 game login.  We send it here only
        # to learn whether this endpoint accepts result-only subscription without
        # inventing or replaying an authentication packet.
        self._send_subscription(ws)

    def on_message(self, ws, message) -> None:
        if isinstance(message, str):
            if message:
                print(f"ℹ️ [Choice/Direct] text frame len={len(message)}", flush=True)
            return
        if not isinstance(message, (bytes, bytearray)):
            return
        raw = bytes(message)
        if not raw:
            return
        self.last_frame_at = time.time()
        try:
            packets = self.assembler.feed(raw)
        except DecodeError as exc:
            self.assembler.reset()
            print(f"⚠️ [Choice/Direct] assembler reset: {exc}", flush=True)
            return

        for packet in packets:
            if len(packet) < 12:
                continue
            resp_id, declared, seq_no = struct.unpack_from(">III", packet, 0)
            self.packet_counts[resp_id] += 1
            count = self.packet_counts[resp_id]
            if count <= 3:
                print(
                    f"📦 [Choice/Direct] packet id={resp_id} len={len(packet)} seq={seq_no} count={count}",
                    flush=True,
                )

            if resp_id == APP_HEARTBEAT_ID:
                continue

            if resp_id == CLIENT_LOGIN_GAME_PROTO_R:
                self.login_ack_seen = True
                try:
                    ack = parse_login_ack(packet)
                    print(
                        "🔐 [Choice/Direct] login ack 143362 "
                        f"retCode={ack['retCode']} version={ack['version']} "
                        f"opaquePayloadBytes={ack['opaquePayloadBytes']}",
                        flush=True,
                    )
                except DecodeError as exc:
                    print(f"⚠️ [Choice/Direct] login ack parse failed: {exc}", flush=True)
                continue

            if resp_id == SUBSCRIBE_VIDEO_LIST_R:
                self.subscription_ack_seen = True
                try:
                    ack = parse_subscribe_ack(packet)
                    self.subscription_ack_ok = ack["retCode"] == 0
                    vids = ",".join(x["vid"] for x in ack["vids"])
                    print(
                        "✅ [Choice/Direct] subscription ack 143365 "
                        f"retCode={ack['retCode']} vids=[{vids}]",
                        flush=True,
                    )
                except DecodeError as exc:
                    print(f"⚠️ [Choice/Direct] subscription ack parse failed: {exc}", flush=True)
                continue

            if resp_id != BAC_FULL_RESULT_LIST:
                continue

            try:
                snapshot = decode_result_packet(packet, allowed_vids=DEFAULT_VIDS)
            except DecodeError as exc:
                print(f"⚠️ [Choice/Direct] BAC decode rejected: {exc}", flush=True)
                continue
            if snapshot.get("has_invalid_rows"):
                print("⚠️ [Choice/Direct] BAC snapshot contains invalid rows; ignored", flush=True)
                continue
            self.last_snapshot_at = time.time()
            print(
                f"🎯 [Choice/Direct] BAC 135176 verified vid={snapshot.get('vid')} "
                f"results={len(snapshot.get('results') or [])}",
                flush=True,
            )
            bot.update_choice_snapshot(snapshot)

    def on_error(self, ws, error) -> None:
        print(f"⚠️ [Choice/Direct] WebSocket error: {type(error).__name__}: {error}", flush=True)

    def on_close(self, ws, status, reason) -> None:
        self._heartbeat_stop.set()
        print(f"🔌 [Choice/Direct] closed status={status} reason={reason}", flush=True)
        if not self.subscription_ack_seen:
            print(
                "🧩 [Choice/Direct] no 143365 subscription acknowledgement was received before close. "
                "The supplied protocol report states 77829 follows successful CLIENT_LOGIN_GAME_PROTO(77826) login; "
                "the actual 77826 request/session bootstrap is not present in the supplied capture, so V14 does not invent it.",
                flush=True,
            )
        elif not self.subscription_ack_ok:
            print("🧩 [Choice/Direct] server returned a non-zero subscription acknowledgement.", flush=True)

    def _watchdog(self, ws) -> None:
        while ws.keep_running:
            time.sleep(5)
            now = time.time()
            base = self.last_snapshot_at or self.last_frame_at
            if base and now - base > NO_SNAPSHOT_SECONDS:
                print(
                    f"⏳ [Choice/Direct] no verified BAC snapshot for {int(now-base)}s; reconnecting",
                    flush=True,
                )
                try:
                    ws.close()
                except Exception:
                    pass
                return

    def run_once(self) -> None:
        self.last_snapshot_at = 0.0
        self.last_frame_at = 0.0
        self.packet_counts.clear()
        self._heartbeat_stop.clear()
        ws = websocket.WebSocketApp(
            CHOICE_WS_URL,
            on_open=self.on_open,
            on_message=self.on_message,
            on_error=self.on_error,
            on_close=self.on_close,
        )
        threading.Thread(target=self._watchdog, args=(ws,), daemon=True).start()
        ws.run_forever(
            origin=CHOICE_ORIGIN,
            ping_interval=0,
            skip_utf8_validation=True,
        )

    def run_forever(self) -> None:
        while True:
            try:
                self.run_once()
            except KeyboardInterrupt:
                raise
            except Exception as exc:
                print(f"⚠️ [Choice/Direct] run failed: {type(exc).__name__}: {exc}", flush=True)
            print(f"⏳ [Choice/Direct] retry in {RETRY_SECONDS}s", flush=True)
            time.sleep(RETRY_SECONDS)


def main() -> None:
    print("=" * 70, flush=True)
    print("🚀 Render WinGo + Choice protocol V14 collector", flush=True)
    print("ℹ️ Source-derived heartbeat + 77829/143365 ack + 135176 decoder", flush=True)
    print("ℹ️ No invented 77826 login packet, no MZPlay UI login, no Cloudflare bypass", flush=True)
    print("=" * 70, flush=True)

    bot.initialize_data()
    threading.Thread(target=bot.wingo_loop, name="wingo", daemon=True).start()
    DirectChoiceCollector().run_forever()


if __name__ == "__main__":
    main()
