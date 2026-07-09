import { StreamUnredactor, type ResolveFn } from "./core.js";

/**
 * Max bytes we buffer while waiting for a newline. Protects against an upstream
 * that never sends `\n` (would otherwise grow the line buffer unbounded).
 * On overflow we force-flush the partial line as-is and reset.
 */
export const MAX_SSE_LINE_BYTES = 1024 * 1024; // 1 MiB

/** Pluggable per-provider SSE shape. */
export interface SSEFormat {
  /** Text delta carried by this parsed data object, or null if none. */
  extractDelta(obj: unknown): string | null;
  /** Write `text` back as this object's delta (mutates obj). */
  setDelta(obj: Record<string, unknown>, text: string): void;
  /** True if this raw data payload is the stream terminator. */
  isDone(dataPayload: string): boolean;
  /** A full SSE block carrying leftover `text` at flush time (or "" to skip). */
  makeFlushEvent(text: string): string;
}

/** OpenAI Chat Completions: `data: {choices:[{delta:{content}}]}`. */
export const openAIChatFormat: SSEFormat = {
  extractDelta(obj) {
    const o = obj as { choices?: Array<{ delta?: { content?: unknown } }> };
    const c = o.choices?.[0]?.delta?.content;
    return typeof c === "string" ? c : null;
  },
  setDelta(obj, text) {
    const o = obj as { choices?: Array<{ delta?: { content?: unknown } }> };
    if (o.choices?.[0]?.delta) o.choices[0].delta.content = text;
  },
  isDone: (p) => p.trim() === "[DONE]",
  makeFlushEvent(text) {
    if (!text) return "";
    const evt = {
      id: "unredact-flush",
      object: "chat.completion.chunk",
      choices: [{ index: 0, delta: { content: text }, finish_reason: null }],
    };
    return `data: ${JSON.stringify(evt)}\n\n`;
  },
};

/** Anthropic Messages: `content_block_delta` with `delta.text`. */
export const anthropicFormat: SSEFormat = {
  extractDelta(obj) {
    const o = obj as { type?: string; delta?: { type?: string; text?: unknown } };
    if (o.type === "content_block_delta" && typeof o.delta?.text === "string") {
      return o.delta.text;
    }
    return null;
  },
  setDelta(obj, text) {
    const o = obj as { delta?: { text?: unknown } };
    if (o.delta) o.delta.text = text;
  },
  // Anthropic terminates with a `message_stop` event, not `[DONE]`.
  isDone: (p) => {
    try {
      return (JSON.parse(p) as { type?: string }).type === "message_stop";
    } catch {
      return false;
    }
  },
  makeFlushEvent(text) {
    if (!text) return "";
    const evt = { type: "content_block_delta", index: 0, delta: { type: "text_delta", text } };
    return `event: content_block_delta\ndata: ${JSON.stringify(evt)}\n\n`;
  },
};

/**
 * Build a TransformStream that un-redacts an OpenAI-format or Anthropic-format
 * SSE byte stream. One StreamUnredactor instance spans the whole stream, so
 * placeholders split across SSE events (or chunks) resolve correctly.
 */
export function createSSEUnredactor(
  resolve: ResolveFn,
  format: SSEFormat,
): { stream: TransformStream<Uint8Array, Uint8Array>; unredactor: StreamUnredactor } {
  const unredactor = new StreamUnredactor(resolve);
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let buf = "";
  let done = false;

  const processLine = (line: string, ctrl: TransformStreamDefaultController<Uint8Array>) => {
    // Pass through blank lines and non-data lines (event:, id:, comments) verbatim.
    if (!line.startsWith("data:")) {
      ctrl.enqueue(encoder.encode(line + "\n"));
      return;
    }
    const payload = line.slice(5).replace(/^ /, "");
    if (format.isDone(payload)) {
      done = true;
      const rest = unredactor.flush();
      const flushEvt = format.makeFlushEvent(rest);
      if (flushEvt) ctrl.enqueue(encoder.encode(flushEvt));
      ctrl.enqueue(encoder.encode(line + "\n"));
      return;
    }
    let obj: unknown;
    try {
      obj = JSON.parse(payload);
    } catch {
      ctrl.enqueue(encoder.encode(line + "\n")); // not JSON — pass through untouched
      return;
    }
    const delta = format.extractDelta(obj);
    if (delta === null) {
      ctrl.enqueue(encoder.encode(line + "\n"));
      return;
    }
    const safe = unredactor.push(delta);
    format.setDelta(obj as Record<string, unknown>, safe);
    ctrl.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n`));
  };

  return {
    unredactor,
    stream: new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, ctrl) {
        buf += decoder.decode(chunk, { stream: true });
        let nl: number;
        while ((nl = buf.indexOf("\n")) !== -1) {
          const line = buf.slice(0, nl);
          buf = buf.slice(nl + 1);
          processLine(line, ctrl);
        }
        // Bounded buffer: force-flush an over-long partial line.
        if (buf.length > MAX_SSE_LINE_BYTES) {
          processLine(buf, ctrl);
          buf = "";
        }
      },
      flush(ctrl) {
        if (buf.length > 0) processLine(buf, ctrl);
        if (!done) {
          const rest = unredactor.flush();
          const flushEvt = format.makeFlushEvent(rest);
          if (flushEvt) ctrl.enqueue(encoder.encode(flushEvt));
        }
      },
    }),
  };
}

/** Whole-body (non-streaming) un-redaction: same grammar, same stats. */
export function unredactBody(
  text: string,
  resolve: ResolveFn,
): { text: string; stats: StreamUnredactor["stats"] } {
  const u = new StreamUnredactor(resolve);
  const out = u.push(text) + u.flush();
  return { text: out, stats: u.stats };
}
