/**
 * Tiny, dependency-free Markdown renderer for assistant messages.
 * Builds React nodes directly (no dangerouslySetInnerHTML → no XSS surface).
 * Covers the chat-relevant subset: code fences, inline code, bold, italic,
 * links, headings, bullet/numbered lists, paragraphs with soft line breaks.
 */
import type { ReactNode } from "react";

const INLINE: Array<{ re: RegExp; render: (m: RegExpMatchArray, key: string) => ReactNode }> = [
  { re: /`([^`]+)`/, render: (m, k) => <code key={k} className="md-code">{m[1]}</code> },
  { re: /\*\*([^*]+)\*\*/, render: (m, k) => <strong key={k}>{inline(m[1], k)}</strong> },
  { re: /__([^_]+)__/, render: (m, k) => <strong key={k}>{inline(m[1], k)}</strong> },
  { re: /\*([^*]+)\*/, render: (m, k) => <em key={k}>{inline(m[1], k)}</em> },
  { re: /(?<![A-Za-z0-9])_([^_]+)_(?![A-Za-z0-9])/, render: (m, k) => <em key={k}>{inline(m[1], k)}</em> },
  { re: /\[([^\]]+)\]\(([^)\s]+)\)/, render: (m, k) => <a key={k} href={m[2]} target="_blank" rel="noreferrer">{m[1]}</a> },
];

function inline(text: string, keyBase: string): ReactNode[] {
  const out: ReactNode[] = [];
  let rest = text;
  let n = 0;
  while (rest) {
    let best: { idx: number; len: number; node: ReactNode } | null = null;
    for (const p of INLINE) {
      const m = rest.match(p.re);
      if (m && m.index !== undefined && (!best || m.index < best.idx)) {
        best = { idx: m.index, len: m[0].length, node: p.render(m, `${keyBase}-${n}`) };
      }
    }
    if (!best) { out.push(rest); break; }
    if (best.idx > 0) out.push(rest.slice(0, best.idx));
    out.push(best.node);
    n++;
    rest = rest.slice(best.idx + best.len);
  }
  return out;
}

const LIST_RE = /^\s*([-*+]|\d+\.)\s+/;

export function Markdown({ text }: { text: string }) {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  let i = 0;
  let key = 0;

  while (i < lines.length) {
    const line = lines[i]!;

    // Fenced code block
    if (/^```/.test(line)) {
      const buf: string[] = [];
      i++;
      while (i < lines.length && !/^```\s*$/.test(lines[i]!)) { buf.push(lines[i]!); i++; }
      i++; // consume closing fence
      blocks.push(<pre key={key++} className="md-pre"><code>{buf.join("\n")}</code></pre>);
      continue;
    }

    // Heading
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      const lvl = h[1]!.length;
      blocks.push(
        <div key={key++} style={{ fontSize: 18 - (lvl - 1) * 1.5, fontWeight: 700, margin: "8px 0 2px" }}>
          {inline(h[2]!, `h${key}`)}
        </div>,
      );
      i++;
      continue;
    }

    // List
    if (LIST_RE.test(line)) {
      const ordered = /^\s*\d+\./.test(line);
      const items: string[] = [];
      while (i < lines.length && LIST_RE.test(lines[i]!)) {
        items.push(lines[i]!.replace(LIST_RE, ""));
        i++;
      }
      const inner = items.map((it, idx) => <li key={idx}>{inline(it, `li${key}-${idx}`)}</li>);
      blocks.push(ordered
        ? <ol key={key++} className="md-list">{inner}</ol>
        : <ul key={key++} className="md-list">{inner}</ul>);
      continue;
    }

    // Blank line
    if (line.trim() === "") { i++; continue; }

    // Paragraph (soft line breaks preserved)
    const para: string[] = [];
    while (
      i < lines.length &&
      lines[i]!.trim() !== "" &&
      !/^```/.test(lines[i]!) &&
      !/^(#{1,6})\s/.test(lines[i]!) &&
      !LIST_RE.test(lines[i]!)
    ) {
      para.push(lines[i]!);
      i++;
    }
    blocks.push(
      <p key={key++} className="md-p">
        {para.flatMap((pl, idx) =>
          idx === 0 ? inline(pl, `p${key}-${idx}`) : [<br key={`br${idx}`} />, ...inline(pl, `p${key}-${idx}`)],
        )}
      </p>,
    );
  }

  return <div className="md">{blocks}</div>;
}
