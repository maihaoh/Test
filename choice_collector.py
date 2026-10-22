"""V33: Read-only Choice D51 collector with privacy-preserving browser diagnostics.

Uses the provider's issued AG_Video game entry; it does not synthesize game
login packets, bypass access controls, inject authentication, or place bets.

V32 did not distinguish a page that failed to enter the game from one with a
blocked websocket (nor websockets opened by frames/workers). V33 observes the
real browser execution through Playwright AND Chrome DevTools Protocol (CDP),
while publishing only bounded, allowlisted counts and stage names. Dedicated
worker sockets may not be observable by either listener; we report worker
counts explicitly instead of implying they were inspected.
"""
from __future__ import annotations

import base64
import hashlib
import os
import threading
import time
from dataclasses import dataclass
from typing import Callable
from urllib.parse import urlparse

from choice_result_decoder import BAC_FULL_RESULT_LIST, DecodeError, PacketAssembler, decode_result_packet

TARGET_VID = 'D051'
ALLOWED_WS_HOSTS = ('mdvuz.com', 'e9p1.com')
CHOICE_WEB_ORIGIN = 'gci.arvideo.video'
KNOWN_PORTS = {5000, 5030, 7101}


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
    def __init__(self, mzplay_client, on_snapshot: Callable[[dict], bool],
                 on_stage: Callable[[str], None] | None = None,
                 on_diagnostics: Callable[[dict], None] | None = None,
                 restart_delay: int = 45, no_frame_timeout: int = 180):
        self.client = mzplay_client
        self.on_snapshot = on_snapshot
        self.on_stage = on_stage or (lambda _stage: None)
        self.on_diagnostics = on_diagnostics or (lambda _state: None)
        self.restart_delay = max(30, int(restart_delay))
        self.no_frame_timeout = max(90, int(no_frame_timeout))
        self.stop_event = threading.Event()
        self.status = ChoiceCollectorStatus()
        self._assemblers: dict[object, PacketAssembler] = {}
        self._cdp_sessions: dict[object, object] = {}
        self._cdp_request: dict[tuple[int, str], tuple[bool, int]] = {}
        self._playwright_ports: set[int] = set()
        self._seen_ws_fingerprints: set[bytes] = set()
        self._attached_pages: set[object] = set()
        self._counters = {}
        self._game_page_seen = False
        self._launch_page_seen = False
        self._navigation_selected = False
        self._last_diagnostics_at = 0.0
        self._lock = threading.Lock()
        self._reset_diagnostics()

    def _reset_diagnostics(self):
        self._assemblers.clear()
        self._cdp_sessions.clear()
        self._cdp_request.clear()
        self._playwright_ports.clear()
        self._seen_ws_fingerprints.clear()
        self._attached_pages.clear()
        self._game_page_seen = False
        self._launch_page_seen = False
        self._navigation_selected = False
        self._last_diagnostics_at = 0.0
        self._counters = dict(
            providerWebSockets=0, otherWebSockets=0,
            webSocketHandshakes=0, webSocketHandshakeFailures=0,
            webSocketFrames=0, gameHttpErrors=0,
            requestFailures=0, browserJsErrors=0,
            gameNavigationCandidates=0, workerCount=0,
        )
        self._observed_ports = set()

    def _stage(self, stage: str) -> None:
        self.status.stage = stage
        self.on_stage(stage)
        print(f'[Choice/D51] stage={stage}', flush=True)

    def stop(self) -> None:
        self.stop_event.set()

    @staticmethod
    def _allow_ws(url: str) -> bool:
        try:
            parsed = urlparse(url)
            host = (parsed.hostname or '').lower()
            return (parsed.scheme in ('ws', 'wss') and any(
                host == domain or host.endswith('.' + domain) for domain in ALLOWED_WS_HOSTS))
        except ValueError:
            return False

    @staticmethod
    def _safe_port(url: str) -> int:
        try:
            return urlparse(url).port or 0
        except ValueError:
            return 0

    def _note_page_url(self, url: str) -> None:
        # Never retain or log complete URL: forwardGame.do contains a signed ticket.
        try:
            parsed = urlparse(url)
            if (parsed.hostname or '').lower() != CHOICE_WEB_ORIGIN:
                return
            if parsed.path == '/forwardGame.do':
                self._launch_page_seen = True
            elif parsed.path.startswith('/pc/') or parsed.path.endswith('/index.jsp'):
                self._game_page_seen = True
        except ValueError:
            pass

    def _diagnostics(self, context=None) -> dict:
        frames = 0
        pages = 0
        if context is not None:
            try:
                active = list(context.pages)
                pages = len(active)
                frames = sum(len(page.frames) for page in active)
                for page in active:
                    self._note_page_url(page.url)
                    for frame in page.frames:
                        self._note_page_url(frame.url)
            except Exception:
                pass
        return {
            'launchPageSeen': self._launch_page_seen,
            'gamePageSeen': self._game_page_seen,
            'pageCount': pages,
            'frameCount': frames,
            'gameNavigationSelected': self._navigation_selected,
            'webSocketPorts': sorted(self._observed_ports & KNOWN_PORTS),
            **dict(self._counters),
        }

    def _publish_diagnostics(self, context=None, force=False) -> None:
        now = time.monotonic()
        if not force and now - self._last_diagnostics_at < 15:
            return
        self._last_diagnostics_at = now
        safe = self._diagnostics(context)
        self.on_diagnostics(safe)
        # Only explicitly safe categorical counters. Never print URL, page text,
        # request headers or socket payloads (all may include authorization).
        print('[Choice/D51/Diag] '
              f'gamePage={int(safe["gamePageSeen"])} pages={safe["pageCount"]} '
              f'frames={safe["frameCount"]} wsProvider={safe["providerWebSockets"]} '
              f'wsOther={safe["otherWebSockets"]} '
              f'wsHandshake={safe["webSocketHandshakes"]} '
              f'wsFail={safe["webSocketHandshakeFailures"]} '
              f'wsFrames={safe["webSocketFrames"]} '
              f'httpErrors={safe["gameHttpErrors"]} '
              f'requestFailures={safe["requestFailures"]} '
              f'jsErrors={safe["browserJsErrors"]} '
              f'navSelected={int(safe["gameNavigationSelected"])}',
              flush=True)

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
        if self.on_snapshot(snapshot):
            self.status.result_snapshots += 1
            self.status.last_result_at = time.time()
            self._stage('d51_snapshot_received')

    def _handle_frame(self, socket_id: object, payload) -> None:
        if not isinstance(payload, (bytes, bytearray)) or not payload:
            return
        self.status.last_frame_at = time.time()
        assembler = self._assemblers.setdefault(socket_id, PacketAssembler())
        try:
            for packet in assembler.feed(bytes(payload)):
                self._handle_packet(packet)
        except DecodeError:
            assembler.reset()

    def _observe_ws_url(self, url: str) -> tuple[bool, int]:
        allowed = self._allow_ws(url)
        port = self._safe_port(url)
        # Playwright + CDP may each report the same socket. Count unique
        # endpoint URLs once, without retaining ticket-bearing URL strings.
        fingerprint = hashlib.sha256(url.encode('utf-8', 'replace')).digest()
        if fingerprint not in self._seen_ws_fingerprints:
            self._seen_ws_fingerprints.add(fingerprint)
            self._counters['providerWebSockets' if allowed else 'otherWebSockets'] += 1
        if allowed:
            self.status.websocket_seen = True
            if port in KNOWN_PORTS:
                self._observed_ports.add(port)
        return allowed, port

    def _attach_websocket(self, ws) -> None:
        url = str(getattr(ws, 'url', '') or '')
        allowed, port = self._observe_ws_url(url)
        if not allowed:
            return
        socket_id = ('pw', id(ws))
        self._playwright_ports.add(port)
        # This is discovery of a socket, not verification of successful login.
        self._stage('choice_websocket_seen')
        ws.on('framereceived', lambda payload, key=socket_id: self._playwright_frame(key, payload))
        ws.on('socketerror', lambda *_: self._note_ws_failure())
        ws.on('close', lambda *_: self._assemblers.pop(socket_id, None))

    def _playwright_frame(self, socket_id: object, payload) -> None:
        self._counters['webSocketFrames'] += 1
        self._handle_frame(socket_id, payload)

    def _note_ws_failure(self):
        self._counters['webSocketHandshakeFailures'] += 1

    def _attach_cdp(self, context, page_or_frame) -> None:
        """Observe sockets from page targets and accessible cross-origin frame targets.

        CDP events only supply metadata to the public status. Binary payloads
        are parsed in memory only on already-allowed provider hosts. When the
        same port is visible through Playwright, avoid processing it twice.
        """
        if page_or_frame in self._cdp_sessions or len(self._cdp_sessions) >= 24:
            return
        try:
            session = context.new_cdp_session(page_or_frame)
            session.send('Network.enable')
        except Exception:
            # Unsupported frame target is a normal condition, not a false success.
            return
        self._cdp_sessions[page_or_frame] = session
        sid = id(session)

        def created(event):
            rid = str(event.get('requestId') or '')
            allowed, port = self._observe_ws_url(str(event.get('url') or ''))
            self._cdp_request[(sid, rid)] = (allowed, port)

        def handshake(event):
            rid = str(event.get('requestId') or '')
            allowed, port = self._cdp_request.get((sid, rid), (False, 0))
            if not allowed:
                return
            status = int((event.get('response') or {}).get('status') or 0)
            if status == 101:
                self._counters['webSocketHandshakes'] += 1
                self._stage('choice_websocket_open')
            else:
                self._note_ws_failure()

        def cdp_frame(event):
            rid = str(event.get('requestId') or '')
            allowed, port = self._cdp_request.get((sid, rid), (False, 0))
            if not allowed or port in self._playwright_ports:
                return
            response = event.get('response') or {}
            opcode = response.get('opcode')
            if opcode != 2:
                return
            try:
                # CDP's binary frame payloadData is base64-encoded.
                packet = base64.b64decode(str(response.get('payloadData') or ''), validate=True)
            except (ValueError, TypeError):
                return
            self._counters['webSocketFrames'] += 1
            self._handle_frame(('cdp', sid, rid), packet)

        def failure(event):
            rid = str(event.get('requestId') or '')
            if self._cdp_request.get((sid, rid), (False, 0))[0]:
                self._note_ws_failure()

        session.on('Network.webSocketCreated', created)
        session.on('Network.webSocketHandshakeResponseReceived', handshake)
        session.on('Network.webSocketFrameReceived', cdp_frame)
        session.on('Network.webSocketFrameError', failure)

    @staticmethod
    def _is_blocked(page) -> bool:
        try:
            title = str(page.title() or '').lower()
            if any(word in title for word in ('attention required', 'just a moment', 'access denied')):
                return True
            text = str(page.locator('body').inner_text(timeout=3000) or '')[:500].lower()
            return ('sorry, you have been blocked' in text
                    or 'checking your browser before accessing' in text)
        except Exception:
            return False

    def _try_select_d51(self, context) -> bool:
        """Click only a unique, visible room-navigation control; never bet controls.

        If the game is canvas-rendered there may be no safe DOM target; in that
        case abstain instead of clicking arbitrary screen coordinates.
        """
        selectors = (
            '[data-room-id="D51"]', '[data-table-id="D51"]',
            'a[title="D51"]', 'button[title="D51"]',
            'a:has-text("D51")', 'button:has-text("D51")',
        )
        candidates = 0
        for page in context.pages:
            for frame in page.frames:
                for selector in selectors:
                    try:
                        locator = frame.locator(selector)
                        if locator.count() == 1 and locator.first.is_visible():
                            candidates += 1
                            self._counters['gameNavigationCandidates'] = candidates
                            locator.first.click(timeout=1500)
                            self._navigation_selected = True
                            print('[Choice/D51] selected explicit D51 room control', flush=True)
                            return True
                    except Exception:
                        continue
        self._counters['gameNavigationCandidates'] = candidates
        print('[Choice/D51] no unambiguous D51 navigation control found; will not click canvas/betting UI', flush=True)
        return False

    def _attach_page(self, context, page):
        if page in self._attached_pages:
            return
        self._attached_pages.add(page)
        page.on('websocket', self._attach_websocket)
        page.on('pageerror', lambda _error: self._counters.__setitem__(
            'browserJsErrors', self._counters['browserJsErrors'] + 1))

        def on_navigation(frame):
            self._note_page_url(frame.url)
            if frame != page.main_frame:
                self._attach_cdp(context, frame)

        def on_response(response):
            try:
                if (urlparse(response.url).hostname or '').lower() != CHOICE_WEB_ORIGIN:
                    return
                if int(response.status) >= 400:
                    self._counters['gameHttpErrors'] += 1
            except (ValueError, TypeError):
                pass

        def on_request_failure(request):
            # Deliberately do not log request.url or failure body. Count only
            # game-origin/known-provider failures, not unrelated analytics/CDNs.
            try:
                host = (urlparse(request.url).hostname or '').lower()
                if host != CHOICE_WEB_ORIGIN and not any(
                    host == d or host.endswith('.' + d) for d in ALLOWED_WS_HOSTS):
                    return
                self._counters['requestFailures'] += 1
            except (TypeError, ValueError):
                pass

        page.on('framenavigated', on_navigation)
        page.on('frameattached', lambda frame: self._attach_cdp(context, frame)
                if frame != page.main_frame else None)
        page.on('worker', lambda _: self._counters.__setitem__(
            'workerCount', self._counters['workerCount'] + 1))
        page.on('response', on_response)
        page.on('requestfailed', on_request_failure)
        self._attach_cdp(context, page)
        for frame in page.frames:
            self._note_page_url(frame.url)
            if frame != page.main_frame:
                self._attach_cdp(context, frame)

    def _timeout_reason(self):
        c = self._counters
        if c['webSocketHandshakeFailures'] and not c['webSocketHandshakes'] and not self.status.last_frame_at:
            return 'choice_ws_handshake_failed'
        if c['otherWebSockets'] and not self.status.websocket_seen:
            return 'choice_ws_endpoint_unrecognized'
        if not self._game_page_seen:
            return 'choice_game_not_loaded'
        if not self.status.websocket_seen:
            return 'choice_websocket_not_seen'
        if not c['webSocketHandshakes'] and not self.status.last_frame_at:
            return 'choice_ws_handshake_unconfirmed'
        return 'd51_result_not_seen'

    def _run_browser_session(self) -> None:
        try:
            from playwright.sync_api import sync_playwright
            from browser_runtime import configure_browser_path, launch_chromium
        except ImportError as exc:
            raise ChoiceConnectionError('playwright_unavailable') from exc

        self._reset_diagnostics()
        self.status.websocket_seen = False
        self.status.choice_page_loaded = False
        self.status.browser_started = False
        self.status.last_frame_at = 0.0
        session_snapshot_count = self.status.result_snapshots

        self._stage('requesting_authorized_choice_launch')
        launch_url = self.client.get_choice_launch_url()
        parsed = urlparse(launch_url)
        if parsed.scheme != 'https' or parsed.hostname != CHOICE_WEB_ORIGIN or parsed.path != '/forwardGame.do':
            raise ChoiceConnectionError('invalid_authorized_launch_url')

        configure_browser_path()
        self._stage('starting_official_choice_client')
        with sync_playwright() as p:
            browser = launch_chromium(p)
            self.status.browser_started = True
            try:
                context = browser.new_context(viewport={'width': 1365, 'height': 768}, locale='en-US')
                context.on('page', lambda new_page: self._attach_page(context, new_page))
                context.on('serviceworker', lambda _: self._counters.__setitem__(
                    'workerCount', self._counters['workerCount'] + 1))
                page = context.new_page()
                self._attach_page(context, page)
                try:
                    page.goto(launch_url, wait_until='domcontentloaded', timeout=90_000)
                except Exception as exc:
                    # Do not print signed launch_url or Playwright exception text.
                    raise ChoiceConnectionError('choice_navigation_failed') from exc
                self.status.choice_page_loaded = True
                self._stage('choice_client_loaded')
                if self._is_blocked(page):
                    raise ChoiceConnectionError('provider_access_blocked')

                choose_once_at = time.monotonic() + 7
                started = time.monotonic()
                timeout = max(90, int(os.getenv('CHOICE_RESULT_WAIT_SECONDS') or 150))
                while not self.stop_event.is_set():
                    page.wait_for_timeout(500)
                    elapsed = time.monotonic() - started
                    if time.monotonic() >= choose_once_at:
                        choose_once_at = float('inf')
                        self._try_select_d51(context)
                    self._publish_diagnostics(context)
                    if self.status.result_snapshots == session_snapshot_count and elapsed >= timeout:
                        self._publish_diagnostics(context, force=True)
                        if any(self._is_blocked(p) for p in context.pages):
                            raise ChoiceConnectionError('provider_access_blocked')
                        raise ChoiceConnectionError(self._timeout_reason())
                    if self.status.last_frame_at and time.time() - self.status.last_frame_at > self.no_frame_timeout:
                        raise ChoiceConnectionError('choice_websocket_stalled')
                    if elapsed > 40 and not self.status.websocket_seen:
                        if any(self._is_blocked(p) for p in context.pages):
                            raise ChoiceConnectionError('provider_access_blocked')
            finally:
                self._publish_diagnostics(context, force=True) if 'context' in locals() else None
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
