"use client";

/** Tenant admin: manage this company's employees + see the license/seat status. */
import { useCallback, useEffect, useState } from "react";

interface User {
  id: string;
  email: string;
  name: string | null;
  role: "tenant_admin" | "employee";
  disabled: boolean;
  created_at: string;
}
interface License {
  seats: number;
  status: string;
  expires_at: string | null;
}

export function UserManagement() {
  const [users, setUsers] = useState<User[]>([]);
  const [license, setLicense] = useState<License | null>(null);
  const [seatsUsed, setSeatsUsed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<"employee" | "tenant_admin">("employee");

  const load = useCallback(async () => {
    try {
      const [u, l] = await Promise.all([
        fetch("/api/gw/admin/users", { cache: "no-store" }),
        fetch("/api/gw/admin/license", { cache: "no-store" }),
      ]);
      if (u.ok) setUsers(((await u.json()).users as User[]) ?? []);
      if (l.ok) { const d = await l.json(); setLicense(d.license); setSeatsUsed(d.seats_used ?? 0); }
      setError(null);
    } catch { setError("Gateway nicht erreichbar."); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function addUser() {
    if (!email.trim() || password.length < 8) { setError("E-Mail und Passwort (min. 8 Zeichen) erforderlich."); return; }
    setBusy(true); setError(null); setNotice(null);
    const res = await fetch("/api/gw/admin/users", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: email.trim(), password, name: name.trim() || undefined, role }),
    });
    setBusy(false);
    if (!res.ok) { setError((await res.json().catch(() => ({}))).error ?? "Fehler."); return; }
    setEmail(""); setName(""); setPassword(""); setRole("employee");
    setNotice("Benutzer angelegt.");
    void load();
  }

  async function toggle(u: User) {
    await fetch(`/api/gw/admin/users/${u.id}`, {
      method: "PATCH", headers: { "content-type": "application/json" },
      body: JSON.stringify({ disabled: !u.disabled }),
    });
    void load();
  }
  async function remove(u: User) {
    if (!confirm(`Benutzer ${u.email} löschen?`)) return;
    await fetch(`/api/gw/admin/users/${u.id}`, { method: "DELETE" });
    void load();
  }

  const atCap = license ? seatsUsed >= license.seats : false;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {error && <div className="glass" style={{ padding: "12px 16px", borderRadius: 14, color: "#e5484d", fontSize: 13 }}>{error}</div>}
      {notice && <div style={{ fontSize: 12.5, color: "var(--shield)" }}>{notice}</div>}

      {/* License / seats */}
      <div className="glass" style={{ borderRadius: 16, padding: "14px 18px", display: "flex", gap: 22, flexWrap: "wrap", alignItems: "center" }}>
        <div>
          <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>Lizenz</div>
          <div style={{ fontWeight: 700, color: license?.status === "active" ? "var(--shield)" : "#e5484d" }}>
            {license ? license.status : "keine"}
          </div>
        </div>
        <div>
          <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>Sitzplätze</div>
          <div style={{ fontWeight: 700 }}>{seatsUsed}{license ? ` / ${license.seats}` : ""}</div>
        </div>
        {license?.expires_at && (
          <div>
            <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>Gültig bis</div>
            <div style={{ fontWeight: 700 }}>{new Date(license.expires_at).toLocaleDateString("de-DE")}</div>
          </div>
        )}
      </div>

      {/* Users list */}
      <div className="glass" style={{ borderRadius: 18, overflow: "hidden" }}>
        {users.map((u) => (
          <div key={u.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "11px 16px", borderTop: "1px solid var(--border-glass)" }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 600, fontSize: 14, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{u.name || u.email}</div>
              <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>{u.email}</div>
            </div>
            <span style={{ fontSize: 11, color: "var(--text-secondary)", border: "1px solid var(--border-glass)", padding: "2px 9px", borderRadius: 999 }}>
              {u.role === "tenant_admin" ? "Admin" : "Mitarbeiter"}
            </span>
            {u.disabled && <span style={{ fontSize: 11, color: "#e5484d" }}>deaktiviert</span>}
            <button onClick={() => void toggle(u)} className="transition" style={ghost}>{u.disabled ? "Aktivieren" : "Deaktivieren"}</button>
            <button onClick={() => void remove(u)} className="transition" style={{ ...ghost, color: "#e5484d" }}>Löschen</button>
          </div>
        ))}
        {users.length === 0 && <div style={{ padding: 24, textAlign: "center", color: "var(--text-secondary)", fontSize: 13 }}>Noch keine Benutzer.</div>}
      </div>

      {/* Add user */}
      <div className="glass" style={{ borderRadius: 18, padding: "16px 18px", display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ fontWeight: 600 }}>Mitarbeiter hinzufügen</div>
        {atCap && <div style={{ fontSize: 12.5, color: "#e5484d" }}>Sitzplatz-Limit erreicht. Lizenz erweitern lassen.</div>}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10 }}>
          <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="E-Mail" type="email" style={inp} />
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name (optional)" style={inp} />
          <input value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Passwort (min. 8)" type="password" style={inp} />
          <select value={role} onChange={(e) => setRole(e.target.value as "employee" | "tenant_admin")} style={inp}>
            <option value="employee">Mitarbeiter</option>
            <option value="tenant_admin">Admin</option>
          </select>
        </div>
        <button onClick={() => void addUser()} disabled={busy || atCap} className="transition btn-primary" style={{ alignSelf: "flex-start", padding: "9px 18px", borderRadius: 12, border: "none", fontWeight: 600 }}>
          {busy ? "Anlegen…" : "Anlegen"}
        </button>
      </div>
    </div>
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
