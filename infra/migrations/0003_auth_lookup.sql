-- 0003_auth_lookup — cross-tenant API-key lookup for authentication.
--
-- Auth is a chicken-and-egg: the gateway discovers the tenant FROM the key, so
-- it must read api_keys BEFORE it can set app.tenant_id. RLS (0001) correctly
-- hides all rows when app.tenant_id is unset. This SECURITY DEFINER function is
-- owned by the migration superuser, so it bypasses RLS — but it only ever
-- returns (tenant_id, key_hash) for an ACTIVE key matched by prefix, nothing
-- else. Normal api_keys access stays RLS-confined.

CREATE OR REPLACE FUNCTION find_api_key(p_prefix text)
RETURNS TABLE (tenant_id uuid, key_hash bytea)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT tenant_id, key_hash
  FROM api_keys
  WHERE prefix = p_prefix AND revoked_at IS NULL
$$;

REVOKE ALL ON FUNCTION find_api_key(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION find_api_key(text) TO gateway;
