/** Login: verify at the gateway, then set an httpOnly session cookie. */
import type { NextRequest } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function gatewayUrl(): string {
  return process.env.GATEWAY_URL ?? "http://localhost:8080";
}

export async function POST(req: NextRequest): Promise<Response> {
  const body = await req.text();
  const res = await fetch(`${gatewayUrl()}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
  });
  const data = (await res.json()) as { token?: string; user?: unknown; error?: string };
  if (!res.ok || !data.token) {
    return Response.json({ error: data.error ?? "Login fehlgeschlagen." }, { status: res.status });
  }
  const secure = process.env.NODE_ENV === "production";
  const cookie = [
    `ds_session=${data.token}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${7 * 24 * 3600}`,
    secure ? "Secure" : "",
  ].filter(Boolean).join("; ");
  return new Response(JSON.stringify({ user: data.user }), {
    status: 200,
    headers: { "content-type": "application/json", "set-cookie": cookie },
  });
}
