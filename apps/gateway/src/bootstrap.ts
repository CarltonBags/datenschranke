/** Create the platform super-admin on first start, from env, if none exists. */
import { query } from "./db.js";
import { hashPassword } from "./password.js";
import { config } from "./config.js";

export async function bootstrapPlatformAdmin(): Promise<void> {
  if (!config.platformAdminEmail || !config.platformAdminPassword) return;
  const exists = await query<{ n: string }>(
    "SELECT count(*)::text AS n FROM users WHERE role = 'platform_admin'",
  );
  if (Number(exists.rows[0]?.n ?? 0) > 0) return;
  const password_hash = await hashPassword(config.platformAdminPassword);
  await query(
    `INSERT INTO users (tenant_id, email, password_hash, name, role)
     VALUES (NULL, $1, $2, 'Platform Admin', 'platform_admin')
     ON CONFLICT (email) DO NOTHING`,
    [config.platformAdminEmail, password_hash],
  );
}
