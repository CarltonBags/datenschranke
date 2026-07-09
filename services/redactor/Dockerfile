# syntax=docker/dockerfile:1
FROM python:3.12-slim AS base

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    UV_SYSTEM_PYTHON=1

RUN pip install --no-cache-dir uv==0.4.27

# Tesseract OCR + German/English language packs for image PII redaction, plus
# OpenCV runtime libs (presidio-image-redactor pulls opencv via cv2).
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      tesseract-ocr tesseract-ocr-deu tesseract-ocr-eng \
      libgl1 libglib2.0-0 \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install deps first (better layer caching).
COPY pyproject.toml uv.lock* ./
RUN uv pip install --system -r pyproject.toml

# spaCy models are baked INTO the image (VPC installs must not fetch at runtime,
# and startup downloads would break healthchecks). Pin exact versions.
RUN python -m spacy download de_core_news_lg-3.7.0 --direct \
 && python -m spacy download en_core_web_lg-3.7.1 --direct

COPY app ./app

EXPOSE 8000

# Workers configurable via UVICORN_WORKERS (default 2). Each worker keeps spaCy
# models in memory (~1-2 GB — see docs/sizing.md). On an 8 GB box set it to 1.
ENV UVICORN_WORKERS=2
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port 8000 --workers ${UVICORN_WORKERS:-2}"]

HEALTHCHECK --interval=15s --timeout=5s --start-period=150s --retries=5 \
  CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://localhost:8000/healthz').status==200 else 1)"
