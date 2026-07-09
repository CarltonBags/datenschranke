"""Placeholder grammar — the single source of truth (Python side).

MIRRORED IN: packages/shared/src/placeholder.ts
A cross-language test (tests/test_placeholder_crosslang.py) asserts both
implementations produce and accept byte-identical strings.

Format: [[TYPE_N]]  where TYPE in ENTITY_TYPES and N is 1-4 digits, numbered
per conversation in order of first appearance. The vocabulary is CLOSED.
"""
from __future__ import annotations

import re
from typing import NamedTuple, Optional

ENTITY_TYPES: tuple[str, ...] = (
    "PERSON",
    "EMAIL",
    "PHONE",
    "IBAN",
    "ADDRESS",
    "ORG",
    "LOCATION",
    "DATE",
    "ID",
    "MISC",
    "CUSTOM",
)

MIN_INDEX = 1
MAX_INDEX = 9999

_TYPE_ALT = "|".join(ENTITY_TYPES)

# Matches exactly one complete placeholder, anchored.
PLACEHOLDER_RE = re.compile(rf"^\[\[({_TYPE_ALT})_(\d{{1,4}})\]\]$")
# Matches every complete placeholder inside a larger string.
COMPLETE_PLACEHOLDER = re.compile(rf"\[\[(?:{_TYPE_ALT})_\d{{1,4}}\]\]")

# Longest a valid placeholder can be: "[[" + longest type + "_" + 4 digits + "]]".
MAX_PLACEHOLDER_LENGTH = 2 + max(len(t) for t in ENTITY_TYPES) + 1 + 4 + 2


class ParsedPlaceholder(NamedTuple):
    type: str
    index: int


def make_placeholder(entity_type: str, index: int) -> str:
    if entity_type not in ENTITY_TYPES:
        raise ValueError(f"Unknown entity type: {entity_type}")
    if not (MIN_INDEX <= index <= MAX_INDEX):
        raise ValueError(f"Placeholder index out of range: {index}")
    return f"[[{entity_type}_{index}]]"


def parse_placeholder(s: str) -> Optional[ParsedPlaceholder]:
    m = PLACEHOLDER_RE.match(s)
    if not m:
        return None
    return ParsedPlaceholder(type=m.group(1), index=int(m.group(2)))


def is_placeholder(s: str) -> bool:
    return PLACEHOLDER_RE.match(s) is not None


def could_be_placeholder_prefix(s: str) -> bool:
    """True if some ``s + suffix`` is a complete placeholder (grammar only)."""
    if len(s) == 0:
        return False
    if len(s) > MAX_PLACEHOLDER_LENGTH:
        return False
    if s == "[":
        return True
    if not s.startswith("[["):
        return False
    if s == "[[":
        return True

    rest = s[2:]
    underscore = rest.find("_")
    if underscore == -1:
        return any(t.startswith(rest) for t in ENTITY_TYPES)

    type_part = rest[:underscore]
    if type_part not in ENTITY_TYPES:
        return False

    after_type = rest[underscore + 1:]
    digits = after_type
    closers = 0
    while digits.endswith("]") and closers < 2:
        digits = digits[:-1]
        closers += 1
    if len(digits) > 4:
        return False
    if not re.fullmatch(r"\d*", digits):
        return False
    if closers == 2:
        return False
    return True


PLACEHOLDER_SYSTEM_SUFFIX = (
    "Tokens of the form [[TYPE_N]] are opaque references. "
    "Preserve them exactly; never modify, translate, expand, or invent them."
)
