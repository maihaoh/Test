"""Read-only D51 snapshot archive, using only Python's built-in SQLite.

Each D051 FullResultList is a *replacement* roadmap snapshot, not a unique
round event. Store distinct snapshots by digest, and never fabricate official
round IDs. Render Free's filesystem is ephemeral: SQLite here is local to the
running instance unless a provider-supported persistent mount is configured.
"""
from __future__ import annotations

import json
import sqlite3
from contextlib import contextmanager
import threading
from pathlib import Path


class ChoiceSnapshotArchive:
    def __init__(self, path: Path, limit: int = 5000):
        self.path = Path(path)
        self.limit = max(100, min(int(limit), 100_000))
        self._lock = threading.Lock()
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with self._connect() as connection:
            connection.execute('''CREATE TABLE IF NOT EXISTS snapshots (
                digest TEXT PRIMARY KEY,
                room TEXT NOT NULL CHECK(room = 'D51'),
                first_seen_at INTEGER NOT NULL,
                rows_json TEXT NOT NULL
            )''')
            connection.execute('CREATE INDEX IF NOT EXISTS idx_choice_seen ON snapshots(first_seen_at)')

    @contextmanager
    def _connect(self):
        connection = sqlite3.connect(str(self.path), timeout=8)
        try:
            connection.execute('PRAGMA busy_timeout=8000')
            with connection:
                yield connection
        finally:
            connection.close()

    def record(self, digest: str, seen_at: int, rows: list[dict]) -> bool:
        """Return True only when this exact validated snapshot was not saved before."""
        # No session token, signed provider URL, user details or prediction is stored.
        stored = json.dumps(rows, ensure_ascii=False, separators=(',', ':'))
        with self._lock, self._connect() as conn:
            cursor = conn.execute(
                'INSERT OR IGNORE INTO snapshots(digest,room,first_seen_at,rows_json) VALUES(?,?,?,?)',
                (digest, 'D51', int(seen_at), stored),
            )
            inserted = bool(cursor.rowcount)
            if inserted:
                conn.execute('''DELETE FROM snapshots WHERE digest IN (
                    SELECT digest FROM snapshots ORDER BY first_seen_at DESC, rowid DESC LIMIT -1 OFFSET ?
                )''', (self.limit,))
        return inserted

    def count(self) -> int:
        with self._lock, self._connect() as conn:
            return int(conn.execute('SELECT count(*) FROM snapshots').fetchone()[0])

    def latest(self) -> dict | None:
        with self._lock, self._connect() as conn:
            row = conn.execute('''SELECT digest,first_seen_at,rows_json
                FROM snapshots ORDER BY first_seen_at DESC,rowid DESC LIMIT 1''').fetchone()
        if not row:
            return None
        try:
            rows = json.loads(row[2])
            if not isinstance(rows, list):
                return None
            return {'digest': row[0], 'seenAt': int(row[1]), 'rows': rows}
        except (ValueError, TypeError):
            return None
