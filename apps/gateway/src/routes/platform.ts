/** Platform-owner console: create tenants + their first admin, issue/adjust
 *  licenses, view every tenant and user. platform_admin only. */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requirePlatformAdmin } from "../principal.js";
import {
  createTenantWithAdmin,
  issueLicense,
  updateLicense,
  listTenantsOverview,
  listAllUsers,
  DuplicateEmailError,
} from "../accounts.js";

export async function platformRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/platform/tenants", async (req, reply) => {
    if (!(await requirePlatformAdmin(req, reply))) return;
    return reply.send({ tenants: await listTenantsOverview() });
  });

  app.get("/api/platform/users", async (req, reply) => {
    if (!(await requirePlatformAdmin(req, reply))) return;
    return reply.send({ users: await listAllUsers() });
  });

  const createTenant = z.object({
    name: z.string().min(1).max(200),
    adminEmail: z.string().email(),
    adminPassword: z.string().min(8).max(400),
    adminName: z.string().max(200).optional(),
    seats: z.number().int().min(1).max(100000).default(5),
    expiresAt: z.string().datetime().nullable().optional(),
  });
  app.post("/api/platform/tenants", async (req, reply) => {
    if (!(await requirePlatformAdmin(req, reply))) return;
    const parsed = createTenant.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });
    const d = parsed.data;
    try {
      const { tenantId } = await createTenantWithAdmin(d.name, d.adminEmail, d.adminPassword, d.adminName ?? null);
      const { key } = await issueLicense(tenantId, d.seats, d.expiresAt ?? null);
      // license key is shown ONCE
      return reply.send({ tenantId, license_key: key });
    } catch (e) {
      if (e instanceof DuplicateEmailError) return reply.code(409).send({ error: e.message });
      throw e;
    }
  });

  const licenseBody = z.object({
    seats: z.number().int().min(1).max(100000).optional(),
    status: z.enum(["active", "suspended", "expired"]).optional(),
    expiresAt: z.string().datetime().nullable().optional(),
    rotate: z.boolean().optional(),
  });
  app.patch("/api/platform/tenants/:id/license", async (req, reply) => {
    if (!(await requirePlatformAdmin(req, reply))) return;
    const id = (req.params as { id: string }).id;
    const parsed = licenseBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });
    const d = parsed.data;
    if (d.rotate) {
      const { key } = await issueLicense(id, d.seats ?? 5, d.expiresAt ?? null);
      return reply.send({ ok: true, license_key: key });
    }
    const patch: { seats?: number; status?: "active" | "suspended" | "expired"; expires_at?: string | null } = {};
    if (d.seats !== undefined) patch.seats = d.seats;
    if (d.status !== undefined) patch.status = d.status;
    if (d.expiresAt !== undefined) patch.expires_at = d.expiresAt;
    const ok = await updateLicense(id, patch);
    return reply.send({ ok });
  });
}
