/**
 * Server-side proxy: browser → this route → gateway. Forwards the opaque session
 * token from the httpOnly cookie as x-session-token. The gateway derives tenant +
 * user + role from the validated session — no identity is trusted from the client.
 */
import type { NextRequest } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function gatewayUrl(): string {
  return process.env.GATEWAY_URL ?? "http://localhost:8080";
}

async function proxy(req: NextRequest, path: string[]): Promise<Response> {
  const search = req.nextUrl.search;
  const target = `${gatewayUrl()}/api/${path.join("/")}${search}`;
  const token = req.cookies.get("ds_session")?.value ?? "";
  const headers: Record<string, string> = {
    "content-type": req.headers.get("content-type") ?? "application/json",
    "x-session-token": token,
  };
  const init: RequestInit = { method: req.method, headers };
  if (req.method !== "GET" && req.method !== "DELETE") {
    init.body = await req.text();
  }
  const res = await fetch(target, init);
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
export async function PATCH(req: NextRequest, ctx: Ctx) {
  return proxy(req, (await ctx.params).path);
}
export async function DELETE(req: NextRequest, ctx: Ctx) {
  return proxy(req, (await ctx.params).path);
}
