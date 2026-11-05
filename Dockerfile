# syntax=docker/dockerfile:1.7
FROM --platform=linux/arm64 python:3.12-slim-bookworm AS dependencies
ENV PIP_NO_CACHE_DIR=1 PIP_DISABLE_PIP_VERSION_CHECK=1
RUN apt-get update && apt-get install -y --no-install-recommends libgomp1 libstdc++6 ca-certificates \
    && rm -rf /var/lib/apt/lists/* && python -m venv /opt/venv
COPY requirements-hosted.txt /build/requirements-hosted.txt
RUN /opt/venv/bin/pip install --only-binary=:all: --require-hashes -r /build/requirements-hosted.txt
COPY bake_models.py /build/bake_models.py
ENV HF_HOME=/opt/models HF_HUB_DISABLE_TELEMETRY=1 DO_NOT_TRACK=1
RUN /opt/venv/bin/python /build/bake_models.py

FROM --platform=linux/arm64 python:3.12-slim-bookworm AS parser-dependencies
ENV PIP_NO_CACHE_DIR=1 PIP_DISABLE_PIP_VERSION_CHECK=1
RUN apt-get update && apt-get install -y --no-install-recommends tesseract-ocr-eng libgomp1 libstdc++6 \
    && rm -rf /var/lib/apt/lists/* && python -m venv /opt/venv
COPY requirements-parser.txt /build/requirements-parser.txt
RUN /opt/venv/bin/pip install --only-binary=:all: --require-hashes -r /build/requirements-parser.txt
COPY bake_models.py /build/bake_models.py
ENV TESSDATA_PREFIX=/usr/share/tesseract-ocr/5/tessdata
RUN /opt/venv/bin/python /build/bake_models.py --parser-only

FROM --platform=linux/arm64 python:3.12-slim-bookworm AS parser
RUN apt-get update && apt-get install -y --no-install-recommends tesseract-ocr-eng libgomp1 libstdc++6 \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd -g 10002 parser && useradd -u 10002 -g parser -M -s /usr/sbin/nologin parser
COPY --from=parser-dependencies /opt/venv /opt/venv
ENV PATH=/opt/venv/bin:$PATH PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 \
    PYTHON_DOTENV_DISABLED=1 PARSER_MODE=true ORT_DISABLE_TELEMETRY=1 HF_HUB_OFFLINE=1 \
    TRANSFORMERS_OFFLINE=1 OMP_NUM_THREADS=1 MKL_NUM_THREADS=1 OPENBLAS_NUM_THREADS=1 \
    TESSDATA_PREFIX=/usr/share/tesseract-ocr/5/tessdata HOME=/tmp
WORKDIR /app
COPY config.py level1.py guardrails.py protection.py parser_ipc.py parser_service.py parser_worker.py /app/
RUN mkdir -p /app/.cache/parser /run/parser-ipc && chown -R 10002:10002 /app/.cache/parser /run/parser-ipc
USER 10002:10002
HEALTHCHECK --interval=10s --timeout=3s --start-period=20s --retries=3 CMD ["python", "parser_service.py", "--health"]
CMD ["python", "parser_service.py"]

FROM --platform=linux/arm64 python:3.12-slim-bookworm AS app
RUN apt-get update && apt-get install -y --no-install-recommends libgomp1 libstdc++6 ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd -g 10001 app && useradd -u 10001 -g app -M -s /usr/sbin/nologin app
COPY --from=dependencies /opt/venv /opt/venv
COPY --from=dependencies /opt/models /opt/models
ENV PATH=/opt/venv/bin:$PATH PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 \
    PYTHON_DOTENV_DISABLED=1 HF_HOME=/opt/models HF_HUB_OFFLINE=1 TRANSFORMERS_OFFLINE=1 \
    HF_HUB_DISABLE_TELEMETRY=1 DO_NOT_TRACK=1 TOKENIZERS_PARALLELISM=false \
    OMP_NUM_THREADS=1 MKL_NUM_THREADS=1 OPENBLAS_NUM_THREADS=1 NUMEXPR_NUM_THREADS=1 \
    MALLOC_ARENA_MAX=2 HOME=/tmp XDG_CACHE_HOME=/tmp/cache
WORKDIR /app
COPY app.py config.py guardrails.py level1.py level2.py level3.py llm.py protection.py sessions.py container_start.py container_health.py parser_ipc.py session_store.py watchdog.py limiter.conf /app/
RUN mkdir -p /app/.cache/stage2 && chown 10001:10001 /app/.cache/stage2 \
    && chmod -R a-w /opt/models
USER 10001:10001
HEALTHCHECK --interval=30s --timeout=5s --start-period=600s --retries=3 CMD ["python", "container_health.py"]
CMD ["python", "container_start.py"]
