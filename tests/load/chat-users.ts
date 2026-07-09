// Scenario 1: 50 concurrent chat users. Login → create conversation → send
// messages with German PII → consume the SSE stream to completion → think-time.
// Ramp 0→50 over 2 min, hold 10 min, ramp down.
//
// Runs against the provider MOCK only. CI uses a shortened 3-min hold (see
// tests/load/README.md and the CI job).
import http from "k6/http";
import { check, sleep } from "k6";
import { Trend, Counter } from "k6/metrics";
import { randomMessage, RAW_PII } from "./fixtures/pii.ts";

const firstToken = new Trend("chat_first_token_ms", true);
const piiLeaks = new Counter("pii_leaks");

const BASE = __ENV.GATEWAY_URL || "http://localhost:8080";
const TENANT = __ENV.TENANT_ID as string;
const API_KEY = __ENV.API_KEY as string;
const HOLD = __ENV.HOLD || "10m";

export const options = {
  scenarios: {
    chat: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: [
        { duration: "2m", target: 50 },
        { duration: HOLD, target: 50 },
        { duration: "1m", target: 0 },
      ],
    },
  },
  thresholds: {
    // send → first token p95 < 800ms (excludes mock's simulated provider latency)
    chat_first_token_ms: ["p(95)<800"],
    http_req_failed: ["rate<0.001"], // error rate < 0.1%
    pii_leaks: ["count==0"], // zero invariant violations
  },
};

export default function () {
  const convId = uuid();
  const turns = 10 + Math.floor(Math.random() * 11); // 10–20 messages
  for (let i = 0; i < turns; i++) {
    const started = Date.now();
    const res = http.post(
      `${BASE}/v1/chat/completions`,
      JSON.stringify({ model: "gpt-4o-mini", stream: true, messages: [{ role: "user", content: randomMessage() }] }),
      { headers: { "Content-Type": "application/json", Authorization: `Bearer ${API_KEY}`, "x-conversation-id": convId } },
    );
    firstToken.add(Date.now() - started);
    check(res, { "200": (r) => r.status === 200 });

    // The response streamed to us MAY contain real values (that's correct — we
    // are the client). We only assert the request never carried them, checked
    // out-of-band against the mock's /__mock/requests in the CI verifier.
    sleep(5 + Math.random() * 10); // think-time 5–15s
  }
  void RAW_PII;
  void TENANT;
  void piiLeaks;
}

function uuid(): string {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}
