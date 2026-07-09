"""Image PII redaction via OCR (Presidio Image Redactor + Tesseract).

Unlike text redaction (reversible placeholders), image redaction is DESTRUCTIVE:
OCR finds PII regions and we paint solid boxes over them. There is no
un-redaction — you cannot restore a value into burned pixels. The redacted image
is what gets forwarded to the (vision) model; the original never leaves the
tenant boundary (invariant #1).

Tesseract runs with the German + English models (`deu+eng`). Policy is applied:
below min_confidence → ignored; entity action `allow` → not boxed; `block` →
the whole request is blocked (as with text).
"""
from __future__ import annotations

import base64
import binascii
from io import BytesIO

from PIL import Image, ImageDraw
from presidio_image_redactor import ImageAnalyzerEngine

from .analyzer import _map_type, get_engine
from .models import Blocked, ImageEntity, ImageRedactResponse, Policy

_OCR_LANG = "deu+eng"
_FILL = (12, 12, 14)  # near-black box

_image_analyzer: ImageAnalyzerEngine | None = None


def _analyzer() -> ImageAnalyzerEngine:
    global _image_analyzer
    if _image_analyzer is None:
        # Reuse the SAME configured text AnalyzerEngine (de+en, German recognizers).
        _image_analyzer = ImageAnalyzerEngine(analyzer_engine=get_engine())
    return _image_analyzer


def _decode(image: str) -> bytes:
    raw = image.split(",", 1)[1] if image.startswith("data:") else image
    try:
        return base64.b64decode(raw, validate=True)
    except (binascii.Error, ValueError) as exc:
        raise ValueError(f"invalid base64 image: {exc}") from exc


def redact_image(req_image: str, language: str, policy: Policy) -> ImageRedactResponse:
    img = Image.open(BytesIO(_decode(req_image))).convert("RGB")

    results = _analyzer().analyze(
        image=img,
        ocr_kwargs={"lang": _OCR_LANG},
        language=language,
    )

    draw = ImageDraw.Draw(img)
    entities: list[ImageEntity] = []
    for r in results:
        if r.score < policy.min_confidence:
            continue
        gtype = _map_type(r.entity_type)
        action = policy.entities.get(gtype, policy.default_action)
        if action == "allow":
            continue
        if action == "block":
            return ImageRedactResponse(
                image="",
                entities=[],
                count=0,
                blocked=Blocked(reason=f"Policy blocks entity type {gtype} (in image)", entity_type=gtype),
            )
        draw.rectangle([r.left, r.top, r.left + r.width, r.top + r.height], fill=_FILL)
        entities.append(
            ImageEntity(
                type=gtype,
                score=float(r.score),
                box={"x": int(r.left), "y": int(r.top), "w": int(r.width), "h": int(r.height)},
            )
        )

    out = BytesIO()
    img.save(out, format="PNG")
    return ImageRedactResponse(
        image=base64.b64encode(out.getvalue()).decode("ascii"),
        entities=entities,
        count=len(entities),
        blocked=None,
    )
