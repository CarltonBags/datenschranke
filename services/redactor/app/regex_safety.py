"""Guardrails for tenant-supplied custom regexes.

A tenant must not be able to DoS the redactor with a pathological pattern
(catastrophic backtracking). We: cap length, reject known backtracking-prone
constructs (nested quantifiers), compile-check, and — at analyze time — run
patterns under a wall-clock budget (see analyzer.py). This is a conservative
linter, not a full RE2 port; the runtime budget is the backstop.
"""
from __future__ import annotations

import re

MAX_PATTERN_LENGTH = 512

# Nested quantifier like (a+)+ , (a*)* , (a+)* , (.*)+  → classic ReDoS shapes.
_NESTED_QUANTIFIER = re.compile(r"\([^()]*[+*]\s*\)\s*[+*]")
# Unbounded alternation inside a repeated group with overlap is also risky; we
# flag repeated groups containing an alternation of quantified atoms.
_ALT_IN_REPEAT = re.compile(r"\([^()]*[+*][^()]*\|[^()]*[+*][^()]*\)[+*]")


class UnsafeRegexError(ValueError):
    pass


def validate_regex(pattern: str) -> re.Pattern[str]:
    """Validate a tenant regex on save. Raises UnsafeRegexError if rejected."""
    if len(pattern) > MAX_PATTERN_LENGTH:
        raise UnsafeRegexError(f"pattern exceeds {MAX_PATTERN_LENGTH} chars")
    if _NESTED_QUANTIFIER.search(pattern) or _ALT_IN_REPEAT.search(pattern):
        raise UnsafeRegexError("pattern has catastrophic-backtracking shape (nested quantifiers)")
    try:
        return re.compile(pattern)
    except re.error as exc:  # invalid regex
        raise UnsafeRegexError(f"invalid regex: {exc}") from exc
