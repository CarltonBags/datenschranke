#!/usr/bin/env node
/**
 * Seed a tenant + default policy + a fresh API key. Runs inside the gateway
 * container against the SUPERUSER DATABASE_URL (bypasses RLS for setup only).
 *
 * Usage: node seed.mjs <tenant-name>
 * Prints JSON: {"tenant_id": "...", "api_key": "..."}  (key shown once)
 */
import { createHash, randomBytes } from "node:crypto";
import pg from "pg";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("seed: DATABASE_URL required");
  process.exit(1);
}
const tenantName = process.argv[2] ?? "Demo GmbH";

const DEFAULT_POLICY = {
  version: 1,
  default_action: "redact",
  entities: { ORG: "allow" },
  min_confidence: 0.6,
  allowed_providers: [process.env.DEFAULT_PROVIDER ?? "mock"],
  languages: ["de", "en"],
};

function makeApiKey() {
  const prefix = `gk_${randomBytes(6).toString("hex")}`.slice(0, 12);
  const secret = randomBytes(24).toString("base64url");
  const key = `${prefix}_${secret}`;
  return { key, prefix, keyHash: createHash("sha256").update(key).digest() };
}

const client = new pg.Client({ connectionString: DATABASE_URL });
await client.connect();
try {
  const existing = await client.query("SELECT id FROM tenants WHERE name = $1", [tenantName]);
  let tenantId = existing.rows[0]?.id;
  if (!tenantId) {
    tenantId = (await client.query("INSERT INTO tenants(name) VALUES ($1) RETURNING id", [tenantName])).rows[0].id;
  }
  await client.query(
    `INSERT INTO policies(tenant_id, version, document)
     VALUES ($1,$2,$3)
     ON CONFLICT (tenant_id) DO UPDATE SET version=EXCLUDED.version, document=EXCLUDED.document`,
    [tenantId, DEFAULT_POLICY.version, JSON.stringify(DEFAULT_POLICY)],
  );
  const { key, prefix, keyHash } = makeApiKey();
  await client.query(
    "INSERT INTO api_keys(tenant_id, name, prefix, key_hash) VALUES ($1,$2,$3,$4)",
    [tenantId, "seed-key", prefix, keyHash],
  );
  console.log(JSON.stringify({ tenant_id: tenantId, api_key: key }));
} finally {
  await client.end();
}
