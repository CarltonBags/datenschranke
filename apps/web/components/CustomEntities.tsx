"use client";

/**
 * Admin: per-tenant custom recognizers. A DPO defines a number/format to protect
 * by giving it a NAME and an EXAMPLE VALUE; we derive the regex shape (editable),
 * preview matches live in the browser, then save it into the tenant policy via
 * PUT /api/admin/policy. On the wire these always map to [[CUSTOM_N]] — the label
 * lives only in the token map, audit, and this screen.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { regexFromExample, testPattern } from "../lib/shape";

type Action = "redact" | "block";
type Kind = "pattern" | "deny_list";

interface CustomEntity {
  label: string;
  kind: Kind;
  regex?: string;
  values?: string[];
  context?: string[];
  score?: number;
  action: Action;
}
interface Policy {
  version: number;
  default_action: string;
  entities: Record<string, string>;
  min_confidence: number;
  allowed_providers: string[];
  languages: string[];
  custom_entities?: CustomEntity[];
}

export function CustomEntities() {
  const [policy, setPolicy] = useState<Policy | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  // draft form
  const [label, setLabel] = useState("");
  const [kind, setKind] = useState<Kind>("pattern");
  const [example, setExample] = useState("");
  const [regex, setRegex] = useState("");
  const [regexEdited, setRegexEdited] = useState(false);
  const [values, setValues] = useState("");
  const [context, setContext] = useState("");
  const [action, setAction] = useState<Action>("redact");
  const [sample, setSample] = useState("");

  const loadPolicy = useCallback(async () => {
    try {
      const res = await fetch("/api/gw/admin/policy", { cache: "no-store" });
      if (!res.ok) { setError(res.status === 401 ? "Kein Tenant konfiguriert (DEMO_TENANT_ID)." : `Fehler ${res.status}`); return; }
      setPolicy((await res.json()) as Policy);
      setError(null);
    } catch { setError("Gateway nicht erreichbar."); }
  }, []);
  useEffect(() => { void loadPolicy(); }, [loadPolicy]);

  // Auto-derive regex from the example until the user hand-edits the regex.
  useEffect(() => {
    if (!regexEdited) setRegex(regexFromExample(example));
  }, [example, regexEdited]);

  const matches = useMemo(() => (kind === "pattern" ? testPattern(regex, sample) : null), [regex, sample, kind]);
  const regexInvalid = kind === "pattern" && regex !== "" && matches === null;

  async function persist(next: Policy) {
    setSaving(true);
    setNotice(null);
    try {
      const res = await fetch("/api/gw/admin/policy", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(next),
      });
      if (!res.ok) {
        const t = await res.text().catch(() => "");
        setError(`Speichern fehlgeschlagen: ${t || res.status}`);
        return false;
      }
      setError(null);
      setPolicy(next);
      setNotice("Gespeichert.");
      return true;
    } catch {
      setError("Gateway nicht erreichbar.");
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function add() {
    if (!policy) return;
    if (!label.trim()) { setError("Name fehlt."); return; }
    const entity: CustomEntity = { label: label.trim(), kind, action };
    if (kind === "pattern") {
      if (!regex) { setError("Muster fehlt (Beispielwert eingeben)."); return; }
      if (regexInvalid) { setError("Ungültiges Muster."); return; }
      entity.regex = regex;
      entity.score = 0.7;
      const ctx = context.split(",").map((s) => s.trim()).filter(Boolean);
      if (ctx.length) entity.context = ctx;
    } else {
      const vals = values.split("\n").map((s) => s.trim()).filter(Boolean);
      if (!vals.length) { setError("Keine Werte angegeben."); return; }
      entity.values = vals;
    }
    const next: Policy = {
      ...policy,
      version: policy.version + 1,
      custom_entities: [...(policy.custom_entities ?? []), entity],
    };
    const ok = await persist(next);
    if (ok) {
      setLabel(""); setExample(""); setRegex(""); setRegexEdited(false);
      setValues(""); setContext(""); setSample("");
    }
  }

  async function remove(idx: number) {
    if (!policy) return;
    const next: Policy = {
      ...policy,
      version: policy.version + 1,
      custom_entities: (policy.custom_entities ?? []).filter((_, i) => i !== idx),
    };
    await persist(next);
  }

  const list = policy?.custom_entities ?? [];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {error && <div className="glass" style={{ padding: "12px 16px", borderRadius: 14, color: "#e5484d", fontSize: 13 }}>{error}</div>}
      {notice && <div style={{ fontSize: 12.5, color: "var(--shield)" }}>{notice}</div>}

      {/* Existing */}
      <div className="glass" style={{ borderRadius: 18, padding: "16px 18px" }}>
        <div style={{ fontWeight: 600, marginBottom: 10 }}>Eigene Erkennungsregeln {list.length ? `(${list.length})` : ""}</div>
        {list.length === 0 && <div style={{ fontSize: 13, color: "var(--text-secondary)" }}>Noch keine eigenen Regeln. Unten hinzufügen.</div>}
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {list.map((c, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", padding: "9px 11px", borderRadius: 12, border: "1px solid var(--border-glass)" }}>
              <span style={{ fontWeight: 600, fontSize: 13.5 }}>{c.label}</span>
              <span style={{ fontSize: 11, color: "var(--text-secondary)", border: "1px solid var(--border-glass)", padding: "1px 8px", borderRadius: 999 }}>
                {c.kind === "pattern" ? "Muster" : "Liste"} · {c.action === "block" ? "blockieren" : "ersetzen"}
              </span>
              <code style={{ fontSize: 11.5, color: "var(--text-secondary)", fontFamily: "ui-monospace, monospace", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {c.kind === "pattern" ? c.regex : (c.values ?? []).join(", ")}
              </code>
              <button onClick={() => void remove(i)} disabled={saving} className="transition icon-ghost" style={{ border: "none", background: "transparent", color: "var(--text-secondary)", borderRadius: 8, padding: "2px 8px" }}>Entfernen</button>
            </div>
          ))}
        </div>
      </div>

      {/* Add form */}
      <div className="glass" style={{ borderRadius: 18, padding: "16px 18px", display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ fontWeight: 600 }}>Neue Regel</div>

        <Field label="Name">
          <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="z. B. Kundennummer" style={inp} />
        </Field>

        <div style={{ display: "inline-flex", gap: 4, padding: 3, borderRadius: 999, border: "1px solid var(--border-glass)", alignSelf: "flex-start" }}>
          {(["pattern", "deny_list"] as Kind[]).map((k) => (
            <button key={k} onClick={() => setKind(k)} className="transition" style={pill(kind === k)}>
              {k === "pattern" ? "Muster (Beispiel)" : "Feste Liste"}
            </button>
          ))}
        </div>

        {kind === "pattern" ? (
          <>
            <Field label="Beispielwert" hint="Ein echtes Beispiel — daraus wird die Form abgeleitet.">
              <input value={example} onChange={(e) => setExample(e.target.value)} placeholder="z. B. KD-12345" style={inp} />
            </Field>
            <Field label="Muster (automatisch, bearbeitbar)">
              <input
                value={regex}
                onChange={(e) => { setRegex(e.target.value); setRegexEdited(true); }}
                spellCheck={false}
                style={{ ...inp, fontFamily: "ui-monospace, monospace", fontSize: 12.5, color: regexInvalid ? "#e5484d" : "var(--text-primary)" }}
              />
            </Field>
            <Field label="Kontextwörter (optional, kommagetrennt)" hint="Erhöhen die Treffersicherheit, wenn sie in der Nähe stehen.">
              <input value={context} onChange={(e) => setContext(e.target.value)} placeholder="kunde, kundennummer, konto" style={inp} />
            </Field>
            <Field label="Test" hint="Sofortige Vorschau im Browser (vor dem Speichern).">
              <input value={sample} onChange={(e) => setSample(e.target.value)} placeholder="Text zum Testen eingeben…" style={inp} />
            </Field>
            {sample && (
              <div style={{ fontSize: 12.5, color: regexInvalid ? "#e5484d" : matches && matches.length ? "var(--shield)" : "var(--text-secondary)" }}>
                {regexInvalid ? "Ungültiges Muster." : matches && matches.length ? `${matches.length} Treffer: ${matches.join(", ")}` : "Keine Treffer."}
              </div>
            )}
          </>
        ) : (
          <Field label="Werte (einer pro Zeile)" hint="Genau diese Zeichenketten werden erkannt.">
            <textarea value={values} onChange={(e) => setValues(e.target.value)} rows={4} placeholder={"Projekt Kranich\nMüller Holding GmbH"} style={{ ...inp, resize: "vertical" }} />
          </Field>
        )}

        <Field label="Aktion">
          <div style={{ display: "inline-flex", gap: 4, padding: 3, borderRadius: 999, border: "1px solid var(--border-glass)" }}>
            {(["redact", "block"] as Action[]).map((a) => (
              <button key={a} onClick={() => setAction(a)} className="transition" style={pill(action === a)}>
                {a === "redact" ? "Ersetzen ([[CUSTOM_N]])" : "Anfrage blockieren"}
              </button>
            ))}
          </div>
        </Field>

        <button onClick={() => void add()} disabled={saving} className="transition btn-primary" style={{ alignSelf: "flex-start", padding: "9px 18px", borderRadius: 12, border: "none", fontWeight: 600 }}>
          {saving ? "Speichern…" : "Regel hinzufügen"}
        </button>
      </div>
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <span style={{ fontSize: 12.5, fontWeight: 600 }}>{label}</span>
      {children}
      {hint && <span style={{ fontSize: 11, color: "var(--text-secondary)" }}>{hint}</span>}
    </label>
  );
}

const inp: React.CSSProperties = {
  padding: "9px 12px",
  borderRadius: 10,
  border: "1px solid var(--border-glass)",
  background: "var(--surface-glass)",
  color: "var(--text-primary)",
  outline: "none",
  fontSize: 14,
};

function pill(active: boolean): React.CSSProperties {
  return {
    padding: "6px 13px",
    borderRadius: 999,
    fontSize: 12.5,
    fontWeight: 600,
    border: "none",
    background: active ? "color-mix(in srgb, var(--accent) 18%, transparent)" : "transparent",
    color: active ? "var(--accent)" : "var(--text-secondary)",
  };
}
