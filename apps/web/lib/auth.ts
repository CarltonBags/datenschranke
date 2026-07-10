/** Client auth helpers. Identity lives in an httpOnly cookie; these call the
 *  gateway (via the proxy) and the cookie-setting login/logout routes. */
export type Role = "platform_admin" | "tenant_admin" | "employee";
export interface Me {
  id: string;
  email: string;
  role: Role;
  tenantId: string | null;
}

export async function me(): Promise<Me | null> {
  const res = await fetch("/api/gw/auth/me", { cache: "no-store" });
  if (!res.ok) return null;
  return (await res.json()).user as Me;
}

export async function login(email: string, password: string): Promise<{ ok: boolean; error?: string; user?: Me }> {
  const res = await fetch("/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return { ok: false, error: data.error ?? "Login fehlgeschlagen." };
  return { ok: true, user: data.user as Me };
}

export async function logout(): Promise<void> {
  await fetch("/api/auth/logout", { method: "POST" }).catch(() => undefined);
}

export async function changePassword(currentPassword: string, newPassword: string): Promise<{ ok: boolean; error?: string }> {
  const res = await fetch("/api/gw/auth/change-password", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ currentPassword, newPassword }),
  });
  if (res.ok) return { ok: true };
  const d = await res.json().catch(() => ({}));
  return { ok: false, error: d.error ?? "Fehler." };
}

/** Landing route by role. */
export function homeFor(role: Role): string {
  return role === "platform_admin" ? "/platform" : "/";
}
