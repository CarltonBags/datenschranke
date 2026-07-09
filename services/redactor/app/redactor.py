"""Policy application + placeholder numbering/reuse.

Deliberately independent of Presidio so it is unit-testable: detection is
injected as a list of RawSpan (see analyzer.py for the Presidio-backed source).

Reuse contract (ADR-0001: gateway owns the vault): the gateway sends
``existing_entities`` as {value_hash, placeholder, type}, where value_hash is
``sha256("TYPE:<normalized value>")``. The redactor recomputes the same hash for
each newly detected entity and reuses the existing placeholder on a match, so
the same real-world entity keeps the same placeholder for the whole
conversation (invariant #3). Numbering for NEW entities continues from the max
existing index per type.
"""
from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass
from typing import Optional

from .models import (
    Blocked,
    DetectedEntity,
    ExistingEntity,
    NewMapEntry,
    Policy,
    RedactResponse,
)
from .placeholder import make_placeholder, parse_placeholder

_WS = re.compile(r"\s+")


@dataclass
class RawSpan:
    start: int
    end: int
    type: str  # a grammar entity type (PERSON, IBAN, ... CUSTOM)
    score: float
    custom_label: Optional[str] = None
    # For CUSTOM entities the action rides on the span (a deny_list and a pattern
    # are both wire-type CUSTOM but may have different actions). Overrides policy.
    action: Optional[str] = None


def normalize(entity_type: str, value: str) -> str:
    v = value.strip()
    if entity_type in ("IBAN", "PHONE", "ID"):
        v = re.sub(r"\s+", "", v)
    else:
        v = _WS.sub(" ", v)
    return v.casefold()


def value_hash(entity_type: str, value: str) -> str:
    return hashlib.sha256(f"{entity_type}:{normalize(entity_type, value)}".encode("utf-8")).hexdigest()


def _drop_overlaps(spans: list[RawSpan]) -> list[RawSpan]:
    """Keep highest-score span on overlap; ties → longer; then earlier."""
    ordered = sorted(spans, key=lambda s: (-s.score, -(s.end - s.start), s.start))
    kept: list[RawSpan] = []
    for s in ordered:
        if any(not (s.end <= k.start or s.start >= k.end) for k in kept):
            continue
        kept.append(s)
    return sorted(kept, key=lambda s: s.start)


def _action_for(policy: Policy, span: RawSpan) -> str:
    if span.action is not None:
        return span.action
    return policy.entities.get(span.type, policy.default_action)


def apply_policy(
    text: str,
    spans: list[RawSpan],
    policy: Policy,
    existing_entities: list[ExistingEntity],
) -> RedactResponse:
    spans = _drop_overlaps([s for s in spans if s.score >= policy.min_confidence])

    # Block precedence: if any detected entity is policy=block, reject the whole
    # request before any redaction (invariant: some data must never reach an LLM).
    for s in spans:
        if _action_for(policy, s) == "block":
            return RedactResponse(
                redacted_text="",
                entities=[],
                new_map_entries=[],
                blocked=Blocked(reason=f"Policy blocks entity type {s.type}", entity_type=s.type),
            )

    # Seed numbering + reuse map from existing conversation state.
    max_index: dict[str, int] = {}
    for e in existing_entities:
        parsed = parse_placeholder(e.placeholder)
        if parsed:
            max_index[parsed.type] = max(max_index.get(parsed.type, 0), parsed.index)
    reuse: dict[str, str] = {e.value_hash: e.placeholder for e in existing_entities}

    new_entries: list[NewMapEntry] = []
    detected: list[DetectedEntity] = []
    # Replace right-to-left so earlier offsets stay valid.
    out = text
    replacements: list[tuple[int, int, str]] = []

    for s in sorted(spans, key=lambda s: s.start):
        if _action_for(policy, s) == "allow":
            continue
        raw = text[s.start : s.end]
        h = value_hash(s.type, raw)
        placeholder = reuse.get(h)
        if placeholder is None:
            idx = max_index.get(s.type, 0) + 1
            max_index[s.type] = idx
            placeholder = make_placeholder(s.type, idx)
            reuse[h] = placeholder
            new_entries.append(
                NewMapEntry(
                    placeholder=placeholder,
                    value=raw,
                    entity_type=s.type,
                    custom_label=s.custom_label,
                )
            )
        detected.append(
            DetectedEntity(placeholder=placeholder, type=s.type, start=s.start, end=s.end, score=s.score)
        )
        replacements.append((s.start, s.end, placeholder))

    for start, end, placeholder in sorted(replacements, key=lambda r: r[0], reverse=True):
        out = out[:start] + placeholder + out[end:]

    return RedactResponse(
        redacted_text=out,
        entities=sorted(detected, key=lambda d: d.start),
        new_map_entries=new_entries,
        blocked=None,
    )
