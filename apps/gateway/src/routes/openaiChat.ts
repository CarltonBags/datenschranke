/** Product B — OpenAI Chat Completions compatible surface (M6). */
import type { FastifyInstance } from "fastify";
import { openaiChatRequestSchema } from "@gdpr/shared";
import { authenticate } from "../auth.js";
import { withTenant } from "../db.js";
import { ensureConversation } from "../conversations.js";
import { handleChat } from "../chatCore.js";
import type { ChatContext } from "../pipeline.js";

export async function openaiChatRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/chat/completions", async (req, reply) => {
    const principal = await authenticate(req.headers.authorization);
    if (!principal) return reply.code(401).send({ error: { type: "auth", message: "invalid API key" } });

    const parsed = openaiChatRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: { type: "invalid_request", message: parsed.error.message } });
    }
    const body = parsed.data;

    const requested = (req.headers["x-conversation-id"] as string | undefined) ?? undefined;
    const conversationId = await withTenant(principal.tenantId, (db) =>
      ensureConversation(db, "proxy", requested),
    );

    const ctx: ChatContext = {
      tenantId: principal.tenantId,
      actor: principal.actor,
      conversationId,
      product: "proxy",
      model: body.model,
      stream: body.stream,
      messages: body.messages,
      ...(body.temperature !== undefined ? { temperature: body.temperature } : {}),
      ...(body.max_tokens !== undefined ? { maxTokens: body.max_tokens } : {}),
    };

    reply.header("x-conversation-id", conversationId);
    await handleChat(ctx, reply);
  });

  app.get("/v1/models", async (req, reply) => {
    const principal = await authenticate(req.headers.authorization);
    if (!principal) return reply.code(401).send({ error: { type: "auth", message: "invalid API key" } });
    return reply.send({
      object: "list",
      data: [
        { id: "gpt-4o", object: "model", owned_by: "gdpr-gateway" },
        { id: "gpt-4o-mini", object: "model", owned_by: "gdpr-gateway" },
        { id: "claude-sonnet-5", object: "model", owned_by: "gdpr-gateway" },
      ],
    });
  });
}
