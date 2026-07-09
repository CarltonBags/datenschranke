import { describe, it, expect } from "vitest";
import { StreamUnredactor, type ResolveFn } from "./core.js";

const MAP: Record<string, string> = {
  "[[PERSON_1]]": "Anna Schmidt",
  "[[IBAN_2]]": "DE89 3704 0044 0532 0130 00",
  "[[EMAIL_3]]": "anna@example.de",
  "[[CUSTOM_1]]": "UK-78dzu",
};
const resolve: ResolveFn = (p) => MAP[p];

function runChunks(chunks: string[], r: ResolveFn = resolve) {
  const u = new StreamUnredactor(r);
  let out = "";
  for (const c of chunks) out += u.push(c);
  out += u.flush();
  return { out, stats: u.stats };
}

describe("StreamUnredactor", () => {
  it("resolves a whole placeholder in one chunk", () => {
    expect(runChunks(["Hallo [[PERSON_1]]!"]).out).toBe("Hallo Anna Schmidt!");
  });

  it("resolves a placeholder split across 2 chunks", () => {
    expect(runChunks(["Hallo [[PER", "SON_1]]!"]).out).toBe("Hallo Anna Schmidt!");
  });

  it("resolves a placeholder split across 4 chunks", () => {
    expect(runChunks(["Hallo [[", "PERS", "ON_", "1]]!"]).out).toBe("Hallo Anna Schmidt!");
  });

  it("resolves one char at a time", () => {
    const text = "IBAN [[IBAN_2]] ok";
    expect(runChunks([...text]).out).toBe("IBAN DE89 3704 0044 0532 0130 00 ok");
  });

  it("handles back-to-back placeholders", () => {
    expect(runChunks(["[[PERSON_1]]", "[[EMAIL_3]]"]).out).toBe("Anna Schmidtanna@example.de");
    expect(runChunks(["[[PERSON_1]][[EMAIL_3]]"]).out).toBe("Anna Schmidtanna@example.de");
  });

  it("passes unknown placeholders through and counts them", () => {
    const { out, stats } = runChunks(["hi [[PERSON_99]] there"]);
    expect(out).toBe("hi [[PERSON_99]] there");
    expect(stats.unknown).toBe(1);
    expect(stats.unknownPlaceholders).toEqual(["[[PERSON_99]]"]);
  });

  it("emits leftover text when the stream ends mid-possible-placeholder", () => {
    // Never completes → the partial must still be emitted verbatim on flush.
    expect(runChunks(["ends here [[PER"]).out).toBe("ends here [[PER");
    expect(runChunks(["trailing bracket ["]).out).toBe("trailing bracket [");
  });

  it("does not treat a bracket run that can't be a placeholder as held", () => {
    expect(runChunks(["arr[0] and [[XYZ]] stay"]).out).toBe("arr[0] and [[XYZ]] stay");
  });

  it("counts replacements", () => {
    const { stats } = runChunks(["[[PERSON_1]] [[IBAN_2]] [[PERSON_1]]"]);
    expect(stats.replaced).toBe(3);
  });

  it("resolves CUSTOM placeholders", () => {
    expect(runChunks(["Konto [[CUSTOM_1]] ok"]).out).toBe("Konto UK-78dzu ok");
  });
});
