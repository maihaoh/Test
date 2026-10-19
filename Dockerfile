FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app

# Render only serves the API and WinGo collector. Choice is entered manually
# in the browser, so Render does not require a Chromium/Playwright download.
COPY requirements-render.txt ./
RUN pip install --no-cache-dir -r requirements-render.txt

COPY . .
RUN python -m py_compile bot.py mzplay_multi.py direct_choice_render.py choice_result_decoder.py realtime_api.py multi_runtime.py multi_snapshot.py

EXPOSE 10000
CMD ["bash", "./start_render.sh"]
