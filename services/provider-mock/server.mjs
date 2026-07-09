#!/usr/bin/env node
/**
 * OpenAI-compatible provider MOCK. Never call real providers in tests/load.
 *
 * Key behaviour for exercising the stream un-redactor: it echoes placeholders
 * found in the incoming (already-redacted) prompt back in its reply, and when
 * streaming it DELIBERATELY splits those placeholders across SSE chunks (1-3
 * chars at a time). If the gateway's un-redactor is correct, the client sees
 * the real values reassembled; if not, the split shows up as corruption.
 *
 * It also records every request body so a test can assert NO raw PII ever
 * reached the provider (GET /__mock/requests).
 */
import { createServer } from "node:http";

const PORT = Number(process.env.PORT ?? 9090);
const LATENCY_MS = Number(process.env.MOCK_LATENCY_MS ?? 40);
const PLACEHOLDER = /\[\[(?:PERSON|EMAIL|PHONE|IBAN|ADDRESS|ORG|LOCATION|DATE|ID|MISC|CUSTOM)_\d{1,4}\]\]/g;

const recorded = [];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function replyText(messages) {
  const lastUser = [...messages].reverse().find((m) => m.role === "user");
  const placeholders = (lastUser?.content ?? "").match(PLACEHOLDER) ?? [];
  if (placeholders.length === 0) {
    return "Verstanden. Ich habe Ihre Nachricht ohne personenbezogene Daten erhalten.";
  }
  // Reference the placeholders so un-redaction restores the real values.
  const uniq = [...new Set(placeholders)];
  return `Zusammenfassung: Ich habe die Angaben zu ${uniq.join(" und ")} verarbeitet und gespeichert.`;
}

/** Split a string into pieces of 1-3 chars — splits placeholders mid-token. */
function tinyChunks(text) {
  const out = [];
  let i = 0;
  while (i < text.length) {
    const n = 1 + (i % 3); // 1,2,3,1,2,3...
    out.push(text.slice(i, i + n));
    i += n;
  }
  return out;
}

function chunkEvent(content) {
  return `data: ${JSON.stringify({
    id: "chatcmpl-mock",
    object: "chat.completion.chunk",
    created: Math.floor(Date.now() / 1000),
    model: "mock",
    choices: [{ index: 0, delta: { content }, finish_reason: null }],
  })}\n\n`;
}

const server = createServer((req, res) => {
  if (req.method === "GET" && req.url === "/__mock/requests") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(recorded));
    return;
  }
  if (req.method === "GET" && req.url === "/healthz") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end('{"status":"ok"}');
    return;
  }
  if (req.method !== "POST" || !req.url.endsWith("/chat/completions")) {
    res.writeHead(404).end();
    return;
  }

  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", async () => {
    let parsed;
    try {
      parsed = JSON.parse(body);
    } catch {
      res.writeHead(400).end('{"error":"bad json"}');
      return;
    }
    recorded.push({ at: Date.now(), body: parsed });
    if (recorded.length > 1000) recorded.shift();

    const content = replyText(parsed.messages ?? []);
    await sleep(LATENCY_MS);

    if (parsed.stream) {
      res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
      for (const piece of tinyChunks(content)) {
        res.write(chunkEvent(piece));
        await sleep(2);
      }
      res.write(
        `data: ${JSON.stringify({
          id: "chatcmpl-mock",
          object: "chat.completion.chunk",
          choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
        })}\n\n`,
      );
      res.write("data: [DONE]\n\n");
      res.end();
    } else {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          id: "chatcmpl-mock",
          object: "chat.completion",
          created: Math.floor(Date.now() / 1000),
          model: parsed.model ?? "mock",
          choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }],
          usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
        }),
      );
    }
  });
});

server.listen(PORT, () => console.log(`provider-mock listening on ${PORT} (latency ${LATENCY_MS}ms)`));
