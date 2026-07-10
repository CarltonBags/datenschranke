/**
 * The shared streaming/non-streaming chat handler used by the Product B
 * OpenAI-compatible surface AND the Product A internal chat API. Implements the
 * back half of the request lifecycle: forward → un-redact → persist audit.
 */
import type { FastifyReply } from "fastify";
import { createSSEUnredactor, openAIChatFormat, unredactBody } from "@gdpr/stream-unredactor";
import { withTenant } from "./db.js";
import { prepareOutbound, buildResolveFn, type ChatContext } from "./pipeline.js";
import { forwardChat } from "./providers.js";
import { writeAudit, auditEvent } from "./audit.js";
import { persistMessages } from "./conversations.js";
import { RedactorUnavailableError } from "./redactorClient.js";

export interface ChatOutcome {
  status: number;
  handled: boolean; // true if the reply was already streamed/sent
}

export async function handleChat(ctx: ChatContext, reply: FastifyReply): Promise<void> {
  const startedAt = Date.now();

  let prepared;
  try {
    prepared = await withTenant(ctx.tenantId, async (db) => prepareOutbound(db, ctx));
  } catch (err) {
    // FAIL CLOSED: redactor unavailable/rejected → never forward to a provider.
    const rejected = err instanceof RedactorUnavailableError && err.name === "RedactorRejectedError";
    reply.code(rejected ? 400 : 502).send({
      error: {
        type: "redaction_failed",
        message: rejected
          ? (err as Error).message
          : "Redaction service unavailable — request not forwarded (fail closed).",
      },
    });
    return;
  }

  if (prepared.blocked) {
    await withTenant(ctx.tenantId, (db) =>
      writeAudit(
        db,
        auditEvent(ctx.tenantId, "request.blocked", ctx.actor, {
          reason: prepared.reason,
          entity_type: prepared.entityType,
          policy_version: prepared.policyVersion,
          conversation_id: ctx.conversationId,
        }, ctx.conversationId),
      ),
    );
    reply.code(403).send({
      error: { type: "policy_blocked", message: prepared.reason, entity_type: prepared.entityType },
    });
    return;
  }

  const { outbound, provider, policy, stats } = prepared;

  // Audit the redaction (types/counts only — never values).
  await withTenant(ctx.tenantId, (db) =>
    writeAudit(
      db,
      auditEvent(ctx.tenantId, "request.redacted", ctx.actor, {
        entity_count: stats.entityCount,
        per_type: stats.perType,
        new_entries: stats.newEntries,
        image_entities: stats.imageEntities,
        policy_version: policy.version,
        provider,
        product: ctx.product,
      }, ctx.conversationId),
    ),
  );

  const resolve = await withTenant(ctx.tenantId, (db) => buildResolveFn(db, ctx));
  const providerRes = await forwardChat(provider, outbound);

  if (!ctx.stream) {
    const json = (await providerRes.body.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    let replaced = 0;
    let unknown = 0;
    let assistantRedacted = "";
    for (const choice of json.choices ?? []) {
      if (typeof choice.message?.content === "string") {
        if (!assistantRedacted) assistantRedacted = choice.message.content; // pre-unredact
        const out = unredactBody(choice.message.content, resolve);
        choice.message.content = out.text;
        replaced += out.stats.replaced;
        unknown += out.stats.unknown;
      }
    }
    await withTenant(ctx.tenantId, (db) =>
      writeAudit(
        db,
        auditEvent(ctx.tenantId, "response.unredacted", ctx.actor, {
          replaced,
          unknown,
          latency_ms: Date.now() - startedAt,
          provider,
        }, ctx.conversationId),
      ),
    );
    await persistChatTurn(ctx, stats.lastUserRedacted, assistantRedacted);
    reply.code(providerRes.statusCode).send(json);
    return;
  }

  // Streaming: pipe provider SSE through the un-redactor into the client.
  reply.hijack();
  const raw = reply.raw;
  raw.writeHead(providerRes.statusCode, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache",
    connection: "keep-alive",
  });

  // Product A shield signal: an SSE comment line (starts with ':') carrying
  // entity TYPES/COUNTS only. Comment lines are ignored by strict OpenAI clients
  // but read by our chat UI to render the per-message shield. Never values.
  if (ctx.product === "chat") {
    // The shield describes what was protected in the USER'S LATEST message — the
    // thing they just typed — so the count matches the reconstructed list. The
    // full-request entityCount (which also re-redacts resent history + the prior
    // assistant reply) would inflate this and confuse the user. perType is
    // derived from the same spans that produce the list.
    const lastPerType: Record<string, number> = {};
    for (const s of stats.lastUserSpans) lastPerType[s.type] = (lastPerType[s.type] ?? 0) + 1;
    raw.write(
      `: shield ${JSON.stringify({
        entities: stats.lastUserSpans.length,
        perType: lastPerType,
        // Offsets into the user's OWN latest message — no values on the wire.
        spans: stats.lastUserSpans,
        imageEntities: stats.imageEntities,
      })}\n\n`,
    );
  }

  const { stream, unredactor } = createSSEUnredactor(resolve, openAIChatFormat);
  const writer = stream.writable.getWriter();
  const reader = stream.readable.getReader();

  const pump = (async () => {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      raw.write(Buffer.from(value));
    }
  })();

  // Accumulate the RAW provider SSE (redacted, placeholders only) so we can
  // persist the assistant reply for reload — never the un-redacted text.
  let providerRaw = "";
  const dec = new TextDecoder();
  try {
    for await (const chunk of providerRes.body) {
      providerRaw += dec.decode(chunk as Buffer, { stream: true });
      await writer.write(new Uint8Array(chunk as Buffer));
    }
  } finally {
    await writer.close();
    await pump;
    raw.end();
  }

  await withTenant(ctx.tenantId, (db) =>
    writeAudit(
      db,
      auditEvent(ctx.tenantId, "response.unredacted", ctx.actor, {
        replaced: unredactor.stats.replaced,
        unknown: unredactor.stats.unknown,
        unknown_placeholders: unredactor.stats.unknownPlaceholders,
        latency_ms: Date.now() - startedAt,
        provider,
      }, ctx.conversationId),
    ),
  );
  await persistChatTurn(ctx, stats.lastUserRedacted, extractAssistantFromSSE(providerRaw));
}

/** Persist one chat turn (redacted user + assistant). Product A only — the proxy
 *  is stateless. Best-effort: a persistence failure must not fail the response. */
async function persistChatTurn(ctx: ChatContext, userRedacted: string, assistantRedacted: string): Promise<void> {
  if (ctx.product !== "chat") return;
  const entries: Array<{ role: "user" | "assistant"; content: string }> = [];
  if (userRedacted) entries.push({ role: "user", content: userRedacted });
  if (assistantRedacted) entries.push({ role: "assistant", content: assistantRedacted });
  if (entries.length === 0) return;
  try {
    await withTenant(ctx.tenantId, (db) => persistMessages(db, ctx.conversationId, entries));
  } catch {
    /* persistence is best-effort; reload history may miss this turn */
  }
}

/** Extract the assistant's REDACTED text from accumulated OpenAI SSE (delta.content). */
function extractAssistantFromSSE(raw: string): string {
  let out = "";
  for (const line of raw.split("\n")) {
    if (!line.startsWith("data:")) continue;
    const payload = line.slice(5).trim();
    if (payload === "" || payload === "[DONE]") continue;
    try {
      const obj = JSON.parse(payload) as { choices?: Array<{ delta?: { content?: string } }> };
      const c = obj.choices?.[0]?.delta?.content;
      if (c) out += c;
    } catch {
      /* ignore keep-alives / non-JSON */
    }
  }
  return out;
}
