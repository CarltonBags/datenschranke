import { describe, it, expect, beforeAll } from "vitest";
import { matchHash, normalize } from "./matchhash.js";

// Envelope tests need a 32-byte master key.
beforeAll(() => {
  process.env.MASTER_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
  process.env.GATEWAY_DATABASE_URL = "postgres://x/y";
});

describe("matchHash cross-service contract (must equal redactor.value_hash)", () => {
  // Expected values computed by services/redactor/app/redactor.py :: value_hash.
  it.each([
    ["PERSON", "Anna Schmidt", "219ebe8c7b3ee0ecadb5427d9126251cc881669e1b53e2ebcf3660a8961200fb"],
    ["IBAN", "DE89 3704 0044", "113e96e59d9ca956a93646fd01a039248d2e312feeedaf27c5ce9c06cff40946"],
    ["CUSTOM", "UK-78dzu", "601ff3eced6a37b7672ad5f333061f4d640ba1e457c9cbb9598e39e499c0ba91"],
    ["PERSON", "Straße Müller", "a4e223eeccb43709be39dc19e46bb64a615f3d0c6b868b408068affe4c5d32eb"],
  ])("%s %s", (type, value, expected) => {
    expect(matchHash(type, value)).toBe(expected);
  });

  it("normalizes IBAN by stripping whitespace", () => {
    expect(normalize("IBAN", "DE89 3704 0044")).toBe("de8937040044");
  });
});

describe("envelope encryption", () => {
  it("round-trips a value under a tenant DEK", async () => {
    const { generateDek, encryptValue, decryptValue, unwrapDek } = await import("./envelope.js");
    const { dek, wrapped } = generateDek();
    const sealed = encryptValue(dek, "Anna Schmidt");
    expect(decryptValue(dek, sealed)).toBe("Anna Schmidt");
    // DEK survives wrap/unwrap with the master key.
    const dek2 = unwrapDek(wrapped);
    expect(decryptValue(dek2, sealed)).toBe("Anna Schmidt");
  });

  it("produces different ciphertext each time (random IV)", async () => {
    const { generateDek, encryptValue } = await import("./envelope.js");
    const { dek } = generateDek();
    const a = encryptValue(dek, "secret");
    const b = encryptValue(dek, "secret");
    expect(a.ciphertext.equals(b.ciphertext) && a.iv.equals(b.iv)).toBe(false);
  });
});
