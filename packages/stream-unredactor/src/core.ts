import {
  COMPLETE_PLACEHOLDER,
  MAX_PLACEHOLDER_LENGTH,
  couldBePlaceholderPrefix,
} from "@gdpr/shared/placeholder";

/**
 * Resolve a complete placeholder string (e.g. "[[PERSON_1]]") to its original
 * value. Return `undefined` for an unknown placeholder — the un-redactor then
 * passes the placeholder through untouched (and records it as "unknown").
 */
export type ResolveFn = (placeholder: string) => string | undefined;

export interface UnredactStats {
  replaced: number;
  unknown: number;
  unknownPlaceholders: string[];
}

/**
 * Incremental placeholder → value replacement over a chunked character stream.
 *
 * Invariant: never emit a byte that could still turn out to be part of a
 * placeholder. On each push we hold back the shortest trailing suffix that
 * `couldBePlaceholderPrefix`, emit everything before it (resolving any COMPLETE
 * placeholders found there), and carry the tail to the next push.
 *
 * This works regardless of how the upstream splits placeholders across chunks
 * (the CLAUDE.md invariant: the provider mock deliberately splits them).
 */
export class StreamUnredactor {
  private held = "";
  readonly stats: UnredactStats = { replaced: 0, unknown: 0, unknownPlaceholders: [] };
  private readonly unknownSeen = new Set<string>();

  constructor(private readonly resolve: ResolveFn) {}

  /** Feed a chunk of text; returns the text safe to emit right now. */
  push(chunk: string): string {
    if (chunk.length === 0) return "";
    this.held += chunk;
    const boundary = this.safeBoundary(this.held);
    const emittable = this.held.slice(0, boundary);
    this.held = this.held.slice(boundary);
    return this.resolveComplete(emittable);
  }

  /** Call once the stream ends; emits whatever is left (resolving completes). */
  flush(): string {
    const out = this.resolveComplete(this.held);
    this.held = "";
    return out;
  }

  /**
   * Smallest index `i` such that held.slice(i) could still grow into a
   * placeholder. Everything before `i` is safe to emit. Only positions within
   * the last MAX_PLACEHOLDER_LENGTH chars can start an incomplete placeholder.
   */
  private safeBoundary(held: string): number {
    const start = Math.max(0, held.length - MAX_PLACEHOLDER_LENGTH);
    for (let j = start; j < held.length; j++) {
      if (held.charCodeAt(j) !== 0x5b /* '[' */) continue;
      if (couldBePlaceholderPrefix(held.slice(j))) return j;
    }
    return held.length;
  }

  private resolveComplete(text: string): string {
    if (text.length === 0) return "";
    return text.replace(COMPLETE_PLACEHOLDER, (match) => {
      const value = this.resolve(match);
      if (value === undefined) {
        if (!this.unknownSeen.has(match)) {
          this.unknownSeen.add(match);
          this.stats.unknownPlaceholders.push(match);
        }
        this.stats.unknown += 1;
        return match; // pass unknown placeholder through untouched
      }
      this.stats.replaced += 1;
      return value;
    });
  }
}
