-- 0005_auth_users — built-in accounts, sessions-in-Redis, per-tenant licenses.
--
-- Roles:
--   platform_admin — the platform owner (you). tenant_id IS NULL. Creates tenants,
--                    their first admin, and licenses. Sees everything.
--   tenant_admin   — a company's admin. Manages that company's employees, sees its
--                    license + user overview.
--   employee       — a company's user. Chat only.
--
-- users/licenses are NOT under RLS (they are not the PII vault): login must resolve
-- a user across tenants, and platform_admin operates cross-tenant. Tenant scoping is
-- enforced in application code with explicit tenant_id filters derived from the
-- authenticated session.

CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid REFERENCES tenants(id) ON DELETE CASCADE,   -- NULL for platform_admin
  email         citext NOT NULL UNIQUE,
  password_hash text NOT NULL,
  name          text,
  role          text NOT NULL CHECK (role IN ('platform_admin','tenant_admin','employee')),
  disabled      boolean NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now(),
  -- platform_admin has no tenant; everyone else must belong to one
  CONSTRAINT users_tenant_role CHECK (
    (role = 'platform_admin' AND tenant_id IS NULL) OR
    (role <> 'platform_admin' AND tenant_id IS NOT NULL)
  )
);
CREATE INDEX users_tenant_idx ON users(tenant_id);

CREATE TABLE licenses (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL UNIQUE REFERENCES tenants(id) ON DELETE CASCADE,
  key_prefix  text NOT NULL,
  key_hash    bytea NOT NULL,                 -- SHA-256(full license key)
  seats       integer NOT NULL DEFAULT 5 CHECK (seats >= 0),
  status      text NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended','expired')),
  expires_at  timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Per-employee chat: a conversation belongs to one user (colleagues in the same
-- tenant must not see each other's chats). Nullable so pre-existing rows survive;
-- new rows always set it.
ALTER TABLE conversations ADD COLUMN owner_user_id uuid REFERENCES users(id) ON DELETE CASCADE;
CREATE INDEX conversations_owner_idx ON conversations(owner_user_id);

-- gateway role inherits SELECT/INSERT/UPDATE/DELETE via ALTER DEFAULT PRIVILEGES (0002).
