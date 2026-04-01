import { useState, useEffect } from "react";

type ThemeMode = "dark" | "light" | "system";
type ResolvedTheme = "dark" | "light";
const STORAGE_KEY = "oscata-theme";

function getSystemTheme(): ResolvedTheme {
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

function applyTheme(resolved: ResolvedTheme): void {
  document.documentElement.setAttribute("data-theme", resolved);
}

function readStoredTheme(): ThemeMode {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored === "light" || stored === "dark" || stored === "system")
    return stored;
  return "system";
}

interface UseThemeResult {
  theme: ThemeMode;
  resolvedTheme: ResolvedTheme;
  setTheme: (theme: ThemeMode) => void;
}

export function useTheme(): UseThemeResult {
  const [theme, setThemeState] = useState<ThemeMode>(() => readStoredTheme());

  const resolvedTheme: ResolvedTheme =
    theme === "system" ? getSystemTheme() : theme;

  useEffect(() => {
    applyTheme(resolvedTheme);
    localStorage.setItem(STORAGE_KEY, theme);
  }, [theme, resolvedTheme]);

  useEffect(() => {
    if (theme !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = () => {
      applyTheme(mq.matches ? "dark" : "light");
    };
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, [theme]);

  const setTheme = (next: ThemeMode) => {
    setThemeState(next);
  };

  return { theme, resolvedTheme, setTheme };
}
