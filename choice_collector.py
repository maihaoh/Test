FROM python:3.12-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt waitress flask \
    && python -m playwright install --with-deps chromium

COPY . .

ENV PYTHONUNBUFFERED=1
CMD ["sh", "-c", "python -u bot.py & exec python -m waitress --listen=0.0.0.0:${PORT:-10000} realtime_api:app"]
