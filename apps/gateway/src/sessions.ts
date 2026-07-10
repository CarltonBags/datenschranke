/**
 * Opaque server-side sessions in Redis. The gateway is the source of truth for
 * identity — the web app only holds the opaque token in an httpOnly cookie and
 * forwards it as `x-session-token`. No tenant/role is trusted from client headers.
 */
import { randomBytes } from "node:crypto";
import { Redis } from "ioredis";
import { config } from "./config.js";

const redis = new Redis(config.redisUrl, { lazyConnect: true, maxRetriesPerRequest: 2 });

export type Role = "platform_admin" | "tenant_admin" | "employee";

export interface SessionData {
  userId: string;
  tenantId: string | null; // null for platform_admin
  role: Role;
  email: string;
}

const TTL_SECONDS = 7 * 24 * 3600;
const keyOf = (token: string) => `sess:${token}`;

export async function connectSessions(): Promise<void> {
  if (["wait", "close", "end"].includes(redis.status)) {
    await redis.connect().catch(() => undefined);
  }
}
export async function closeSessions(): Promise<void> {
  await redis.quit().catch(() => undefined);
}

export async function createSession(data: SessionData): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  await redis.set(keyOf(token), JSON.stringify(data), "EX", TTL_SECONDS);
  return token;
}

export async function getSession(token: string | undefined): Promise<SessionData | null> {
  if (!token) return null;
  const raw = await redis.get(keyOf(token));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as SessionData;
  } catch {
    return null;
  }
}

export async function destroySession(token: string | undefined): Promise<void> {
  if (token) await redis.del(keyOf(token));
}

/** Invalidate a user's sessions (e.g. on disable/delete or password change).
 *  Optionally keep one token alive (the caller's current session). Best-effort. */
export async function destroyUserSessions(userId: string, exceptToken?: string): Promise<void> {
  const keep = exceptToken ? keyOf(exceptToken) : null;
  let cursor = "0";
  do {
    const [next, keys] = await redis.scan(cursor, "MATCH", "sess:*", "COUNT", 200);
    cursor = next;
    for (const k of keys) {
      if (k === keep) continue;
      const raw = await redis.get(k);
      if (raw && (JSON.parse(raw) as SessionData).userId === userId) await redis.del(k);
    }
  } while (cursor !== "0");
}
