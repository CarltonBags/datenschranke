/** Lucide icons, inlined (MIT). Same paths as lucide-react — no runtime dep,
 *  works in an offline VPC build. Inherit `currentColor`, sized via `size`. */
import type { ReactNode } from "react";

function Svg({ size = 20, children }: { size?: number; children: ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      style={{ display: "block" }}
    >
      {children}
    </svg>
  );
}

/** lucide: image-plus */
export function ImagePlus({ size }: { size?: number }) {
  return (
    <Svg size={size}>
      <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7" />
      <path d="M16 5h6" />
      <path d="M19 2v6" />
      <circle cx="9" cy="9" r="2" />
      <path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" />
    </Svg>
  );
}

/** lucide: arrow-up */
export function ArrowUp({ size }: { size?: number }) {
  return (
    <Svg size={size}>
      <path d="m5 12 7-7 7 7" />
      <path d="M12 19V5" />
    </Svg>
  );
}

/** lucide: square (filled — stop) */
export function StopSquare({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden style={{ display: "block" }}>
      <rect x="7" y="7" width="10" height="10" rx="2.5" fill="currentColor" />
    </svg>
  );
}
