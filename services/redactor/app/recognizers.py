"""Custom German PatternRecognizers — ONLY for gaps not covered upstream.

Presidio's German built-in set (Reisepass, Personalausweis, Rentenversicherung,
Krankenversicherung) is enabled in analyzer.py when present. Steuernummer and
Steuer-IdNr are ALSO expected upstream, but are absent in the pinned Presidio
version — so they are provided here as gaps until the built-ins are available.

Built here (upstream gaps): Handelsregisternummer (HRB/HRA + court), USt-IdNr
(DE + 9 digits with checksum), Steuernummer (Finanzamt slash format), Steuer-IdNr
(11 digits, context-gated), EU driving licence number.
"""
from __future__ import annotations

from presidio_analyzer import Pattern, PatternRecognizer


def _ustidnr_checksum_ok(digits: str) -> bool:
    """DE USt-IdNr (VAT) ISO 7064 MOD 11,10 checksum over the 9 digits."""
    if len(digits) != 9 or not digits.isdigit():
        return False
    p = 10
    for ch in digits[:8]:
        s = (int(ch) + p) % 10
        s = 10 if s == 0 else s
        p = (2 * s) % 11
    check = (11 - p) % 10
    return check == int(digits[8])


class UstIdNrRecognizer(PatternRecognizer):
    """USt-IdNr: 'DE' + 9 digits, validated by checksum."""

    def __init__(self) -> None:
        super().__init__(
            supported_entity="DE_UST_IDNR",
            name="UstIdNrRecognizer",
            supported_language="de",
            patterns=[Pattern("ustidnr", r"\bDE\s?\d{9}\b", 0.4)],
            context=["ust", "umsatzsteuer", "vat", "ust-idnr", "steuer"],
        )

    def validate_result(self, pattern_text: str) -> bool | None:
        digits = "".join(c for c in pattern_text if c.isdigit())
        return _ustidnr_checksum_ok(digits)


def handelsregister_recognizer() -> PatternRecognizer:
    """Handelsregisternummer: HRB/HRA + number, often with a court name."""
    return PatternRecognizer(
        supported_entity="DE_HANDELSREGISTER",
        name="HandelsregisterRecognizer",
        supported_language="de",
        patterns=[Pattern("hrb_hra", r"\bHR[AB]\s?\d{1,6}\b", 0.6)],
        context=["handelsregister", "amtsgericht", "registergericht", "hrb", "hra"],
    )


def steuernummer_recognizer() -> PatternRecognizer:
    """German Steuernummer in the common Finanzamt slash format (e.g.
    12/345/67890). The distinctive three-group shape carries enough signal to
    redact standalone (score above min_confidence); context words boost it.

    NOTE: intended to be covered by Presidio's German built-in set, but that set
    is absent in the pinned version — so we provide it here as an upstream gap.
    """
    return PatternRecognizer(
        supported_entity="DE_STEUERNUMMER",
        name="SteuernummerRecognizer",
        supported_language="de",
        patterns=[Pattern("steuernummer_slash", r"\b\d{2,3}/\d{3}/\d{4,5}\b", 0.65)],
        context=["steuernummer", "steuer-nr", "st.-nr", "stnr", "finanzamt", "steuer"],
    )


def steuer_id_recognizer() -> PatternRecognizer:
    """Steuerliche Identifikationsnummer (IdNr): 11 digits, optionally grouped.
    Bare 11-digit numbers are too ambiguous to auto-redact, so this scores low
    and relies on context words to cross min_confidence."""
    return PatternRecognizer(
        supported_entity="DE_STEUER_ID",
        name="SteuerIdRecognizer",
        supported_language="de",
        patterns=[Pattern("steuer_id", r"\b\d{2}[ .]?\d{3}[ .]?\d{3}[ .]?\d{3}\b", 0.3)],
        context=["identifikationsnummer", "steuer-id", "steuerliche", "idnr", "steuer-idnr"],
    )


def svnr_recognizer() -> PatternRecognizer:
    """Sozial-/Rentenversicherungsnummer (SVNR): 12 chars,
    2 digits + 6-digit birthdate + 1 letter + 3 digits. Structured enough to
    fire standalone."""
    return PatternRecognizer(
        supported_entity="DE_SVNR",
        name="SvnrRecognizer",
        supported_language="de",
        patterns=[Pattern("svnr", r"\b\d{2}\s?\d{6}\s?[A-Za-z]\s?\d{3}\b", 0.6)],
        context=["sozialversicherung", "rentenversicherung", "sv-nummer", "svnr", "versicherungsnummer"],
    )


def krankenversicherung_recognizer() -> PatternRecognizer:
    """Krankenversichertennummer (eGK): 1 letter + 9 digits. Ambiguous alone —
    context-gated."""
    return PatternRecognizer(
        supported_entity="DE_KRANKENVERSICHERUNG",
        name="KrankenversicherungRecognizer",
        supported_language="de",
        patterns=[Pattern("kvnr", r"\b[A-Za-z]\d{9}\b", 0.3)],
        context=["krankenversicherung", "versichertennummer", "krankenkasse", "gkv", "egk"],
    )


def personalausweis_recognizer() -> PatternRecognizer:
    """Personalausweisnummer (nPA): letter + 8 alnum. Broad shape → context-gated."""
    return PatternRecognizer(
        supported_entity="DE_PERSONALAUSWEIS",
        name="PersonalausweisRecognizer",
        supported_language="de",
        patterns=[Pattern("npa", r"\b[LMNPRTVWXYZ][0-9A-Z]{8,9}\b", 0.3)],
        context=["personalausweis", "ausweisnummer", "ausweis", "perso"],
    )


def reisepass_recognizer() -> PatternRecognizer:
    """Reisepassnummer: 9 alnum. Broad shape → context-gated."""
    return PatternRecognizer(
        supported_entity="DE_REISEPASS",
        name="ReisepassRecognizer",
        supported_language="de",
        patterns=[Pattern("pass", r"\b[CFGHJKLMNPRTVWXYZ0-9]{9}\b", 0.3)],
        context=["reisepass", "passnummer", "passport", "pass"],
    )


def kfz_recognizer() -> PatternRecognizer:
    """Kfz-Kennzeichen: region (1-3 letters) + 1-2 letters + 1-4 digits
    (e.g. B-AB 1234). Dash makes it fairly distinctive; context boosts it."""
    return PatternRecognizer(
        supported_entity="DE_KFZ",
        name="KfzRecognizer",
        supported_language="de",
        patterns=[Pattern("kfz", r"\b[A-ZÄÖÜ]{1,3}-[A-Z]{1,2}\s?\d{1,4}[EH]?\b", 0.5)],
        context=["kennzeichen", "kfz", "nummernschild", "auto", "fahrzeug"],
    )


def bic_recognizer() -> PatternRecognizer:
    """German BIC/SWIFT: 4 bank letters + 'DE' + 2 + optional 3 (8 or 11 chars)."""
    return PatternRecognizer(
        supported_entity="DE_BIC",
        name="BicRecognizer",
        supported_language="de",
        patterns=[Pattern("bic", r"\b[A-Z]{4}DE[A-Z0-9]{2}(?:[A-Z0-9]{3})?\b", 0.6)],
        context=["bic", "swift", "bank", "iban"],
    )


def blz_recognizer() -> PatternRecognizer:
    """Bankleitzahl: 8 digits. Ambiguous alone — context-gated."""
    return PatternRecognizer(
        supported_entity="DE_BLZ",
        name="BlzRecognizer",
        supported_language="de",
        patterns=[Pattern("blz", r"\b\d{8}\b", 0.3)],
        context=["bankleitzahl", "blz"],
    )


def eu_driving_licence_recognizer() -> PatternRecognizer:
    """Simplified EU driving licence number (DE format B + 10 alnum)."""
    return PatternRecognizer(
        supported_entity="EU_DRIVING_LICENCE",
        name="EuDrivingLicenceRecognizer",
        supported_language="de",
        patterns=[Pattern("eu_dl", r"\b[A-Z]\d{2}[A-Z0-9]{6}\d\b", 0.3)],
        context=["führerschein", "fahrerlaubnis", "driving", "licence", "license"],
    )


def german_gap_recognizers() -> list[PatternRecognizer]:
    return [
        UstIdNrRecognizer(),
        handelsregister_recognizer(),
        steuernummer_recognizer(),
        steuer_id_recognizer(),
        svnr_recognizer(),
        krankenversicherung_recognizer(),
        personalausweis_recognizer(),
        reisepass_recognizer(),
        kfz_recognizer(),
        bic_recognizer(),
        blz_recognizer(),
        eu_driving_licence_recognizer(),
    ]
