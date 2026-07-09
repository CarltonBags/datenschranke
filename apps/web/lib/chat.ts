/** Client helpers: create conversations and stream messages from the gateway. */

/** Redaction span from the gateway — offsets into the user's OWN message, no value. */
export interface RedactionSpan {
  placeholder: string;
  type: string;
  start: number;
  end: number;
  custom_label?: string | null;
}

export interface ShieldInfo {
  entities: number;
  perType: Record<string, number>;
  spans?: RedactionSpan[];
  imageEntities?: number;
}

/** Resolved locally by the author from their own input — never fetched from server. */
export interface Redaction {
  value: string;
  placeholder: string;
  type: string;
  custom_label?: string | null;
}

export interface Protection {
  entities: number;
  perType: Record<string, number>;
  redactions: Redaction[];
  imageEntities?: number;
}

export interface Conversation {
  id: string;
  title: string | null;
  created_at: string;
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  images?: string[]; // data: URLs (author's attachments)
  protection?: Protection;
}

/** Map gateway spans → value pairs using the author's own message text. */
export function resolveRedactions(shield: ShieldInfo, authorText: string): Redaction[] {
  return (shield.spans ?? []).map((s) => ({
    value: authorText.slice(s.start, s.end),
    placeholder: s.placeholder,
    type: s.type,
    custom_label: s.custom_label ?? null,
  }));
}

export async function createConversation(title?: string): Promise<string> {
  const res = await fetch("/api/gw/conversations", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ title }),
  });
  if (!res.ok) throw new Error("failed to create conversation");
  return (await res.json()).id as string;
}

export async function listConversations(): Promise<Conversation[]> {
  const res = await fetch("/api/gw/conversations");
  if (!res.ok) return [];
  return (await res.json()).conversations as Conversation[];
}

export async function deleteConversation(id: string): Promise<void> {
  await fetch(`/api/gw/conversations/${id}`, { method: "DELETE" });
}

/**
 * Stream one assistant turn. Parses OpenAI SSE deltas AND our `: shield` comment
 * line. `onToken` is called with incremental text; `onShield` once with stats.
 */
export async function streamMessage(
  conversationId: string,
  messages: Array<{ role: string; content: string; images?: string[] }>,
  handlers: { onToken: (t: string) => void; onShield?: (s: ShieldInfo) => void; signal?: AbortSignal },
): Promise<void> {
  const res = await fetch(`/api/gw/conversations/${conversationId}/messages`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model: "gpt-4o", stream: true, messages }),
    signal: handlers.signal,
  });
  if (!res.ok || !res.body) {
    const err = await res.text().catch(() => "");
    throw new Error(err || `stream failed (${res.status})`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let nl: number;
    while ((nl = buf.indexOf("\n")) !== -1) {
      const line = buf.slice(0, nl);
      buf = buf.slice(nl + 1);
      if (line.startsWith(": shield ")) {
        try {
          handlers.onShield?.(JSON.parse(line.slice(9)) as ShieldInfo);
        } catch {
          /* ignore malformed shield line */
        }
        continue;
      }
      if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      if (payload === "" || payload === "[DONE]") continue;
      try {
        const obj = JSON.parse(payload) as { choices?: Array<{ delta?: { content?: string } }> };
        const token = obj.choices?.[0]?.delta?.content;
        if (token) handlers.onToken(token);
      } catch {
        /* ignore keep-alives / non-JSON */
      }
    }
  }
}
