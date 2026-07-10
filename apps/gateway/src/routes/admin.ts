/** Admin console API: policy editor, live analyze, audit viewer, API keys, and
 *  tenant user management. tenant_admin only (session-authenticated). */
import type { FastifyInstance } from "fastify";
import { tenantPolicySchema } from "@gdpr/shared";
import { z } from "zod";
import { withTenant } from "../db.js";
import { loadPolicy, savePolicy } from "../policy.js";
import { writeAudit, auditEvent } from "../audit.js";
import { generateApiKey } from "../auth.js";
import { analyze } from "../redactorClient.js";
import { requireTenantAdmin, actorOf } from "../principal.js";
import { destroyUserSessions } from "../sessions.js";
import {
  listTenantUsers, createTenantUser, setUserDisabled, deleteUser, getLicense,
  SeatLimitError, DuplicateEmailError,
} from "../accounts.js";

export async function adminRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/admin/policy", async (req, reply) => {
    const p = await requireTenantAdmin(req, reply);
    if (!p) return;
    const policy = await withTenant(p.tenantId, (db) => loadPolicy(db, p.tenantId));
    return reply.send(policy);
  });

  app.put("/api/admin/policy", async (req, reply) => {
    const p = await requireTenantAdmin(req, reply);
    if (!p) return;
    const parsed = tenantPolicySchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });
    await withTenant(p.tenantId, async (db) => {
      await savePolicy(db, p.tenantId, parsed.data);
      await writeAudit(db, auditEvent(p.tenantId, "policy.updated", actorOf(p), { policy_version: parsed.data.version }));
    });
    return reply.send({ ok: true });
  });

  // Live "test your policy" — detection only, safe to show entity TYPES (not values).
  app.post("/api/admin/analyze", async (req, reply) => {
    const p = await requireTenantAdmin(req, reply);
    if (!p) return;
    const parsed = z.object({ text: z.string().max(20000), language: z.string().optional() }).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });
    const policy = await withTenant(p.tenantId, (db) => loadPolicy(db, p.tenantId));
    const result = await analyze({
      tenant_id: p.tenantId,
      conversation_id: "00000000-0000-0000-0000-000000000000",
      text: parsed.data.text,
      ...(parsed.data.language ? { language: parsed.data.language } : {}),
      policy,
      existing_entities: [],
    });
    return reply.send(result);
  });

  app.get("/api/admin/audit", async (req, reply) => {
    const p = await requireTenantAdmin(req, reply);
    if (!p) return;
    const q = z
      .object({ from: z.string().optional(), to: z.string().optional(), type: z.string().optional(), format: z.enum(["json", "csv"]).optional() })
      .parse(req.query);
    const rows = await withTenant(p.tenantId, (db) =>
      db.query<{ id: string; event_type: string; actor: string; conversation_id: string | null; payload: unknown; created_at: string }>(
        `SELECT id, event_type, actor, conversation_id, payload, created_at
         FROM audit_events
         WHERE ($1::timestamptz IS NULL OR created_at >= $1)
           AND ($2::timestamptz IS NULL OR created_at <= $2)
           AND ($3::text IS NULL OR event_type = $3)
         ORDER BY created_at DESC LIMIT 1000`,
        [q.from ?? null, q.to ?? null, q.type ?? null],
      ).then((r) => r.rows),
    );
    if (q.format === "csv") {
      const header = "id,event_type,actor,conversation_id,created_at,payload\n";
      const body = rows
        .map((r) => `${r.id},${r.event_type},${r.actor},${r.conversation_id ?? ""},${r.created_at},"${JSON.stringify(r.payload).replace(/"/g, "'")}"`)
        .join("\n");
      reply.header("content-type", "text/csv");
      return reply.send(header + body);
    }
    return reply.send({ events: rows });
  });

  app.post("/api/admin/apikeys", async (req, reply) => {
    const p = await requireTenantAdmin(req, reply);
    if (!p) return;
    const parsed = z.object({ name: z.string().min(1).max(120) }).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });
    const { key, prefix, keyHash } = generateApiKey();
    await withTenant(p.tenantId, async (db) => {
      await db.query(
        "INSERT INTO api_keys (tenant_id, name, prefix, key_hash) VALUES (current_setting('app.tenant_id')::uuid, $1, $2, $3)",
        [parsed.data.name, prefix, keyHash],
      );
      await writeAudit(db, auditEvent(p.tenantId, "apikey.created", actorOf(p), { prefix, name: parsed.data.name }));
    });
    // Plaintext key is shown exactly once.
    return reply.send({ key, prefix, name: parsed.data.name });
  });

  // ---- Tenant user management (tenant_admin) --------------------------------

  app.get("/api/admin/users", async (req, reply) => {
    const p = await requireTenantAdmin(req, reply);
    if (!p) return;
    return reply.send({ users: await listTenantUsers(p.tenantId) });
  });

  app.get("/api/admin/license", async (req, reply) => {
    const p = await requireTenantAdmin(req, reply);
    if (!p) return;
    const license = await getLicense(p.tenantId);
    const used = (await listTenantUsers(p.tenantId)).filter((u) => !u.disabled).length;
    return reply.send({ license, seats_used: used });
  });

  const newUser = z.object({
    email: z.string().email(),
    password: z.string().min(8).max(400),
    name: z.string().max(200).optional(),
    role: z.enum(["employee", "tenant_admin"]).default("employee"),
  });
  app.post("/api/admin/users", async (req, reply) => {
    const p = await requireTenantAdmin(req, reply);
    if (!p) return;
    const parsed = newUser.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });
    const d = parsed.data;
    try {
      const { id } = await createTenantUser(p.tenantId, d.email, d.password, d.name ?? null, d.role);
      await withTenant(p.tenantId, (db) =>
        writeAudit(db, auditEvent(p.tenantId, "user.created", actorOf(p), { role: d.role })),
      ).catch(() => undefined);
      return reply.send({ id });
    } catch (e) {
      if (e instanceof SeatLimitError) return reply.code(409).send({ error: e.message });
      if (e instanceof DuplicateEmailError) return reply.code(409).send({ error: e.message });
      throw e;
    }
  });

  app.patch("/api/admin/users/:id", async (req, reply) => {
    const p = await requireTenantAdmin(req, reply);
    if (!p) return;
    const id = (req.params as { id: string }).id;
    const parsed = z.object({ disabled: z.boolean() }).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });
    if (id === p.userId) return reply.code(400).send({ error: "Eigenes Konto nicht ändern." });
    const ok = await setUserDisabled(p.tenantId, id, parsed.data.disabled);
    if (ok && parsed.data.disabled) await destroyUserSessions(id);
    return reply.send({ ok });
  });

  app.delete("/api/admin/users/:id", async (req, reply) => {
    const p = await requireTenantAdmin(req, reply);
    if (!p) return;
    const id = (req.params as { id: string }).id;
    if (id === p.userId) return reply.code(400).send({ error: "Eigenes Konto nicht löschen." });
    const ok = await deleteUser(p.tenantId, id);
    if (ok) await destroyUserSessions(id);
    return reply.send({ ok });
  });
}
