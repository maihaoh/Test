# V25 GitHub / Render Upload

This is the cleaned V25 project. **Upload the contents of this folder to the root of your GitHub repository** (alongside `index.html`), not the `.zip` file.

## Files retained

- Web UI: `index.html`, `style.css`, `script.js`, `multi_games.js`.
- Baccarat (庄 / 闲 / 和): `choice_manual.js` and `baccarat_*.js`. These modules remain required even though some were originally created in V24.
- Read-only data service: Python collector and API modules, dependency files, `Dockerfile`, `render.yaml` and start scripts.
- GitHub: `.github/workflows/pages.yml` for Pages, `choice-collector.yml` for the authorized optional collector.

## What is intentionally omitted

Old V14-V24 reports and setup notes, unused V16 duplicate Python code, old one-shot scripts, generated `choice_status.json`, and stale `data.json`. The backend creates its runtime data when launched. There is no old static JSON fallback on GitHub Pages.

## Important during an update

Uploading new files via the GitHub website **does not remove old files already committed**. Delete obsolete V14-V24 `.md` reports and `direct_choice_render_V16.py`, `run_once.py`, `full_diagnostic.py`, `requirements.txt`, `data.json`, and `.github/workflows/choice-full-diagnostic.yml` from the GitHub repository if present. Keep the JS modules and the currently listed files above.

Secrets are configured only in GitHub Actions Secrets and Render environment variables, never as repository files. A missing/expired MZPlay token cannot be fixed merely by uploading source files. Pages will refresh its appearance after a successful `main` branch deployment; if needed use Ctrl+Shift+R.
