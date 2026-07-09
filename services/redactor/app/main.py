"""FastAPI redaction service.

Endpoints:
  POST /v1/redact   — detect + replace, returns redacted_text + map deltas
  POST /v1/analyze  — detection only (admin "test your policy" screen)
  POST /v1/warmup   — force model load
  GET  /healthz     — gateway fail-closed check
"""
from __future__ import annotations

import logging
import time

from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException

from . import analyzer
from .models import AnalyzeResponse, ImageRedactRequest, ImageRedactResponse, RedactRequest, RedactResponse
from .redactor import apply_policy
from .regex_safety import UnsafeRegexError

logger = logging.getLogger("redactor")


@asynccontextmanager
async def lifespan(_app: FastAPI):
    # Warm both spaCy pipelines before serving so /healthz only reports OK once
    # the first request will be fast (keeps the gateway's fail-closed timeout honest).
    logger.info("warming redaction models...")
    analyzer.warmup()
    logger.info("redaction models warm")
    yield


app = FastAPI(title="GDPR Redaction Service", version="0.1.0", lifespan=lifespan)

# Per-request wall-clock budget for detection (backstop for tenant regexes).
ANALYZE_BUDGET_S = 2.0


def _detect_language(text: str, requested: str | None) -> str:
    if requested:
        return requested
    try:
        from langdetect import detect  # lazy: optional dependency

        lang = detect(text)
        return lang if lang in ("de", "en") else "en"
    except Exception:
        return "en"


@app.get("/healthz")
def healthz() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/v1/warmup")
def warmup() -> dict[str, str]:
    analyzer.warmup()
    return {"status": "warm"}


@app.post("/v1/redact", response_model=RedactResponse)
def redact(req: RedactRequest) -> RedactResponse:
    language = _detect_language(req.text, req.language)
    started = time.monotonic()
    try:
        spans = analyzer.analyze(req.text, language, req.policy)
    except UnsafeRegexError as exc:
        raise HTTPException(status_code=422, detail=f"unsafe custom regex: {exc}") from exc
    elapsed = time.monotonic() - started
    if elapsed > ANALYZE_BUDGET_S:
        logger.warning("analyze exceeded budget: %.3fs", elapsed)
    return apply_policy(req.text, spans, req.policy, req.existing_entities)


@app.post("/v1/redact-image", response_model=ImageRedactResponse)
def redact_image(req: ImageRedactRequest) -> ImageRedactResponse:
    # Lazy import: pulls Pillow + presidio-image-redactor + Tesseract binding.
    from .image_redactor import redact_image as _redact_image

    language = req.language or "de"  # OCR runs deu+eng; analyzer defaults to German
    try:
        return _redact_image(req.image, language, req.policy)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@app.post("/v1/analyze", response_model=AnalyzeResponse)
def analyze_only(req: RedactRequest) -> AnalyzeResponse:
    language = _detect_language(req.text, req.language)
    try:
        spans = analyzer.analyze(req.text, language, req.policy)
    except UnsafeRegexError as exc:
        raise HTTPException(status_code=422, detail=f"unsafe custom regex: {exc}") from exc
    result = apply_policy(req.text, spans, req.policy, req.existing_entities)
    return AnalyzeResponse(entities=result.entities, language=language)
