from __future__ import annotations

import pytest

from app.regex_safety import UnsafeRegexError, validate_regex


def test_accepts_safe_pattern():
    assert validate_regex(r"\bUK-\d{2}[a-z]{3}\b") is not None


def test_rejects_nested_quantifier():
    with pytest.raises(UnsafeRegexError):
        validate_regex(r"(a+)+")
    with pytest.raises(UnsafeRegexError):
        validate_regex(r"(.*)*")


def test_rejects_overlong_pattern():
    with pytest.raises(UnsafeRegexError):
        validate_regex("a" * 600)


def test_rejects_invalid_regex():
    with pytest.raises(UnsafeRegexError):
        validate_regex(r"(unclosed")
