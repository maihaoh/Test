"""Headless Choice baccarat collector.

The MZPlay API is used only to obtain the same signed AG_Video launch URL that
its web UI requests.  A headless Chromium instance then follows that authorized
launch and lets the official Choice client establish/renew its own session.
We listen to the official client's WebSocket traffic and decode only plaintext
BAC_FULL_RESULT_LIST (0x00021008) snapshots for D051-D058.

No betting, deposits, bet placement, or account actions are implemented.
"""
from __future__ import annotations

import os
import shutil
import threading
import time
from dataclasses import dataclass
from typing import Callable, Optional
from urllib.parse import urlparse

from choice_result_decoder import (
    BAC_FULL_RESULT_LIST,
    DEFAULT_VIDS,
    DecodeError,
    PacketAssembler,
    decode_result_packet,
)


@dataclass
class ChoiceCollectorStatus:
    running: bool = False
    browser_started: bool = False
    choice_page_loaded: bool = False
    websocket_seen: bool = False
    result_snapshots: int = 0
    last_frame_at: float = 0.0
    last_result_at: float = 0.0
    last_error: str = ""


class ChoiceHeadlessCollector:
    """Run the authorized Choice web client invisibly and surface result snapshots."""

    def __init__(
        self,
        mzplay_client,
        on_snapshot: Callable[[dict], None],
        restart_delay: int = 12,
        no_frame_timeout: int = 150,
    ) -> None:
        self.client = mzplay_client
        self.on_snapshot = on_snapshot
        self.restart_delay = max(5, int(restart_delay))
        self.no_frame_timeout = max(60, int(no_frame_timeout))
        self.stop_event = threading.Event()
        self.status = ChoiceCollectorStatus()
        self._assemblers: dict[int, PacketAssembler] = {}
        self._lock = threading.Lock()

    @property
    def headless(self) -> bool:
        return str(os.getenv("CHOICE_HEADLESS", "1")).strip().lower() not in {
            "0", "false", "no", "off"
        }

    def stop(self) -> None:
        self.stop_event.set()

    def _safe_ws_label(self, url: str) -> str:
        try:
            p = urlparse(url)
            return f"{p.hostname or 'unknown'}:{p.port or ''}"
        except Exception:
            return "unknown"

    def _handle_packet(self, packet: bytes) -> None:
        if len(packet) < 12:
            return
        resp_id = int.from_bytes(packet[0:4], "big")
        if resp_id != BAC_FULL_RESULT_LIST:
            return
        # decode_result_packet strictly rejects tables outside D051-D058.
        try:
            snapshot = decode_result_packet(packet, allowed_vids=DEFAULT_VIDS)
        except DecodeError:
            return
        if snapshot.get("has_invalid_rows"):
            # Keep source integrity: do not publish a snapshot with ambiguous outcome bits.
            return
        self.status.result_snapshots += 1
        self.status.last_result_at = time.time()
        self.on_snapshot(snapshot)

    def _handle_frame(self, ws_key: int, payload) -> None:
        if isinstance(payload, str):
