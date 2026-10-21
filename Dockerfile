FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app

# Render uses Chromium for official MZPlay browser sign-in if its saved session
# expires. Baccarat remains manual; this does not bypass account permissions.
COPY requirements-render.txt ./
RUN pip install --no-cache-dir -r requirements-render.txt \
    && python -m playwright install --with-deps chromium

COPY . .
RUN python -m py_compile bot.py mzplay_multi.py direct_choice_render.py choice_result_decoder.py realtime_api.py multi_runtime.py multi_snapshot.py

EXPOSE 10000
CMD ["bash", "./start_render.sh"]
