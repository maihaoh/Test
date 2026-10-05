#!/usr/bin/env bash
set -euo pipefail
export PYTHONUNBUFFERED=1
PORT="${PORT:-10000}"

echo "[Render] starting realtime API on port ${PORT}..."
python -m waitress --listen="0.0.0.0:${PORT}" realtime_api:app &
API_PID=$!

echo "[Render] realtime API PID: ${API_PID}"
for i in $(seq 1 30); do
  if python - <<PY >/dev/null 2>&1
import urllib.request
urllib.request.urlopen('http://127.0.0.1:${PORT}/health', timeout=2).read()
PY
  then
    break
  fi
  sleep 1
done

echo "[Render] starting direct Choice + WinGo collector..."
python -u direct_choice_render.py &
COLLECTOR_PID=$!
echo "[Render] collector PID: ${COLLECTOR_PID}"

cleanup() {
  kill "${COLLECTOR_PID}" "${API_PID}" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

while true; do
  if ! kill -0 "${API_PID}" 2>/dev/null; then
    echo '[Render] ERROR: realtime API stopped.'
    exit 1
  fi
  if ! kill -0 "${COLLECTOR_PID}" 2>/dev/null; then
    echo '[Render] ERROR: direct collector stopped.'
    exit 1
  fi
  sleep 5
done
