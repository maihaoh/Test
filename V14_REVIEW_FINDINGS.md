# Choice V14 source review (no invented authentication)

This package is an audited version of the **user-uploaded V14 project**.
It keeps the existing Render API and WinGo collector.

## Main finding

V14 directly connects to `wss://ng211.mdvuz.com:5000`, then sends heartbeat
and `SUBSCRIBE_VIDEO_LIST=77829`. **It does not send**
`CLIENT_LOGIN_GAME_PROTO=77826` and therefore cannot claim a successful game
login. The user-supplied `choice-ws-login-capture.json` includes **zero** sockets
and **zero** records. No real 77826 login payload was available to implement.
The user's protocol report identifies 77829 and 143365 and states that
subscription normally follows game login. Source code alone cannot provide an
accepted game session/launch ticket, especially where the server returns 401 or
an official website access denial.

The four V14 outgoing heartbeats seen in Render are not evidence that the server
has responded; the logs report **sent** not **received**.

## Improvements in this reviewed package

- Explicitly reports `received_frames`, `received_packets`,
  `subscription_ack_seen`, `subscription_ack_accepted` and `result_snapshots`.
  No incoming packet payloads, tokens or cookies are logged or stored.
- After **90 seconds** with no 143365 acknowledgement, reports a clear
  `ACK_TIMEOUT`, closes the socket and retries at most **two** times total.
  After that, Choice stops probing, without stopping WinGo or the API.
- Logs nonzero 143365 return code as **REJECTED**, not a green success.
- Limits untrusted returned room count; avoids stale heartbeat worker threads.
- Corrects an embedded-JS Python escape warning in `mzplay_multi.py`.
- Disables the old GitHub `choice-collector.yml` four-hour schedule to avoid
  simultaneous/blocked GitHub retries; the workflow remains manually runnable.
- New read-only `GET /api/choice-status` reports high-level status; it will never
  contain credentials or arbitrary WebSocket payloads.

## Deployment (optional)

This is **a diagnostic/safety correction, not a live Choice authorization fix**.
Do not deploy it expecting it to manufacture authenticated Choice results.

If deploying: overwrite the GitHub repo root with the root-level files in the
ZIP; keep existing Render environment secrets unchanged, and retain

- Build Command: `bash ./render_build.sh`
- Start Command: `bash ./start_render.sh`

After deployment, inspect `https://test-4bvi.onrender.com/api/choice-status`.
If `received_frames=0` and `subscription_ack_seen=false`, the server delivered
no application frames in that interval. If `received_frames>0`, packet framing
or the actual reply ID may need further diagnosis. The endpoint cannot prove
*why* the upstream did not reply.

For reliable 24/7 live Choice data, the collector must run with a legitimate,
provider-accepted game launch/session/WS authorization flow. If this is not
available via the supplied source, obtain the appropriate official integration
or host the official client on an always-on environment where access is
permitted. Do not reuse a revoked or blocked token and do not bypass access
controls.

## Important Render Free limitation

The existing `render.yaml` sets `plan: free`. Render's official documentation
says Free web services spin down after 15 minutes without **incoming** HTTP
requests or WebSocket messages. Outgoing Choice heartbeats are not incoming
traffic to the Render web service. Free instances also lose changes to their
local files on spin-down/redeploy. Therefore **this service is not a reliable
always-on 24/7 collector/data store**, even after obtaining an accepted
session. A permitted always-on host or paid service with durable storage is
needed for that requirement.

https://render.com/docs/free

## Offline checks

The included unit tests cover parsing, outbound order, bounded retries,
incoming packet observability, and the safe status endpoint. They do **not**
represent a live authenticated server test.
