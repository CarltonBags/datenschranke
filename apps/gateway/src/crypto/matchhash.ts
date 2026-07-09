/**
 * match_hash: sha256("TYPE:<normalized value>") — the reuse key the redactor
 * uses to keep the same placeholder for the same entity across turns.
 *
 * MUST byte-match services/redactor/app/redactor.py :: normalize + value_hash.
 * (A cross-service test in the E2E suite asserts identical placeholders across
 * turns, which would fail if these drift.)
 */
import { createHash } from "node:crypto";

const NO_SPACE_TYPES = new Set(["IBAN", "PHONE", "ID"]);

export function normalize(entityType: string, value: string): string {
  let v = value.trim();
  v = NO_SPACE_TYPES.has(entityType) ? v.replace(/\s+/g, "") : v.replace(/\s+/g, " ");
  // Python str.casefold(): lower-case + special folds (notably ß -> ss).
  return v.toLowerCase().replace(/ß/g, "ss");
}

export function matchHash(entityType: string, value: string): string {
  return createHash("sha256").update(`${entityType}:${normalize(entityType, value)}`).digest("hex");
}
