# Render ALL-IN-ONE setup (V11)

This version self-heals missing Python dependencies at startup and includes a dedicated build script.

Recommended Render settings:

- Build Command: `bash ./render_build.sh`
- Start Command: `bash ./start_render.sh`

Required environment variables:

- `MZPLAY_AUTH_STATE_B64`
- `MZPLAY_DEVICE_ID`
- `INGEST_SECRET`

Optional existing variables can remain unchanged.

The startup sequence is:

1. Verify/install Python runtime dependencies.
2. Verify/install Playwright Chromium.
3. Start the realtime API.
4. Run the complete Choice diagnostic once.
5. Start the normal collector.

The diagnostic never prints passwords, tokens, cookies, or secret values.
