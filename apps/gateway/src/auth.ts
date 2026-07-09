/**
 * Product B auth: hashed API keys (SHA-256), prefix-searchable.
 * Key format: `gk_<prefix>_<secret>`. We store SHA-256(full key) + prefix.
 */
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { query } from "./db.js";

export interface Principal {
  tenantId: string;
  actor: string; // "apikey:<prefix>"
}

const PREFIX_LEN = 12;

export function hashKey(fullKey: string): Buffer {
  return createHash("sha256").update(fullKey).digest();
}

/** Generate a new API key. Returns the plaintext ONCE and the stored fields. */
export function generateApiKey(): { key: string; prefix: string; keyHash: Buffer } {
  const prefix = `gk_${randomBytes(6).toString("hex")}`.slice(0, PREFIX_LEN);
  const secret = randomBytes(24).toString("base64url");
  const key = `${prefix}_${secret}`;
  return { key, prefix, keyHash: hashKey(key) };
}

export async function authenticate(authHeader: string | undefined): Promise<Principal | null> {
  if (!authHeader?.startsWith("Bearer ")) return null;
  const key = authHeader.slice(7).trim();
  const prefix = key.split("_").slice(0, 2).join("_").slice(0, PREFIX_LEN);
  if (!prefix) return null;

  // Cross-tenant lookup via a SECURITY DEFINER function (0003_auth_lookup):
  // RLS hides api_keys when app.tenant_id is unset, but auth must resolve the
  // tenant FROM the key. The function returns only tenant_id + hash for an
  // active key matched by prefix.
  const res = await query<{ tenant_id: string; key_hash: Buffer }>(
    "SELECT tenant_id, key_hash FROM find_api_key($1)",
    [prefix],
  );
  const row = res.rows[0];
  if (!row) return null;

  const provided = hashKey(key);
  if (provided.length !== row.key_hash.length || !timingSafeEqual(provided, row.key_hash)) {
    return null;
  }
  return { tenantId: row.tenant_id, actor: `apikey:${prefix}` };
}
