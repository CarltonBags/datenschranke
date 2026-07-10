"use client";

/** Platform owner console: create tenants + first admin, issue/adjust licenses,
 *  view every tenant and user. platform_admin only. */
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { me, logout } from "../../lib/auth";
import { ThemeToggle } from "../../components/ThemeToggle";

interface Tenant {
  id: string;
  name: string;
  user_count: number;
  license_status: string | null;
  seats: number | null;
  expires_at: string | null;
}
interface PUser {
  id: string;
  email: string;
  name: string | null;
  role: string;
  disabled: boolean;
  tenant_name: string | null;
}

export default function PlatformPage() {
  const router = useRouter();
  const [authed, setAuthed] = useState(false);
  const [tab, setTab] = useState<"tenants" | "users">("tenants");
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [users, setUsers] = useState<PUser[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<{ tenantId: string; key: string } | null>(null);

  // create-tenant form
  const [name, setName] = useState("");
  const [adminEmail, setAdminEmail] = useState("");
  const [adminPassword, setAdminPassword] = useState("");
  const [seats, setSeats] = useState(5);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    me().then((m) => {
      if (!m) { router.push("/login"); return; }
      if (m.role !== "platform_admin") { router.push("/"); return; }
      setAuthed(true);
    });
  }, [router]);

  const load = useCallback(async () => {
    try {
      const [t, u] = await Promise.all([
        fetch("/api/gw/platform/tenants", { cache: "no-store" }),
        fetch("/api/gw/platform/users", { cache: "no-store" }),
      ]);
      if (t.ok) setTenants(((await t.json()).tenants as Tenant[]) ?? []);
      if (u.ok) setUsers(((await u.json()).users as PUser[]) ?? []);
      setError(null);
    } catch { setError("Gateway nicht erreichbar."); }
  }, []);
  useEffect(() => { if (authed) void load(); }, [authed, load]);

  async function createTenant() {
    if (!name.trim() || !adminEmail.trim() || adminPassword.length < 8) {
      setError("Name, Admin-E-Mail und Passwort (min. 8) erforderlich."); return;
    }
    setBusy(true); setError(null); setCreated(null);
    const res = await fetch("/api/gw/platform/tenants", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: name.trim(), adminEmail: adminEmail.trim(), adminPassword, seats }),
    });
    setBusy(false);
    const d = await res.json().catch(() => ({}));
    if (!res.ok) { setError(d.error ?? "Fehler."); return; }
    setCreated({ tenantId: d.tenantId, key: d.license_key });
    setName(""); setAdminEmail(""); setAdminPassword(""); setSeats(5);
    void load();
  }

  async function license(id: string, patch: Record<string, unknown>) {
    const res = await fetch(`/api/gw/platform/tenants/${id}/license`, {
      method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(patch),
    });
    const d = await res.json().catch(() => ({}));
    if (d.license_key) setCreated({ tenantId: id, key: d.license_key });
    void load();
  }

  if (!authed) return <main style={{ minHeight: "100vh" }} />;

  return (
    <main style={{ minHeight: "100vh", overflow: "auto", padding: "0 clamp(16px, 4vw, 48px) 64px" }}>
      <header style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap", padding: "22px 0 18px", position: "sticky", top: 0, zIndex: 3 }}>
        <div className="glass" style={{ flex: 1, display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap", padding: "12px 18px", borderRadius: 16 }}>
          <div style={{ fontWeight: 700, fontSize: 17 }}>Datenschranke</div>
          <span style={{ fontSize: 12, color: "var(--text-secondary)", border: "1px solid var(--border-glass)", padding: "2px 9px", borderRadius: 999 }}>Plattform-Konsole</span>
          <div style={{ display: "inline-flex", gap: 4, padding: 3, borderRadius: 999, border: "1px solid var(--border-glass)" }}>
            <button onClick={() => setTab("tenants")} className="transition" style={pill(tab === "tenants")}>Mandanten</button>
            <button onClick={() => setTab("users")} className="transition" style={pill(tab === "users")}>Alle Benutzer</button>
          </div>
          <div style={{ flex: 1 }} />
          <button onClick={async () => { await logout(); router.push("/login"); }} className="transition" style={{ fontSize: 13, color: "var(--text-secondary)", border: "1px solid var(--border-glass)", background: "transparent", borderRadius: 8, padding: "4px 10px" }}>Abmelden</button>
          <ThemeToggle />
        </div>
      </header>

      {error && <div className="glass" style={{ padding: "12px 16px", borderRadius: 14, color: "#e5484d", fontSize: 13, marginBottom: 14 }}>{error}</div>}
      {created && (
        <div className="glass" style={{ padding: "14px 16px", borderRadius: 14, marginBottom: 14 }}>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>Lizenzschlüssel (nur jetzt sichtbar):</div>
          <code style={{ fontSize: 12.5, wordBreak: "break-all", color: "var(--shield)" }}>{created.key}</code>
        </div>
      )}

      {tab === "tenants" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div className="glass" style={{ borderRadius: 18, overflow: "hidden" }}>
            {tenants.map((t) => (
              <div key={t.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 16px", borderTop: "1px solid var(--border-glass)", flexWrap: "wrap" }}>
                <div style={{ flex: 1, minWidth: 140 }}>
                  <div style={{ fontWeight: 600 }}>{t.name}</div>
                  <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>{t.user_count} Benutzer</div>
                </div>
                <span style={{ fontSize: 11, color: t.license_status === "active" ? "var(--shield)" : "#e5484d", border: "1px solid var(--border-glass)", padding: "2px 9px", borderRadius: 999 }}>
                  {t.license_status ?? "keine Lizenz"}{t.seats != null ? ` · ${t.seats} Sitze` : ""}
                </span>
                <button onClick={() => void license(t.id, { status: t.license_status === "active" ? "suspended" : "active" })} className="transition" style={ghost}>
                  {t.license_status === "active" ? "Sperren" : "Aktivieren"}
                </button>
                <button onClick={() => { const s = prompt("Neue Sitzplatzanzahl:", String(t.seats ?? 5)); if (s) void license(t.id, { seats: Number(s) }); }} className="transition" style={ghost}>Sitze</button>
                <button onClick={() => { if (confirm("Neuen Lizenzschlüssel erzeugen? Der alte wird ungültig.")) void license(t.id, { rotate: true, seats: t.seats ?? 5 }); }} className="transition" style={ghost}>Neuer Key</button>
              </div>
            ))}
            {tenants.length === 0 && <div style={{ padding: 24, textAlign: "center", color: "var(--text-secondary)", fontSize: 13 }}>Noch keine Mandanten.</div>}
          </div>

          <div className="glass" style={{ borderRadius: 18, padding: "16px 18px", display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ fontWeight: 600 }}>Neuen Mandanten anlegen</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10 }}>
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Firmenname" style={inp} />
              <input value={adminEmail} onChange={(e) => setAdminEmail(e.target.value)} placeholder="Admin-E-Mail" type="email" style={inp} />
              <input value={adminPassword} onChange={(e) => setAdminPassword(e.target.value)} placeholder="Admin-Passwort (min. 8)" type="password" style={inp} />
              <input value={seats} onChange={(e) => setSeats(Number(e.target.value))} placeholder="Sitze" type="number" min={1} style={inp} />
            </div>
            <button onClick={() => void createTenant()} disabled={busy} className="transition btn-primary" style={{ alignSelf: "flex-start", padding: "9px 18px", borderRadius: 12, border: "none", fontWeight: 600 }}>
              {busy ? "Anlegen…" : "Mandant + Admin + Lizenz anlegen"}
            </button>
          </div>
        </div>
      )}

      {tab === "users" && (
        <div className="glass" style={{ borderRadius: 18, overflow: "hidden" }}>
          {users.map((u) => (
            <div key={u.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "11px 16px", borderTop: "1px solid var(--border-glass)" }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: 14 }}>{u.name || u.email}</div>
                <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>{u.email}</div>
              </div>
              <span style={{ fontSize: 11, color: "var(--text-secondary)" }}>{u.tenant_name ?? "—"}</span>
              <span style={{ fontSize: 11, color: "var(--text-secondary)", border: "1px solid var(--border-glass)", padding: "2px 9px", borderRadius: 999 }}>{u.role}</span>
              {u.disabled && <span style={{ fontSize: 11, color: "#e5484d" }}>deaktiviert</span>}
            </div>
          ))}
          {users.length === 0 && <div style={{ padding: 24, textAlign: "center", color: "var(--text-secondary)", fontSize: 13 }}>Keine Benutzer.</div>}
        </div>
      )}
    </main>
  );
}

const inp: React.CSSProperties = {
  padding: "9px 12px", borderRadius: 10, border: "1px solid var(--border-glass)",
  background: "var(--surface-glass)", color: "var(--text-primary)", outline: "none", fontSize: 14,
};
const ghost: React.CSSProperties = {
  border: "1px solid var(--border-glass)", background: "transparent", color: "var(--text-secondary)",
  borderRadius: 8, padding: "4px 10px", fontSize: 12, flexShrink: 0,
};
function pill(active: boolean): React.CSSProperties {
  return {
    padding: "5px 14px", borderRadius: 999, fontSize: 13, fontWeight: 600, border: "none",
    background: active ? "color-mix(in srgb, var(--accent) 18%, transparent)" : "transparent",
    color: active ? "var(--accent)" : "var(--text-secondary)",
  };
}
