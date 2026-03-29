import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import Wizard from "./pages/Wizard";
import Library from "./pages/Library";
import { t } from "./utils/i18n";
import type { AppLanguage } from "./utils/mediaLanguage";

export default function Router() {
  const [ready, setReady] = useState<boolean | null>(null);
  const language: AppLanguage = "es";

  useEffect(() => {
    invoke<boolean>("has_config").then(setReady).catch(() => setReady(false));
  }, []);

  if (ready === null) return (
    <div style={{ height: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "var(--color-bg)" }}>
      <div style={{ color: "var(--color-text-muted)", fontSize: 14 }}>{t(language, "router.loading")}</div>
    </div>
  );
  return ready ? <Library /> : <Wizard onComplete={() => setReady(true)} />;
}
