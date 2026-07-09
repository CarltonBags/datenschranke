import { z } from "zod";
import { ENTITY_TYPES } from "./placeholder.js";

export const entityTypeSchema = z.enum(ENTITY_TYPES);

const policyActionSchema = z.enum(["redact", "block", "allow"]);

export const customEntitySchema = z
  .object({
    label: z.string().min(1).max(120),
    kind: z.enum(["pattern", "deny_list"]),
    regex: z.string().max(512).optional(),
    values: z.array(z.string().max(256)).max(1000).optional(),
    context: z.array(z.string().max(64)).max(50).optional(),
    score: z.number().min(0).max(1).optional(),
    action: z.enum(["redact", "block"]),
  })
  .refine((c) => (c.kind === "pattern" ? !!c.regex : true), {
    message: "pattern custom entity requires a regex",
  })
  .refine((c) => (c.kind === "deny_list" ? !!c.values?.length : true), {
    message: "deny_list custom entity requires values",
  });

export const tenantPolicySchema = z.object({
  version: z.number().int().nonnegative(),
  default_action: policyActionSchema,
  entities: z.record(entityTypeSchema, policyActionSchema).default({}),
  min_confidence: z.number().min(0).max(1).default(0.6),
  allowed_providers: z.array(z.string()).default([]),
  languages: z.array(z.string()).default(["de", "en"]),
  custom_entities: z.array(customEntitySchema).max(200).optional(),
});

/** Redaction service contract. */
export const redactRequestSchema = z.object({
  tenant_id: z.string().uuid(),
  conversation_id: z.string().uuid(),
  text: z.string(),
  language: z.string().optional(),
  policy: tenantPolicySchema,
  existing_entities: z
    .array(
      z.object({
        value_hash: z.string(),
        placeholder: z.string(),
        type: entityTypeSchema,
      }),
    )
    .default([]),
});

export const redactResponseSchema = z.object({
  redacted_text: z.string(),
  entities: z.array(
    z.object({
      placeholder: z.string(),
      type: entityTypeSchema,
      start: z.number().int(),
      end: z.number().int(),
      score: z.number(),
    }),
  ),
  new_map_entries: z.array(
    z.object({
      placeholder: z.string(),
      value: z.string(),
      entity_type: entityTypeSchema,
      custom_label: z.string().nullable().optional(),
    }),
  ),
  blocked: z
    .object({ reason: z.string(), entity_type: z.string() })
    .nullable()
    .optional(),
});

/** OpenAI Chat Completions inbound surface (subset we support). */
export const openaiChatMessageSchema = z.object({
  role: z.enum(["system", "user", "assistant", "tool"]),
  content: z.string(),
  name: z.string().optional(),
  tool_call_id: z.string().optional(),
});

export const openaiChatRequestSchema = z.object({
  model: z.string(),
  messages: z.array(openaiChatMessageSchema).min(1),
  stream: z.boolean().default(false),
  max_tokens: z.number().int().positive().optional(),
  temperature: z.number().min(0).max(2).optional(),
});

export type RedactRequest = z.infer<typeof redactRequestSchema>;
export type RedactResponse = z.infer<typeof redactResponseSchema>;
export type OpenAIChatRequest = z.infer<typeof openaiChatRequestSchema>;
