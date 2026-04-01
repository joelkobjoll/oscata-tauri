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
  return "Auto (system) — click for dark";
}

function getIcon(theme: ThemeMode): "moon" | "sun" | "monitor" {
  if (theme === "dark") return "moon";
  if (theme === "light") return "sun";
  return "monitor";
}

export default function ThemeToggle() {
  const { theme, setTheme } = useTheme();
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
        border: "1.5px solid var(--color-border)",
        background: hovered ? "var(--color-surface-2)" : "var(--color-surface)",
        color: hovered ? "var(--color-text)" : "var(--color-text-muted)",
        cursor: "pointer",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        boxShadow:
          "0 1px 4px color-mix(in srgb, black 14%, transparent), inset 0 1px 0 color-mix(in srgb, white 6%, transparent)",
        transition:
          "background 0.15s ease, color 0.15s ease, border-color 0.15s ease",
        flexShrink: 0,
        position: "relative",
      }}
    >
      <AppIcon name={getIcon(theme)} size={16} strokeWidth={2.2} />
    </button>
  );
}
