import json
import os
from pathlib import Path
from flask import Flask, jsonify, send_from_directory, make_response

BASE_DIR = Path(__file__).resolve().parent
DATA_FILE = BASE_DIR / "data.json"

app = Flask(__name__)

def read_data():
    try:
        with DATA_FILE.open("r", encoding="utf-8") as f:
            data = json.load(f)
        return data if isinstance(data, dict) else {}
    except Exception as exc:
        return {"error": str(exc)}

@app.after_request
def cors(resp):
    # Public read-only result API for the dashboard.
    resp.headers["Access-Control-Allow-Origin"] = os.getenv(
        "DASHBOARD_ORIGIN", "https://maihaoh.github.io"
    )
    resp.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
    return resp

@app.get("/health")
def health():
    return jsonify({"ok": True})

@app.get("/api/data")
def api_data():
    return jsonify(read_data())

@app.get("/data.json")
def data_json():
    return jsonify(read_data())

if __name__ == "__main__":
    port = int(os.getenv("PORT", "8080"))
    app.run(host="0.0.0.0", port=port, threaded=True)
