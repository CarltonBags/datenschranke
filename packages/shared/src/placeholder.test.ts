import { describe, it, expect } from "vitest";
import {
  ENTITY_TYPES,
  MAX_PLACEHOLDER_LENGTH,
  makePlaceholder,
  parsePlaceholder,
  isPlaceholder,
  couldBePlaceholderPrefix,
  COMPLETE_PLACEHOLDER,
} from "./placeholder.js";

describe("placeholder grammar", () => {
  it("round-trips make/parse for every type", () => {
    for (const t of ENTITY_TYPES) {
      const p = makePlaceholder(t, 42);
      expect(p).toBe(`[[${t}_42]]`);
      expect(parsePlaceholder(p)).toEqual({ type: t, index: 42 });
      expect(isPlaceholder(p)).toBe(true);
    }
  });

  it("rejects out-of-range index", () => {
    expect(() => makePlaceholder("PERSON", 0)).toThrow();
    expect(() => makePlaceholder("PERSON", 10000)).toThrow();
  });

  it("MAX_PLACEHOLDER_LENGTH bounds every 4-digit placeholder", () => {
    for (const t of ENTITY_TYPES) {
      expect(makePlaceholder(t, 9999).length).toBeLessThanOrEqual(MAX_PLACEHOLDER_LENGTH);
    }
  });

  it("finds complete placeholders in a body", () => {
    const s = "Hi [[PERSON_1]], your IBAN [[IBAN_2]] is fine [[CUSTOM_10]].";
    const found = s.match(COMPLETE_PLACEHOLDER);
    expect(found).toEqual(["[[PERSON_1]]", "[[IBAN_2]]", "[[CUSTOM_10]]"]);
  });

  describe("couldBePlaceholderPrefix", () => {
    const yes = ["[", "[[", "[[P", "[[PER", "[[PERSON", "[[PERSON_", "[[PERSON_1", "[[PERSON_12]", "[[CUSTOM_9999", "[[IB"];
    const no = ["", "x", "[[XYZ", "[[PERSON_1]]", "[[PERSON_12345", "hello[[", "[[PERSONX", "[[PERSON_a"];

    for (const s of yes) {
      it(`true: ${JSON.stringify(s)}`, () => expect(couldBePlaceholderPrefix(s)).toBe(true));
    }
    for (const s of no) {
      it(`false: ${JSON.stringify(s)}`, () => expect(couldBePlaceholderPrefix(s)).toBe(false));
    }
  });
});
