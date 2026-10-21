#!/usr/bin/env bash
set -euo pipefail

python -m pip install --upgrade pip
python -m pip install -r requirements-render.txt

# Render's native "Python 3" service ignores Dockerfile. The Chromium bundle
# must be installed at build time for the official MZPlay web-login fallback.
# This downloads the browser only; OS library availability is checked when
# the login runs. If the native image lacks libraries, a Docker runtime is
# required rather than claiming that API permissions can be bypassed.
if [[ "${MZPLAY_INSTALL_BROWSER:-1}" != "0" ]]; then
    echo '[Render/Build] downloading Playwright Chromium for native Python runtime...'
    python -m playwright install chromium
    echo '[Render/Build] Chromium download complete.'
else
    echo '[Render/Build] MZPlay browser install skipped by MZPLAY_INSTALL_BROWSER=0.'
fi

echo '[Render/Build] Python dependencies installed.'
