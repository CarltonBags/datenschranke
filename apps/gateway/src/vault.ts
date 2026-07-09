/**
 * Token map vault client. The ONLY component that touches encrypted PII.
 *
 * - DEKs are unwrapped once per tenant and held in process memory (never cached
 *   in Redis, never logged).
 * - Redis caches the conversation map as CIPHERTEXT only (invariant #2); values
 *   are decrypted exclusively in this process.
 * - Reads/writes always run inside withTenant() so RLS confines them.
 */
import { Redis } from "ioredis";
import { config } from "./config.js";
import type { Db } from "./db.js";
import {
  decryptValue,
  encryptValue,
  generateDek,
  unwrapDek,
  valueHash,
} from "./crypto/envelope.js";
import { matchHash, normalize } from "./crypto/matchhash.js";
import type { NewMapEntry } from "@gdpr/shared";

const redis = new Redis(config.redisUrl, { lazyConnect: true, maxRetriesPerRequest: 2 });

// Unwrapped DEKs, in-memory only.
const dekCache = new Map<string, { dekId: string; dek: Buffer }>();

async function getTenantDek(db: Db, tenantId: string): Promise<{ dekId: string; dek: Buffer }> {
  const cached = dekCache.get(tenantId);
  if (cached) return cached;

  const rows = await db.query<{ id: string; wrapped_dek: Buffer }>(
    "SELECT id, wrapped_dek FROM data_keys WHERE tenant_id = $1 AND retired_at IS NULL ORDER BY created_at DESC LIMIT 1",
    [tenantId],
  );
  let entry: { dekId: string; dek: Buffer };
  if (rows.rows.length === 0) {
    const { wrapped, masterKeyId } = generateDek();
    const ins = await db.query<{ id: string }>(
      "INSERT INTO data_keys (tenant_id, wrapped_dek, master_key_id) VALUES ($1, $2, $3) RETURNING id",
      [tenantId, wrapped, masterKeyId],
    );
    entry = { dekId: ins.rows[0]!.id, dek: unwrapDek(wrapped) };
  } else {
    const row = rows.rows[0]!;
    entry = { dekId: row.id, dek: unwrapDek(row.wrapped_dek) };
  }
  dekCache.set(tenantId, entry);
  return entry;
}

/** What the redactor needs to reuse placeholders across turns. */
export interface ExistingEntity {
  value_hash: string; // == match_hash column (sha256 "TYPE:normalized")
  placeholder: string;
  type: string;
}

interface CachedRow {
  placeholder: string;
  entity_type: string;
  match_hash: string;
  ct: string; // base64
  iv: string;
  tag: string;
}

const cacheKey = (tenantId: string, conversationId: string) => `map:${tenantId}:${conversationId}`;

async function loadRows(db: Db, tenantId: string, conversationId: string): Promise<CachedRow[]> {
  try {
    const hit = await redis.get(cacheKey(tenantId, conversationId));
    if (hit) return JSON.parse(hit) as CachedRow[];
  } catch {
    /* cache is best-effort; fall through to Postgres */
  }
  const res = await db.query<{
    placeholder: string;
    entity_type: string;
    match_hash: string;
    value_ciphertext: Buffer;
    value_iv: Buffer;
    value_tag: Buffer;
  }>(
    "SELECT placeholder, entity_type, match_hash, value_ciphertext, value_iv, value_tag FROM token_map WHERE conversation_id = $1",
    [conversationId],
  );
  const rows: CachedRow[] = res.rows.map((r) => ({
    placeholder: r.placeholder,
    entity_type: r.entity_type,
    match_hash: r.match_hash,
    ct: r.value_ciphertext.toString("base64"),
    iv: r.value_iv.toString("base64"),
    tag: r.value_tag.toString("base64"),
  }));
  try {
    await redis.set(cacheKey(tenantId, conversationId), JSON.stringify(rows), "EX", config.mapCacheTtlSeconds);
  } catch {
    /* best-effort */
  }
  return rows;
}

/** Existing entities for the redactor (no decryption needed). */
export async function existingEntities(
  db: Db,
  tenantId: string,
  conversationId: string,
): Promise<ExistingEntity[]> {
  const rows = await loadRows(db, tenantId, conversationId);
  return rows.map((r) => ({ value_hash: r.match_hash, placeholder: r.placeholder, type: r.entity_type }));
}

/** placeholder -> original value, for un-redaction. Decrypts in-process only. */
export async function resolverMap(
  db: Db,
  tenantId: string,
  conversationId: string,
): Promise<Map<string, string>> {
  const [{ dek }, rows] = await Promise.all([
    getTenantDek(db, tenantId),
    loadRows(db, tenantId, conversationId),
  ]);
  const map = new Map<string, string>();
  for (const r of rows) {
    const value = decryptValue(dek, {
      ciphertext: Buffer.from(r.ct, "base64"),
      iv: Buffer.from(r.iv, "base64"),
      tag: Buffer.from(r.tag, "base64"),
    });
    map.set(r.placeholder, value);
  }
  return map;
}

/** Persist newly created map entries from a redaction. Idempotent per placeholder. */
export async function persistNewEntries(
  db: Db,
  tenantId: string,
  conversationId: string,
  entries: NewMapEntry[],
): Promise<void> {
  if (entries.length === 0) return;
  const { dekId, dek } = await getTenantDek(db, tenantId);
  for (const e of entries) {
    const sealed = encryptValue(dek, e.value);
    const norm = normalize(e.entity_type, e.value);
    await db.query(
      `INSERT INTO token_map
         (tenant_id, conversation_id, placeholder, entity_type, custom_label,
          value_ciphertext, value_iv, value_tag, value_hash, match_hash, dek_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       ON CONFLICT (conversation_id, placeholder) DO NOTHING`,
      [
        tenantId,
        conversationId,
        e.placeholder,
        e.entity_type,
        e.custom_label ?? null,
        sealed.ciphertext,
        sealed.iv,
        sealed.tag,
        valueHash(dek, e.entity_type, norm),
        matchHash(e.entity_type, e.value),
        dekId,
      ],
    );
  }
  // Invalidate the hot cache so the next turn reloads with the new entries.
  try {
    await redis.del(cacheKey(tenantId, conversationId));
  } catch {
    /* best-effort */
  }
}

/** GDPR Art. 17: delete a conversation and (via cascade) its map entries. */
export async function deleteConversation(db: Db, tenantId: string, conversationId: string): Promise<number> {
  const res = await db.query<{ count: string }>(
    "WITH del AS (DELETE FROM token_map WHERE conversation_id = $1 RETURNING 1) SELECT count(*)::text FROM del",
    [conversationId],
  );
  await db.query("DELETE FROM conversations WHERE id = $1", [conversationId]);
  try {
    await redis.del(cacheKey(tenantId, conversationId));
  } catch {
    /* best-effort */
  }
  return Number(res.rows[0]?.count ?? "0");
}

export async function connectRedis(): Promise<void> {
  if (redis.status === "wait" || redis.status === "close" || redis.status === "end") {
    await redis.connect().catch(() => undefined);
  }
}
export async function closeRedis(): Promise<void> {
  await redis.quit().catch(() => undefined);
}
