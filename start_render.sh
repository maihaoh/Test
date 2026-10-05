#!/usr/bin/env bash
set -euo pipefail

PORT="${PORT:-10000}"
export DIAG_PUSH_URL="http://127.0.0.1:${PORT}/api/ingest"
export CHOICE_DIAGNOSTIC_REPORT="/tmp/choice_full_diagnostic.json"

echo "[Render] starting realtime API on port ${PORT}..."
python -m waitress --listen="0.0.0.0:${PORT}" realtime_api:app &
API_PID=$!

echo "[Render] realtime API PID: ${API_PID}"

# Give the local API a moment to bind. Do not fail deployment if the diagnostic itself finds failures.
for _ in $(seq 1 20); do
  if python - <<'PY' >/dev/null 2>&1
import os, urllib.request
port = os.getenv('PORT', '10000')
urllib.request.urlopen(f'http://127.0.0.1:{port}/health', timeout=1).read()
PY
  then
    break
  fi
  sleep 0.5
done

echo "[Render] running ALL-IN-ONE Choice diagnostic..."
python -u full_diagnostic.py || true

echo "[Render] starting collector..."
python -u bot.py &
BOT_PID=$!
echo "[Render] collector PID: ${BOT_PID}"

cleanup() {
  kill -TERM "$BOT_PID" "$API_PID" 2>/dev/null || true
  wait "$BOT_PID" "$API_PID" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

while true; do
  if ! kill -0 "$BOT_PID" 2>/dev/null; then
    echo "[Render] ERROR: bot.py stopped; exiting so Render can restart the service."
    wait "$BOT_PID" || true
    exit 1
  fi
  if ! kill -0 "$API_PID" 2>/dev/null; then
    echo "[Render] ERROR: realtime API stopped; exiting so Render can restart the service."
    wait "$API_PID" || true
    exit 1
  fi
  sleep 5
done
