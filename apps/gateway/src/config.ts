/** Central env config. Fail fast on missing required secrets. */

function req(name: string): string {
  const v = process.env[name];
  if (!v) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return v;
}

function opt(name: string, fallback: string): string {
  return process.env[name] ?? fallback;
}

export const config = {
  port: Number(opt("GATEWAY_PORT", "8080")),
  host: opt("GATEWAY_HOST", "0.0.0.0"),
  databaseUrl: req("GATEWAY_DATABASE_URL"),
  redisUrl: opt("REDIS_URL", "redis://localhost:6379"),
  redactorUrl: opt("REDACTOR_URL", "http://localhost:8000"),
  redactorTimeoutMs: Number(opt("REDACTOR_TIMEOUT_MS", "3000")),
  /** Master key for envelope encryption (32 bytes, base64). KMS in prod. */
  masterKey: req("MASTER_ENCRYPTION_KEY"),
  masterKeyId: opt("MASTER_KEY_ID", "env-master-v1"),
  /** Provider routing. "mock" for the local provider mock. */
  defaultProvider: opt("DEFAULT_PROVIDER", "mock"),
  mockProviderUrl: opt("MOCK_PROVIDER_URL", "http://localhost:9090"),
  openaiBaseUrl: opt("OPENAI_BASE_URL", "https://api.openai.com/v1"),
  openaiApiKey: process.env.OPENAI_API_KEY ?? "",
  mapCacheTtlSeconds: Number(opt("MAP_CACHE_TTL_SECONDS", "300")),
  /** Redact PII in uploaded images (OCR box-out) before forwarding. Fail-closed. */
  redactImages: opt("REDACT_IMAGES", "true") !== "false",
  /** Larger timeout for image OCR than for text redaction. */
  imageRedactTimeoutMs: Number(opt("IMAGE_REDACT_TIMEOUT_MS", "15000")),
  /** Bootstrap the platform super-admin on first start (optional). */
  platformAdminEmail: process.env.PLATFORM_ADMIN_EMAIL ?? "",
  platformAdminPassword: process.env.PLATFORM_ADMIN_PASSWORD ?? "",
} as const;

export type Config = typeof config;
