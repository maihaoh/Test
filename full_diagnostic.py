from __future__ import annotations

import base64
import json
import os
import socket
import tempfile
import time
from pathlib import Path
from urllib.parse import urlparse

import requests

ROOT = Path(__file__).resolve().parent
REPORT_PATH = Path(os.getenv("CHOICE_DIAGNOSTIC_REPORT", "/tmp/choice_full_diagnostic.json"))
rows: list[tuple[str, str, str]] = []


def add(name: str, status: str, detail: str = "") -> None:
    status = status.upper()
    detail = str(detail)[:220]
    rows.append((name, status, detail))
    print(f"[DIAG] {name}: {status}" + (f" - {detail}" if detail else ""), flush=True)


def yn(value) -> str:
    return "yes" if value else "no"


def safe_body(response) -> str:
    try:
        body = response.json()
        if isinstance(body, dict):
            return (
                f"code={body.get('code')} msgCode={body.get('msgCode')} "
                f"msg={body.get('msg') or body.get('message') or ''}"
            )[:180]
    except Exception:
        pass
    return (response.text or "")[:120].replace("\n", " ")


def load_bootstrap_state() -> dict:
    raw = str(os.getenv("MZPLAY_AUTH_STATE_B64") or "").strip()
    if raw:
        try:
            value = json.loads(base64.b64decode(raw, validate=True).decode("utf-8"))
            if isinstance(value, dict):
                add("Decode session", "PASS", "MZPLAY_AUTH_STATE_B64 -> JSON object")
                return value
            add("Decode session", "FAIL", "decoded value is not a JSON object")
        except Exception as exc:
            add("Decode session", "FAIL", type(exc).__name__)
        return {}

    local_state = ROOT / "mzplay_auth_state.json"
    if local_state.exists():
        try:
            value = json.loads(local_state.read_text(encoding="utf-8"))
            if isinstance(value, dict):
                add("Decode session", "PASS", "local mzplay_auth_state.json")
                return value
        except Exception as exc:
            add("Decode session", "FAIL", f"local state: {type(exc).__name__}")
            return {}

    add("Decode session", "FAIL", "MZPLAY_AUTH_STATE_B64 missing")
    return {}


def tcp_probe(host: str, port: int, timeout: float = 6.0) -> tuple[bool, str]:
    try:
        started = time.time()
        with socket.create_connection((host, port), timeout=timeout):
            elapsed = int((time.time() - started) * 1000)
        return True, f"{host}:{port} reachable ({elapsed}ms)"
    except Exception as exc:
        return False, f"{host}:{port} {type(exc).__name__}: {exc}"


def write_report() -> None:
    first_fail = next((name for name, status, _ in rows if status == "FAIL"), "No hard failure detected")
    report = {
        "generatedAtEpoch": int(time.time()),
        "environment": "Render" if os.getenv("RENDER") or os.getenv("RENDER_SERVICE_ID") else "unknown",
        "firstHardFailure": first_fail,
        "checks": [
            {"name": name, "status": status, "detail": detail}
            for name, status, detail in rows
        ],
    }
    try:
        REPORT_PATH.parent.mkdir(parents=True, exist_ok=True)
        REPORT_PATH.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    except Exception as exc:
        print(f"[DIAG] report write failed: {type(exc).__name__}: {exc}", flush=True)


def main() -> int:
    print("================ RENDER CHOICE FULL DIAGNOSTIC ================", flush=True)
    add("Execution environment", "PASS", "Render diagnostic startup run")

    # Render does not need MZPLAY_STATE_KEY. It consumes the already exported base64 JSON state.
    required = ["MZPLAY_AUTH_STATE_B64", "MZPLAY_DEVICE_ID", "INGEST_SECRET"]
    missing = [key for key in required if not os.getenv(key)]
    add("Render env vars", "PASS" if not missing else "FAIL", "missing=" + ",".join(missing) if missing else "required vars present")

    state = load_bootstrap_state()
    token = state.get("token") or state.get("accessToken") or state.get("access_token") or state.get("ar_token") or ""
    refresh = state.get("refreshToken") or state.get("refresh_token") or ""
    device = state.get("deviceId") or state.get("arvId") or os.getenv("MZPLAY_DEVICE_ID", "")
    token_header = state.get("tokenHeader") or state.get("token_header") or "Bearer"
    add(
        "Session fields",
        "PASS" if token else "FAIL",
        f"token={yn(token)} refresh={yn(refresh)} device={yn(device)} tokenHeader={yn(token_header)}",
    )

    # Offline pipeline checks.
    try:
        from choice_result_decoder import build_subscribe_packet, DEFAULT_VIDS, decode_wininfo

        packet = build_subscribe_packet(DEFAULT_VIDS)
        values = [decode_wininfo(x) for x in (1, 2, 4)]
        add("D051-D058 decoder", "PASS", f"subscribe_bytes={len(packet)} offline_wininfo={len(values)}")
    except Exception as exc:
        add("D051-D058 decoder", "FAIL", f"{type(exc).__name__}: {exc}")

    try:
        path = ROOT / "data.json"
        obj = json.loads(path.read_text(encoding="utf-8"))
        with tempfile.NamedTemporaryFile("w", delete=True, encoding="utf-8") as handle:
            json.dump(obj, handle)
            handle.flush()
        add("data.json writer", "PASS", f"json_object={isinstance(obj, dict)}")
    except Exception as exc:
        add("data.json writer", "FAIL", type(exc).__name__)

    # Basic outbound network tests independent of MZPlay authentication.
    for port in (7101, 5000):
        ok, detail = tcp_probe("ng211.mdvuz.com", port)
        add(f"Choice TCP :{port}", "PASS" if ok else "FAIL", detail)

    # Direct MZPlay API contract: no UI login and no retry loop.
    try:
        from mzplay_multi import MZPlayClient, load_config

        client = MZPlayClient(load_config())
        if token:
            client.token = str(token)
        if refresh:
            client.refresh_token = str(refresh)
        if device:
            client.device_id = str(device)
        if token_header:
            client.token_header = str(token_header)

        auth = {"Authorization": client._auth_header()} if client.token else {}
        tests = [
            ("GetK3 history", "/GetK3NoaverageEmerdList", {"pageSize": 10, "pageNo": 1, "typeId": 9}),
            ("GetGameUrl", "/GetGameUrl", {"vendorCode": "AG_Video", "returnUrl": "https://mzplay0.com", "deviceType": 3}),
        ]
        for name, path, payload in tests:
            try:
                response = client._post_json(path, client._signed(payload), headers=auth, timeout=20)
                ok = response.status_code == 200
                detail = f"HTTP={response.status_code} {safe_body(response)}"
                if ok:
                    try:
                        body = response.json()
                        ok = isinstance(body, dict) and body.get("code") in (None, 0)
                    except Exception:
                        pass
                add(name, "PASS" if ok else "FAIL", detail)
            except Exception as exc:
                add(name, "FAIL", f"{type(exc).__name__}: {exc}")

        if refresh:
            try:
                headers = {"Authorization": client._auth_header(refresh=True)}
                response = client._post_json("/RefreshToken", client._signed({}), headers=headers, timeout=20)
                ok = response.status_code == 200
                try:
                    body = response.json()
                    ok = ok and isinstance(body, dict) and body.get("code") in (None, 0)
                except Exception:
                    pass
                add("RefreshToken", "PASS" if ok else "FAIL", f"HTTP={response.status_code} {safe_body(response)}")
            except Exception as exc:
                add("RefreshToken", "FAIL", f"{type(exc).__name__}: {exc}")
        else:
            add("RefreshToken", "SKIP", "refresh token missing")
    except Exception as exc:
        add("MZPlay API client", "FAIL", f"{type(exc).__name__}: {exc}")

    # Browser/official-site test. Never performs username/password login and never bypasses Cloudflare.
    try:
        from playwright.sync_api import sync_playwright

        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(headless=True, args=["--disable-dev-shm-usage", "--no-sandbox"])
            context = browser.new_context(
                user_agent=(
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                    "(KHTML, like Gecko) Chrome/154.0.0.0 Safari/537.36"
                )
            )
            token_js = json.dumps(str(token))
            header_js = json.dumps(str(token_header))
            refresh_js = json.dumps(str(refresh))
            device_js = json.dumps(str(device))
            # Seed common aliases used by different MZPlay builds. This only reuses the user's authorized state.
            context.add_init_script(
                script=f"""
                try {{
                  localStorage.setItem('ar_token', {token_js});
                  localStorage.setItem('token', {token_js});
                  localStorage.setItem('accessToken', {token_js});
                  localStorage.setItem('tokenHeader', {header_js});
                  localStorage.setItem('refreshToken', {refresh_js});
                  localStorage.setItem('arvId', {device_js});
                  localStorage.setItem('deviceId', {device_js});
                }} catch (e) {{}}
                """
            )

            sockets: list[str] = []

            def attach_page(page):
                page.on("websocket", lambda ws: sockets.append(str(ws.url or "")))

            context.on("page", attach_page)
            page = context.new_page()
            attach_page(page)
            try:
                page.goto("https://mzplay0.com/", wait_until="domcontentloaded", timeout=45_000)
            except Exception:
                pass
            page.wait_for_timeout(1800)
            title = page.title() or ""
            try:
                body = (page.locator("body").inner_text(timeout=4000) or "")[:800]
            except Exception:
                body = ""
            try:
                path = page.evaluate("() => location.pathname") or ""
            except Exception:
                path = ""

            blocked = "Attention Required" in title or "Sorry, you have been blocked" in body
            login_page = str(path).lower().startswith("/login")
            if blocked:
                add("MZPlay website", "FAIL", "CLOUDFLARE_BLOCKED")
            elif login_page:
                add("MZPlay website", "FAIL", "SESSION_NOT_ACCEPTED /login")
            else:
                add("MZPlay website", "PASS", f"path={path}")

            choice = None
            if not blocked and not login_page:
                for selector in [
                    "text=CHOICE",
                    "text=Choice",
                    "img[src*='choice' i]",
                    "a:has-text('CHOICE')",
                    "button:has-text('CHOICE')",
                ]:
                    try:
                        loc = page.locator(selector)
                        for idx in range(min(loc.count(), 10)):
                            candidate = loc.nth(idx)
                            if candidate.is_visible():
                                choice = candidate
                                break
                    except Exception:
                        pass
                    if choice is not None:
                        break

            if choice is None:
                add("Choice launch", "NOT REACHED" if blocked or login_page else "FAIL", "tile not reachable")
            else:
                try:
                    choice.click(timeout=10_000)
                    deadline = time.time() + 30
                    while time.time() < deadline and not sockets:
                        for current in context.pages:
                            try:
                                current.wait_for_timeout(150)
                            except Exception:
                                pass
                        time.sleep(0.1)
                    add("Choice launch", "PASS" if sockets else "FAIL", "official UI clicked; websocket=" + yn(sockets))
                except Exception as exc:
                    add("Choice launch", "FAIL", type(exc).__name__)

            game_sockets = [url for url in sockets if "mdvuz.com" in url or "e9p1.com" in url]
            ports = {urlparse(url).port for url in game_sockets if urlparse(url).port}
            add("Choice WS :7101", "PASS" if 7101 in ports else "NOT REACHED", f"observed_ports={sorted(ports)}")
            add("Choice WS :5000", "PASS" if 5000 in ports else "NOT REACHED", f"observed_ports={sorted(ports)}")
            add(
                "BAC 135176 live",
                "NOT REACHED",
                "live packet capture requires reachable Choice websocket" if not game_sockets else "game socket reached; normal collector decodes packets",
            )
            browser.close()
    except Exception as exc:
        add("MZPlay website", "FAIL", f"browser {type(exc).__name__}: {exc}")
        add("Choice launch", "NOT REACHED", "browser unavailable")
        add("Choice WS :7101", "NOT REACHED", "browser unavailable")
        add("Choice WS :5000", "NOT REACHED", "browser unavailable")
        add("BAC 135176 live", "NOT REACHED", "browser unavailable")

    # Test the Render ingest endpoint after the API process has started.
    try:
        url = os.getenv("DIAG_PUSH_URL") or os.getenv("PUSH_URL") or ""
        secret = os.getenv("INGEST_SECRET", "")
        data = (ROOT / "data.json").read_bytes()
        if not url:
            add("Render ingest endpoint", "SKIP", "DIAG_PUSH_URL/PUSH_URL missing")
        elif not secret:
            add("Render ingest endpoint", "FAIL", "INGEST_SECRET missing")
        else:
            response = requests.post(
                url,
                data=data,
                headers={"Authorization": f"Bearer {secret}", "Content-Type": "application/json", "User-Agent": "RenderChoiceDiagnostic/1"},
                timeout=30,
            )
            if response.status_code == 200:
                add("Render ingest endpoint", "PASS", "HTTP=200")
            elif response.status_code == 409:
                add("Render ingest endpoint", "PASS", "HTTP=409 endpoint reachable; snapshot rejected as stale/duplicate")
            else:
                add("Render ingest endpoint", "FAIL", f"HTTP={response.status_code}")
    except Exception as exc:
        add("Render ingest endpoint", "FAIL", f"{type(exc).__name__}: {exc}")

    print("\n================ RENDER DIAGNOSTIC SUMMARY ====================", flush=True)
    for name, status, detail in rows:
        print(f"{name:28} {status:12} {detail}", flush=True)
    failures = [name for name, status, _ in rows if status == "FAIL"]
    root = failures[0] if failures else "No hard failure detected"
    print("===============================================================", flush=True)
    print("FIRST HARD FAILURE:", root, flush=True)
    print("No passwords, tokens, cookies, or secret values were printed.", flush=True)
    write_report()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
