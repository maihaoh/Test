"""Independent K3/5D/TRX authorized read-only collector for Render.

Writes a separate atomic snapshot.  /api/data selects the most recent verified
success for each game, so GitHub ingest and the WinGo bot cannot overwrite it.
No Choice WebSocket is created and no betting actions are sent.
"""
import json
import os
import time
from pathlib import Path

from mzplay_multi import MultiGameCollector, MZPlayClient, load_config

ROOT = Path(__file__).resolve().parent
MULTI_RUNTIME_FILE = ROOT / "multi_runtime.json"
GAMES = ("k3", "5d", "trx")


def publish_multi(states):
    snapshot = {game: json.loads(json.dumps(states[game], ensure_ascii=False))
                for game in GAMES if isinstance(states.get(game), dict)}
    tmp = MULTI_RUNTIME_FILE.with_suffix(".json.tmp")
    with tmp.open("w", encoding="utf-8") as file:
        json.dump(snapshot, file, ensure_ascii=False, separators=(",", ":"))
        file.flush()
        os.fsync(file.fileno())
    os.replace(tmp, MULTI_RUNTIME_FILE)


def run():
    interval = max(8, min(120, int(os.getenv("MULTI_POLL_SECONDS", "12"))))
    print(f"[Multi/Render] K3, 5D, TRX start (interval={interval}s, read-only)", flush=True)
    client = MZPlayClient(load_config())
    collector = MultiGameCollector(publish_multi, poll_interval=interval, client=client)
    collector.run()
