#!/usr/bin/env node
/**
 * Full-path smoke test, run inside the gateway container by deploy.sh.
 *
 * Sends a message with a German name + valid IBAN through the real gateway →
 * redactor → provider(mock) → un-redactor, then asserts:
 *   (a) the caller gets the REAL values back (round-trip works), and
 *   (b) when using the mock, NO raw PII ever reached the provider (invariant #1).
 *
 * Prints a single JSON line: {"ok":true,...} or {"ok":false,"error":...}.
 */
import { randomUUID } from "node:crypto";
import pg from "pg";

const GATEWAY = process.env.SMOKE_GATEWAY_URL ?? "http://localhost:8080";
const MOCK = process.env.MOCK_PROVIDER_URL ?? "http://provider-mock:9090";
const useMock = (process.env.DEFAULT_PROVIDER ?? "mock") === "mock";
const NAME = "Anna Schmidt";
const IBAN = "DE89 3704 0044 0532 0130 00";
const IBAN_COMPACT = IBAN.replace(/\s/g, "");

async function main() {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  const name = `__smoke_${randomUUID().slice(0, 8)}`;
  const { createHash, randomBytes } = await import("node:crypto");
  const prefix = `gk_${randomBytes(6).toString("hex")}`.slice(0, 12);
  const key = `${prefix}_${randomBytes(24).toString("base64url")}`;
  const keyHash = createHash("sha256").update(key).digest();

  let tenantId;
  try {
    tenantId = (await client.query("INSERT INTO tenants(name) VALUES ($1) RETURNING id", [name])).rows[0].id;
    await client.query(
      "INSERT INTO policies(tenant_id, version, document) VALUES ($1,1,$2)",
      [tenantId, JSON.stringify({ version: 1, default_action: "redact", entities: {}, min_confidence: 0.5, allowed_providers: [process.env.DEFAULT_PROVIDER ?? "mock"], languages: ["de", "en"] })],
    );
    await client.query("INSERT INTO api_keys(tenant_id,name,prefix,key_hash) VALUES ($1,'smoke',$2,$3)", [tenantId, prefix, keyHash]);

    const convId = randomUUID();
    const res = await fetch(`${GATEWAY}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${key}`, "x-conversation-id": convId },
      body: JSON.stringify({
        model: process.env.SMOKE_MODEL ?? (useMock ? "gpt-4o-mini" : "deepseek-chat"),
        stream: false,
        messages: [{ role: "user", content: `Ich bin ${NAME}, meine IBAN ist ${IBAN}.` }],
      }),
    });
    const body = await res.json();
    const content = body?.choices?.[0]?.message?.content ?? "";

    // (a) round-trip: the mock deterministically echoes placeholders, so we can
    // assert the real name comes back. A real LLM's wording is nondeterministic,
    // so there we only require a successful (200) completion.
    const roundTrip = content.includes(NAME);

    // (b) leak check against the mock's recorded request bodies (mock only).
    let noLeak = true;
    if (useMock) {
      const recorded = await (await fetch(`${MOCK}/__mock/requests`)).json();
      const dump = JSON.stringify(recorded);
      noLeak = !dump.includes(NAME) && !dump.includes(IBAN) && !dump.includes(IBAN_COMPACT);
    }

    const ok = useMock ? res.ok && roundTrip && noLeak : res.ok && content.length > 0;
    console.log(JSON.stringify({ ok, status: res.status, roundTrip, noLeak, checkedMock: useMock, sample: content.slice(0, 120) }));
    process.exitCode = ok ? 0 : 1;
  } finally {
    if (tenantId) await client.query("DELETE FROM tenants WHERE id = $1", [tenantId]).catch(() => {});
    await client.end();
  }
}

main().catch((err) => {
  console.log(JSON.stringify({ ok: false, error: String(err?.message ?? err) }));
  process.exit(1);
});
