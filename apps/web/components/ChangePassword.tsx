"use client";

/** Change-password control usable on any page. Renders a small trigger that
 *  opens a modal with current/new/confirm fields. */
import { useState } from "react";
import { changePassword } from "../lib/auth";

export function ChangePassword({ trigger }: { trigger?: "link" | "button" }) {
  const [open, setOpen] = useState(false);
  const [cur, setCur] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  function reset() {
    setCur(""); setNext(""); setConfirm(""); setError(null); setDone(false);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (next.length < 8) { setError("Neues Passwort min. 8 Zeichen."); return; }
    if (next !== confirm) { setError("Passwörter stimmen nicht überein."); return; }
    setBusy(true); setError(null);
    const res = await changePassword(cur, next);
    setBusy(false);
    if (!res.ok) { setError(res.error ?? "Fehler."); return; }
    setDone(true); setCur(""); setNext(""); setConfirm("");
  }

  return (
    <>
      <button
        onClick={() => { reset(); setOpen(true); }}
        className="transition"
        style={
          trigger === "button"
            ? { fontSize: 13, color: "var(--text-secondary)", border: "1px solid var(--border-glass)", background: "transparent", borderRadius: 8, padding: "4px 10px" }
            : { fontSize: 12, color: "var(--text-secondary)", border: "none", background: "transparent", padding: 0, textDecoration: "underline", cursor: "pointer" }
        }
      >
        Passwort ändern
      </button>

      {open && (
        <div
          onClick={() => setOpen(false)}
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", display: "grid", placeItems: "center", zIndex: 50, padding: 20 }}
        >
          <form
            onClick={(e) => e.stopPropagation()}
            onSubmit={submit}
            className="glass"
            style={{ width: "min(380px, 92vw)", borderRadius: "var(--radius-xl)", padding: 22, display: "flex", flexDirection: "column", gap: 12 }}
          >
            <div style={{ fontWeight: 700, fontSize: 16 }}>Passwort ändern</div>
            {done ? (
              <>
                <div style={{ fontSize: 13.5, color: "var(--shield)" }}>Passwort geändert. Andere Sitzungen wurden abgemeldet.</div>
                <button type="button" onClick={() => setOpen(false)} className="transition btn-primary" style={{ padding: "9px 16px", borderRadius: 12, border: "none", fontWeight: 600 }}>Schließen</button>
              </>
            ) : (
              <>
                <input type="password" value={cur} onChange={(e) => setCur(e.target.value)} placeholder="Aktuelles Passwort" autoFocus style={inp} />
                <input type="password" value={next} onChange={(e) => setNext(e.target.value)} placeholder="Neues Passwort (min. 8)" style={inp} />
                <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder="Neues Passwort bestätigen" style={inp} />
                {error && <div style={{ fontSize: 13, color: "#e5484d" }}>{error}</div>}
                <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 4 }}>
                  <button type="button" onClick={() => setOpen(false)} className="transition" style={{ border: "1px solid var(--border-glass)", background: "transparent", color: "var(--text-secondary)", borderRadius: 10, padding: "8px 14px", fontSize: 13 }}>Abbrechen</button>
                  <button type="submit" disabled={busy} className="transition btn-primary" style={{ padding: "8px 16px", borderRadius: 10, border: "none", fontWeight: 600 }}>{busy ? "Speichern…" : "Speichern"}</button>
                </div>
              </>
            )}
          </form>
        </div>
      )}
    </>
  );
}

const inp: React.CSSProperties = {
  padding: "10px 12px", borderRadius: 10, border: "1px solid var(--border-glass)",
  background: "var(--surface-glass)", color: "var(--text-primary)", outline: "none", fontSize: 14,
};
