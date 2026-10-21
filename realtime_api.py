import hmac
import json
import os
import threading
import time
from pathlib import Path

from flask import Flask, jsonify, request
from multi_snapshot import merge_snapshots
from browser_runtime import public_status

BASE_DIR = Path(__file__).resolve().parent
DATA_FILE = BASE_DIR / "data.json"
TEMP_FILE = BASE_DIR / "data.json.ingest.tmp"
MULTI_RUNTIME_FILE = BASE_DIR / "multi_runtime.json"
MULTI_GAMES = ("k3", "5d", "trx")
WRITE_LOCK = threading.Lock()
MAX_BODY_BYTES = int(os.getenv("INGEST_MAX_BYTES", str(4 * 1024 * 1024)))

app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = MAX_BODY_BYTES

_last_ingest_at = 0
_last_sender_updated_at = 0


def read_data():
    """Merge GitHub/WinGo data and Render multi-game states by actual success time.

    An error attempt is never treated as a fresh result.  /api/ingest can keep
    replacing data.json without erasing newer live multi results.
    """
    try:
        with DATA_FILE.open("r", encoding="utf-8") as f:
            raw = json.load(f)
        data = raw if isinstance(raw, dict) else {}
    except FileNotFoundError:
        data = {}
    except Exception as exc:
        return {"error": f"data read failed: {type(exc).__name__}"}

    try:
        with MULTI_RUNTIME_FILE.open("r", encoding="utf-8") as f:
            local = json.load(f)
    except (OSError, ValueError):
        return data
    return merge_snapshots(data, local)


def _extract_secret():
    auth = str(request.headers.get("Authorization") or "").strip()
    if auth.lower().startswith("bearer "):
        return auth[7:].strip()
    return str(request.headers.get("X-Ingest-Key") or "").strip()


def _authorized():
    expected = str(os.getenv("INGEST_SECRET") or "").strip()
    if not expected:
        return False, "server ingest secret is not configured"
    provided = _extract_secret()
    if not provided or not hmac.compare_digest(provided, expected):
        return False, "invalid ingest credentials"
    return True, ""


def _snapshot_updated_at(data):
    try:
        value = int(data.get("updated_at") or 0)
        return max(0, value)
    except Exception:
        return 0


def _valid_snapshot(data):
    """Reject future-clock, partial, and empty snapshots before persistence.

    The GitHub relay sends at minimum the complete WinGo and Baccarat sections.
    Optional lottery streams can be temporarily unavailable, but the ingested
    document must still contain real history; an empty bootstrap must never
    erase a previously healthy dashboard snapshot.
    """
    if not isinstance(data, dict):
        return False
    updated = _snapshot_updated_at(data)
    if not updated or updated > int(time.time()) + 60:
        return False
    wingo, baccarat = data.get('wingo'), data.get('baccarat')
    if not isinstance(wingo, dict) or not isinstance(baccarat, dict):
        return False
    wingo_draws, rooms = wingo.get('draws'), baccarat.get('rooms')
    if not isinstance(wingo_draws, list) or not isinstance(rooms, dict):
        return False
    if any(not isinstance(records, list) for records in rooms.values()):
        return False
    has_history = bool(wingo_draws) or any(bool(records) for records in rooms.values())
    for name in MULTI_GAMES:
        state = data.get(name)
        if state is None:
            continue
        if not isinstance(state, dict) or not isinstance(state.get('draws'), list):
            return False
        has_history = has_history or bool(state['draws'])
    return bool(has_history)


def _atomic_write(data):
    with TEMP_FILE.open("w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, separators=(",", ":"))
        f.flush()
        os.fsync(f.fileno())
    os.replace(TEMP_FILE, DATA_FILE)


@app.after_request
def add_headers(resp):
    resp.headers["Access-Control-Allow-Origin"] = os.getenv(
        "DASHBOARD_ORIGIN", "https://maihaoh.github.io"
    )
    resp.headers["Vary"] = "Origin"
    resp.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
    resp.headers["X-Content-Type-Options"] = "nosniff"
    return resp


@app.get("/health")
def health():
    data = read_data()
    if isinstance(data, dict) and "error" in data:
        return jsonify({"ok": False, "error": "data_unavailable"}), 503
    now = int(time.time())
    updated = _snapshot_updated_at(data)
    return jsonify(
        {
            "ok": True,
            "ingestConfigured": bool(str(os.getenv("INGEST_SECRET") or "").strip()),
            "lastIngestAt": int(_last_ingest_at or 0),
            "lastSenderUpdatedAt": int(_last_sender_updated_at or 0),
            "dataUpdatedAt": updated,
            "dataAgeSeconds": max(0, now - updated) if updated else None,
        }
    )


def _source_status(state, now=None):
    """Safe, public collector diagnostics; never expose upstream auth data.

    This reports *observed timestamp freshness*, not proof that the external
    provider is authenticated or that future outcomes are predictable.
    """
    now = int(time.time() if now is None else now)
    if not isinstance(state, dict):
        state = {}
    draws = state.get("draws")
    if not isinstance(draws, list):
        draws = []
    def safe_stamp(value):
        try:
            stamp = int(value)
            return stamp if 0 < stamp <= now + 60 else 0
        except (ValueError, TypeError, OverflowError):
            return 0
    success_at = safe_stamp(state.get("last_success_at") or state.get("updated_at"))
    new_at = safe_stamp(state.get("last_new_draw_at"))
    if new_at > now:
        new_at = 0
    fresh = bool(draws and new_at and 0 <= now - new_at <= 180)
    latest = draws[0] if draws and isinstance(draws[0], dict) else {}
    issue = str(latest.get("issueNumber") or latest.get("issue") or "")[:40]
    return {
        "observedRecently": fresh,
        "records": len(draws),
        "latestIssue": issue,
        "lastSuccessfulReadAt": success_at or None,
        "lastNewIssueObservedAt": new_at or None,
        "secondsSinceNewIssue": now - new_at if new_at else None,
        "sourceStatus": str(state.get("status") or "unknown")[:120],
    }


@app.get("/api/connection-status")
def connection_status():
    data = read_data()
    if isinstance(data, dict) and "error" in data:
        return jsonify({"ok": False, "service": "responding", "error": "data_unavailable"}), 503
    now = int(time.time())
    sources = {name: _source_status(data.get(name), now) for name in MULTI_GAMES}
    return jsonify({
        "ok": True,
        "service": "responding",
        "checkedAt": now,
        "multiGameSources": sources,
        "browserRuntime": public_status(),
        "release": "V29",
        "anyNewIssueObservedRecently": any(item["observedRecently"] for item in sources.values()),
        "note": "The API responds; fresh timestamps are not proof of an authorized or continuous external game feed."
    })


@app.get("/api/data")
def api_data():
    data = read_data()
    if "error" in data:
        return jsonify(data), 503
    return jsonify(data)


@app.get("/data.json")
def data_json():
    data = read_data()
    if "error" in data:
        return jsonify(data), 503
    return jsonify(data)


@app.get("/api/choice-diagnostic")
def choice_diagnostic():
    report_path = Path(os.getenv("CHOICE_DIAGNOSTIC_REPORT", "/tmp/choice_full_diagnostic.json"))
    try:
        with report_path.open("r", encoding="utf-8") as f:
            report = json.load(f)
        if not isinstance(report, dict):
            raise ValueError("diagnostic report is not an object")
        return jsonify(report)
    except FileNotFoundError:
        return jsonify({"ok": False, "status": "not-run-yet"}), 404
    except Exception as exc:
        return jsonify({"ok": False, "error": f"diagnostic read failed: {type(exc).__name__}"}), 500


@app.get("/api/choice-status")
def choice_status():
    """Report safe high-level Choice transport status, without session data."""
    status_path = BASE_DIR / "choice_status.json"
    try:
        data = json.loads(status_path.read_text(encoding="utf-8"))
        if not isinstance(data, dict):
            raise ValueError("status is not an object")
        return jsonify(data)
    except FileNotFoundError:
        return jsonify({"status": "not_started", "note": "No Choice diagnostic status yet"}), 200
    except (ValueError, OSError):
        return jsonify({"status": "invalid_status"}), 500


@app.post("/api/ingest")
def ingest():
    global _last_ingest_at, _last_sender_updated_at

    ok, reason = _authorized()
    if not ok:
        status = 503 if "not configured" in reason else 401
        return jsonify({"ok": False, "error": reason}), status

    payload = request.get_json(silent=True)
    if not _valid_snapshot(payload):
        return jsonify({"ok": False, "error": "invalid snapshot"}), 400

    incoming_updated = _snapshot_updated_at(payload)

    with WRITE_LOCK:
        existing = read_data()
        existing_updated = _snapshot_updated_at(existing)
        if incoming_updated and existing_updated and incoming_updated < existing_updated:
            return (
                jsonify(
                    {
                        "ok": False,
                        "error": "stale snapshot",
                        "existingUpdatedAt": existing_updated,
                        "incomingUpdatedAt": incoming_updated,
                    }
                ),
                409,
            )
        try:
            _atomic_write(payload)
        except Exception as exc:
            return jsonify({"ok": False, "error": f"write failed: {type(exc).__name__}"}), 500

        _last_ingest_at = int(time.time())
        _last_sender_updated_at = incoming_updated

    return jsonify(
        {
            "ok": True,
            "receivedAt": _last_ingest_at,
            "updatedAt": incoming_updated,
        }
    )


if __name__ == "__main__":
    port = int(os.getenv("PORT", "8080"))
    app.run(host="0.0.0.0", port=port, threaded=True)
