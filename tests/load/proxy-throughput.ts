// Scenario 2: Product B sustained req/s against /v1/chat/completions.
// Streaming + non-streaming mix, payloads 0.5 / 2 / 8 KB.
import http from "k6/http";
import { check } from "k6";
import { Trend } from "k6/metrics";
import { randomMessage } from "./fixtures/pii.ts";

const overhead = new Trend("proxy_overhead_ms", true);
const BASE = __ENV.GATEWAY_URL || "http://localhost:8080";
const API_KEY = __ENV.API_KEY as string;

export const options = {
  scenarios: {
    proxy: { executor: "constant-arrival-rate", rate: Number(__ENV.RPS || 50), timeUnit: "1s", duration: __ENV.DURATION || "5m", preAllocatedVUs: 50, maxVUs: 200 },
  },
  thresholds: {
    // non-streaming proxy overhead p95 < 250ms
    "proxy_overhead_ms{mode:non-stream}": ["p(95)<250"],
    http_req_failed: ["rate<0.001"],
  },
};

function payload(sizeKb: number): string {
  const filler = "Lorem ipsum dolor sit amet. ".repeat(Math.ceil((sizeKb * 1024) / 28));
  return `${randomMessage()} ${filler}`.slice(0, sizeKb * 1024);
}

export default function () {
  const stream = Math.random() < 0.5;
  const size = [0.5, 2, 8][Math.floor(Math.random() * 3)]!;
  const started = Date.now();
  const res = http.post(
    `${BASE}/v1/chat/completions`,
    JSON.stringify({ model: "gpt-4o-mini", stream, messages: [{ role: "user", content: payload(size) }] }),
    { headers: { "Content-Type": "application/json", Authorization: `Bearer ${API_KEY}` } },
  );
  overhead.add(Date.now() - started, { mode: stream ? "stream" : "non-stream" });
  check(res, { "200": (r) => r.status === 200 });
}
