#!/usr/bin/env bash
set -euo pipefail
python -m pip install --upgrade pip
python -m pip install -r requirements-render.txt
echo '[Render/Build] dependencies installed.'
