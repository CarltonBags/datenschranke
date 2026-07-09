"use client";

import { useState } from "react";
import type { Protection } from "../lib/chat";
import { ShieldIcon } from "./ShieldIcon";

const TYPE_LABEL: Record<string, string> = {
  PERSON: "Name",
  EMAIL: "E-Mail",
  PHONE: "Telefon",
  IBAN: "IBAN",
  ADDRESS: "Adresse",
  ORG: "Organisation",
  LOCATION: "Ort",
  DATE: "Datum",
  ID: "Ausweis/ID",
  MISC: "Sonstiges",
  CUSTOM: "Eigene Regel",
};

/**
 * Per-message transparency: what was cut out of the request and re-inserted in
 * the reply. Values are reconstructed CLIENT-SIDE from the author's own input;
 * the server only ever sent placeholder + offset + type.
 */
export function RedactionPanel({ protection }: { protection: Protection }) {
  const [open, setOpen] = useState(false);
  const imageEntities = protection.imageEntities ?? 0;
  const total = protection.entities + imageEntities;
  if (total === 0) {
    return (
      <div style={{ marginTop: 8, fontSize: 12, color: "var(--text-secondary)", display: "inline-flex", gap: 6, alignItems: "center" }}>
        <ShieldIcon size={13} /> Keine personenbezogenen Daten erkannt
      </div>
    );
  }

  return (
    <div style={{ marginTop: 10 }}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="transition"
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 7,
          fontSize: 12.5,
          padding: "4px 11px",
          borderRadius: 999,
          border: "1px solid color-mix(in srgb, var(--shield) 40%, transparent)",
          background: "color-mix(in srgb, var(--shield) 12%, transparent)",
          color: "var(--shield)",
          fontWeight: 600,
        }}
      >
        <ShieldIcon size={14} />
        {total} {total === 1 ? "Angabe" : "Angaben"} geschützt
        {imageEntities > 0 && <span style={{ opacity: 0.75, fontWeight: 400 }}>· 🖼 {imageEntities}</span>}
        <span style={{ opacity: 0.6, fontWeight: 400 }}>{open ? "▾" : "▸"}</span>
      </button>

      {open && (
        <div
          className="glass"
          style={{ marginTop: 8, borderRadius: 14, padding: "10px 12px", fontSize: 12.5 }}
        >
          <div style={{ color: "var(--text-secondary)", marginBottom: 8, lineHeight: 1.5 }}>
            Diese Werte wurden vor dem Versand an das KI-Modell ersetzt und in der Antwort
            wieder eingesetzt. Das Modell sah nur die Platzhalter.
          </div>
          {imageEntities > 0 && (
            <div style={{ marginBottom: protection.redactions.length ? 10 : 0, paddingBottom: protection.redactions.length ? 10 : 0, borderBottom: protection.redactions.length ? "1px solid var(--border-glass)" : "none", display: "flex", gap: 7, alignItems: "flex-start" }}>
              <span aria-hidden>🖼</span>
              <span>
                {imageEntities} {imageEntities === 1 ? "Bildbereich" : "Bildbereiche"} mit personenbezogenen Daten wurden im Bild
                geschwärzt, bevor es an das Modell ging. Bildschwärzungen sind endgültig (keine Wiederherstellung).
              </span>
            </div>
          )}
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {protection.redactions.map((r, i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <span style={{ fontWeight: 600 }}>{r.value || "—"}</span>
                <span style={{ color: "var(--text-secondary)" }}>→</span>
                <code
                  style={{
                    fontFamily: "ui-monospace, monospace",
                    fontSize: 11.5,
                    padding: "1px 6px",
                    borderRadius: 6,
                    background: "var(--surface-glass-strong)",
                    border: "1px solid var(--border-glass)",
                  }}
                >
                  {r.placeholder}
                </code>
                <span
                  style={{
                    fontSize: 10.5,
                    color: "var(--text-secondary)",
                    padding: "1px 7px",
                    borderRadius: 999,
                    border: "1px solid var(--border-glass)",
                  }}
                >
                  {r.custom_label || TYPE_LABEL[r.type] || r.type}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
