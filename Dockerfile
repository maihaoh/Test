FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

WORKDIR /app

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt waitress flask \
    && python -m playwright install --with-deps chromium

COPY . .
RUN python -m py_compile bot.py mzplay_multi.py choice_collector.py choice_result_decoder.py realtime_api.py run_once.py

EXPOSE 10000
CMD ["bash", "./start_render.sh"]
