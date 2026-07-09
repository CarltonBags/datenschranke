/**
 * Background "Schlieren" — soft flamingo / pink / blue gradient blobs that drift
 * slowly behind the glass UI (warmwind-style). Pure CSS, no image. Fixed, behind
 * everything, non-interactive. Animation disabled under prefers-reduced-motion
 * (handled globally in globals.css).
 */
export function Aurora() {
  return (
    <div aria-hidden className="aurora">
      <span className="blob blob-1" />
      <span className="blob blob-2" />
      <span className="blob blob-3" />
      <span className="blob blob-4" />
      <div className="aurora-veil" />
    </div>
  );
}
