"""D51-only validated snapshots and safe status for Render's read-only API."""
from __future__ import annotations

import hashlib
import json
import os
import threading
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent
RUNTIME_FILE = ROOT / 'choice_runtime.json'
STATUS_FILE = ROOT / 'choice_status.json'
STAGES = frozenset({
    'starting', 'requesting_authorized_choice_launch', 'starting_official_choice_client',
    'choice_client_loaded', 'choice_websocket_open', 'd51_snapshot_received',
    'choice_navigation_failed', 'invalid_authorized_launch_url',
    'provider_access_blocked', 'choice_websocket_not_seen', 'd51_result_not_seen',
    'choice_websocket_stalled', 'playwright_unavailable',
    'authorized_launch_throttled_or_network_error', 'provider_authentication_failed',
    'choice_game_not_loaded', 'choice_ws_handshake_failed', 'choice_websocket_seen',
    'choice_ws_handshake_unconfirmed',
    'choice_ws_endpoint_unrecognized', 'choice_game_ui_unavailable',
    'browser_runtime_failed', 'authorized_launch_failed', 'retry_wait', 'stopped',
})


def _atomic_json(path: Path, data: dict) -> None:
    tmp = path.with_suffix('.json.tmp')
    with tmp.open('w', encoding='utf-8') as out:
        json.dump(data, out, ensure_ascii=False, separators=(',', ':'))
        out.flush()
        os.fsync(out.fileno())
    os.replace(tmp, path)


class ChoiceRuntime:
    def __init__(self, runtime_file: Path = RUNTIME_FILE, status_file: Path = STATUS_FILE):
        self.runtime_file = runtime_file
        self.status_file = status_file
        self._lock = threading.Lock()
        self._last_digest = None
        self._previous_values = None
        self._last_new_at = 0
        self._snapshot_count = 0
        self._records = 0
        self._last_snapshot_at = 0
        self._last_issue = ''
        self._diagnostics = {}
        self._stage = 'starting'
        self._last_error = ''
        # If a previous worker wrote a snapshot on the same Render instance,
        # retain its baseline so restart doesn't fabricate a "new" round.
        try:
            old = json.loads(self.runtime_file.read_text(encoding='utf-8'))
            self._last_digest = str(old.get('signature') or '') or None
            values = [row.get('raw_wininfo') for row in reversed(old.get('rows') or [])]
            self._previous_values = values if values and all(type(v) is int for v in values) else None
            self._last_new_at = int(old.get('lastNewResultAt') or 0)
            self._snapshot_count = int(old.get('snapshotCount') or 0)
            self._records = len(old.get('rows') or [])
            self._last_snapshot_at = int(old.get('lastSnapshotAt') or 0)
        except (OSError, ValueError, TypeError):
            pass

    def set_stage(self, stage: str) -> None:
        if stage not in STAGES:
            stage = 'authorized_launch_failed'
        with self._lock:
            self._stage = stage
            if stage.endswith('_failed') or stage in {
                'provider_access_blocked', 'choice_websocket_not_seen',
                'd51_result_not_seen', 'choice_websocket_stalled',
                'invalid_authorized_launch_url', 'provider_authentication_failed',
                'authorized_launch_throttled_or_network_error',
                'authorized_launch_failed', 'playwright_unavailable',
                'choice_game_not_loaded', 'choice_ws_handshake_failed',
                'choice_ws_handshake_unconfirmed',
                'choice_ws_endpoint_unrecognized', 'choice_game_ui_unavailable',
            }:
                self._last_error = stage
            if stage == 'd51_snapshot_received':
                self._last_error = ''
            self._write_status()

    def update_diagnostics(self, values: dict) -> None:
        # Deliberately fixed allowlist: never publish signed URLs, requests,
        # page HTML, tokens, headers or WebSocket payloads.
        permitted = {
            'gamePageSeen', 'launchPageSeen', 'pageCount', 'frameCount',
            'providerWebSockets', 'otherWebSockets', 'webSocketHandshakes',
            'webSocketHandshakeFailures', 'webSocketFrames', 'gameHttpErrors',
            'requestFailures', 'browserJsErrors', 'gameNavigationSelected',
            'gameNavigationCandidates', 'workerCount', 'webSocketPorts',
        }
        clean = {}
        for key, value in values.items():
            if key not in permitted:
                continue
            if type(value) is bool:
                clean[key] = value
            elif type(value) is int and 0 <= value <= 1_000_000:
                clean[key] = value
            elif key == 'webSocketPorts' and isinstance(value, list):
                clean[key] = sorted(set(v for v in value if type(v) is int
                                        and v in {5000, 5030, 7101}))
        with self._lock:
            self._diagnostics = clean
            self._write_status()

    def _write_status(self):
        _atomic_json(self.status_file, {
            'release': 'V33', 'mode': 'server_official_choice_client_read_only',
            'room': 'D51', 'stage': self._stage,
            'updatedAt': int(time.time()), 'snapshotCount': self._snapshot_count,
            'records': self._records, 'lastSnapshotAt': self._last_snapshot_at,
            'lastNewResultAt': self._last_new_at,
            'lastIssue': self._last_issue, 'lastError': self._last_error,
            'diagnostics': self._diagnostics,
            'note': 'Signed Choice launch may require additional provider permission. Only D051 decoded results are accepted.',
        })

    @staticmethod
    def _observed_append(previous: list[int] | None, current: list[int]) -> bool:
        # A replacement roadmap might contain corrections or a new shoe.
        # Only call it a *new round* when previous tail overlaps the new head
        # AND at least one outcome was appended. This also works for fixed-size
        # rolling windows, without treating arbitrary corrections as new draws.
        if not previous or not current or previous == current:
            return False
        for overlap in range(min(len(previous), len(current)), 0, -1):
            if previous[-overlap:] == current[:overlap] and len(current) > overlap:
                return True
        return False

    def accept_snapshot(self, snapshot: dict) -> bool:
        if not isinstance(snapshot, dict) or snapshot.get('vid') != 'D051' or snapshot.get('has_invalid_rows'):
            return False
        source = snapshot.get('results')
        if not isinstance(source, list) or not source or len(source) > 1000:
            return False
        rows = []
        compact = []
        codes = {'B': '庄', 'P': '闲', 'T': '和'}
        for idx, item in enumerate(source):
            if not isinstance(item, dict) or item.get('issues'):
                return False
            code = item.get('result')
            if code not in codes:
                return False
            wininfo = item.get('raw_wininfo')
            if type(wininfo) is not int:
                return False
            compact.append(wininfo)
            rows.append({
                'room': 'D51', 'game': idx + 1, 'round': idx + 1,
                'result': codes[code], 'raw_wininfo': wininfo,
                'bankerPair': item.get('bankerPair') is True,
                'playerPair': item.get('playerPair') is True,
                'source': 'Choice BAC_FULL_RESULT_LIST D051',
            })
        digest = hashlib.sha256(json.dumps(compact, separators=(',', ':')).encode()).hexdigest()
        now = int(time.time())
        with self._lock:
            if self._observed_append(self._previous_values, compact):
                self._last_new_at = now
            self._previous_values = compact
            self._last_digest = digest
            self._snapshot_count += 1
            self._last_snapshot_at = now
            self._records = len(rows)
            self._last_issue = f'road position {len(rows)} (not official round id)'
            _atomic_json(self.runtime_file, {
                'release': 'V33', 'room': 'D51', 'source': 'official_choice_client_ws_D051',
                'rows': rows[::-1], 'signature': digest,
                'lastSnapshotAt': now, 'lastNewResultAt': self._last_new_at,
                'snapshotCount': self._snapshot_count,
            })
            self._write_status()
        return True


def merge_choice(base: dict, runtime: dict) -> dict:
    """Overlay only recent, validated D51 data; preserve WinGo/K3/5D/TRX."""
    if not isinstance(base, dict):
        base = {}
    data = dict(base)
    if not isinstance(runtime, dict) or runtime.get('room') != 'D51':
        return data
    try:
        updated = int(runtime.get('lastSnapshotAt') or 0)
    except (TypeError, ValueError):
        return data
    if not 0 < updated <= time.time() + 60:
        return data
    rows = runtime.get('rows')
    if not isinstance(rows, list) or not 0 < len(rows) <= 1000:
        return data
    valid_codes = {'庄', '闲', '和'}
    if any(not isinstance(row, dict) or row.get('room') != 'D51'
           or row.get('result') not in valid_codes for row in rows):
        return data
    bacc = dict(data.get('baccarat') or {})
    rooms = dict(bacc.get('rooms') or {})
    rooms['D51'] = rows
    bacc['rooms'] = rooms
    bacc['choiceAuto'] = {
        'mode': 'server_official_choice_client_read_only',
        'lastSnapshotAt': updated,
        'lastNewResultAt': int(runtime.get('lastNewResultAt') or 0),
        'snapshotCount': int(runtime.get('snapshotCount') or 0),
        'records': len(rows), 'room': 'D51',
    }
    data['baccarat'] = bacc
    return data
