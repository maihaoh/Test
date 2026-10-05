import os
import threading
import time

from remote_push import push_loop


def _require_env():
    missing = []
    for key in ("MZPLAY_USERNAME", "MZPLAY_PASSWORD", "MZPLAY_DEVICE_ID", "INGEST_SECRET"):
        if not str(os.getenv(key) or "").strip():
            missing.append(key)
    if missing:
        raise RuntimeError("missing required environment variables: " + ", ".join(missing))


def _relay_worker():
    while True:
        try:
            push_loop()
            return
        except RuntimeError as exc:
            print(f"[Relay] fatal configuration error: {exc}")
            return
        except Exception as exc:
            print(f"[Relay] {type(exc).__name__}: relay worker restarting in 15s")
            time.sleep(15)


def main():
    _require_env()
    import bot

    relay = threading.Thread(target=_relay_worker, name="render-relay", daemon=True)
    relay.start()
    bot.main()


if __name__ == "__main__":
    main()
