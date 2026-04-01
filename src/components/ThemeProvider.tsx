import { ThemeContext, useThemeProvider } from "../hooks/useTheme";

export default function ThemeProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const value = useThemeProvider();
  return (
    <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
  );
}
