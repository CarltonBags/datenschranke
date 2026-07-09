/** Per-tenant policy: load from Postgres, cache in Redis, validate with zod. */
import { Redis } from "ioredis";
import { config } from "./config.js";
import type { Db } from "./db.js";
import { tenantPolicySchema, type TenantPolicy } from "@gdpr/shared";

const redis = new Redis(config.redisUrl, { lazyConnect: true, maxRetriesPerRequest: 2 });
const policyKey = (tenantId: string) => `policy:${tenantId}`;

const DEFAULT_POLICY: TenantPolicy = {
  version: 1,
  default_action: "redact",
  entities: {},
  min_confidence: 0.6,
  allowed_providers: [config.defaultProvider],
  languages: ["de", "en"],
};

export async function loadPolicy(db: Db, tenantId: string): Promise<TenantPolicy> {
  try {
    const hit = await redis.get(policyKey(tenantId));
    if (hit) return tenantPolicySchema.parse(JSON.parse(hit));
  } catch {
    /* best-effort cache */
  }
  const res = await db.query<{ document: unknown }>(
    "SELECT document FROM policies WHERE tenant_id = $1",
    [tenantId],
  );
  const doc = res.rows[0]?.document;
  const policy = doc ? tenantPolicySchema.parse(doc) : DEFAULT_POLICY;
  try {
    await redis.set(policyKey(tenantId), JSON.stringify(policy), "EX", 300);
  } catch {
    /* best-effort */
  }
  return policy;
}

export async function savePolicy(db: Db, tenantId: string, policy: TenantPolicy): Promise<void> {
  const validated = tenantPolicySchema.parse(policy);
  await db.query(
    `INSERT INTO policies (tenant_id, version, document, updated_at)
     VALUES ($1, $2, $3, now())
     ON CONFLICT (tenant_id) DO UPDATE SET version = EXCLUDED.version, document = EXCLUDED.document, updated_at = now()`,
    [tenantId, validated.version, JSON.stringify(validated)],
  );
  try {
    await redis.del(policyKey(tenantId));
  } catch {
    /* best-effort */
  }
}
