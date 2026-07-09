#!/usr/bin/env node
// Idempotent SQL migration runner. Applies numbered *.sql files in order,
// tracked in schema_migrations. Safe to re-run (deploy.sh calls it every deploy).
//
// Connects as an admin/superuser role (DATABASE_URL). Sets app.gateway_password
// so 0002 can create the least-privilege `gateway` role.
import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const __dirname = dirname(fileURLToPath(import.meta.url));

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("migrate: DATABASE_URL is required");
  process.exit(1);
}
const gatewayPassword = process.env.GATEWAY_DB_PASSWORD ?? "";

async function main() {
  const client = new pg.Client({ connectionString: DATABASE_URL });
  await client.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      );
    `);
    // Available to migrations via current_setting('app.gateway_password', true).
    await client.query("SELECT set_config('app.gateway_password', $1, false)", [gatewayPassword]);

    const files = (await readdir(__dirname))
      .filter((f) => /^\d+_.*\.sql$/.test(f))
      .sort();

    const applied = new Set(
      (await client.query("SELECT name FROM schema_migrations")).rows.map((r) => r.name),
    );

    let ran = 0;
    for (const file of files) {
      if (applied.has(file)) continue;
      const sql = await readFile(join(__dirname, file), "utf8");
      process.stdout.write(`migrate: applying ${file} ... `);
      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query("INSERT INTO schema_migrations(name) VALUES ($1)", [file]);
        await client.query("COMMIT");
        console.log("ok");
        ran += 1;
      } catch (err) {
        await client.query("ROLLBACK");
        console.log("FAILED");
        throw err;
      }
    }
    console.log(ran === 0 ? "migrate: up to date" : `migrate: applied ${ran} migration(s)`);
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error("migrate: error\n", err);
  process.exit(1);
});
