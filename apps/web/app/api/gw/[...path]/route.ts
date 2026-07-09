/**
 * Server-side proxy: browser → this route → gateway. Injects the tenant/user
 * identity here (stand-in for verified OIDC claims) so the browser never holds
 * gateway credentials, and streams SSE straight through.
 */
import type { NextRequest } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Read at RUNTIME (plain env, not NEXT_PUBLIC — those inline at build time).
function gatewayUrl(): string {
  return process.env.GATEWAY_URL ?? "http://localhost:8080";
}
// Stand-in identity — replace with OIDC session claims in production.
function tenantId(): string {
  return process.env.DEMO_TENANT_ID ?? process.env.NEXT_PUBLIC_DEMO_TENANT_ID ?? "";
}

async function proxy(req: NextRequest, path: string[]): Promise<Response> {
  const search = req.nextUrl.search;
  const target = `${gatewayUrl()}/api/${path.join("/")}${search}`;
  const headers: Record<string, string> = {
    "content-type": req.headers.get("content-type") ?? "application/json",
    "x-tenant-id": tenantId(),
    "x-user": "demo",
  };
  const init: RequestInit = { method: req.method, headers };
  if (req.method !== "GET" && req.method !== "DELETE") {
    init.body = await req.text();
  }
  const res = await fetch(target, init);
  // Stream (SSE) or pass through JSON.
  return new Response(res.body, {
    status: res.status,
    headers: {
      "content-type": res.headers.get("content-type") ?? "application/json",
      "cache-control": "no-cache",
    },
  });
}

type Ctx = { params: Promise<{ path: string[] }> };
export async function GET(req: NextRequest, ctx: Ctx) {
  return proxy(req, (await ctx.params).path);
}
export async function POST(req: NextRequest, ctx: Ctx) {
  return proxy(req, (await ctx.params).path);
}
export async function DELETE(req: NextRequest, ctx: Ctx) {
  return proxy(req, (await ctx.params).path);
}
