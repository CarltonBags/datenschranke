/** Logout: destroy the gateway session and clear the cookie. */
import type { NextRequest } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function gatewayUrl(): string {
  return process.env.GATEWAY_URL ?? "http://localhost:8080";
}

export async function POST(req: NextRequest): Promise<Response> {
  const token = req.cookies.get("ds_session")?.value ?? "";
  await fetch(`${gatewayUrl()}/api/auth/logout`, {
    method: "POST",
    headers: { "x-session-token": token },
  }).catch(() => undefined);
  const clear = "ds_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0";
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { "content-type": "application/json", "set-cookie": clear },
  });
}
