import { describe, it, expect } from "vitest";
import {
  createSSEUnredactor,
  openAIChatFormat,
  anthropicFormat,
  unredactBody,
  type SSEFormat,
} from "./sse.js";
import type { ResolveFn } from "./core.js";

const MAP: Record<string, string> = {
  "[[PERSON_1]]": "Anna Schmidt",
  "[[IBAN_2]]": "DE89 3704 0044 0532 0130 00",
};
const resolve: ResolveFn = (p) => MAP[p];

/** Feed raw SSE chunks through the transform, return the decoded output text. */
async function drive(chunks: string[], format: SSEFormat): Promise<string> {
  const { stream } = createSSEUnredactor(resolve, format);
  const enc = new TextEncoder();
  const dec = new TextDecoder();
  const writer = stream.writable.getWriter();
  const reader = stream.readable.getReader();
  let out = "";
  const pump = (async () => {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      out += dec.decode(value, { stream: true });
    }
  })();
  for (const c of chunks) await writer.write(enc.encode(c));
  await writer.close();
  await pump;
  return out;
}

/** Reconstruct the full assistant text from an OpenAI SSE output. */
function reconstructOpenAI(sse: string): string {
  let text = "";
  for (const line of sse.split("\n")) {
    if (!line.startsWith("data:")) continue;
    const payload = line.slice(5).trim();
    if (payload === "[DONE]" || payload === "") continue;
    const obj = JSON.parse(payload) as { choices?: Array<{ delta?: { content?: string } }> };
    text += obj.choices?.[0]?.delta?.content ?? "";
  }
  return text;
}

function reconstructAnthropic(sse: string): string {
  let text = "";
  for (const line of sse.split("\n")) {
    if (!line.startsWith("data:")) continue;
    const payload = line.slice(5).trim();
    if (payload === "") continue;
    const obj = JSON.parse(payload) as { type?: string; delta?: { text?: string } };
    if (obj.type === "content_block_delta") text += obj.delta?.text ?? "";
  }
  return text;
}

function oaDelta(content: string): string {
  return `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content } }] })}\n\n`;
}

describe("OpenAI SSE un-redactor", () => {
  it("un-redacts a placeholder split across SSE events", async () => {
    const chunks = [oaDelta("Hallo [[PER"), oaDelta("SON_1]], IBAN "), oaDelta("[[IBAN_2]]."), "data: [DONE]\n\n"];
    const out = await drive(chunks, openAIChatFormat);
    expect(reconstructOpenAI(out)).toBe("Hallo Anna Schmidt, IBAN DE89 3704 0044 0532 0130 00.");
    expect(out.trimEnd().endsWith("data: [DONE]")).toBe(true);
  });

  it("un-redacts a placeholder split even across raw byte-chunk boundaries", async () => {
    const full = oaDelta("Hi [[PERSON_1]]") + "data: [DONE]\n\n";
    // Split the raw SSE text at an awkward byte position mid-placeholder.
    const cut = full.indexOf("PERSON") + 2;
    const out = await drive([full.slice(0, cut), full.slice(cut)], openAIChatFormat);
    expect(reconstructOpenAI(out)).toBe("Hi Anna Schmidt");
  });

  it("passes tool-call argument deltas through untouched (no content delta)", async () => {
    const toolChunk = `data: ${JSON.stringify({
      choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: "call_abc", function: { arguments: '{"city":"' } }] } }],
    })}\n\n`;
    const out = await drive([toolChunk, "data: [DONE]\n\n"], openAIChatFormat);
    expect(out).toContain('"id":"call_abc"');
    expect(out).toContain('{\\"city\\":\\"');
  });

  it("passes non-data SSE lines through verbatim", async () => {
    const out = await drive([": keep-alive\n", oaDelta("[[PERSON_1]]"), "data: [DONE]\n\n"], openAIChatFormat);
    expect(out).toContain(": keep-alive");
    expect(reconstructOpenAI(out)).toBe("Anna Schmidt");
  });
});

describe("Anthropic SSE un-redactor", () => {
  const delta = (text: string) =>
    `event: content_block_delta\ndata: ${JSON.stringify({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text } })}\n\n`;

  it("un-redacts content_block_delta split across events", async () => {
    const chunks = [delta("Hallo [[PER"), delta("SON_1]]"), `data: ${JSON.stringify({ type: "message_stop" })}\n\n`];
    const out = await drive(chunks, anthropicFormat);
    expect(reconstructAnthropic(out)).toBe("Hallo Anna Schmidt");
  });
});

describe("non-streaming whole-body", () => {
  it("replaces all placeholders and reports stats", () => {
    const { text, stats } = unredactBody("[[PERSON_1]] has IBAN [[IBAN_2]] and [[PERSON_9]]", resolve);
    expect(text).toBe("Anna Schmidt has IBAN DE89 3704 0044 0532 0130 00 and [[PERSON_9]]");
    expect(stats.replaced).toBe(2);
    expect(stats.unknown).toBe(1);
  });
});
