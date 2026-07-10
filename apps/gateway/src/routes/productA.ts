/**
 * Product A — internal chat API for the Next.js UI.
 *
 * Auth: server-side session (Redis), resolved from the x-session-token the web
 * proxy forwards. Conversations are scoped to the authenticated USER (colleagues
 * in the same tenant cannot see each other's chats). Message history is stored
 * REDACTED (placeholders only) and un-redacted for the author on load.
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { openaiChatMessageSchema } from "@gdpr/shared";
import { unredactBody } from "@gdpr/stream-unredactor";
import { withTenant } from "../db.js";
import { ensureConversation, listConversations, loadMessages, ownsConversation } from "../conversations.js";
import { deleteConversation, resolverMap } from "../vault.js";
import { writeAudit, auditEvent } from "../audit.js";
import { handleChat } from "../chatCore.js";
import { requireTenantUser, actorOf } from "../principal.js";
import type { ChatContext } from "../pipeline.js";

// Product A messages may carry image attachments (data: URLs). Text is redacted;
// image contents are NOT scanned for PII in this build (no OCR) — see pipeline.
const chatMessage = openaiChatMessageSchema.extend({
  images: z.array(z.string().max(8_000_000)).max(6).optional(),
});

const messagesBody = z.object({
  model: z.string().default("gpt-4o-mini"),
  stream: z.boolean().default(true),
  messages: z.array(chatMessage).min(1),
});

export async function productARoutes(app: FastifyInstance): Promise<void> {
  app.post("/api/conversations", async (req, reply) => {
    const p = await requireTenantUser(req, reply);
    if (!p) return;
    const title = (req.body as { title?: string } | undefined)?.title;
    const id = await withTenant(p.tenantId, (db) => ensureConversation(db, "chat", undefined, title, p.userId));
    return reply.send({ id });
  });

  app.get("/api/conversations", async (req, reply) => {
    const p = await requireTenantUser(req, reply);
    if (!p) return;
    const rows = await withTenant(p.tenantId, (db) => listConversations(db, p.userId));
    return reply.send({ conversations: rows });
  });

  // Reload a conversation's history. Stored content is REDACTED; we un-redact it
  // here for the author using the encrypted token map. Only the user's OWN
  // conversation is accessible.
  app.get("/api/conversations/:id/messages", async (req, reply) => {
    const p = await requireTenantUser(req, reply);
    if (!p) return;
    const id = (req.params as { id: string }).id;
    const messages = await withTenant(p.tenantId, async (db) => {
      if (!(await ownsConversation(db, id, p.userId))) return null;
      const rows = await loadMessages(db, id);
      const map = await resolverMap(db, p.tenantId, id);
      const resolve = (placeholder: string) => map.get(placeholder);
      return rows.map((r) => ({ role: r.role, content: unredactBody(r.content_redacted, resolve).text }));
    });
    if (messages === null) return reply.code(403).send({ error: "forbidden" });
    return reply.send({ messages });
  });

  app.delete("/api/conversations/:id", async (req, reply) => {
    const p = await requireTenantUser(req, reply);
    if (!p) return;
    const id = (req.params as { id: string }).id;
    const removed = await withTenant(p.tenantId, async (db) => {
      if (!(await ownsConversation(db, id, p.userId))) return null;
      const n = await deleteConversation(db, p.tenantId, id);
      await writeAudit(db, auditEvent(p.tenantId, "map.deleted", actorOf(p), { map_entries: n }, id));
      return n;
    });
    if (removed === null) return reply.code(403).send({ error: "forbidden" });
    return reply.send({ deleted: true, map_entries: removed });
  });

  app.post("/api/conversations/:id/messages", async (req, reply) => {
    const p = await requireTenantUser(req, reply);
    if (!p) return;
    const parsed = messagesBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });
    const conversationId = (req.params as { id: string }).id;

    // Ensure the conversation exists and belongs to this user.
    const owned = await withTenant(p.tenantId, async (db) => {
      if (!(await ownsConversation(db, conversationId, p.userId))) return false;
      await ensureConversation(db, "chat", conversationId, undefined, p.userId);
      return true;
    });
    if (!owned) return reply.code(403).send({ error: "forbidden" });

    const ctx: ChatContext = {
      tenantId: p.tenantId,
      actor: actorOf(p),
      conversationId,
      product: "chat",
      model: parsed.data.model,
      stream: parsed.data.stream,
      messages: parsed.data.messages,
    };
    await handleChat(ctx, reply);
  });
}
