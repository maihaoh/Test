# Choice V15 evidence-safe diagnostic patch

**Not a working real-time Choice fix. Do not deploy as a production replacement.**

Verified from the metadata capture: browser port 7101 sends 77826 and 77829; browser port 5000 receives 135176. The capture contains only protocol identifiers, timestamps and lengths; it cannot supply valid session-specific login or launch data.

This patch removes the V14 guessed application heartbeat (ID 1) and premature unauthenticated subscription (77829), and reports `awaiting_authorized_game_bootstrap` instead of implying success. WinGo, API, decoder and frontend are unchanged. It is an **observer/diagnostic** build, not a collector that can log in.

To finish live integration, use a supported authorized session/bootstrap source and verify its behavior on Render; do not hard-code captured login bytes or bypass Cloudflare.
