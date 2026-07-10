"use client";

/**
 * Admin console — audit log viewer (DPO/CISO view). Separate from the chat UI.
 * Shows EVERY gateway request across both products (chat + API proxy): what the
 * anonymizer removed (entity types + counts), policy block decisions, and what
 * the de-anonymizer re-inserted. Per invariant #1 the audit log — and therefore
 * this screen — never contains raw PII values, only types/counts/placeholders.
 *
 * Data comes from the gateway `GET /api/admin/audit` via the server proxy
 * (`/api/gw/...`), which injects the tenant identity. No gateway creds here.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ThemeToggle } from "../../components/ThemeToggle";

type Payload = Record<string, unknown>;
interface AuditEvent {
  id: string;
  event_type: string;
  actor: string;
  conversation_id: string | null;
  payload: Payload;
  created_at: string;
}

const TYPE_META: Record<string, { label: string; color: string }> = {
  "request.redacted": { label: "Redigiert", color: "var(--shield)" },
  "request.blocked": { label: "Blockiert", color: "#e5484d" },
  "response.unredacted": { label: "Wiederhergestellt", color: "var(--accent)" },
  "policy.updated": { label: "Policy geändert", color: "#a07cff" },
  "apikey.created": { label: "API-Key erstellt", color: "#a07cff" },
  "map.deleted": { label: "Map gelöscht", color: "#e0913a" },
  "auth.login": { label: "Login", color: "var(--text-secondary)" },
};

const ENTITY_LABEL: Record<string, string> = {
  PERSON: "Name", EMAIL: "E-Mail", PHONE: "Telefon", IBAN: "IBAN",
  ADDRESS: "Adresse", ORG: "Organisation", LOCATION: "Ort", DATE: "Datum",
  ID: "Ausweis/ID", MISC: "Sonstiges", CUSTOM: "Eigene Regel",
};

const RANGES: Array<{ label: string; ms: number | null }> = [
  { label: "15 min", ms: 15 * 60_000 },
  { label: "1 h", ms: 60 * 60_000 },
  { label: "24 h", ms: 24 * 60 * 60_000 },
  { label: "Alle", ms: null },
];

function fromParam(rangeMs: number | null): string | undefined {
  if (rangeMs == null) return undefined;
  return new Date(Date.now() - rangeMs).toISOString();
}

export default function AdminPage() {
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [typeFilter, setTypeFilter] = useState<string>("");
  const [rangeMs, setRangeMs] = useState<number | null>(60 * 60_000);
  const [live, setLive] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      const from = fromParam(rangeMs);
      if (from) params.set("from", from);
      if (typeFilter) params.set("type", typeFilter);
      const res = await fetch(`/api/gw/admin/audit?${params.toString()}`, { cache: "no-store" });
      if (!res.ok) {
        setError(res.status === 401 ? "Kein Tenant konfiguriert (DEMO_TENANT_ID)." : `Fehler ${res.status}`);
        return;
      }
      const data = (await res.json()) as { events: AuditEvent[] };
      setEvents(data.events ?? []);
      setError(null);
    } catch {
      setError("Gateway nicht erreichbar.");
    } finally {
      setLoading(false);
    }
  }, [rangeMs, typeFilter]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (timer.current) clearInterval(timer.current);
    if (live) timer.current = setInterval(() => void load(), 4000);
    return () => { if (timer.current) clearInterval(timer.current); };
  }, [live, load]);

  const stats = useMemo(() => {
    let redacted = 0, blocked = 0, entities = 0, images = 0;
    for (const e of events) {
      if (e.event_type === "request.redacted") {
        redacted++;
        entities += Number(e.payload.entity_count ?? 0);
        images += Number(e.payload.image_entities ?? 0);
      } else if (e.event_type === "request.blocked") blocked++;
    }
    return { total: events.length, redacted, blocked, entities, images };
  }, [events]);

  const csvHref = useMemo(() => {
    const params = new URLSearchParams({ format: "csv" });
    const from = fromParam(rangeMs);
    if (from) params.set("from", from);
    if (typeFilter) params.set("type", typeFilter);
    return `/api/gw/admin/audit?${params.toString()}`;
  }, [rangeMs, typeFilter]);

  return (
    <main style={{ height: "100vh", overflow: "auto", padding: "0 clamp(16px, 4vw, 48px) 64px", position: "relative", zIndex: 1 }}>
      <header style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap", padding: "22px 0 18px", position: "sticky", top: 0, zIndex: 3 }}>
        <div className="glass" style={{ flex: 1, display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap", padding: "12px 18px", borderRadius: 16 }}>
          <div style={{ fontWeight: 700, fontSize: 17, letterSpacing: 0.2 }}>Datenschranke</div>
          <span style={{ fontSize: 12, color: "var(--text-secondary)", border: "1px solid var(--border-glass)", padding: "2px 9px", borderRadius: 999 }}>
            Admin · Audit-Log
          </span>
          <div style={{ flex: 1 }} />
          <a href="/" style={{ fontSize: 13, color: "var(--text-secondary)", textDecoration: "none" }}>← Chat</a>
          <ThemeToggle />
        </div>
      </header>

      {/* Summary cards */}
      <section style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 12, marginBottom: 16 }}>
        <StatCard label="Ereignisse" value={stats.total} />
        <StatCard label="Redigierte Anfragen" value={stats.redacted} accent="var(--shield)" />
        <StatCard label="Geschützte Angaben" value={stats.entities} accent="var(--shield)" hint={stats.images ? `+ ${stats.images} im Bild` : undefined} />
        <StatCard label="Blockiert" value={stats.blocked} accent={stats.blocked ? "#e5484d" : undefined} />
      </section>

      {/* Controls */}
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", marginBottom: 14 }}>
        <div style={{ display: "inline-flex", gap: 4, padding: 3, borderRadius: 999, border: "1px solid var(--border-glass)", background: "var(--surface-glass)" }}>
          {RANGES.map((r) => (
            <button key={r.label} onClick={() => setRangeMs(r.ms)} className="transition"
              style={pill(rangeMs === r.ms)}>{r.label}</button>
          ))}
        </div>

        <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}
          style={{ padding: "7px 12px", borderRadius: 999, border: "1px solid var(--border-glass)", background: "var(--surface-glass)", color: "var(--text-primary)" }}>
          <option value="">Alle Ereignistypen</option>
          {Object.entries(TYPE_META).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>

        <button onClick={() => setLive((v) => !v)} className="transition" style={pill(live)}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <span style={{ width: 7, height: 7, borderRadius: 999, background: live ? "var(--shield)" : "var(--text-secondary)" }} />
            Live
          </span>
        </button>

        <div style={{ flex: 1 }} />
        <a href={csvHref} download="audit.csv" style={{ ...pill(false), textDecoration: "none", display: "inline-block" }}>CSV Export</a>
        <button onClick={() => void load()} className="transition" style={pill(false)}>{loading ? "…" : "↻"}</button>
      </div>

      {error && (
        <div className="glass" style={{ padding: "12px 16px", borderRadius: 14, marginBottom: 14, color: "#e5484d", fontSize: 13 }}>{error}</div>
      )}

      {/* Event feed */}
      <div className="glass" style={{ borderRadius: 18, overflow: "hidden" }}>
        {events.length === 0 && !error && (
          <div style={{ padding: 40, textAlign: "center", color: "var(--text-secondary)", fontSize: 14 }}>
            Keine Ereignisse im gewählten Zeitraum.
          </div>
        )}
        {events.map((e) => (
          <EventRow key={e.id} event={e} open={expanded === e.id} onToggle={() => setExpanded(expanded === e.id ? null : e.id)} />
        ))}
      </div>
      <p style={{ fontSize: 11.5, color: "var(--text-secondary)", marginTop: 12, lineHeight: 1.6 }}>
        Hinweis: Das Audit-Log speichert ausschließlich Entitätstypen, Platzhalter und Kennzahlen — niemals
        die tatsächlichen personenbezogenen Werte. Diese verlassen die Datenschranke nie.
      </p>
    </main>
  );
}

function StatCard({ label, value, accent, hint }: { label: string; value: number; accent?: string; hint?: string }) {
  return (
    <div className="glass" style={{ padding: "14px 16px", borderRadius: 16 }}>
      <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>{label}</div>
      <div style={{ fontSize: 26, fontWeight: 700, color: accent ?? "var(--text-primary)", lineHeight: 1.2 }}>{value}</div>
      {hint && <div style={{ fontSize: 11, color: "var(--text-secondary)" }}>{hint}</div>}
    </div>
  );
}

function EventRow({ event, open, onToggle }: { event: AuditEvent; open: boolean; onToggle: () => void }) {
  const meta = TYPE_META[event.event_type] ?? { label: event.event_type, color: "var(--text-secondary)" };
  const time = new Date(event.created_at);
  return (
    <div style={{ borderTop: "1px solid var(--border-glass)" }}>
      <button onClick={onToggle} className="transition"
        style={{ width: "100%", display: "flex", alignItems: "center", gap: 12, padding: "11px 16px", background: "transparent", border: "none", textAlign: "left", color: "inherit" }}>
        <span style={{ fontSize: 11.5, color: "var(--text-secondary)", fontVariantNumeric: "tabular-nums", minWidth: 66 }}>
          {time.toLocaleTimeString("de-DE")}
        </span>
        <span style={{ fontSize: 12, fontWeight: 600, color: meta.color, border: `1px solid color-mix(in srgb, ${meta.color} 40%, transparent)`, background: `color-mix(in srgb, ${meta.color} 12%, transparent)`, padding: "2px 9px", borderRadius: 999, whiteSpace: "nowrap" }}>
          {meta.label}
        </span>
        <span style={{ flex: 1, fontSize: 13, color: "var(--text-secondary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          <Summary event={event} />
        </span>
        <span style={{ fontSize: 11, color: "var(--text-secondary)" }}>{event.actor}</span>
        <span style={{ fontSize: 11, color: "var(--text-secondary)", opacity: 0.6 }}>{open ? "▾" : "▸"}</span>
      </button>
      {open && (
        <pre style={{ margin: 0, padding: "10px 16px 16px 94px", fontSize: 11.5, color: "var(--text-secondary)", fontFamily: "ui-monospace, monospace", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
          {JSON.stringify(event.payload, null, 2)}
          {event.conversation_id ? `\n\nconversation: ${event.conversation_id}` : ""}
        </pre>
      )}
    </div>
  );
}

/** One-line human summary per event type. Types/counts only. */
function Summary({ event }: { event: AuditEvent }) {
  const p = event.payload;
  switch (event.event_type) {
    case "request.redacted": {
      const perType = (p.per_type ?? {}) as Record<string, number>;
      const chips = Object.entries(perType);
      const product = p.product === "proxy" ? "API-Proxy" : "Chat";
      return (
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
          <span style={{ color: "var(--text-primary)" }}>{Number(p.entity_count ?? 0)} geschützt</span>
          <span>· {product} · {String(p.provider ?? "")}</span>
          {chips.map(([t, n]) => (
            <span key={t} style={{ fontSize: 10.5, padding: "1px 7px", borderRadius: 999, border: "1px solid var(--border-glass)", color: "var(--text-secondary)" }}>
              {ENTITY_LABEL[t] ?? t} {n}
            </span>
          ))}
          {Number(p.image_entities ?? 0) > 0 && <span>· 🖼 {Number(p.image_entities)}</span>}
        </span>
      );
    }
    case "response.unredacted":
      return <span>{Number(p.replaced ?? 0)} Platzhalter zurückgesetzt · {Number(p.latency_ms ?? 0)} ms · {String(p.provider ?? "")}{Number(p.unknown ?? 0) ? ` · ${Number(p.unknown)} unbekannt` : ""}</span>;
    case "request.blocked":
      return <span style={{ color: "#e5484d" }}>Blockiert: {String(p.reason ?? "")} {p.entity_type ? `(${p.entity_type})` : ""}</span>;
    case "policy.updated":
      return <span>Policy → v{String(p.policy_version ?? "")}</span>;
    case "apikey.created":
      return <span>Key {String(p.prefix ?? "")} · {String(p.name ?? "")}</span>;
    default:
      return <span>{JSON.stringify(p).slice(0, 80)}</span>;
  }
}

function pill(active: boolean): React.CSSProperties {
  return {
    padding: "6px 13px",
    borderRadius: 999,
    fontSize: 12.5,
    fontWeight: 600,
    border: active ? "1px solid color-mix(in srgb, var(--accent) 45%, transparent)" : "1px solid var(--border-glass)",
    background: active ? "color-mix(in srgb, var(--accent) 18%, transparent)" : "var(--surface-glass)",
    color: active ? "var(--accent)" : "var(--text-primary)",
  };
}
