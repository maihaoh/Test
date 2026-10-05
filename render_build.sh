#!/usr/bin/env bash
set -euo pipefail

echo "[Render/Build] installing Python dependencies..."
python -m pip install --upgrade pip
python -m pip install -r requirements.txt

echo "[Render/Build] installing Playwright Chromium..."
python -m playwright install chromium

echo "[Render/Build] validating Python sources..."
python -m py_compile bot.py mzplay_multi.py choice_collector.py choice_result_decoder.py realtime_api.py run_once.py full_diagnostic.py

echo "[Render/Build] complete."
