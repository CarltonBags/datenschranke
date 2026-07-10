/**
 * User / tenant / license operations. users & licenses are not under RLS, so these
 * use the non-tenant-scoped query() with EXPLICIT tenant_id filters. Tenant-scoped
 * side effects (a new tenant's default policy, which IS under RLS) go through
 * withTenant().
 */
import { createHash, randomBytes } from "node:crypto";
import { query, withTenant } from "./db.js";
import { config } from "./config.js";
import { hashPassword } from "./password.js";
import type { Role } from "./sessions.js";

export interface UserRow {
  id: string;
  tenant_id: string | null;
  email: string;
  password_hash: string;
  name: string | null;
  role: Role;
  disabled: boolean;
  created_at: string;
}

export interface LicenseRow {
  tenant_id: string;
  key_prefix: string;
  seats: number;
  status: "active" | "suspended" | "expired";
  expires_at: string | null;
  created_at: string;
}

const sha256 = (s: string) => createHash("sha256").update(s).digest();

// ---- Users -----------------------------------------------------------------

export async function findUserByEmail(email: string): Promise<UserRow | null> {
  const r = await query<UserRow>("SELECT * FROM users WHERE email = $1", [email]);
  return r.rows[0] ?? null;
}

export async function getUserById(id: string): Promise<UserRow | null> {
  const r = await query<UserRow>("SELECT * FROM users WHERE id = $1", [id]);
  return r.rows[0] ?? null;
}

export async function countTenantUsers(tenantId: string): Promise<number> {
  const r = await query<{ n: string }>(
    "SELECT count(*)::text AS n FROM users WHERE tenant_id = $1 AND disabled = false",
    [tenantId],
  );
  return Number(r.rows[0]?.n ?? 0);
}

export async function listTenantUsers(tenantId: string): Promise<Array<Omit<UserRow, "password_hash">>> {
  const r = await query<Omit<UserRow, "password_hash">>(
    "SELECT id, tenant_id, email, name, role, disabled, created_at FROM users WHERE tenant_id = $1 ORDER BY created_at",
    [tenantId],
  );
  return r.rows;
}

export class SeatLimitError extends Error {}
export class DuplicateEmailError extends Error {}

/** Create an employee/tenant_admin in a tenant, enforcing the license seat cap. */
export async function createTenantUser(
  tenantId: string,
  email: string,
  password: string,
  name: string | null,
  role: "tenant_admin" | "employee",
): Promise<{ id: string }> {
  const license = await getLicense(tenantId);
  const used = await countTenantUsers(tenantId);
  if (license && used >= license.seats) {
    throw new SeatLimitError(`Sitzplatz-Limit erreicht (${license.seats}). Lizenz erweitern.`);
  }
  const existing = await findUserByEmail(email);
  if (existing) throw new DuplicateEmailError("E-Mail bereits vergeben.");
  const password_hash = await hashPassword(password);
  const r = await query<{ id: string }>(
    `INSERT INTO users (tenant_id, email, password_hash, name, role)
     VALUES ($1,$2,$3,$4,$5) RETURNING id`,
    [tenantId, email, password_hash, name, role],
  );
  return { id: r.rows[0]!.id };
}

export async function setUserDisabled(tenantId: string, userId: string, disabled: boolean): Promise<boolean> {
  const r = await query(
    "UPDATE users SET disabled = $3 WHERE id = $1 AND tenant_id = $2",
    [userId, tenantId, disabled],
  );
  return (r.rowCount ?? 0) > 0;
}

export async function deleteUser(tenantId: string, userId: string): Promise<boolean> {
  const r = await query("DELETE FROM users WHERE id = $1 AND tenant_id = $2", [userId, tenantId]);
  return (r.rowCount ?? 0) > 0;
}

// ---- Tenants (platform) ----------------------------------------------------

export interface TenantOverview {
  id: string;
  name: string;
  user_count: number;
  license_status: string | null;
  seats: number | null;
  expires_at: string | null;
}

export async function listAllUsers(): Promise<Array<Omit<UserRow, "password_hash"> & { tenant_name: string | null }>> {
  const r = await query<Omit<UserRow, "password_hash"> & { tenant_name: string | null }>(
    `SELECT u.id, u.tenant_id, u.email, u.name, u.role, u.disabled, u.created_at, t.name AS tenant_name
     FROM users u LEFT JOIN tenants t ON t.id = u.tenant_id
     ORDER BY t.name NULLS FIRST, u.created_at`,
  );
  return r.rows;
}

export async function listTenantsOverview(): Promise<TenantOverview[]> {
  const r = await query<TenantOverview>(
    `SELECT t.id, t.name,
            (SELECT count(*)::int FROM users u WHERE u.tenant_id = t.id) AS user_count,
            l.status AS license_status, l.seats, l.expires_at
     FROM tenants t
     LEFT JOIN licenses l ON l.tenant_id = t.id
     ORDER BY t.name`,
  );
  return r.rows;
}

const DEFAULT_POLICY = {
  version: 1,
  default_action: "redact",
  entities: { ORG: "allow" },
  min_confidence: 0.6,
  allowed_providers: [config.defaultProvider],
  languages: ["de", "en"],
};

/** Provision a new tenant + its first tenant_admin + default policy. */
export async function createTenantWithAdmin(
  companyName: string,
  adminEmail: string,
  adminPassword: string,
  adminName: string | null,
): Promise<{ tenantId: string; adminUserId: string }> {
  if (await findUserByEmail(adminEmail)) throw new DuplicateEmailError("E-Mail bereits vergeben.");
  const t = await query<{ id: string }>("INSERT INTO tenants (name) VALUES ($1) RETURNING id", [companyName]);
  const tenantId = t.rows[0]!.id;
  await withTenant(tenantId, (db) =>
    db.query(
      `INSERT INTO policies (tenant_id, version, document) VALUES ($1,$2,$3)
       ON CONFLICT (tenant_id) DO NOTHING`,
      [tenantId, DEFAULT_POLICY.version, JSON.stringify(DEFAULT_POLICY)],
    ),
  );
  const password_hash = await hashPassword(adminPassword);
  const u = await query<{ id: string }>(
    `INSERT INTO users (tenant_id, email, password_hash, name, role)
     VALUES ($1,$2,$3,$4,'tenant_admin') RETURNING id`,
    [tenantId, adminEmail, password_hash, adminName],
  );
  return { tenantId, adminUserId: u.rows[0]!.id };
}

// ---- Licenses --------------------------------------------------------------

export async function getLicense(tenantId: string): Promise<LicenseRow | null> {
  const r = await query<LicenseRow>(
    "SELECT tenant_id, key_prefix, seats, status, expires_at, created_at FROM licenses WHERE tenant_id = $1",
    [tenantId],
  );
  return r.rows[0] ?? null;
}

/** True if the tenant may be used right now (active + not expired). */
export async function licenseValid(tenantId: string): Promise<boolean> {
  const l = await getLicense(tenantId);
  if (!l) return false;
  if (l.status !== "active") return false;
  if (l.expires_at && new Date(l.expires_at).getTime() < Date.now()) return false;
  return true;
}

/** Create or replace a tenant's license. Returns the plaintext key ONCE. */
export async function issueLicense(
  tenantId: string,
  seats: number,
  expiresAt: string | null,
): Promise<{ key: string; prefix: string }> {
  const prefix = `lic_${randomBytes(4).toString("hex")}`;
  const secret = randomBytes(24).toString("base64url");
  const key = `${prefix}_${secret}`;
  await query(
    `INSERT INTO licenses (tenant_id, key_prefix, key_hash, seats, status, expires_at)
     VALUES ($1,$2,$3,$4,'active',$5)
     ON CONFLICT (tenant_id) DO UPDATE
       SET key_prefix = EXCLUDED.key_prefix, key_hash = EXCLUDED.key_hash,
           seats = EXCLUDED.seats, status = 'active', expires_at = EXCLUDED.expires_at`,
    [tenantId, prefix, sha256(key), seats, expiresAt],
  );
  return { key, prefix };
}

export async function updateLicense(
  tenantId: string,
  patch: { seats?: number; status?: "active" | "suspended" | "expired"; expires_at?: string | null },
): Promise<boolean> {
  const sets: string[] = [];
  const vals: unknown[] = [tenantId];
  if (patch.seats !== undefined) { vals.push(patch.seats); sets.push(`seats = $${vals.length}`); }
  if (patch.status !== undefined) { vals.push(patch.status); sets.push(`status = $${vals.length}`); }
  if (patch.expires_at !== undefined) { vals.push(patch.expires_at); sets.push(`expires_at = $${vals.length}`); }
  if (sets.length === 0) return false;
  const r = await query(`UPDATE licenses SET ${sets.join(", ")} WHERE tenant_id = $1`, vals);
  return (r.rowCount ?? 0) > 0;
}
