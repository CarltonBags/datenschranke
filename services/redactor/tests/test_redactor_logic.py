"""Policy + numbering/reuse tests. No Presidio needed (spans injected)."""
from __future__ import annotations

from app.models import ExistingEntity, Policy
from app.redactor import RawSpan, apply_policy, value_hash


def _policy(**kw) -> Policy:
    base = dict(version=1, default_action="redact", min_confidence=0.5)
    base.update(kw)
    return Policy(**base)


def test_basic_redaction_assigns_placeholders():
    text = "Anna Schmidt hat IBAN DE89370400440532013000."
    spans = [
        RawSpan(0, 12, "PERSON", 0.9),
        RawSpan(22, 44, "IBAN", 0.95),
    ]
    res = apply_policy(text, spans, _policy(), [])
    assert res.redacted_text == "[[PERSON_1]] hat IBAN [[IBAN_1]]."
    assert res.blocked is None
    assert {e.placeholder for e in res.new_map_entries} == {"[[PERSON_1]]", "[[IBAN_1]]"}


def test_same_entity_same_placeholder_within_request():
    text = "Anna und Anna"
    spans = [RawSpan(0, 4, "PERSON", 0.9), RawSpan(9, 13, "PERSON", 0.9)]
    res = apply_policy(text, spans, _policy(), [])
    assert res.redacted_text == "[[PERSON_1]] und [[PERSON_1]]"
    assert len(res.new_map_entries) == 1


def test_reuse_across_turns_via_existing_entities():
    text = "Anna schreibt wieder"
    existing = [
        ExistingEntity(value_hash=value_hash("PERSON", "Anna"), placeholder="[[PERSON_3]]", type="PERSON")
    ]
    spans = [RawSpan(0, 4, "PERSON", 0.9)]
    res = apply_policy(text, spans, _policy(), existing)
    assert res.redacted_text == "[[PERSON_3]] schreibt wieder"
    assert res.new_map_entries == []  # reused, nothing new


def test_new_entity_numbering_continues_from_existing_max():
    text = "Bob"
    existing = [
        ExistingEntity(value_hash=value_hash("PERSON", "Anna"), placeholder="[[PERSON_2]]", type="PERSON")
    ]
    res = apply_policy(text, [RawSpan(0, 3, "PERSON", 0.9)], _policy(), existing)
    assert res.redacted_text == "[[PERSON_3]]"


def test_allow_action_leaves_text():
    text = "Acme GmbH"
    res = apply_policy(text, [RawSpan(0, 9, "ORG", 0.9)], _policy(entities={"ORG": "allow"}), [])
    assert res.redacted_text == "Acme GmbH"
    assert res.new_map_entries == []


def test_block_action_rejects_whole_request():
    text = "IBAN DE89370400440532013000 here"
    res = apply_policy(text, [RawSpan(5, 27, "IBAN", 0.95)], _policy(entities={"IBAN": "block"}), [])
    assert res.blocked is not None
    assert res.blocked.entity_type == "IBAN"
    assert res.redacted_text == ""


def test_min_confidence_filters_low_score_spans():
    res = apply_policy("noise", [RawSpan(0, 5, "PERSON", 0.3)], _policy(min_confidence=0.6), [])
    assert res.redacted_text == "noise"
    assert res.entities == []


def test_overlapping_spans_keep_higher_score():
    text = "Anna Schmidt"
    spans = [RawSpan(0, 12, "PERSON", 0.9), RawSpan(0, 4, "LOCATION", 0.5)]
    res = apply_policy(text, spans, _policy(), [])
    assert res.redacted_text == "[[PERSON_1]]"


def test_custom_entity_wire_type_and_label():
    text = "Konto UK-78dzu offen"
    spans = [RawSpan(6, 14, "CUSTOM", 0.8, custom_label="Acme account number", action="redact")]
    res = apply_policy(text, spans, _policy(), [])
    assert res.redacted_text == "Konto [[CUSTOM_1]] offen"
    assert res.new_map_entries[0].custom_label == "Acme account number"


def test_custom_entity_block_action_overrides_policy():
    text = "Project Kranich is secret"
    spans = [RawSpan(0, 15, "CUSTOM", 0.9, custom_label="Confidential projects", action="block")]
    res = apply_policy(text, spans, _policy(default_action="redact"), [])
    assert res.blocked is not None
    assert res.blocked.entity_type == "CUSTOM"
