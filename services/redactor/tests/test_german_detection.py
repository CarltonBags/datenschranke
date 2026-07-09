"""German PII detection integration tests.

Requires Presidio + spaCy models (baked into the redactor image). Skipped
automatically when those aren't installed so the pure-logic + cross-language
tests still run in a lightweight CI lane.

The moat is German NER + ID coverage — these fixtures use valid checksums and
should be extended into a labeled evaluation set tracked per release.
"""
from __future__ import annotations

import pytest

pytest.importorskip("presidio_analyzer", reason="Presidio not installed")
pytestmark = pytest.mark.presidio

from app.analyzer import analyze  # noqa: E402
from app.models import Policy  # noqa: E402


def _types(text: str, language: str = "de") -> set[str]:
    spans = analyze(text, language, Policy(version=1, min_confidence=0.3))
    return {s.type for s in spans}


def test_detects_person_and_iban_in_german():
    t = "Anna Schmidt überweist von IBAN DE89 3704 0044 0532 0130 00."
    found = _types(t)
    assert "PERSON" in found
    assert "IBAN" in found


def test_detects_ustidnr_with_valid_checksum():
    # DE + 9 digits passing the MOD 11,10 checksum.
    t = "Unsere USt-IdNr lautet DE136695976."
    assert "ID" in _types(t)


def test_detects_handelsregister():
    t = "Eingetragen im Handelsregister des Amtsgerichts München, HRB 123456."
    assert "ID" in _types(t)


@pytest.mark.parametrize(
    "text",
    [
        "Meine Steuer-Identifikationsnummer ist 44 123 456 789.",
        "Reisepassnummer C01X00T47.",
        "Personalausweisnummer T220001293.",
    ],
)
def test_detects_german_id_group(text: str):
    # Relies on the enabled German built-in recognizer set.
    assert "ID" in _types(text)
