# Render Direct Choice mode

This mode intentionally does not log in to MZPlay and does not call MZPlay APIs.
It only attempts the previously observed Choice result WebSocket endpoint and
subscribes to D051-D058. If the endpoint rejects unauthenticated/public access,
the collector stops/retries without attempting to bypass authentication.

Render settings:
- Build Command: `bash ./render_build.sh`
- Start Command: `bash ./start_render.sh`

No MZPLAY_* environment variable is required for this mode.
Keep `INGEST_SECRET` only if you still use `/api/ingest` from another trusted sender.

Expected success logs:
- `[Choice/Direct] WebSocket connected`
- `subscribe D51` ... `subscribe D58`
- `[Choice/Direct] packet id=135176 ...`
- `[Choice D51] snapshot=...` (or D52-D58)

If the WebSocket closes/rejects before verified result packets arrive, do not
attempt to circumvent the service's access controls; use an authorized host/session.
