// Scenario 3: isolate the Python redactor. p50/p95/p99 vs text size and entity
// density, with and without tenant custom recognizers.
import http from "k6/http";
import { check } from "k6";
import { Trend } from "k6/metrics";
import { randomMessage } from "./fixtures/pii.ts";

const lat2k = new Trend("redactor_2kb_ms", true);
const lat8k = new Trend("redactor_8kb_ms", true);
const REDACTOR = __ENV.REDACTOR_URL || "http://localhost:8000";

export const options = {
  vus: Number(__ENV.VUS || 10),
  duration: __ENV.DURATION || "3m",
  thresholds: {
    redactor_2kb_ms: ["p(95)<150"], // p95 < 150ms @ 2KB
    redactor_8kb_ms: ["p(95)<400"], // p95 < 400ms @ 8KB
  },
};

const POLICY = { version: 1, default_action: "redact", entities: {}, min_confidence: 0.6, allowed_providers: ["mock"], languages: ["de", "en"] };

function text(kb: number): string {
  let s = "";
  while (s.length < kb * 1024) s += randomMessage() + " ";
  return s.slice(0, kb * 1024);
}

function bench(kb: number, trend: Trend, custom = false) {
  const policy = custom
    ? { ...POLICY, custom_entities: [{ label: "Acme account", kind: "pattern", regex: "\\bUK-\\d{2}[a-z]{3}\\b", score: 0.7, action: "redact" }] }
    : POLICY;
  const res = http.post(
    `${REDACTOR}/v1/redact`,
    JSON.stringify({ tenant_id: uuid(), conversation_id: uuid(), text: text(kb), policy, existing_entities: [] }),
    { headers: { "Content-Type": "application/json" } },
  );
  trend.add(res.timings.duration, { custom: String(custom) });
  check(res, { "200": (r) => r.status === 200 });
}

export default function () {
  bench(2, lat2k, false);
  bench(2, lat2k, true);
  bench(8, lat8k, false);
}

function uuid(): string {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}
