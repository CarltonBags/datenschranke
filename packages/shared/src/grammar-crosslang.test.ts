import { describe, it, expect } from "vitest";
import fixtures from "./grammar-fixtures.json" with { type: "json" };
import {
  makePlaceholder,
  isPlaceholder,
  couldBePlaceholderPrefix,
  MAX_PLACEHOLDER_LENGTH,
  COMPLETE_PLACEHOLDER,
  type EntityType,
} from "./placeholder.js";

describe("cross-language grammar fixtures (TS side)", () => {
  it("MAX_PLACEHOLDER_LENGTH matches the fixture", () => {
    expect(MAX_PLACEHOLDER_LENGTH).toBe(fixtures.max_placeholder_length);
  });

  it("make() matches fixtures", () => {
    for (const c of fixtures.make) {
      expect(makePlaceholder(c.type as EntityType, c.index)).toBe(c.out);
    }
  });

  it("isPlaceholder true/false match fixtures", () => {
    for (const s of fixtures.is_placeholder_true) expect(isPlaceholder(s)).toBe(true);
    for (const s of fixtures.is_placeholder_false) expect(isPlaceholder(s)).toBe(false);
  });

  it("couldBePlaceholderPrefix true/false match fixtures", () => {
    for (const s of fixtures.prefix_true) expect(couldBePlaceholderPrefix(s)).toBe(true);
    for (const s of fixtures.prefix_false) expect(couldBePlaceholderPrefix(s)).toBe(false);
  });

  it("finds all placeholders in a body", () => {
    expect(fixtures.find_in_body.text.match(COMPLETE_PLACEHOLDER)).toEqual(fixtures.find_in_body.out);
  });
});
