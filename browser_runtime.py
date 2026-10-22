"""Shared Chromium install/launch contract. No account data or network login.

Build and runtime resolve the same project-local browser directory, instead of
relying on the (potentially different) home directories of the two processes.
Playwright's full Chromium channel is installed AND used, not headless_shell.
"""
from __future__ import annotations
import argparse
import importlib.metadata
import json
import os
from pathlib import Path
import subprocess
import sys
import time

ROOT = Path(__file__).resolve().parent
REPORT = ROOT / 'browser_runtime.json'


def configure_browser_path() -> str:
    value = os.environ.get('PLAYWRIGHT_BROWSERS_PATH', '').strip()
    if not value:
        value = str(ROOT / '.playwright-browsers')
    elif value != '0':
        path = Path(value).expanduser()
        value = str((path if path.is_absolute() else ROOT / path).resolve())
    os.environ['PLAYWRIGHT_BROWSERS_PATH'] = value
    return value


class BrowserRuntimeError(RuntimeError):
    def __init__(self, category: str):
        self.category = category
        super().__init__(category)


def failure_category(exc: Exception) -> str:
    if isinstance(exc, BrowserRuntimeError):
        return exc.category
    reason = str(exc).lower()
    if 'executable doesn\'t exist' in reason or 'no executable' in reason:
        return 'chromium_not_installed'
    if any(s in reason for s in ('shared libraries', 'host system is missing dependencies', 'libnspr4', 'libnss3', 'libgbm', 'libasound')):
        return 'system_libraries_missing'
    if 'permission denied' in reason or 'eacces' in reason:
        return 'browser_executable_permission'
    if 'sandbox' in reason and ('failed' in reason or 'no usable' in reason):
        return 'browser_sandbox_failed'
    if 'timeout' in reason or 'timeout' in type(exc).__name__.lower():
        return 'browser_launch_timeout'
    if 'target closed' in reason or 'browser has been closed' in reason or 'sigkill' in reason:
        return 'browser_closed_or_resource_limit'
    return 'chromium_launch_failed'


def launch_chromium(playwright):
    # Must be configured before starting the Playwright driver.
    path = Path(playwright.chromium.executable_path)
    if not path.is_file():
        raise BrowserRuntimeError('chromium_not_installed')
    if os.name != 'nt' and not os.access(path, os.X_OK):
        raise BrowserRuntimeError('browser_executable_permission')
    return playwright.chromium.launch(
        channel='chromium', headless=True, timeout=30000,
        args=['--disable-dev-shm-usage'],
    )


def public_status() -> dict:
    """Allowlist report fields. Never expose arbitrary persisted values."""
    try:
        raw = json.loads(REPORT.read_text(encoding='utf-8'))
    except (OSError, ValueError):
        return {'status': 'not_checked', 'note': 'Browser ready does not mean account authorized.'}
    if not isinstance(raw, dict):
        return {'status': 'check_failed', 'note': 'Invalid local diagnostic file.'}
    allowed = {'ready', 'chromium_not_installed', 'playwright_package_missing',
               'system_libraries_missing', 'browser_executable_permission',
               'browser_sandbox_failed', 'browser_launch_timeout',
               'browser_closed_or_resource_limit', 'chromium_launch_failed', 'check_failed'}
    status = raw.get('status') if isinstance(raw.get('status'), str) and raw.get('status') in allowed else 'check_failed'
    return {'status': status, 'checkedAt': raw.get('checkedAt') if isinstance(raw.get('checkedAt'), int) else None,
            'executableFound': raw.get('executableFound') is True,
            'launchVerified': raw.get('launchVerified') is True,
            'release': 'V33', 'note': 'Browser ready does not mean account authorized.'}


def check_browser(write_report: bool = True) -> dict:
    configure_browser_path()
    result = {'release': 'V33', 'status': 'check_failed', 'checkedAt': int(time.time()),
              'executableFound': False, 'launchVerified': False}
    try:
        from playwright.sync_api import sync_playwright
        result['playwrightVersion'] = importlib.metadata.version('playwright')
        with sync_playwright() as p:
            result['executableFound'] = Path(p.chromium.executable_path).is_file()
            browser = launch_chromium(p)
            try:
                page = browser.new_page()
                page.set_content('<title>browser-preflight</title>')
                if page.title() != 'browser-preflight':
                    raise BrowserRuntimeError('check_failed')
                result.update(status='ready', launchVerified=True)
            finally:
                browser.close()
    except ImportError:
        result['status'] = 'playwright_package_missing'
    except Exception as exc:
        result['status'] = failure_category(exc)
    if write_report:
        tmp = REPORT.with_suffix('.json.tmp')
        tmp.write_text(json.dumps(result), encoding='utf-8')
        os.replace(tmp, REPORT)
    # Do not print exception text, environment values or account information.
    print('[Browser/Check] ' + json.dumps(result), flush=True)
    return result


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument('--install', action='store_true')
    parser.add_argument('--with-deps', action='store_true', help='Docker/root only')
    parser.add_argument('--check', action='store_true')
    args = parser.parse_args()
    configure_browser_path()
    if args.install:
        command = [sys.executable, '-m', 'playwright', 'install', '--no-shell']
        if args.with_deps:
            command.append('--with-deps')
        command.append('chromium')
        print('[Browser/Build] Installing matching full Chromium in shared build/runtime path.', flush=True)
        completed = subprocess.run(command, check=False)
        if completed.returncode:
            print('[Browser/Build] Install failed. Deployment must not report browser ready.', flush=True)
            return 1
    result = check_browser()
    return 0 if result['status'] == 'ready' else 1


if __name__ == '__main__':
    raise SystemExit(main())
