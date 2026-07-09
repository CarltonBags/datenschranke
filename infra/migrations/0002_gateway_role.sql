-- 0002_gateway_role — least-privilege role the gateway connects as.
--
-- The gateway must be SUBJECT to RLS (it is not the table owner and not a
-- superuser). It sets app.tenant_id at the start of every transaction. Password
-- is injected by deploy.sh from .env (GATEWAY_DB_PASSWORD).

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'gateway') THEN
    EXECUTE format('CREATE ROLE gateway LOGIN PASSWORD %L', current_setting('app.gateway_password', true));
  END IF;
END $$;

GRANT USAGE ON SCHEMA public TO gateway;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO gateway;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO gateway;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO gateway;

-- Append-only enforcement for audit_events: no UPDATE/DELETE for gateway.
REVOKE UPDATE, DELETE ON audit_events FROM gateway;
