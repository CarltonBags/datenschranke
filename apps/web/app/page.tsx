"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { me, logout, type Me } from "../lib/auth";
import { ThemeToggle } from "../components/ThemeToggle";
import { RedactionPanel } from "../components/RedactionPanel";
import { ShieldIcon } from "../components/ShieldIcon";
import { Markdown } from "../components/Markdown";
import { ImagePlus, ArrowUp, StopSquare } from "../components/Icons";
import {
  createConversation,
  deleteConversation,
  fetchMessages,
  listConversations,
  resolveRedactions,
  streamMessage,
  type ChatMessage,
  type Conversation,
} from "../lib/chat";

export default function ChatPage() {
  const router = useRouter();
  const [user, setUser] = useState<Me | null>(null);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [attachments, setAttachments] = useState<string[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  // Per-conversation message history, in-memory for THIS session only. Message
  // text is never persisted server-side (raw PII) nor in localStorage (spec).
  const convStore = useRef<Record<string, ChatMessage[]>>({});
  // The conversation the UI is currently showing — used to ignore a late async
  // history fetch if the user has already switched away.
  const activeRef = useRef<string | null>(null);

  const MAX_IMAGES = 6;
  const MAX_BYTES = 5 * 1024 * 1024;

  function readFiles(files: FileList | File[]) {
    const imgs = Array.from(files).filter((f) => f.type.startsWith("image/"));
    for (const f of imgs) {
      if (f.size > MAX_BYTES) {
        setError(`Bild zu groß (max 5 MB): ${f.name}`);
        continue;
      }
      const reader = new FileReader();
      reader.onload = () =>
        setAttachments((cur) => (cur.length >= MAX_IMAGES ? cur : [...cur, String(reader.result)]));
      reader.readAsDataURL(f);
    }
  }

  useEffect(() => {
    // Gate: require a session. platform_admin has no chat workspace → console.
    me().then((m) => {
      if (!m) { router.push("/login"); return; }
      if (m.role === "platform_admin") { router.push("/platform"); return; }
      setUser(m);
      listConversations().then(setConversations).catch(() => {});
    });
  }, [router]);
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  async function refreshList() {
    setConversations(await listConversations().catch(() => []));
  }

  function newChat() {
    if (conversationId) convStore.current[conversationId] = messages;
    activeRef.current = null;
    setConversationId(null);
    setMessages([]);
    setError(null);
  }

  // Switch to an existing conversation: stash the current one, restore the target
  // from the in-memory store, or fetch its persisted history from the server
  // (server un-redacts for the author). Survives a full page reload.
  async function openConversation(id: string) {
    if (id === conversationId) return;
    if (conversationId) convStore.current[conversationId] = messages;
    activeRef.current = id;
    setConversationId(id);
    setError(null);
    const cached = convStore.current[id];
    if (cached) { setMessages(cached); return; }
    setMessages([]);
    const loaded = await fetchMessages(id).catch(() => []);
    convStore.current[id] = loaded;
    if (activeRef.current === id) setMessages(loaded); // ignore if user switched away
  }

  async function send() {
    const text = input.trim();
    const images = attachments;
    if ((!text && images.length === 0) || busy) return;
    setError(null);
    setInput("");
    setAttachments([]);

    let convId = conversationId;
    if (!convId) {
      convId = await createConversation((text || "Bild").slice(0, 40)).catch((e) => {
        setError(String(e));
        return null;
      });
      if (!convId) return;
      setConversationId(convId);
      void refreshList();
    }
    activeRef.current = convId;

    const userMsg: ChatMessage = { role: "user", content: text, ...(images.length ? { images } : {}) };
    const history = [...messages, userMsg];
    setMessages([...history, { role: "assistant", content: "" }]);
    setBusy(true);
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    try {
      await streamMessage(
        convId,
        history.map((m) => ({ role: m.role, content: m.content, ...(m.images ? { images: m.images } : {}) })),
        {
          signal: ctrl.signal,
          onShield: (shield) =>
            setMessages((cur) => {
              const copy = [...cur];
              // Reconstruct values LOCALLY from the author's own input.
              const redactions = resolveRedactions(shield, text);
              copy[copy.length - 1] = {
                ...copy[copy.length - 1]!,
                protection: { entities: shield.entities, perType: shield.perType, redactions, imageEntities: shield.imageEntities ?? 0 },
              };
              return copy;
            }),
          onToken: (token) =>
            setMessages((cur) => {
              const copy = [...cur];
              const last = copy[copy.length - 1]!;
              copy[copy.length - 1] = { ...last, content: last.content + token };
              return copy;
            }),
        },
      );
    } catch (e) {
      if ((e as Error).name !== "AbortError") setError(String((e as Error).message ?? e));
    } finally {
      setBusy(false);
      abortRef.current = null;
    }
  }

  function stop() {
    abortRef.current?.abort();
  }

  return (
    <div style={{ display: "grid", gridTemplateColumns: "290px 1fr", height: "100vh", gap: 0 }}>
      {/* Sidebar (glass surface) */}
      <aside className="glass" style={{ margin: 12, borderRadius: "var(--radius-xl)", padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <strong style={{ fontSize: 16, letterSpacing: "0.2px" }}>Datenschranke</strong>
          <ThemeToggle />
        </div>
        <button
          onClick={newChat}
          className="transition btn-primary"
          style={{ padding: "10px 12px", borderRadius: 12, border: "none", fontWeight: 600 }}
        >
          + Neuer Chat
        </button>
        <div style={{ overflowY: "auto", display: "flex", flexDirection: "column", gap: 4, flex: 1 }}>
          {conversations.map((c) => (
            <div
              key={c.id}
              className="transition"
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "8px 10px",
                borderRadius: 10,
                cursor: "pointer",
                background: c.id === conversationId ? "var(--surface-glass-strong)" : "transparent",
                border: "1px solid transparent",
              }}
              onClick={() => openConversation(c.id)}
            >
              <span style={{ fontSize: 13.5, color: "var(--text-secondary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {c.title || "Ohne Titel"}
              </span>
              <button
                aria-label="Delete conversation"
                onClick={async (e) => {
                  e.stopPropagation();
                  await deleteConversation(c.id);
                  if (c.id === conversationId) newChat();
                  void refreshList();
                }}
                style={{ border: "none", background: "transparent", color: "var(--text-secondary)" }}
              >
                ✕
              </button>
            </div>
          ))}
        </div>
        {user?.role === "tenant_admin" && (
          <a
            href="/admin"
            className="transition"
            style={{ display: "flex", alignItems: "center", gap: 8, padding: "9px 11px", borderRadius: 10, border: "1px solid var(--border-glass)", color: "var(--text-secondary)", textDecoration: "none", fontSize: 13.5 }}
          >
            <span aria-hidden>▤</span> Admin-Konsole
          </a>
        )}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, fontSize: 12, color: "var(--text-secondary)", borderTop: "1px solid var(--border-glass)", paddingTop: 10 }}>
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{user?.email}</span>
          <button
            onClick={async () => { await logout(); router.push("/login"); }}
            className="transition"
            style={{ border: "1px solid var(--border-glass)", background: "transparent", color: "var(--text-secondary)", borderRadius: 8, padding: "4px 10px", fontSize: 12, flexShrink: 0 }}
          >
            Abmelden
          </button>
        </div>
      </aside>

      {/* Main column */}
      <main style={{ position: "relative", display: "flex", flexDirection: "column", height: "100vh", padding: "12px 12px 12px 0" }}>
        {/* Warmwind-style top notch */}
        <div className="glass notch">
          <span className="dot" />
          Datenschranke
          <span style={{ opacity: 0.55, fontWeight: 400 }}>· geschützt</span>
        </div>
        <div ref={scrollRef} style={{ flex: 1, overflowY: "auto", padding: "48px 8px 16px" }}>
          <div
            style={{ maxWidth: 760, margin: "0 auto", display: "flex", flexDirection: "column", gap: 16 }}
          >
            {messages.length === 0 && (
              <div style={{ textAlign: "center", color: "var(--text-secondary)", marginTop: 90 }}>
                <div style={{ display: "inline-flex", color: "var(--shield)", marginBottom: 12, opacity: 0.9 }}>
                  <ShieldIcon size={38} />
                </div>
                <h1 style={{ fontSize: 22, margin: "0 0 6px", color: "var(--text-primary)" }}>Wie kann ich helfen?</h1>
                <p style={{ margin: 0, fontSize: 14 }}>Schreiben Sie normal — Namen, IBANs &amp; Co. bleiben geschützt.</p>
              </div>
            )}
            {messages.map((m, i) => (
              <div key={i} style={{ display: "flex", justifyContent: m.role === "user" ? "flex-end" : "flex-start" }}>
                <div
                  className={`msg-glass transition ${m.role === "user" ? "msg-user" : "msg-assistant"}`}
                  style={{
                    maxWidth: "85%",
                    padding: "12px 15px",
                    borderRadius: "var(--radius-lg)",
                    color: "var(--text-primary)",
                    whiteSpace: m.role === "user" ? "pre-wrap" : "normal",
                    lineHeight: 1.55,
                    fontSize: 14.5,
                  }}
                >
                  {m.images && m.images.length > 0 && (
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: m.content ? 8 : 0 }}>
                      {m.images.map((src, k) => (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img key={k} src={src} alt="Anhang" style={{ maxWidth: 180, maxHeight: 180, borderRadius: 10, display: "block" }} />
                      ))}
                    </div>
                  )}
                  {m.role === "assistant"
                    ? (m.content ? <Markdown text={m.content} /> : (busy ? "…" : null))
                    : m.content}
                  {m.role === "assistant" && m.protection && <RedactionPanel protection={m.protection} />}
                </div>
              </div>
            ))}
          </div>
        </div>

        {error && (
          <div style={{ maxWidth: 760, margin: "0 auto 8px", color: "#c0392b", fontSize: 13 }}>⚠ {error}</div>
        )}

        {/* Composer (glass surface) — supports drag/drop + paste of images */}
        <div
          className="glass transition"
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            if (e.dataTransfer.files?.length) readFiles(e.dataTransfer.files);
          }}
          style={{
            maxWidth: 760,
            margin: "0 auto",
            width: "100%",
            borderRadius: "var(--radius-xl)",
            padding: 8,
            display: "flex",
            flexDirection: "column",
            gap: 8,
            outline: dragOver ? "2px dashed var(--accent)" : "none",
            outlineOffset: -4,
          }}
        >
          {attachments.length > 0 && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, padding: "4px 6px 0" }}>
              {attachments.map((src, i) => (
                <div key={i} style={{ position: "relative" }}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={src} alt="Vorschau" style={{ width: 56, height: 56, objectFit: "cover", borderRadius: 8, border: "1px solid var(--border-glass)" }} />
                  <button
                    aria-label="Entfernen"
                    onClick={() => setAttachments((cur) => cur.filter((_, k) => k !== i))}
                    style={{ position: "absolute", top: -6, right: -6, width: 18, height: 18, borderRadius: 999, border: "none", background: "rgba(0,0,0,0.7)", color: "#fff", fontSize: 11, lineHeight: "18px", padding: 0 }}
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          )}

          <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              multiple
              hidden
              onChange={(e) => {
                if (e.target.files) readFiles(e.target.files);
                e.target.value = "";
              }}
            />
            <button
              aria-label="Bild anhängen"
              onClick={() => fileRef.current?.click()}
              className="transition icon-ghost"
              style={{ width: 40, height: 40, borderRadius: 12, border: "none", background: "transparent", color: "var(--text-secondary)", display: "grid", placeItems: "center", flexShrink: 0 }}
            >
              <ImagePlus size={20} />
            </button>
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onPaste={(e) => {
                const imgs = Array.from(e.clipboardData.files).filter((f) => f.type.startsWith("image/"));
                if (imgs.length) {
                  e.preventDefault();
                  readFiles(imgs);
                }
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void send();
                }
              }}
              placeholder="Nachricht schreiben oder Bild einfügen…"
              rows={1}
              style={{ flex: 1, resize: "none", maxHeight: 160, border: "none", background: "transparent", outline: "none", padding: "10px 12px", fontSize: 14.5 }}
            />
            {busy ? (
              <button
                aria-label="Stopp"
                onClick={stop}
                className="transition icon-ghost"
                style={{ width: 40, height: 40, borderRadius: 999, border: "1px solid var(--border-glass)", background: "transparent", color: "var(--text-primary)", display: "grid", placeItems: "center", flexShrink: 0 }}
              >
                <StopSquare size={18} />
              </button>
            ) : (
              <button
                aria-label="Senden"
                onClick={() => void send()}
                disabled={!input.trim() && attachments.length === 0}
                className="transition send-btn"
                style={{ width: 40, height: 40, borderRadius: 999, border: "none", color: "#fff", display: "grid", placeItems: "center", flexShrink: 0 }}
              >
                <ArrowUp size={20} />
              </button>
            )}
          </div>
          {attachments.length > 0 && (
            <p style={{ fontSize: 10.5, color: "var(--text-secondary)", margin: "0 6px", lineHeight: 1.4 }}>
              ⚠ Bildinhalte werden derzeit nicht auf personenbezogene Daten geprüft (nur Text).
            </p>
          )}
        </div>
      </main>
    </div>
  );
}
