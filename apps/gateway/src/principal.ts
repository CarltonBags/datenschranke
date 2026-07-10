/**
 * Identity resolution for Product A + admin/platform routes. Identity comes ONLY
 * from a validated server-side session (Redis), never from client-supplied
 * tenant/role headers — the web proxy forwards the opaque token as x-session-token.
 */
import type { FastifyRequest, FastifyReply } from "fastify";
import { getSession, type SessionData } from "./sessions.js";

export function sessionToken(req: FastifyRequest): string | undefined {
  return req.headers["x-session-token"] as string | undefined;
}

export async function principal(req: FastifyRequest): Promise<SessionData | null> {
  return getSession(sessionToken(req));
}

/** Require any authenticated user with a tenant (employee or tenant_admin). */
export async function requireTenantUser(
  req: FastifyRequest,
  reply: FastifyReply,
): Promise<(SessionData & { tenantId: string }) | null> {
  const p = await principal(req);
  if (!p) { reply.code(401).send({ error: "unauthenticated" }); return null; }
  if (!p.tenantId) { reply.code(403).send({ error: "no tenant context" }); return null; }
  return p as SessionData & { tenantId: string };
}

/** Require a tenant_admin (manages their own company). */
export async function requireTenantAdmin(
  req: FastifyRequest,
  reply: FastifyReply,
): Promise<(SessionData & { tenantId: string }) | null> {
  const p = await requireTenantUser(req, reply);
  if (!p) return null;
  if (p.role !== "tenant_admin") { reply.code(403).send({ error: "admin only" }); return null; }
  return p;
}

/** Require the platform owner. */
export async function requirePlatformAdmin(
  req: FastifyRequest,
  reply: FastifyReply,
): Promise<SessionData | null> {
  const p = await principal(req);
  if (!p) { reply.code(401).send({ error: "unauthenticated" }); return null; }
  if (p.role !== "platform_admin") { reply.code(403).send({ error: "platform admin only" }); return null; }
  return p;
}

/** Actor string for audit events. */
export function actorOf(p: SessionData): string {
  return `${p.role}:${p.email}`;
}
