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
        width: 36,
        height: 36,
        borderRadius: 999,
        border: hovered
          ? "1.5px solid var(--color-primary)"
          : "1.5px solid color-mix(in srgb, var(--color-primary) 55%, var(--color-border))",
        background: hovered
          ? "color-mix(in srgb, var(--color-primary) 20%, var(--color-surface-2))"
          : "color-mix(in srgb, var(--color-primary) 10%, var(--color-surface))",
        color: hovered
          ? "var(--color-primary)"
          : "color-mix(in srgb, var(--color-primary) 80%, var(--color-text-muted))",
        cursor: "pointer",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        boxShadow: hovered
          ? "0 0 0 3px color-mix(in srgb, var(--color-primary) 15%, transparent)"
          : "0 1px 4px color-mix(in srgb, black 18%, transparent)",
        transition:
          "background 0.15s ease, color 0.15s ease, border-color 0.15s ease, box-shadow 0.15s ease",
        flexShrink: 0,
      }}
    >
      <AppIcon name={getIcon(theme)} size={16} strokeWidth={2.2} />
    </button>
  );
}
