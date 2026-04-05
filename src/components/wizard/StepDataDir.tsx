import { useEffect, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";
import AppIcon from "../AppIcon";
import Toggle from "../Toggle";
import type { AppLanguage } from "../../utils/mediaLanguage";
import { t } from "../../utils/i18n";

const sectionCard: React.CSSProperties = {
  borderRadius: "var(--radius-lg)",
  border: "1px solid color-mix(in srgb, var(--color-border) 76%, transparent)",
  background:
    "linear-gradient(180deg, color-mix(in srgb, var(--color-surface) 96%, transparent), color-mix(in srgb, var(--color-surface-2) 92%, transparent))",
  boxShadow:
    "0 14px 30px color-mix(in srgb, black 16%, transparent), inset 0 1px 0 color-mix(in srgb, white 4%, transparent)",
  padding: "1rem",
};

const subtextStyle: React.CSSProperties = {
  fontSize: 12,
  lineHeight: 1.5,
  color: "var(--color-text-muted)",
};

const pathBox: React.CSSProperties = {
  padding: "0.7rem 0.9rem",
  borderRadius: "var(--radius)",
  border: "1px solid color-mix(in srgb, var(--color-border) 78%, transparent)",
  background: "color-mix(in srgb, var(--color-surface-2) 84%, transparent)",
  color: "var(--color-text)",
  fontSize: 13,
  fontFamily: "monospace",
  wordBreak: "break-all",
  minHeight: 38,
  display: "flex",
  alignItems: "center",
};

const primaryBtn = (disabled?: boolean): React.CSSProperties => ({
  padding: "9px 18px",
  borderRadius: "var(--radius-full)",
  border: "none",
  background: disabled
    ? "color-mix(in srgb, var(--color-primary) 46%, transparent)"
    : "var(--color-primary)",
  color: "#fff",
  cursor: disabled ? "not-allowed" : "pointer",
  fontSize: 13,
  fontWeight: 600,
  display: "inline-flex",
  alignItems: "center",
  gap: 8,
  transition: "background 0.15s ease",
});

const ghostBtn: React.CSSProperties = {
  padding: "9px 14px",
  borderRadius: "var(--radius-full)",
  border: "1px solid color-mix(in srgb, var(--color-border) 80%, transparent)",
  background: "color-mix(in srgb, var(--color-surface) 88%, transparent)",
  color: "var(--color-text-muted)",
  cursor: "pointer",
  fontSize: 13,
  fontWeight: 600,
  display: "inline-flex",
  alignItems: "center",
  gap: 8,
};

interface StepDataDirProps {
  language: AppLanguage;
  onNext: (partial: Record<string, never>) => void;
}

export default function StepDataDir({ language, onNext }: StepDataDirProps) {
  const [defaultDir, setDefaultDir] = useState<string>("");
  const [useDefault, setUseDefault] = useState(true);
  const [customDir, setCustomDir] = useState<string>("");
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");

  useEffect(() => {
    invoke<string>("get_db_path")
      .then(setDefaultDir)
      .catch(() => {});
  }, []);

  const pickFolder = async () => {
    try {
      const selected = await open({ directory: true, multiple: false });
      if (typeof selected === "string" && selected) {
        setCustomDir(selected);
      }
    } catch {
      // user cancelled
    }
  };

  const handleNext = async () => {
    setSaving(true);
    setErrorMsg("");
    try {
      const dir = useDefault ? null : customDir || null;
      if (dir) {
        await invoke("init_db_path", { dir });
      }
      onNext({});
    } catch (err: unknown) {
      setErrorMsg(String(err));
    } finally {
      setSaving(false);
    }
  };

  const displayPath = useDefault ? defaultDir : customDir || defaultDir;

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <div style={{ ...sectionCard, padding: "1rem 1.05rem" }}>
        <div
          style={{
            fontSize: 15,
            fontWeight: 700,
            color: "var(--color-text)",
            marginBottom: 6,
          }}
        >
          {t(language, "wizard.dataDir")}
        </div>
        <p style={{ ...subtextStyle, margin: 0 }}>
          {t(language, "wizard.dataDirDesc")}
        </p>
      </div>

      <div style={{ ...sectionCard, display: "grid", gap: 14 }}>
        {/* Toggle — use default */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 10,
          }}
        >
          <span style={{ fontSize: 13, color: "var(--color-text)" }}>
            {t(language, "wizard.dataDirDefault")}
          </span>
          <Toggle checked={useDefault} onChange={setUseDefault} />
        </div>

        {/* Path display */}
        <div style={pathBox}>
          <span style={{ opacity: displayPath ? 1 : 0.45 }}>
            {displayPath || "…"}
          </span>
        </div>

        {/* Folder picker — only shown when useDefault is false */}
        {!useDefault && (
          <button style={ghostBtn} onClick={pickFolder} type="button">
            <AppIcon name="folder" size={14} strokeWidth={2.2} />
            {t(language, "settings.changeLocation")}
          </button>
        )}
      </div>

      {errorMsg && (
        <p style={{ margin: 0, fontSize: 12, color: "var(--color-danger)" }}>
          {errorMsg}
        </p>
      )}

      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <button
          style={primaryBtn(saving || (!useDefault && !customDir))}
          disabled={saving || (!useDefault && !customDir)}
          onClick={handleNext}
          type="button"
        >
          {saving ? (
            <AppIcon name="refresh-cw" size={14} strokeWidth={2.2} />
          ) : (
            <AppIcon name="chevron-right" size={14} strokeWidth={2.2} />
          )}
          {t(language, "wizard.next")}
        </button>
      </div>
    </div>
  );
}
