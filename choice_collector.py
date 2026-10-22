"""Choice D51 read-only collector using the provider's own authorized launch flow.

This module does not fabricate game-login packets or handle wagering. It asks the
existing MZPlay client for the AG_Video signed launch URL, opens that URL in
Playwright, and observes the official browser client's result-only WebSocket
packets (BAC_FULL_RESULT_LIST / D051). The provider may deny server access.
"""
from __future__ import annotations

import os
import threading
import time
from dataclasses import dataclass
from typing import Callable
from urllib.parse import urlparse

from choice_result_decoder import BAC_FULL_RESULT_LIST, DecodeError, PacketAssembler, decode_result_packet

TARGET_VID = 'D051'
ALLOWED_WS_HOSTS = ('mdvuz.com', 'e9p1.com')


class ChoiceConnectionError(RuntimeError):
    def __init__(self, category: str):
        self.category = category
        super().__init__(category)


@dataclass
class ChoiceCollectorStatus:
    running: bool = False
    browser_started: bool = False
    choice_page_loaded: bool = False
    websocket_seen: bool = False
    result_snapshots: int = 0
    last_frame_at: float = 0.0
    last_result_at: float = 0.0
    last_error: str = ''
    stage: str = 'not_started'


class ChoiceHeadlessCollector:
    def __init__(self, mzplay_client, on_snapshot: Callable[[dict], None],
                 on_stage: Callable[[str], None] | None = None,
                 restart_delay: int = 45, no_frame_timeout: int = 180):
        self.client = mzplay_client
        self.on_snapshot = on_snapshot
        self.on_stage = on_stage or (lambda _stage: None)
        self.restart_delay = max(30, int(restart_delay))
        self.no_frame_timeout = max(90, int(no_frame_timeout))
        self.stop_event = threading.Event()
        self.status = ChoiceCollectorStatus()
        self._assemblers: dict[int, PacketAssembler] = {}
        self._lock = threading.Lock()

    def _stage(self, stage: str) -> None:
        self.status.stage = stage
        self.on_stage(stage)
        print(f'[Choice/D51] stage={stage}', flush=True)

    def stop(self) -> None:
        self.stop_event.set()

    @property
    def headless(self) -> bool:
        return str(os.getenv('CHOICE_HEADLESS', '1')).strip().lower() not in {'0', 'false', 'off', 'no'}

    @staticmethod
    def _allow_ws(url: str) -> bool:
        try:
            host = (urlparse(url).hostname or '').lower()
        except ValueError:
            return False
        return any(host == domain or host.endswith('.' + domain) for domain in ALLOWED_WS_HOSTS)

    def _handle_packet(self, packet: bytes) -> None:
        if len(packet) < 12 or int.from_bytes(packet[:4], 'big') != BAC_FULL_RESULT_LIST:
            return
        try:
            snapshot = decode_result_packet(packet, allowed_vids=(TARGET_VID,))
        except DecodeError:
            return
        if snapshot.get('vid') != TARGET_VID or snapshot.get('has_invalid_rows'):
            return
        if not snapshot.get('results'):
            return
        self.status.result_snapshots += 1
        self.status.last_result_at = time.time()
        if self.on_snapshot(snapshot):
            self._stage('d51_snapshot_received')

    def _handle_frame(self, socket_id: int, payload) -> None:
        if not isinstance(payload, (bytes, bytearray)) or not payload:
            return
        self.status.last_frame_at = time.time()
        assembler = self._assemblers.setdefault(socket_id, PacketAssembler())
        try:
            for packet in assembler.feed(bytes(payload)):
                self._handle_packet(packet)
        except DecodeError:
            assembler.reset()

    def _attach_websocket(self, ws) -> None:
        url = str(getattr(ws, 'url', '') or '')
        if not self._allow_ws(url):
            return
        socket_id = id(ws)
        self.status.websocket_seen = True
        self.status.last_frame_at = time.time()
        self._stage('choice_websocket_open')
        # Never log websocket URL or handshake headers: both may carry tickets.
        ws.on('framereceived', lambda payload, key=socket_id: self._handle_frame(key, payload))
        ws.on('close', lambda *args, key=socket_id: self._assemblers.pop(key, None))

    @staticmethod
    def _is_blocked(page) -> bool:
        try:
            title = str(page.title() or '').lower()
            if 'attention required' in title or 'just a moment' in title:
                return True
            text = str(page.locator('body').inner_text(timeout=3000) or '')[:500].lower()
            return 'sorry, you have been blocked' in text
        except Exception:
            return False

    @staticmethod
    def _try_select_d51(context) -> bool:
        """Only select explicit room-navigation controls, never canvas/bet controls.

        If D51 is selected by default (or room UI is canvas-based), the official
        socket can still provide D051 snapshots; no arbitrary clicks are made.
        """
        selectors = (
            '[data-room-id="D51"]', '[data-table-id="D51"]',
            'a[title="D51"]', 'button[title="D51"]',
            'a:has-text("D51")', 'button:has-text("D51")',
        )
        for page in context.pages:
            for frame in page.frames:
                for selector in selectors:
                    try:
                        locator = frame.locator(selector)
                        if locator.count() == 1 and locator.first.is_visible():
                            locator.first.click(timeout=1500)
                            return True
                    except Exception:
                        continue
        return False

    def _run_browser_session(self) -> None:
        try:
            from playwright.sync_api import sync_playwright
            from browser_runtime import configure_browser_path, launch_chromium
        except ImportError as exc:
            raise ChoiceConnectionError('playwright_unavailable') from exc

        self._assemblers.clear()
        self.status.websocket_seen = False
        self.status.choice_page_loaded = False
        self.status.browser_started = False
        self.status.last_frame_at = 0
        session_snapshot_count = self.status.result_snapshots

        # No guessed D51 deep link: signed launch URL is obtained from the same
        # authorized MZPlay API/session already used by K3, 5D and TRX.
        self._stage('requesting_authorized_choice_launch')
        launch_url = self.client.get_choice_launch_url()
        parsed = urlparse(launch_url)
        if parsed.scheme != 'https' or parsed.hostname != 'gci.arvideo.video' or parsed.path != '/forwardGame.do':
            raise ChoiceConnectionError('invalid_authorized_launch_url')

        configure_browser_path()
        self._stage('starting_official_choice_client')
        with sync_playwright() as p:
            browser = launch_chromium(p)
            self.status.browser_started = True
            try:
                context = browser.new_context(viewport={'width': 1365, 'height': 768}, locale='en-US')
                attached_pages = set()
                def attach_page(new_page):
                    if new_page in attached_pages:
                        return
                    attached_pages.add(new_page)
                    new_page.on('websocket', self._attach_websocket)
                context.on('page', attach_page)
                page = context.new_page()
                attach_page(page)
                # Do not print signed URL or Playwright exceptions with URL details.
                try:
                    page.goto(launch_url, wait_until='domcontentloaded', timeout=90_000)
                except Exception as exc:
                    raise ChoiceConnectionError('choice_navigation_failed') from exc
                self.status.choice_page_loaded = True
                self._stage('choice_client_loaded')
                if self._is_blocked(page):
                    raise ChoiceConnectionError('provider_access_blocked')

                choose_once_at = time.monotonic() + 7
                started = time.monotonic()
                while not self.stop_event.is_set():
                    # Pumps Playwright events, including socket frames and popups.
                    page.wait_for_timeout(500)
                    elapsed = time.monotonic() - started
                    if time.monotonic() >= choose_once_at:
                        choose_once_at = float('inf')
                        self._try_select_d51(context)
                    if self.status.result_snapshots == session_snapshot_count and elapsed > 150:
                        if not self.status.websocket_seen:
                            raise ChoiceConnectionError('choice_websocket_not_seen')
                        raise ChoiceConnectionError('d51_result_not_seen')
                    if self.status.last_frame_at and time.time() - self.status.last_frame_at > self.no_frame_timeout:
                        raise ChoiceConnectionError('choice_websocket_stalled')
                    if elapsed > 40 and not self.status.websocket_seen:
                        if any(self._is_blocked(p) for p in context.pages):
                            raise ChoiceConnectionError('provider_access_blocked')
            finally:
                browser.close()

    @staticmethod
    def _category(exc: Exception) -> str:
        if isinstance(exc, ChoiceConnectionError):
            return exc.category
        name = type(exc).__name__
        if name in {'MZPlayRateLimit', 'MZPlayTransientError'}:
            return 'authorized_launch_throttled_or_network_error'
        if name == 'MZPlayAuthenticationError':
            return 'provider_authentication_failed'
        # Do not expose raw exception text, URL tickets, tokens or login info.
        if name == 'BrowserRuntimeError':
            return 'browser_runtime_failed'
        return 'authorized_launch_failed'

    def run(self) -> None:
        self.status.running = True
        self._stage('starting')
        while not self.stop_event.is_set():
            try:
                self._run_browser_session()
                if self.stop_event.is_set():
                    break
            except Exception as exc:
                category = self._category(exc)
                self.status.last_error = category
                self._stage(category)
            if not self.stop_event.is_set():
                try:
                    retry_after = int(self.client.choice_retry_after())
                except Exception:
                    retry_after = 0
                if self.status.last_error == 'provider_access_blocked':
                    retry_after = max(retry_after, 300)
                wait = max(self.restart_delay, retry_after)
                self._stage('retry_wait')
                print(f'[Choice/D51] retry_after_seconds={wait} reason={self.status.last_error}', flush=True)
                self.stop_event.wait(wait)
        self._stage('stopped')
        self.status.running = False
