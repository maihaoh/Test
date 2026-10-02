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
            # Choice application packets are binary; ignore text frames.
            return
        if not isinstance(payload, (bytes, bytearray)):
            return
        raw = bytes(payload)
        if not raw:
            return
        self.status.last_frame_at = time.time()
        assembler = self._assemblers.setdefault(ws_key, PacketAssembler())
        try:
            for packet in assembler.feed(raw):
                self._handle_packet(packet)
        except DecodeError:
            # A WebSocket frame can belong to another protocol/transport.  Reset only
            # this socket's assembler and continue; never heuristic-resync binary data.
            assembler.reset()

    def _attach_websocket(self, ws) -> None:
        url = str(getattr(ws, "url", "") or "")
        # Results were observed on Choice's game sockets (not MZPlay's broadcast WS).
        if not ("mdvuz.com" in url or "e9p1.com" in url):
            return
        ws_key = id(ws)
        self.status.websocket_seen = True
        self.status.last_frame_at = time.time()
        label = self._safe_ws_label(url)
        print(f"🔗 [Choice] WebSocket 已连接: {label}")
        ws.on("framereceived", lambda payload, key=ws_key: self._handle_frame(key, payload))
        ws.on("close", lambda _=None, key=ws_key: self._assemblers.pop(key, None))

    def _run_browser_session(self) -> None:
        try:
            from playwright.sync_api import sync_playwright, TimeoutError as PlaywrightTimeoutError
        except Exception as exc:
            raise RuntimeError(
                "缺少 Playwright。请先运行 INSTALL_CHOICE_BROWSER.cmd"
            ) from exc

        # The URL is an authorization artifact.  Never print/persist it.
        launch_url = self.client.get_choice_launch_url()
        print("✅ [Choice] 已从 MZPlay 取得新的授权入口（URL 已隐藏）")

        self._assemblers.clear()
        self.status.browser_started = False
        self.status.choice_page_loaded = False
        self.status.websocket_seen = False
        self.status.last_frame_at = 0.0

        with sync_playwright() as p:
            launch_args = {
                "headless": self.headless,
                "args": ["--disable-dev-shm-usage", "--no-sandbox"],
            }
            # Prefer the Playwright-managed Chromium. This is the portable path
            # for Linux containers/Render and avoids hard-coding a system Chrome path.
            browser = None
            launch_errors = []
            try:
                browser = p.chromium.launch(**launch_args)
                print("🧭 [Choice] 使用 Playwright Chromium")
            except Exception as exc:
                launch_errors.append(f"playwright-chromium: {type(exc).__name__}: {exc}")

            # Optional fallback for local machines that already have Chrome/Chromium.
            if browser is None:
                browser_path = str(os.getenv("CHOICE_BROWSER_PATH") or "").strip()
                candidates = []
                if browser_path:
                    candidates.append(browser_path)
                for name in ("google-chrome", "google-chrome-stable", "chromium", "chromium-browser"):
                    found = shutil.which(name)
                    if found and found not in candidates:
                        candidates.append(found)
                if os.name == "nt":
                    for path in (
                        r"C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
                        r"C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
                        os.path.expandvars(r"%LOCALAPPDATA%\\Google\\Chrome\\Application\\chrome.exe"),
                    ):
                        if path and os.path.exists(path) and path not in candidates:
                            candidates.append(path)

                for path in candidates:
                    try:
                        browser = p.chromium.launch(executable_path=path, **launch_args)
                        print(f"🧭 [Choice] 使用系统浏览器: {os.path.basename(path)}")
                        break
                    except Exception as exc:
                        launch_errors.append(f"{path}: {type(exc).__name__}: {exc}")

            if browser is None:
                detail = " | ".join(launch_errors[-2:])
                raise RuntimeError(
                    "无法启动 Chrome/Chromium。Render 建议使用包含 Playwright 系统依赖的 Docker 环境。"
                    + (f" 启动错误: {detail}" if detail else "")
                )

            self.status.browser_started = True
            context = browser.new_context(
                user_agent=(
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                    "AppleWebKit/537.36 (KHTML, like Gecko) "
                    "Chrome/154.0.0.0 Safari/537.36"
                ),
                viewport={"width": 1365, "height": 768},
                locale="en-US",
            )
            page = context.new_page()
            page.on("websocket", self._attach_websocket)
            page.on("crash", lambda: setattr(self.status, "last_error", "Choice page crashed"))

            print("🌐 [Choice] 正在进入 Choice（无头模式，不需要人工操作）...")
            try:
                page.goto(
                    launch_url,
                    wait_until="domcontentloaded",
                    timeout=90_000,
                    referer="https://mzplay0.com/",
                )
            except PlaywrightTimeoutError:
                # The SPA can keep loading background resources for a long time.
                # If we are already on the authorized Choice origin, keep the session
                # and let the WebSocket watchdog decide whether it is healthy.
                if "gci.arvideo.video" not in str(page.url or ""):
                    raise
                print("ℹ️ [Choice] 页面仍在加载资源，继续等待 WebSocket...")
            self.status.choice_page_loaded = True
            print("✅ [Choice] 页面已建立，等待 D051-D058 实时 Result...")

            session_started = time.time()
            while not self.stop_event.is_set():
                # Give Playwright's event loop time to dispatch WebSocket frame events.
                page.wait_for_timeout(1000)
                now = time.time()
                if page.is_closed():
                    raise RuntimeError("Choice page closed")
                # Once websocket traffic has started, silence for too long normally means
                # the internal session died.  Request a fresh MZPlay launch on restart.
                if (
                    self.status.websocket_seen
                    and self.status.last_frame_at
                    and now - self.status.last_frame_at > self.no_frame_timeout
                ):
                    raise RuntimeError(
                        f"Choice WebSocket {self.no_frame_timeout}s 没有数据，准备重新建立 session"
                    )
                # If no Choice socket appears at all, do not hang forever on a bad launch.
                if not self.status.websocket_seen and now - session_started > 120:
                    raise RuntimeError("Choice 入口打开后 120s 仍没有建立游戏 WebSocket")

            context.close()
            browser.close()

    def run(self) -> None:
        self.status.running = True
        while not self.stop_event.is_set():
            try:
                self.status.last_error = ""
                self._run_browser_session()
            except Exception as exc:
                self.status.last_error = f"{type(exc).__name__}: {exc}"
                print(f"⚠️ [Choice] {self.status.last_error}")
            if not self.stop_event.is_set():
                print(f"⏳ [Choice] {self.restart_delay}s 后重新取得入口并重连...")
                self.stop_event.wait(self.restart_delay)
        self.status.running = False
