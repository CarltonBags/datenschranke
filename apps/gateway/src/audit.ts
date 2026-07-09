/**
 * Append-only audit log. Every PII-touching request produces an event
 * (invariant #4). Payloads NEVER contain raw PII — only entity types, counts,
 * placeholders, policy version, provider, latency, and un-redactor stats.
 */
import type { Db } from "./db.js";
import type { AuditEvent, AuditEventType } from "@gdpr/shared";

/** Defensive scrub: audit payloads are constructed by us, but assert the shape
 * never carries obvious value-like fields. Types/counts/placeholders only. */
const FORBIDDEN_KEYS = new Set(["value", "values", "text", "raw", "content", "original"]);

export async function writeAudit(db: Db, event: AuditEvent): Promise<void> {
  for (const k of Object.keys(event.payload)) {
    if (FORBIDDEN_KEYS.has(k)) {
      throw new Error(`audit payload key "${k}" is forbidden (possible PII leak)`);
    }
  }
  await db.query(
    `INSERT INTO audit_events (tenant_id, event_type, actor, conversation_id, payload)
     VALUES ($1, $2, $3, $4, $5)`,
    [
      event.tenant_id,
      event.event_type,
      event.actor,
      event.conversation_id ?? null,
      JSON.stringify(event.payload),
    ],
  );
}

export function auditEvent(
  tenantId: string,
  type: AuditEventType,
  actor: string,
  payload: Record<string, unknown>,
  conversationId?: string,
): AuditEvent {
  return {
    tenant_id: tenantId,
    event_type: type,
    actor,
    payload,
    ...(conversationId ? { conversation_id: conversationId } : {}),
  };
}
