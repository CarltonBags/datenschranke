/**
 * Request lifecycle (both products):
 *   auth → resolve tenant + policy → load conversation map → redact (fail closed)
 *   → policy verdict (block?) → forward redacted request to provider
 *   → pipe response through un-redactor → persist new map entries + audit → return.
 *
 * This module owns the PII-sensitive orchestration. Routes stay thin.
 */
import type { ResolveFn } from "@gdpr/stream-unredactor";
import { PLACEHOLDER_SYSTEM_SUFFIX, type TenantPolicy } from "@gdpr/shared";
import type { Db } from "./db.js";
import { loadPolicy } from "./policy.js";
import { existingEntities, persistNewEntries, resolverMap, type ExistingEntity } from "./vault.js";
import { matchHash } from "./crypto/matchhash.js";
import { redact, redactImage } from "./redactorClient.js";
import { chooseProvider } from "./providers.js";
import type { OutboundRequest } from "./providers.js";
import { config } from "./config.js";

export interface ChatContext {
  tenantId: string;
  actor: string;
  conversationId: string;
  product: "chat" | "proxy";
  model: string;
  stream: boolean;
  messages: Array<{ role: "system" | "user" | "assistant" | "tool"; content: string; name?: string; tool_call_id?: string; images?: string[] }>;
  temperature?: number;
  maxTokens?: number;
  language?: string;
}

/** Redaction positions for the LAST user message — offsets only, NO values.
 * The browser (the author) reconstructs values from its own input locally. */
export interface RedactionSpan {
  placeholder: string;
  type: string;
  start: number;
  end: number;
  custom_label?: string | null;
}

export interface RedactionStats {
  entityCount: number;
  perType: Record<string, number>;
  newEntries: number;
  lastUserSpans: RedactionSpan[];
  /** Redacted text of the latest user message (placeholders only) — persisted. */
  lastUserRedacted: string;
  /** PII regions boxed out of uploaded images (destructive, no round-trip). */
  imageEntities: number;
}

export type Prepared =
  | { blocked: true; reason: string; entityType: string; policyVersion: number }
  | {
      blocked: false;
      outbound: OutboundRequest;
      provider: string;
      policy: TenantPolicy;
      stats: RedactionStats;
    };

/**
 * Redact every outbound message under one shared conversation map so the same
 * entity keeps the same placeholder (invariant #3). Persists new map entries
 * before returning so the response un-redactor can resolve them.
 *
 * THROWS if the redactor is unavailable — fail closed (invariant #5). The caller
 * must not forward anything on throw.
 */
export async function prepareOutbound(db: Db, ctx: ChatContext): Promise<Prepared> {
  const policy = await loadPolicy(db, ctx.tenantId);
  const existing: ExistingEntity[] = await existingEntities(db, ctx.tenantId, ctx.conversationId);

  const redactedMessages: ChatContext["messages"] = [];
  const collectedNew: Parameters<typeof persistNewEntries>[3] = [];
  const perType: Record<string, number> = {};
  let entityCount = 0;
  let imageEntities = 0;
  let lastUserSpans: RedactionSpan[] = [];
  let lastUserRedacted = "";

  for (const msg of ctx.messages) {
    // ---- Image redaction (destructive OCR box-out), fail closed --------------
    let redactedImages = msg.images;
    if (config.redactImages && msg.images && msg.images.length > 0) {
      const out: string[] = [];
      for (const image of msg.images) {
        const ri = await redactImage({
          tenant_id: ctx.tenantId,
          conversation_id: ctx.conversationId,
          image,
          ...(ctx.language ? { language: ctx.language } : {}),
          policy,
        });
        if (ri.blocked) {
          return { blocked: true, reason: ri.blocked.reason, entityType: ri.blocked.entity_type, policyVersion: policy.version };
        }
        imageEntities += ri.count;
        for (const e of ri.entities) perType[e.type] = (perType[e.type] ?? 0) + 1;
        out.push(ri.dataUrl); // the boxed-out image — original never forwarded
      }
      redactedImages = out;
    }

    if (msg.content.length === 0) {
      // Image-only (or empty) message: keep redacted images, no text to redact.
      redactedMessages.push({ ...msg, ...(redactedImages ? { images: redactedImages } : {}) });
      continue;
    }
    const result = await redact({
      tenant_id: ctx.tenantId,
      conversation_id: ctx.conversationId,
      text: msg.content,
      ...(ctx.language ? { language: ctx.language } : {}),
      policy,
      existing_entities: existing,
    });
    if (result.blocked) {
      return {
        blocked: true,
        reason: result.blocked.reason,
        entityType: result.blocked.entity_type,
        policyVersion: policy.version,
      };
    }
    for (const e of result.entities) {
      entityCount += 1;
      perType[e.type] = (perType[e.type] ?? 0) + 1;
    }
    // Make new entries visible to subsequent messages in THIS request.
    const labelByPlaceholder = new Map<string, string | null | undefined>();
    for (const ne of result.new_map_entries) {
      collectedNew.push(ne);
      labelByPlaceholder.set(ne.placeholder, ne.custom_label);
      existing.push({ value_hash: matchHash(ne.entity_type, ne.value), placeholder: ne.placeholder, type: ne.entity_type });
    }
    // Transparency: remember the newest user message's spans (offsets only)
    // and its redacted text (for persistence — placeholders only, no PII).
    if (msg.role === "user") {
      lastUserSpans = result.entities.map((e) => ({
        placeholder: e.placeholder,
        type: e.type,
        start: e.start,
        end: e.end,
        custom_label: labelByPlaceholder.get(e.placeholder) ?? null,
      }));
      lastUserRedacted = result.redacted_text;
    }
    redactedMessages.push({ ...msg, content: result.redacted_text, ...(redactedImages ? { images: redactedImages } : {}) });
  }

  await persistNewEntries(db, ctx.tenantId, ctx.conversationId, collectedNew);

  const outbound: OutboundRequest = {
    model: ctx.model,
    messages: withSystemSuffix(redactedMessages),
    stream: ctx.stream,
    ...(ctx.maxTokens !== undefined ? { max_tokens: ctx.maxTokens } : {}),
    ...(ctx.temperature !== undefined ? { temperature: ctx.temperature } : {}),
  };

  return {
    blocked: false,
    outbound,
    provider: chooseProvider(policy.allowed_providers),
    policy,
    stats: { entityCount, perType, newEntries: collectedNew.length, lastUserSpans, lastUserRedacted, imageEntities },
  };
}

/** Resolver for un-redacting the provider response. Decrypts in-process only. */
export async function buildResolveFn(db: Db, ctx: ChatContext): Promise<ResolveFn> {
  const map = await resolverMap(db, ctx.tenantId, ctx.conversationId);
  return (placeholder) => map.get(placeholder);
}

/**
 * Append the opaque-token instruction to the system message (or prepend one).
 * The LLM must preserve placeholders exactly.
 */
function withSystemSuffix(messages: ChatContext["messages"]): OutboundRequest["messages"] {
  const out: OutboundRequest["messages"] = messages.map((m) => {
    // Multimodal: attach image parts alongside the (already-redacted) text.
    // NOTE: image CONTENTS are not scanned for PII in this build (no OCR) — the
    // redaction guarantee covers text only. Documented limitation.
    const content =
      m.images && m.images.length > 0
        ? ([{ type: "text", text: m.content }, ...m.images.map((url) => ({ type: "image_url", image_url: { url } }))] as OutboundRequest["messages"][number]["content"])
        : m.content;
    return { role: m.role, content, ...(m.name ? { name: m.name } : {}), ...(m.tool_call_id ? { tool_call_id: m.tool_call_id } : {}) };
  });
  const sys = out.find((m) => m.role === "system");
  if (sys && typeof sys.content === "string") {
    sys.content = `${sys.content}\n\n${PLACEHOLDER_SYSTEM_SUFFIX}`;
  } else {
    out.unshift({ role: "system", content: PLACEHOLDER_SYSTEM_SUFFIX });
  }
  return out;
}
