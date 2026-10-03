#!/usr/bin/env bash
set -euo pipefail

PORT="${PORT:-10000}"

echo "[Render] starting collector..."
python -u bot.py &
BOT_PID=$!

echo "[Render] collector PID: ${BOT_PID}"
echo "[Render] starting realtime API on port ${PORT}..."
python -m waitress --listen="0.0.0.0:${PORT}" realtime_api:app &
API_PID=$!

cleanup() {
  kill -TERM "$BOT_PID" "$API_PID" 2>/dev/null || true
  wait "$BOT_PID" "$API_PID" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

# If either process exits, stop the service so Render restarts it instead of
# leaving a misleading 'Live' API with a dead collector.
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
