"use client";

import { useTheme } from "next-themes";
import { useEffect, useState } from "react";

export function ThemeToggle() {
  const { theme, setTheme, resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const current = mounted ? (theme === "system" ? resolvedTheme : theme) : undefined;

  return (
    <button
      aria-label="Toggle color theme"
      className="transition"
      onClick={() => setTheme(current === "dark" ? "light" : "dark")}
      style={{
        width: 40,
        height: 40,
        borderRadius: 12,
        border: "1px solid var(--border-glass)",
        background: "var(--surface-glass)",
        color: "var(--text-primary)",
        display: "grid",
        placeItems: "center",
      }}
    >
      {current === "dark" ? "☾" : "☀"}
    </button>
  );
}
