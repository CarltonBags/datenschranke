/**
 * Product A — internal chat API for the Next.js UI.
 *
 * Auth: OIDC in prod. For this scaffold the UI passes `x-tenant-id` + `x-user`
 * (clearly a dev seam — replace with verified OIDC claims before shipping).
 * Message history is NOT persisted server-side (it would be raw PII); the
 * browser holds it and replays full context, like the proxy. Only the encrypted
 * token map + audit events are stored.
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { openaiChatMessageSchema } from "@gdpr/shared";
import { unredactBody } from "@gdpr/stream-unredactor";
import { withTenant } from "../db.js";
import { ensureConversation, listConversations, loadMessages } from "../conversations.js";
import { deleteConversation, resolverMap } from "../vault.js";
import { writeAudit, auditEvent } from "../audit.js";
import { handleChat } from "../chatCore.js";
import type { ChatContext } from "../pipeline.js";

function principalFromHeaders(req: { headers: Record<string, unknown> }): { tenantId: string; actor: string } | null {
  const tenantId = req.headers["x-tenant-id"] as string | undefined;
  const user = (req.headers["x-user"] as string | undefined) ?? "chat-user";
  if (!tenantId) return null;
  return { tenantId, actor: `user:${user}` };
}

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
    const p = principalFromHeaders(req);
    if (!p) return reply.code(401).send({ error: "unauthenticated" });
    const title = (req.body as { title?: string } | undefined)?.title;
    const id = await withTenant(p.tenantId, (db) => ensureConversation(db, "chat", undefined, title));
    return reply.send({ id });
  });

  app.get("/api/conversations", async (req, reply) => {
    const p = principalFromHeaders(req);
    if (!p) return reply.code(401).send({ error: "unauthenticated" });
    const rows = await withTenant(p.tenantId, (db) => listConversations(db));
    return reply.send({ conversations: rows });
  });

  // Reload a conversation's history. Stored content is REDACTED; we un-redact it
  // here for the authoring tenant using the encrypted token map (same resolver as
  // the streaming response). Only the tenant's own conversation is accessible (RLS).
  app.get("/api/conversations/:id/messages", async (req, reply) => {
    const p = principalFromHeaders(req);
    if (!p) return reply.code(401).send({ error: "unauthenticated" });
    const id = (req.params as { id: string }).id;
    const messages = await withTenant(p.tenantId, async (db) => {
      const rows = await loadMessages(db, id);
      const map = await resolverMap(db, p.tenantId, id);
      const resolve = (placeholder: string) => map.get(placeholder);
      return rows.map((r) => ({ role: r.role, content: unredactBody(r.content_redacted, resolve).text }));
    });
    return reply.send({ messages });
  });

  app.delete("/api/conversations/:id", async (req, reply) => {
    const p = principalFromHeaders(req);
    if (!p) return reply.code(401).send({ error: "unauthenticated" });
    const id = (req.params as { id: string }).id;
    const removed = await withTenant(p.tenantId, async (db) => {
      const n = await deleteConversation(db, p.tenantId, id);
      await writeAudit(db, auditEvent(p.tenantId, "map.deleted", p.actor, { map_entries: n }, id));
      return n;
    });
    return reply.send({ deleted: true, map_entries: removed });
  });

  app.post("/api/conversations/:id/messages", async (req, reply) => {
    const p = principalFromHeaders(req);
    if (!p) return reply.code(401).send({ error: "unauthenticated" });
    const parsed = messagesBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });
    const conversationId = (req.params as { id: string }).id;

    // Make sure the conversation exists for this tenant.
    await withTenant(p.tenantId, (db) => ensureConversation(db, "chat", conversationId));

    const ctx: ChatContext = {
      tenantId: p.tenantId,
      actor: p.actor,
      conversationId,
      product: "chat",
      model: parsed.data.model,
      stream: parsed.data.stream,
      messages: parsed.data.messages,
    };
    await handleChat(ctx, reply);
  });
}
