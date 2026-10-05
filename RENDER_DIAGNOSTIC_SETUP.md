# Render ALL-IN-ONE Choice Diagnostic

This build runs one full Choice diagnostic automatically every time the Render service starts, then starts the normal collector.

## Required Render environment variables

Set these in Render -> Service -> Environment:

- `MZPLAY_AUTH_STATE_B64` — paste the complete content of your locally generated `MZPLAY_AUTH_STATE_B64.txt`.
- `MZPLAY_DEVICE_ID` — your configured MZPlay device ID (kept only in Render secrets).
- `INGEST_SECRET` — the existing ingest secret used by `/api/ingest`.

Existing `MZPLAY_USERNAME` / `MZPLAY_PASSWORD` may remain configured, but the diagnostic never performs UI login and never prints them.

## Where to read the result

1. Deploy/redeploy the service.
2. Open Render Logs.
3. Find `RENDER DIAGNOSTIC SUMMARY`.
4. The same safe report is also exposed at `/api/choice-diagnostic` after the diagnostic completes.

The report never prints passwords, access tokens, refresh tokens, cookies, or secret values.
