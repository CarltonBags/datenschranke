"""Cross-language grammar contract test (Python side).

Reads the SAME fixture file the TypeScript test uses
(packages/shared/src/grammar-fixtures.json) and asserts the Python
placeholder implementation produces/accepts byte-identical strings.
"""
import json
import pathlib

import pytest

from app.placeholder import (
    COMPLETE_PLACEHOLDER,
    MAX_PLACEHOLDER_LENGTH,
    could_be_placeholder_prefix,
    is_placeholder,
    make_placeholder,
)

_FIXTURES = (
    pathlib.Path(__file__).resolve().parents[3]
    / "packages"
    / "shared"
    / "src"
    / "grammar-fixtures.json"
)


@pytest.fixture(scope="module")
def fx() -> dict:
    return json.loads(_FIXTURES.read_text(encoding="utf-8"))


def test_max_length(fx):
    assert MAX_PLACEHOLDER_LENGTH == fx["max_placeholder_length"]


def test_make(fx):
    for c in fx["make"]:
        assert make_placeholder(c["type"], c["index"]) == c["out"]


def test_is_placeholder(fx):
    for s in fx["is_placeholder_true"]:
        assert is_placeholder(s) is True, s
    for s in fx["is_placeholder_false"]:
        assert is_placeholder(s) is False, s


def test_prefix(fx):
    for s in fx["prefix_true"]:
        assert could_be_placeholder_prefix(s) is True, s
    for s in fx["prefix_false"]:
        assert could_be_placeholder_prefix(s) is False, s


def test_find_in_body(fx):
    text = fx["find_in_body"]["text"]
    assert COMPLETE_PLACEHOLDER.findall(text) == fx["find_in_body"]["out"]
