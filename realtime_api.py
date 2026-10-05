import hmac
import json
import os
import threading
import time
from pathlib import Path

from flask import Flask, jsonify, request

BASE_DIR = Path(__file__).resolve().parent
DATA_FILE = BASE_DIR / "data.json"
TEMP_FILE = BASE_DIR / "data.json.ingest.tmp"
WRITE_LOCK = threading.Lock()
MAX_BODY_BYTES = int(os.getenv("INGEST_MAX_BYTES", str(4 * 1024 * 1024)))

app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = MAX_BODY_BYTES

_last_ingest_at = 0
_last_sender_updated_at = 0


def read_data():
    try:
        with DATA_FILE.open("r", encoding="utf-8") as f:
            data = json.load(f)
        return data if isinstance(data, dict) else {}
    except FileNotFoundError:
        return {}
    except Exception as exc:
        return {"error": f"data read failed: {type(exc).__name__}"}


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
    if not isinstance(data, dict):
        return False
    expected_sections = {"wingo", "baccarat", "k3", "5d", "trx"}
    return bool(expected_sections.intersection(data.keys()))


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


@app.get("/api/data")
def api_data():
    return jsonify(read_data())


@app.get("/data.json")
def data_json():
    return jsonify(read_data())


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
