#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
export PYTHONUNBUFFERED=1
python -m pip install -r requirements-render.txt
# Uses the same Python, browser path and Chromium channel as runtime.
# No MZPlay credentials are submitted by this install/launch verification.
python browser_runtime.py --install --check
python -m compileall -q . -x '(^|/)(\.playwright-browsers|\.venv|public-site)/'
echo '[Render/Build] V29 Chromium launch verified; account connection not tested.'
