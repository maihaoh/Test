# Render Choice protocol V14

V14 is deliberately limited to protocol facts recovered from the supplied
`choice-result-protocol-report(1).json` and earlier screenshots.

It adds:

- the observed 12-byte application heartbeat (`id=1, len=12, seq`), every 25s;
- exact `SUBSCRIBE_VIDEO_LIST=77829` for D051-D058;
- parsing/logging of `SUBSCRIBE_VIDEO_LIST_R=143365` (`retCode`, returned vids);
- parsing/logging of the fixed prefix of `CLIENT_LOGIN_GAME_PROTO_R=143362` if seen;
- existing `BAC_FULL_RESULT_LIST=135176` decoder and Render/data.json integration.

It does **not** fabricate `CLIENT_LOGIN_GAME_PROTO=77826`. The supplied source
analysis explicitly states that the actual 77826 login request/session bootstrap
was not recovered. If the server closes without a 143365 acknowledgement, the log
now says that explicitly instead of pretending the subscription succeeded.

Expected useful log outcomes:

- `subscription ack 143365 retCode=0 ...` -> subscription accepted; wait for 135176.
- `packet id=135176` / `BAC 135176 verified ...` -> live result path is working.
- `no 143365 subscription acknowledgement ...` -> application login/bootstrap is
  still required before subscription; another arbitrary 77829 variation will not
  fix it.
