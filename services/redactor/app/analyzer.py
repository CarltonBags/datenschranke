"""Presidio-backed detection → list[RawSpan] in our grammar vocabulary.

Keeps spaCy models loaded in memory (module singleton). German built-in
recognizer group is explicitly enabled (country groups are off by default);
only genuine upstream gaps are added from recognizers.py. Tenant custom
entities are injected per request as Presidio ad-hoc recognizers — no redeploy.
"""
from __future__ import annotations

from functools import lru_cache
from typing import Optional

from presidio_analyzer import AnalyzerEngine, Pattern, PatternRecognizer, RecognizerRegistry
from presidio_analyzer.nlp_engine import NlpEngineProvider

from .models import Policy
from .recognizers import german_gap_recognizers
from .redactor import RawSpan
from .regex_safety import validate_regex

# Presidio entity type -> grammar entity type.
_TYPE_MAP: dict[str, str] = {
    "PERSON": "PERSON",
    "EMAIL_ADDRESS": "EMAIL",
    "PHONE_NUMBER": "PHONE",
    "IBAN_CODE": "IBAN",
    "LOCATION": "LOCATION",
    "GPE": "LOCATION",
    "NRP": "ORG",
    "ORGANIZATION": "ORG",
    "ORG": "ORG",
    "DATE_TIME": "DATE",
    "CREDIT_CARD": "ID",
    "US_SSN": "ID",
    "IP_ADDRESS": "ID",
    "DE_UST_IDNR": "ID",
    "DE_HANDELSREGISTER": "ID",
    "EU_DRIVING_LICENCE": "ID",
    # German built-in group (Presidio 2026 German recognizer set) → ID.
    "DE_STEUER_ID": "ID",
    "DE_STEUERNUMMER": "ID",
    "DE_REISEPASS": "ID",
    "DE_PERSONALAUSWEIS": "ID",
    "DE_RENTENVERSICHERUNG": "ID",
    "DE_KRANKENVERSICHERUNG": "ID",
    "DE_SVNR": "ID",
    "DE_KFZ": "ID",
    "DE_BIC": "ID",
    "DE_BLZ": "ID",
}

# German built-in recognizers to explicitly ENABLE (off by default upstream).
_GERMAN_BUILTIN = [
    "DE_STEUER_ID",
    "DE_STEUERNUMMER",
    "DE_REISEPASS",
    "DE_PERSONALAUSWEIS",
    "DE_RENTENVERSICHERUNG",
    "DE_KRANKENVERSICHERUNG",
]

_NLP_CONFIG = {
    "nlp_engine_name": "spacy",
    "models": [
        {"lang_code": "de", "model_name": "de_core_news_lg"},
        {"lang_code": "en", "model_name": "en_core_web_lg"},
    ],
}


@lru_cache(maxsize=1)
def get_engine() -> AnalyzerEngine:
    nlp_engine = NlpEngineProvider(nlp_configuration=_NLP_CONFIG).create_engine()
    registry = RecognizerRegistry()
    # RecognizerRegistry defaults to ['en']; the engine needs both languages to
    # match or Presidio raises "Misconfigured engine". Set before construction.
    registry.supported_languages = ["de", "en"]
    registry.load_predefined_recognizers(languages=["de", "en"], nlp_engine=nlp_engine)
    for rec in german_gap_recognizers():
        registry.add_recognizer(rec)
    return AnalyzerEngine(nlp_engine=nlp_engine, registry=registry, supported_languages=["de", "en"])


def warmup() -> None:
    """Force BOTH language pipelines to load + run once, so the first real
    request isn't a multi-second cold start (which would trip the gateway's
    fail-closed timeout). Called at startup so /healthz only passes when warm."""
    engine = get_engine()
    engine.analyze(text="Anna Schmidt wohnt in Berlin.", language="de")
    engine.analyze(text="Anna Schmidt lives in Berlin.", language="en")


def _map_type(presidio_type: str) -> str:
    return _TYPE_MAP.get(presidio_type, "MISC")


def _build_custom_recognizers(
    policy: Policy,
    language: str,
) -> tuple[list[PatternRecognizer], dict[str, tuple[str, str]]]:
    """Return (ad-hoc recognizers, entity_name -> (label, action)).

    supported_language MUST match the request language: PatternRecognizer defaults
    to 'en', and Presidio silently skips recognizers whose language differs from
    the analyzed text — so on German text an unset language means the tenant's
    custom rules never fire.
    """
    recognizers: list[PatternRecognizer] = []
    meta: dict[str, tuple[str, str]] = {}
    for i, ce in enumerate(policy.custom_entities or []):
        entity_name = f"CUSTOM_{i}"
        meta[entity_name] = (ce.label, ce.action)
        if ce.kind == "pattern" and ce.regex:
            validate_regex(ce.regex)  # raises on unsafe pattern
            recognizers.append(
                PatternRecognizer(
                    supported_entity=entity_name,
                    name=f"tenant_pattern_{i}",
                    supported_language=language,
                    patterns=[Pattern(f"p{i}", ce.regex, ce.score or 0.7)],
                    context=ce.context or [],
                )
            )
        elif ce.kind == "deny_list" and ce.values:
            recognizers.append(
                PatternRecognizer(
                    supported_entity=entity_name,
                    name=f"tenant_denylist_{i}",
                    supported_language=language,
                    deny_list=ce.values,
                    context=ce.context or [],
                )
            )
    return recognizers, meta


def analyze(text: str, language: str, policy: Policy) -> list[RawSpan]:
    engine = get_engine()
    ad_hoc, custom_meta = _build_custom_recognizers(policy, language)

    results = engine.analyze(
        text=text,
        language=language,
        ad_hoc_recognizers=ad_hoc or None,
        return_decision_process=False,
    )

    spans: list[RawSpan] = []
    for r in results:
        if r.entity_type in custom_meta:
            label, action = custom_meta[r.entity_type]
            spans.append(
                RawSpan(
                    start=r.start,
                    end=r.end,
                    type="CUSTOM",
                    score=r.score,
                    custom_label=label,
                    action=action,
                )
            )
        else:
            spans.append(
                RawSpan(start=r.start, end=r.end, type=_map_type(r.entity_type), score=r.score)
            )
    return spans
