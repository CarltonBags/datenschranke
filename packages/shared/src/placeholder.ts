/**
 * Placeholder grammar — the single source of truth (TypeScript side).
 *
 * MIRRORED IN: services/redactor/app/placeholder.py
 * A cross-language test (services/redactor/tests/test_placeholder_crosslang.py +
 * packages/shared/src/placeholder.test.ts) asserts both implementations produce
 * and accept byte-identical strings.
 *
 * Format: [[TYPE_N]]  where TYPE ∈ ENTITY_TYPES and N is 1–4 digits,
 * numbered per conversation in order of first appearance.
 *
 * The vocabulary is CLOSED. Tenant custom recognizers all map to CUSTOM on the
 * wire; their descriptive label lives only in the token_map row / audit / admin
 * UI — never here, and couldBePlaceholderPrefix() must never depend on any
 * tenant-defined string.
 */

export const ENTITY_TYPES = [
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
] as const;

export type EntityType = (typeof ENTITY_TYPES)[number];

/** N is 1–4 digits. */
export const MIN_INDEX = 1;
export const MAX_INDEX = 9999;

const TYPE_ALT = ENTITY_TYPES.join("|");

/** Matches exactly one complete placeholder, anchored. */
export const PLACEHOLDER_RE = new RegExp(`^\\[\\[(${TYPE_ALT})_(\\d{1,4})\\]\\]$`);

/** Matches every complete placeholder inside a larger string (global). */
export const COMPLETE_PLACEHOLDER = new RegExp(`\\[\\[(?:${TYPE_ALT})_\\d{1,4}\\]\\]`, "g");

/**
 * Longest a valid placeholder can be: `[[` + longest type + `_` + 4 digits + `]]`.
 * The stream un-redactor's hold-back buffer bound derives from this.
 */
export const MAX_PLACEHOLDER_LENGTH = (() => {
  const longestType = ENTITY_TYPES.reduce((a, b) => (b.length > a.length ? b : a), "");
  return 2 + longestType.length + 1 + 4 + 2; // [[  TYPE  _  NNNN  ]]
})();

export function makePlaceholder(type: EntityType, index: number): string {
  if (!ENTITY_TYPES.includes(type)) {
    throw new Error(`Unknown entity type: ${type}`);
  }
  if (!Number.isInteger(index) || index < MIN_INDEX || index > MAX_INDEX) {
    throw new Error(`Placeholder index out of range: ${index}`);
  }
  return `[[${type}_${index}]]`;
}

export interface ParsedPlaceholder {
  type: EntityType;
  index: number;
}

export function parsePlaceholder(s: string): ParsedPlaceholder | null {
  const m = PLACEHOLDER_RE.exec(s);
  if (!m) return null;
  return { type: m[1] as EntityType, index: Number(m[2]) };
}

export function isPlaceholder(s: string): boolean {
  return PLACEHOLDER_RE.test(s);
}

/**
 * True if `s` could be the START of a valid placeholder — i.e. some string
 * `s + suffix` is a complete placeholder. Used by the stream un-redactor to
 * decide whether to hold bytes back. Must depend ONLY on the closed grammar.
 *
 * Examples that return true: "[", "[[", "[[PER", "[[PERSON_1", "[[CUSTOM_12".
 * Examples that return false: "[[XYZ", "[[PERSON_1]]" (already complete → not a
 * *prefix*), "hello".
 */
export function couldBePlaceholderPrefix(s: string): boolean {
  if (s.length === 0) return false;
  if (s.length > MAX_PLACEHOLDER_LENGTH) return false;

  // Leading brackets: "[" or "[["
  if (s === "[") return true;
  if (!s.startsWith("[[")) return false;
  if (s === "[[") return true;

  const rest = s.slice(2); // after "[["
  // rest looks like  TYPE_N]]  in some partial state.
  // Split into the portion before the first "_" (type) and after.
  const underscore = rest.indexOf("_");

  if (underscore === -1) {
    // Still typing the TYPE. Must be a prefix of some known type,
    // and there must be no illegal chars.
    return ENTITY_TYPES.some((t) => t.startsWith(rest));
  }

  const typePart = rest.slice(0, underscore);
  if (!ENTITY_TYPES.includes(typePart as EntityType)) return false;

  const afterType = rest.slice(underscore + 1); // digits, then maybe "]" or "]]"
  // Peel trailing closing brackets (0, 1, or 2).
  let digits = afterType;
  let closers = 0;
  while (digits.endsWith("]") && closers < 2) {
    digits = digits.slice(0, -1);
    closers += 1;
  }
  // Anything left after peeling closers that isn't digits → not a placeholder.
  if (digits.length > 4) return false;
  if (!/^\d*$/.test(digits)) return false;
  // If we already have two closers it's a complete placeholder, not a *prefix*.
  if (closers === 2) return false;
  // Need at least one digit eventually; empty digits with 0 closers ("[[PERSON_")
  // is still a valid prefix.
  return true;
}

/** System-prompt suffix appended to every outbound LLM request. */
export const PLACEHOLDER_SYSTEM_SUFFIX =
  "Tokens of the form [[TYPE_N]] are opaque references. " +
  "Preserve them exactly; never modify, translate, expand, or invent them.";
