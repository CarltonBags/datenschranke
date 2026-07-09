-- 0001_init — system of record + token map vault, with Row-Level Security.
--
-- RLS is the enforcement of invariant #2 (no cross-tenant map access) — NOT
-- application code alone. Every tenant-scoped table FORCEs RLS so even the table
-- owner is constrained; the gateway connects as role `gateway` (created in
-- 0002) and sets `app.tenant_id` per transaction.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE tenants (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Per-tenant data encryption keys (envelope encryption). The DEK is stored
-- WRAPPED by the master key (KMS in prod / env var in dev). Never store a
-- plaintext DEK.
CREATE TABLE data_keys (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  wrapped_dek    bytea NOT NULL,
  master_key_id  text NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  retired_at     timestamptz
);
CREATE INDEX data_keys_tenant_idx ON data_keys(tenant_id) WHERE retired_at IS NULL;

CREATE TABLE conversations (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  product     text NOT NULL CHECK (product IN ('chat','proxy')),
  title       text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  deleted_at  timestamptz
);
CREATE INDEX conversations_tenant_idx ON conversations(tenant_id);

CREATE TABLE token_map (
  id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id         uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  conversation_id   uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  placeholder       text NOT NULL,              -- '[[PERSON_1]]'
  entity_type       text NOT NULL,
  custom_label      text,                       -- tenant display label for CUSTOM, else NULL
  value_ciphertext  bytea NOT NULL,             -- AES-256-GCM(value) under the tenant DEK
  value_iv          bytea NOT NULL,             -- GCM nonce
  value_tag         bytea NOT NULL,             -- GCM auth tag
  value_hash        bytea NOT NULL,             -- HMAC-SHA256(tenant_key, normalized value) for reuse
  match_hash        text NOT NULL,              -- sha256("TYPE:normalized") — reuse lookup sent to redactor
  dek_id            uuid NOT NULL REFERENCES data_keys(id),
  created_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (conversation_id, placeholder)
);
CREATE INDEX token_map_conv_idx ON token_map(conversation_id);
CREATE INDEX token_map_match_idx ON token_map(conversation_id, match_hash);

CREATE TABLE policies (
  tenant_id   uuid PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  version     integer NOT NULL,
  document    jsonb NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE api_keys (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name        text NOT NULL,
  prefix      text NOT NULL,               -- first chars, searchable
  key_hash    bytea NOT NULL,              -- SHA-256 of the full key
  created_at  timestamptz NOT NULL DEFAULT now(),
  revoked_at  timestamptz,
  UNIQUE (prefix)
);
CREATE INDEX api_keys_tenant_idx ON api_keys(tenant_id);

-- Append-only. Payload NEVER contains raw PII (types/counts/placeholders/stats).
CREATE TABLE audit_events (
  id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id        uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  event_type       text NOT NULL,
  actor            text NOT NULL,
  conversation_id  uuid,
  payload          jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_events_tenant_time_idx ON audit_events(tenant_id, created_at DESC);
CREATE INDEX audit_events_type_idx ON audit_events(tenant_id, event_type);

-- ---- Row-Level Security -------------------------------------------------
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['conversations','token_map','policies','api_keys','audit_events','data_keys']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY;', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY;', t);
    EXECUTE format($p$
      CREATE POLICY tenant_isolation ON %I
        USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
        WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
    $p$, t);
  END LOOP;
END $$;

-- audit_events is append-only: allow INSERT + SELECT, forbid UPDATE/DELETE via a
-- restrictive policy for the gateway role (added in 0002 once the role exists).
