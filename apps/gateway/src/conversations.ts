import { randomUUID } from "node:crypto";
import type { Db } from "./db.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Ensure a conversation row exists for this tenant; returns its id. */
export async function ensureConversation(
  db: Db,
  product: "chat" | "proxy",
  requestedId?: string,
  title?: string,
): Promise<string> {
  const id = requestedId && UUID_RE.test(requestedId) ? requestedId : randomUUID();
  await db.query(
    `INSERT INTO conversations (id, tenant_id, product, title)
     VALUES ($1, current_setting('app.tenant_id')::uuid, $2, $3)
     ON CONFLICT (id) DO NOTHING`,
    [id, product, title ?? null],
  );
  return id;
}

export async function listConversations(db: Db): Promise<Array<{ id: string; title: string | null; created_at: string }>> {
  const res = await db.query<{ id: string; title: string | null; created_at: string }>(
    "SELECT id, title, created_at FROM conversations WHERE deleted_at IS NULL ORDER BY created_at DESC LIMIT 200",
  );
  return res.rows;
}
