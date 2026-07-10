"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { login, homeFor } from "../../lib/auth";
import { ShieldIcon } from "../../components/ShieldIcon";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await login(email, password);
    setBusy(false);
    if (!res.ok || !res.user) { setError(res.error ?? "Login fehlgeschlagen."); return; }
    router.push(homeFor(res.user.role));
    router.refresh();
  }

  return (
    <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 20 }}>
      <form onSubmit={submit} className="glass" style={{ width: "min(400px, 92vw)", borderRadius: "var(--radius-xl)", padding: 28, display: "flex", flexDirection: "column", gap: 14 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, color: "var(--shield)" }}>
          <ShieldIcon size={26} />
          <span style={{ fontSize: 20, fontWeight: 700, color: "var(--text-primary)" }}>Datenschranke</span>
        </div>
        <p style={{ margin: 0, fontSize: 13.5, color: "var(--text-secondary)" }}>Bitte anmelden, um fortzufahren.</p>

        <label style={{ display: "flex", flexDirection: "column", gap: 5 }}>
          <span style={{ fontSize: 12.5, fontWeight: 600 }}>E-Mail</span>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus style={inp} />
        </label>
        <label style={{ display: "flex", flexDirection: "column", gap: 5 }}>
          <span style={{ fontSize: 12.5, fontWeight: 600 }}>Passwort</span>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required style={inp} />
        </label>

        {error && <div style={{ fontSize: 13, color: "#e5484d" }}>{error}</div>}

        <button type="submit" disabled={busy} className="transition btn-primary" style={{ padding: "11px 16px", borderRadius: 12, border: "none", fontWeight: 600, marginTop: 4 }}>
          {busy ? "Anmelden…" : "Anmelden"}
        </button>
      </form>
    </main>
  );
}

const inp: React.CSSProperties = {
  padding: "10px 12px",
  borderRadius: 10,
  border: "1px solid var(--border-glass)",
  background: "var(--surface-glass)",
  color: "var(--text-primary)",
  outline: "none",
  fontSize: 14,
};
