import type { EntityType } from "./placeholder.js";

/** Canonical internal request model. Every inbound surface maps onto this. */
export interface CanonicalMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  /** Preserved verbatim for tool-call streams (OpenAI/Anthropic). */
  tool_call_id?: string;
  name?: string;
}

export interface CanonicalRequest {
  tenant_id: string;
  conversation_id: string;
  product: "chat" | "proxy";
  model: string;
  messages: CanonicalMessage[];
  stream: boolean;
  /** Which inbound surface produced this canonical request. */
  surface: "openai.chat" | "openai.responses" | "anthropic.messages" | "chat.internal";
  max_tokens?: number;
  temperature?: number;
}

export interface DetectedEntity {
  placeholder: string;
  type: EntityType;
  start: number;
  end: number;
  score: number;
}

export interface NewMapEntry {
  placeholder: string;
  value: string;
  entity_type: EntityType;
  custom_label?: string | null;
}

export interface RedactResult {
  redacted_text: string;
  entities: DetectedEntity[];
  new_map_entries: NewMapEntry[];
}

export type PolicyAction = "redact" | "block" | "allow";

export interface CustomEntity {
  label: string;
  kind: "pattern" | "deny_list";
  regex?: string;
  values?: string[];
  context?: string[];
  score?: number;
  action: "redact" | "block";
}

export interface TenantPolicy {
  version: number;
  default_action: PolicyAction;
  entities: Partial<Record<EntityType, PolicyAction>>;
  min_confidence: number;
  allowed_providers: string[];
  languages: string[];
  custom_entities?: CustomEntity[];
}

export type AuditEventType =
  | "request.redacted"
  | "request.blocked"
  | "response.unredacted"
  | "map.deleted"
  | "policy.updated"
  | "auth.login"
  | "apikey.created"
  | "user.created";

export interface AuditEvent {
  tenant_id: string;
  event_type: AuditEventType;
  actor: string;
  conversation_id?: string;
  /** NEVER contains raw PII — types, counts, placeholders, stats only. */
  payload: Record<string, unknown>;
}
