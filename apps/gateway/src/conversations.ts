import { randomUUID } from "node:crypto";
import type { Db } from "./db.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Ensure a conversation row exists for this tenant + owner; returns its id. */
export async function ensureConversation(
  db: Db,
  product: "chat" | "proxy",
  requestedId?: string,
  title?: string,
  ownerUserId?: string | null,
): Promise<string> {
  const id = requestedId && UUID_RE.test(requestedId) ? requestedId : randomUUID();
  await db.query(
    `INSERT INTO conversations (id, tenant_id, product, title, owner_user_id)
     VALUES ($1, current_setting('app.tenant_id')::uuid, $2, $3, $4)
     ON CONFLICT (id) DO NOTHING`,
    [id, product, title ?? null, ownerUserId ?? null],
  );
  return id;
}

/** True if the conversation belongs to this owner (or is unowned/legacy). */
export async function ownsConversation(db: Db, conversationId: string, ownerUserId: string): Promise<boolean> {
  const res = await db.query<{ owner_user_id: string | null }>(
    "SELECT owner_user_id FROM conversations WHERE id = $1",
    [conversationId],
  );
  const row = res.rows[0];
  if (!row) return true; // not yet created — will be created with this owner
  return row.owner_user_id === null || row.owner_user_id === ownerUserId;
}

export async function listConversations(
  db: Db,
  ownerUserId: string,
): Promise<Array<{ id: string; title: string | null; created_at: string }>> {
  const res = await db.query<{ id: string; title: string | null; created_at: string }>(
    `SELECT id, title, created_at FROM conversations
     WHERE deleted_at IS NULL AND (owner_user_id = $1 OR owner_user_id IS NULL)
     ORDER BY created_at DESC LIMIT 200`,
    [ownerUserId],
  );
  return res.rows;
}

/** Append messages (REDACTED content only — placeholders, never raw PII) to a
 *  conversation so it can reload after a browser refresh. Product A only. */
export async function persistMessages(
  db: Db,
  conversationId: string,
  entries: Array<{ role: "user" | "assistant"; content: string }>,
): Promise<void> {
  if (entries.length === 0) return;
  const res = await db.query<{ next: number }>(
    "SELECT COALESCE(MAX(seq) + 1, 0) AS next FROM messages WHERE conversation_id = $1",
    [conversationId],
  );
  let seq = res.rows[0]?.next ?? 0;
  for (const e of entries) {
    await db.query(
      `INSERT INTO messages (tenant_id, conversation_id, role, content_redacted, seq)
       VALUES (current_setting('app.tenant_id')::uuid, $1, $2, $3, $4)`,
      [conversationId, e.role, e.content, seq],
    );
    seq += 1;
  }
}

/** Load a conversation's messages (redacted). Caller un-redacts for the author. */
export async function loadMessages(
  db: Db,
  conversationId: string,
): Promise<Array<{ role: string; content_redacted: string }>> {
  const res = await db.query<{ role: string; content_redacted: string }>(
    "SELECT role, content_redacted FROM messages WHERE conversation_id = $1 ORDER BY seq ASC",
    [conversationId],
  );
  return res.rows;
}
