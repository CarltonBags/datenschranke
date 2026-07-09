/**
 * Postgres access. Every tenant-scoped query runs inside withTenant(), which
 * opens a transaction and sets `app.tenant_id` as a LOCAL setting so Postgres
 * RLS (0001_init.sql) confines every statement to that tenant. This is the
 * enforcement of invariant #2 — application code cannot read across tenants
 * even if it forgets a WHERE clause.
 */
import pg from "pg";
import { config } from "./config.js";

export const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 10 });

export type Db = pg.PoolClient;

/**
 * Run `fn` in a transaction scoped to `tenantId`. set_config(..., is_local=true)
 * ties the setting to the transaction, so it cannot leak to another pooled
 * request. Commits on success, rolls back on throw.
 */
export async function withTenant<T>(tenantId: string, fn: (db: Db) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

/** Non-tenant-scoped query (auth lookups by api key prefix, health). */
export async function query<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params?: unknown[],
): Promise<pg.QueryResult<T>> {
  return pool.query<T>(text, params as never);
}

export async function closeDb(): Promise<void> {
  await pool.end();
}
