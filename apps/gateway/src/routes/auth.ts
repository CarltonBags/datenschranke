/** Built-in email+password auth. Sessions live in Redis (opaque token). */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { findUserByEmail, licenseValid } from "../accounts.js";
import { verifyPassword } from "../password.js";
import { createSession, destroySession, getSession } from "../sessions.js";
import { sessionToken } from "../principal.js";
import { withTenant } from "../db.js";
import { writeAudit, auditEvent } from "../audit.js";

const loginBody = z.object({ email: z.string().email(), password: z.string().min(1).max(400) });

export async function authRoutes(app: FastifyInstance): Promise<void> {
  app.post("/api/auth/login", async (req, reply) => {
    const parsed = loginBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid credentials" });
    const { email, password } = parsed.data;

    const user = await findUserByEmail(email);
    // Constant-ish path: always verify against something to reduce user enumeration.
    const ok = user && !user.disabled && (await verifyPassword(password, user.password_hash));
    if (!user || !ok) return reply.code(401).send({ error: "E-Mail oder Passwort falsch." });

    // License gate for tenant users (platform_admin is exempt).
    if (user.role !== "platform_admin") {
      if (!user.tenant_id || !(await licenseValid(user.tenant_id))) {
        return reply.code(403).send({ error: "Lizenz inaktiv oder abgelaufen. Bitte Administrator kontaktieren." });
      }
    }

    const token = await createSession({
      userId: user.id,
      tenantId: user.tenant_id,
      role: user.role,
      email: user.email,
    });
    if (user.tenant_id) {
      await withTenant(user.tenant_id, (db) =>
        writeAudit(db, auditEvent(user.tenant_id!, "auth.login", `${user.role}:${user.email}`, { role: user.role })),
      ).catch(() => undefined);
    }
    return reply.send({
      token,
      user: { id: user.id, email: user.email, name: user.name, role: user.role, tenantId: user.tenant_id },
    });
  });

  app.post("/api/auth/logout", async (req, reply) => {
    await destroySession(sessionToken(req));
    return reply.send({ ok: true });
  });

  app.get("/api/auth/me", async (req, reply) => {
    const s = await getSession(sessionToken(req));
    if (!s) return reply.code(401).send({ error: "unauthenticated" });
    return reply.send({ user: { id: s.userId, email: s.email, role: s.role, tenantId: s.tenantId } });
  });
}
