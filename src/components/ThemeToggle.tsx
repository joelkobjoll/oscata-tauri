import { useState } from "react";
import { useTheme } from "../hooks/useTheme";
import AppIcon from "./AppIcon";

type ThemeMode = "dark" | "light" | "system";

const CYCLE: ThemeMode[] = ["system", "dark", "light"];

function getNextTheme(current: ThemeMode): ThemeMode {
  const idx = CYCLE.indexOf(current);
  return CYCLE[(idx + 1) % CYCLE.length];
}

function getTitle(theme: ThemeMode): string {
  if (theme === "dark") return "Dark mode — click for light";
  if (theme === "light") return "Light mode — click for system";
  return "System theme — click for dark";
}

export default function ThemeToggle() {
  const { theme, resolvedTheme, setTheme } = useTheme();
  const [hovered, setHovered] = useState(false);

  return (
    <button
      onClick={() => setTheme(getNextTheme(theme))}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      title={getTitle(theme)}
      style={{
        width: 40,
        height: 40,
        borderRadius: 999,
        border:
          "1px solid color-mix(in srgb, var(--color-border) 84%, transparent)",
        background: hovered
          ? "color-mix(in srgb, var(--color-surface-2) 94%, transparent)"
          : "color-mix(in srgb, var(--color-surface) 94%, transparent)",
        color: hovered ? "var(--color-text)" : "var(--color-text-muted)",
        cursor: "pointer",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        boxShadow: "inset 0 1px 0 color-mix(in srgb, white 4%, transparent)",
        transition: "background 0.15s ease, color 0.15s ease",
        flexShrink: 0,
        position: "relative",
      }}
    >
      <AppIcon
        name={resolvedTheme === "dark" ? "moon" : "sun"}
        size={16}
        strokeWidth={2.2}
      />
      {theme === "system" && (
        <span
          style={{
            position: "absolute",
            bottom: 4,
            right: 4,
            width: 6,
            height: 6,
            borderRadius: 999,
            background: "var(--color-primary)",
          }}
        />
      )}
    </button>
  );
}
