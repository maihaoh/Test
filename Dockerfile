FROM python:3.12-slim-bookworm
ENV PYTHONUNBUFFERED=1 PIP_DISABLE_PIP_VERSION_CHECK=1
WORKDIR /app
COPY requirements-render.txt browser_runtime.py ./
RUN pip install --no-cache-dir -r requirements-render.txt     && python browser_runtime.py --install --with-deps --check
COPY . .
EXPOSE 10000
CMD ["bash", "./start_render.sh"]
