"""Render-side WinGo + direct Choice public-result collector.

This runner deliberately does NOT log in to MZPlay and does NOT call MZPlay APIs.
It connects only to the already-known Choice result WebSocket endpoint and sends
room subscription packets for D051-D058. If the endpoint requires authorization,
the connection will fail/close and the runner will keep a conservative retry loop;
it does not attempt to bypass that requirement.
"""
from __future__ import annotations

import os
import threading
import time
from collections import Counter

import websocket

import bot
from choice_result_decoder import (
    BAC_FULL_RESULT_LIST,
    DEFAULT_VIDS,
    DecodeError,
    PacketAssembler,
    decode_result_packet,
)

CHOICE_WS_URL = str(os.getenv("CHOICE_WS_URL") or "wss://ng211.mdvuz.com:5000").strip()
CHOICE_ORIGIN = str(os.getenv("CHOICE_ORIGIN") or "https://gci.arvideo.video").strip()
RETRY_SECONDS = max(10, int(os.getenv("CHOICE_RETRY_SECONDS") or 20))
NO_SNAPSHOT_SECONDS = max(60, int(os.getenv("CHOICE_NO_SNAPSHOT_SECONDS") or 180))
ROOMS = tuple(f"D{i}" for i in range(51, 59))


def _subscribe_packet(room: str) -> bytes:
    # Preserved from the previously captured Choice client protocol.
    # Header + ASCII D051..D058 + fixed suffix.
    room_num = int(room[1:])
    room_code = f"D0{room_num}".encode("ascii")
    packet = bytearray(bytes.fromhex("000610030000001900000000"))
    packet.extend(room_code)
    packet.extend(bytes.fromhex("000000000000000100"))
    return bytes(packet)


class DirectChoiceCollector:
    def __init__(self) -> None:
        self.assembler = PacketAssembler()
        self.last_snapshot_at = 0.0
        self.last_frame_at = 0.0
        self.packet_counts: Counter[int] = Counter()
        self._ws = None

    def on_open(self, ws) -> None:
        self._ws = ws
        self.assembler.reset()
        self.last_frame_at = time.time()
        print(f"🟢 [Choice/Direct] WebSocket connected: {CHOICE_WS_URL}", flush=True)
        print(f"🌐 [Choice/Direct] Origin: {CHOICE_ORIGIN}", flush=True)
        for room in ROOMS:
            payload = _subscribe_packet(room)
            ws.send(payload, opcode=websocket.ABNF.OPCODE_BINARY)
            print(f"📤 [Choice/Direct] subscribe {room}", flush=True)
            time.sleep(0.12)
        print("✅ [Choice/Direct] D51-D58 subscription packets sent", flush=True)

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
            if len(packet) < 4:
                continue
            resp_id = int.from_bytes(packet[:4], "big")
            self.packet_counts[resp_id] += 1
            if self.packet_counts[resp_id] <= 2:
                print(
                    f"📦 [Choice/Direct] packet id={resp_id} len={len(packet)} count={self.packet_counts[resp_id]}",
                    flush=True,
                )
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
            bot.update_choice_snapshot(snapshot)

    def on_error(self, ws, error) -> None:
        print(f"⚠️ [Choice/Direct] WebSocket error: {type(error).__name__}: {error}", flush=True)

    def on_close(self, ws, status, reason) -> None:
        print(f"🔌 [Choice/Direct] closed status={status} reason={reason}", flush=True)

    def _watchdog(self, ws) -> None:
        while ws.keep_running:
            time.sleep(5)
            now = time.time()
            # Only force a reconnect when a connection has been alive but no verified
            # BAC_FULL_RESULT_LIST snapshot has appeared for a long interval.
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
        ws = websocket.WebSocketApp(
            CHOICE_WS_URL,
            on_open=self.on_open,
            on_message=self.on_message,
            on_error=self.on_error,
            on_close=self.on_close,
        )
        watchdog = threading.Thread(target=self._watchdog, args=(ws,), daemon=True)
        watchdog.start()
        ws.run_forever(
            origin=CHOICE_ORIGIN,
            ping_interval=20,
            ping_timeout=10,
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
    print("🚀 Render WinGo + Direct Choice D51-D58 collector", flush=True)
    print("ℹ️ No MZPlay login / GetGameUrl / RefreshToken is used in this mode.", flush=True)
    print("=" * 70, flush=True)

    bot.initialize_data()

    wingo = threading.Thread(target=bot.wingo_loop, name="wingo", daemon=True)
    wingo.start()

    DirectChoiceCollector().run_forever()


if __name__ == "__main__":
    main()
