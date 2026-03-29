import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { AppLanguage } from "../../utils/mediaLanguage";
import { t } from "../../utils/i18n";

const inputStyle: React.CSSProperties = {
  padding: "6px 10px",
  border: "1px solid #d1d5db",
  borderRadius: 4,
  fontSize: 14,
  width: "100%",
  boxSizing: "border-box",
};
const btnStyle = (disabled?: boolean): React.CSSProperties => ({
  padding: "8px 16px",
  borderRadius: 4,
  border: "none",
  cursor: disabled ? "not-allowed" : "pointer",
  background: disabled ? "#9ca3af" : "#3b82f6",
  color: "#fff",
  fontWeight: 600,
});

export default function StepTMDB({ defaults, language, onNext }: { defaults: any; language: AppLanguage; onNext: (p: any) => void }) {
  const [key, setKey] = useState<string>(defaults.tmdb_api_key ?? "");
  const [status, setStatus] = useState<"idle" | "testing" | "ok" | "error">("idle");

  const test = async () => {
    setStatus("testing");
    const ok = await invoke<boolean>("test_tmdb_key", { apiKey: key }).catch(() => false);
    setStatus(ok ? "ok" : "error");
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <p style={{ margin: 0, color: "#6b7280", fontSize: 14 }}>
        {t(language, "wizard.tmdbHelp")}{" "}
        <a href="https://www.themoviedb.org/settings/api" target="_blank" rel="noreferrer">
          themoviedb.org
        </a>
      </p>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <label>{t(language, "wizard.tmdbKey")}</label>
        <input
          style={inputStyle}
          value={key}
          onChange={(e) => setKey(e.target.value)}
          placeholder={t(language, "wizard.tmdbPlaceholder")}
        />
      </div>

      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <button style={btnStyle(status === "testing")} onClick={test} disabled={status === "testing"}>
          {status === "testing" ? t(language, "wizard.validating") : t(language, "wizard.validateKey")}
        </button>
        {status === "ok" && <span style={{ color: "#16a34a" }}>{t(language, "wizard.validKey")}</span>}
        {status === "error" && <span style={{ color: "#dc2626" }}>{t(language, "wizard.invalidKey")}</span>}
      </div>

      <button
        style={{ ...btnStyle(status !== "ok"), marginTop: 8 }}
        onClick={() => onNext({ tmdb_api_key: key })}
        disabled={status !== "ok"}
      >
        {t(language, "wizard.next")}
      </button>
    </div>
  );
}
