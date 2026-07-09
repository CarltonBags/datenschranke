"""Request/response models — mirror packages/shared/src/schemas.ts."""
from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel, Field

Action = Literal["redact", "block", "allow"]


class CustomEntity(BaseModel):
    label: str = Field(max_length=120)
    kind: Literal["pattern", "deny_list"]
    regex: Optional[str] = Field(default=None, max_length=512)
    values: Optional[list[str]] = None
    context: Optional[list[str]] = None
    score: Optional[float] = Field(default=None, ge=0, le=1)
    action: Literal["redact", "block"]


class Policy(BaseModel):
    version: int
    default_action: Action = "redact"
    entities: dict[str, Action] = Field(default_factory=dict)
    min_confidence: float = 0.6
    allowed_providers: list[str] = Field(default_factory=list)
    languages: list[str] = Field(default_factory=lambda: ["de", "en"])
    custom_entities: Optional[list[CustomEntity]] = None


class ExistingEntity(BaseModel):
    value_hash: str  # sha256(hex) of normalized "TYPE:value" — see redactor.normalize
    placeholder: str
    type: str


class RedactRequest(BaseModel):
    tenant_id: str
    conversation_id: str
    text: str
    language: Optional[str] = None
    policy: Policy
    existing_entities: list[ExistingEntity] = Field(default_factory=list)


class DetectedEntity(BaseModel):
    placeholder: str
    type: str
    start: int
    end: int
    score: float


class NewMapEntry(BaseModel):
    placeholder: str
    value: str
    entity_type: str
    custom_label: Optional[str] = None


class Blocked(BaseModel):
    reason: str
    entity_type: str


class RedactResponse(BaseModel):
    redacted_text: str
    entities: list[DetectedEntity] = Field(default_factory=list)
    new_map_entries: list[NewMapEntry] = Field(default_factory=list)
    blocked: Optional[Blocked] = None


class AnalyzeResponse(BaseModel):
    entities: list[DetectedEntity]
    language: str


class ImageRedactRequest(BaseModel):
    tenant_id: str
    conversation_id: str
    image: str  # data: URL or raw base64 of the image
    language: Optional[str] = None
    policy: Policy


class ImageEntity(BaseModel):
    type: str  # grammar entity type (PERSON, IBAN, ... CUSTOM)
    score: float
    # bounding box of the redacted region (for the audit/preview) — NO text/value.
    box: dict[str, int]


class ImageRedactResponse(BaseModel):
    image: str  # base64 PNG (no data: prefix) of the redacted image
    entities: list[ImageEntity] = Field(default_factory=list)
    count: int = 0
    blocked: Optional[Blocked] = None
