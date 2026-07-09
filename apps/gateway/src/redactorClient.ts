/**
 * Client for the Python redaction service. FAIL CLOSED (invariant #5): if the
 * redactor is unreachable, errors, or times out, we THROW — the caller must not
 * forward anything to an LLM provider. There is no best-effort path.
 */
import { request } from "undici";
import { config } from "./config.js";
import { redactResponseSchema, type RedactResponse, type TenantPolicy } from "@gdpr/shared";
import type { ExistingEntity } from "./vault.js";

export class RedactorUnavailableError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = "RedactorUnavailableError";
  }
}

export interface RedactInput {
  tenant_id: string;
  conversation_id: string;
  text: string;
  language?: string;
  policy: TenantPolicy;
  existing_entities: ExistingEntity[];
}

export async function redact(input: RedactInput): Promise<RedactResponse> {
  let res;
  try {
    res = await request(`${config.redactorUrl}/v1/redact`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
      headersTimeout: config.redactorTimeoutMs,
      bodyTimeout: config.redactorTimeoutMs,
    });
  } catch (err) {
    throw new RedactorUnavailableError("redactor request failed", err);
  }
  if (res.statusCode >= 500) {
    throw new RedactorUnavailableError(`redactor returned ${res.statusCode}`);
  }
  const json = await res.body.json().catch((err) => {
    throw new RedactorUnavailableError("redactor returned invalid JSON", err);
  });
  if (res.statusCode >= 400) {
    // e.g. 422 unsafe custom regex — a client error, surfaced as-is (still fail
    // closed: nothing is forwarded), but distinguishable from an outage.
    const detail = (json as { detail?: string }).detail ?? "redactor rejected request";
    const e = new RedactorUnavailableError(detail);
    e.name = "RedactorRejectedError";
    throw e;
  }
  const parsed = redactResponseSchema.safeParse(json);
  if (!parsed.success) {
    throw new RedactorUnavailableError(`redactor response failed validation: ${parsed.error.message}`);
  }
  return parsed.data;
}

export interface ImageRedactResult {
  dataUrl: string; // redacted image as a data: URL
  count: number;
  entities: Array<{ type: string }>;
  blocked: { reason: string; entity_type: string } | null;
}

/**
 * Redact PII in an image via OCR (Presidio Image Redactor). FAIL CLOSED: any
 * error/timeout throws so the caller does not forward the original image.
 */
export async function redactImage(input: {
  tenant_id: string;
  conversation_id: string;
  image: string; // data: URL or base64
  language?: string;
  policy: TenantPolicy;
}): Promise<ImageRedactResult> {
  let res;
  try {
    res = await request(`${config.redactorUrl}/v1/redact-image`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
      headersTimeout: config.imageRedactTimeoutMs,
      bodyTimeout: config.imageRedactTimeoutMs,
    });
  } catch (err) {
    throw new RedactorUnavailableError("image redactor request failed", err);
  }
  if (res.statusCode >= 500) throw new RedactorUnavailableError(`image redactor ${res.statusCode}`);
  const json = (await res.body.json().catch((err) => {
    throw new RedactorUnavailableError("image redactor invalid JSON", err);
  })) as {
    image?: string;
    count?: number;
    entities?: Array<{ type: string }>;
    blocked?: { reason: string; entity_type: string } | null;
    detail?: string;
  };
  if (res.statusCode >= 400) {
    const e = new RedactorUnavailableError(json.detail ?? `image redactor ${res.statusCode}`);
    e.name = "RedactorRejectedError";
    throw e;
  }
  return {
    dataUrl: json.blocked ? "" : `data:image/png;base64,${json.image ?? ""}`,
    count: json.count ?? 0,
    entities: json.entities ?? [],
    blocked: json.blocked ?? null,
  };
}

/** Detection-only, for the admin "test your policy" screen. */
export async function analyze(input: RedactInput): Promise<unknown> {
  const res = await request(`${config.redactorUrl}/v1/analyze`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
    headersTimeout: config.redactorTimeoutMs,
    bodyTimeout: config.redactorTimeoutMs,
  }).catch((err) => {
    throw new RedactorUnavailableError("redactor analyze failed", err);
  });
  if (res.statusCode >= 400) {
    const j = (await res.body.json().catch(() => ({}))) as { detail?: string };
    throw new RedactorUnavailableError(j.detail ?? `redactor analyze ${res.statusCode}`);
  }
  return res.body.json();
}

export async function healthy(): Promise<boolean> {
  try {
    const res = await request(`${config.redactorUrl}/healthz`, { method: "GET", headersTimeout: 1500 });
    return res.statusCode === 200;
  } catch {
    return false;
  }
}
