import hashlib
import json
import os
import time
from pathlib import Path
from urllib.parse import urlparse

import requests

BASE_DIR = Path(__file__).resolve().parent
DATA_FILE = BASE_DIR / "data.json"
DEFAULT_PUSH_URL = "https://test-4bvi.onrender.com/api/ingest"


def _load_snapshot():
    with DATA_FILE.open("rb") as f:
        raw = f.read()
    if not raw:
        raise ValueError("data.json is empty")
    data = json.loads(raw.decode("utf-8"))
    if not isinstance(data, dict):
        raise ValueError("data.json is not an object")
    return raw, data


def _safe_url(url):
    p = urlparse(url)
    if p.scheme == "https":
        return True
    return p.scheme == "http" and p.hostname in {"127.0.0.1", "localhost"}


def push_loop(stop_event=None):
    push_url = str(os.getenv("PUSH_URL") or DEFAULT_PUSH_URL).strip()
    secret = str(os.getenv("INGEST_SECRET") or "").strip()
    interval = max(2.0, float(os.getenv("PUSH_INTERVAL_SECONDS") or 5))
    timeout = max(15.0, float(os.getenv("PUSH_TIMEOUT_SECONDS") or 90))

    if not secret:
        raise RuntimeError("INGEST_SECRET is required on the collector host")
    if not _safe_url(push_url):
        raise RuntimeError("PUSH_URL must use HTTPS, except localhost testing")

    session = requests.Session()
    headers = {
        "Authorization": f"Bearer {secret}",
        "Content-Type": "application/json",
        "User-Agent": "ChoiceRemoteCollector/22",
    }

    print(f"[Relay] target={urlparse(push_url).netloc}/api/ingest")
    print(f"[Relay] watching {DATA_FILE}")

    last_hash = ""
    last_success_hash = ""
    backoff = interval

    while stop_event is None or not stop_event.is_set():
        try:
            if not DATA_FILE.exists():
                time.sleep(interval)
                continue

            raw, data = _load_snapshot()
            digest = hashlib.sha256(raw).hexdigest()
            if digest == last_success_hash:
                time.sleep(interval)
                continue
            last_hash = digest

            response = session.post(
                push_url,
                data=raw,
                headers=headers,
                timeout=(10, timeout),
            )

            if response.status_code == 200:
                last_success_hash = digest
                updated = data.get("updated_at") or 0
                print(f"[Relay] pushed snapshot updated_at={updated}")
                backoff = interval
            elif response.status_code == 409:
                print("[Relay] server has a newer snapshot; waiting for local data to advance")
                last_success_hash = digest
                backoff = interval
            elif response.status_code in {401, 403}:
                raise RuntimeError("relay authentication failed; INGEST_SECRET does not match Render")
            else:
                print(f"[Relay] HTTP {response.status_code}; retrying")
                backoff = min(60.0, max(interval, backoff * 1.8))

        except RuntimeError:
            raise
        except Exception as exc:
            print(f"[Relay] {type(exc).__name__}: push failed; retrying")
            backoff = min(60.0, max(interval, backoff * 1.8))

        if last_hash == last_success_hash:
            backoff = interval
        time.sleep(backoff)


if __name__ == "__main__":
    push_loop()
