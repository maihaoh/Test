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
            raise RuntimeError("缺少 Playwright。请先安装 Playwright Chromium") from exc

        if not str(getattr(self.client, "token", "") or ""):
            raise RuntimeError("SESSION_NOT_AVAILABLE: 已恢复状态中没有 access token；不会回退到 GitHub UI Login")

        self._assemblers.clear()
        self.status.browser_started = False
        self.status.choice_page_loaded = False
        self.status.websocket_seen = False
        self.status.last_frame_at = 0.0

        with sync_playwright() as p:
            browser = p.chromium.launch(headless=self.headless, args=["--disable-dev-shm-usage", "--no-sandbox"])
            print("🧭 [Choice] 使用 Playwright Chromium")
            self.status.browser_started = True
            context = browser.new_context(
                user_agent=("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                            "(KHTML, like Gecko) Chrome/154.0.0.0 Safari/537.36"),
                viewport={"width": 1365, "height": 768}, locale="en-US",
            )

            import json as _json
            token = _json.dumps(str(getattr(self.client, "token", "") or ""))
            token_header = _json.dumps(str(getattr(self.client, "token_header", "") or "Bearer"))
            refresh = _json.dumps(str(getattr(self.client, "refresh_token", "") or ""))
            device = _json.dumps(str(getattr(self.client, "device_id", "") or ""))
            context.add_init_script(script=f"""
                try {{
                  localStorage.setItem('ar_token', {token});
                  localStorage.setItem('tokenHeader', {token_header});
                  localStorage.setItem('refreshToken', {refresh});
                  localStorage.setItem('arvId', {device});
                }} catch (e) {{}}
            """)

            # Attach to every page/popup before opening MZPlay.
            def attach_page(pg):
                pg.on("websocket", self._attach_websocket)
                pg.on("crash", lambda: setattr(self.status, "last_error", "Choice page crashed"))
            context.on("page", attach_page)
            page = context.new_page()
            attach_page(page)

            print("🌐 [Choice/UI] 打开 MZPlay 官方首页（仅复用已授权 session，不执行网页登录）...")
            try:
                page.goto("https://mzplay0.com/", wait_until="domcontentloaded", timeout=90_000)
            except PlaywrightTimeoutError:
                pass
            page.wait_for_timeout(2500)

            title = str(page.title() or "")
            path = str(page.evaluate("() => location.pathname") or "")
            body = str(page.locator("body").inner_text(timeout=5000) or "")[:1200]
            if "Attention Required" in title or "Sorry, you have been blocked" in body:
                raise RuntimeError("CLOUDFLARE_BLOCKED: GitHub Runner 被 MZPlay/Cloudflare 拒绝；不会尝试 UI Login")
            if path.lower().startswith("/login"):
                raise RuntimeError("SESSION_NOT_ACCEPTED: MZPlay 没有接受恢复的 session；不会尝试 UI Login")

            # Let the OFFICIAL page perform its own Choice launch flow. No synthetic GetGameUrl.
            choice = None
            selectors = [
                "text=CHOICE", "text=Choice", "[alt*='CHOICE' i]", "img[src*='choice' i]",
                "a:has-text('CHOICE')", "button:has-text('CHOICE')"
            ]
            for sel in selectors:
                try:
                    loc = page.locator(sel)
                    for i in range(min(loc.count(), 10)):
                        cand = loc.nth(i)
                        if cand.is_visible():
                            choice = cand
                            break
                except Exception:
                    pass
                if choice is not None:
                    break
            if choice is None:
                raise RuntimeError("CHOICE_TILE_NOT_FOUND: 官方首页已打开，但找不到 CHOICE 入口")

            print("✅ [Choice/UI] 已找到 CHOICE，交给官方网页执行启动流程")
            pages_before = set(context.pages)
            try:
                choice.click(timeout=15_000)
            except Exception as exc:
                raise RuntimeError(f"CHOICE_CLICK_FAILED: {type(exc).__name__}: {exc}")

            # Wait for official navigation/popup/iframe and especially its game WebSocket.
            deadline = time.time() + 120
            while time.time() < deadline and not self.stop_event.is_set():
                for pg in context.pages:
                    try:
                        pg.wait_for_timeout(250)
                    except Exception:
                        pass
                if self.status.websocket_seen:
                    self.status.choice_page_loaded = True
                    print("✅ [Choice/UI] 官方 CHOICE 启动流程已完成；已建立游戏 WebSocket")
                    break
                time.sleep(0.25)
            if not self.status.websocket_seen:
                urls = []
                for pg in context.pages:
                    try: urls.append(urlparse(pg.url).hostname or "")
                    except Exception: pass
                raise RuntimeError("CHOICE_WS_NOT_SEEN: 点击 CHOICE 后 120s 仍未看到游戏 WebSocket; pages=" + ",".join(sorted(set(urls))))

            print("✅ [Choice] 等待 D051-D058 实时 Result...")
            while not self.stop_event.is_set():
                for pg in context.pages:
                    try: pg.wait_for_timeout(500)
                    except Exception: pass
                now = time.time()
                if self.status.last_frame_at and now - self.status.last_frame_at > self.no_frame_timeout:
                    raise RuntimeError(f"Choice WebSocket {self.no_frame_timeout}s 没有数据，准备重连")
                time.sleep(0.25)
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
                # Respect both Login and GetGameUrl cooldowns.  The shared MZPlay
                # client is the single source of truth, so Choice never creates a
                # second aggressive retry loop.
                retry_after = 0
                try:
                    retry_after = int(getattr(self.client, "choice_retry_after")())
                except Exception:
                    next_login_at = float(getattr(self.client, "next_login_at", 0.0) or 0.0)
                    retry_after = max(0, int(next_login_at - time.time()))
                wait_for = max(self.restart_delay, retry_after)
                if retry_after > self.restart_delay:
                    print(f"⏳ [Choice] MZPlay 冷却中，{wait_for}s 后自动重试，不重复认证请求...")
                else:
                    print(f"⏳ [Choice] {wait_for}s 后重新取得入口并重连...")
                self.stop_event.wait(wait_for)
        self.status.running = False
