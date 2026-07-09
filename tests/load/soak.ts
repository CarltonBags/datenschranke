// Scenario 4: soak — 20 users for 2h. Assert no memory growth in gateway/
// redactor containers, no Redis key leaks, token_map growth matches expectation.
// (Resource sampling + leak assertions are done by the runner in sizing.ts /
//  a docker-stats sidecar; this script drives steady load.)
import http from "k6/http";
import { check, sleep } from "k6";
import { randomMessage } from "./fixtures/pii.ts";

const BASE = __ENV.GATEWAY_URL || "http://localhost:8080";
const API_KEY = __ENV.API_KEY as string;

export const options = {
  vus: 20,
  duration: __ENV.DURATION || "2h",
  thresholds: { http_req_failed: ["rate<0.001"] },
};

export default function () {
  const res = http.post(
    `${BASE}/v1/chat/completions`,
    JSON.stringify({ model: "gpt-4o-mini", stream: true, messages: [{ role: "user", content: randomMessage() }] }),
    { headers: { "Content-Type": "application/json", Authorization: `Bearer ${API_KEY}` } },
  );
  check(res, { "200": (r) => r.status === 200 });
  sleep(3 + Math.random() * 4);
}
