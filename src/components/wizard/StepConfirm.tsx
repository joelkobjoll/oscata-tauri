import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import AppIcon from "../AppIcon";
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

const successBtn = (disabled?: boolean): React.CSSProperties => ({
  ...ghostBtn,
  border: "none",
  background: disabled ? "color-mix(in srgb, var(--color-success) 46%, transparent)" : "var(--color-success)",
  color: "#fff",
  cursor: disabled ? "not-allowed" : "pointer",
});

const subtextStyle: React.CSSProperties = {
  fontSize: 12,
  lineHeight: 1.5,
  color: "var(--color-text-muted)",
};

const responsiveSummaryGrid: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
  gap: 16,
};

function SummaryCard({
  icon,
  title,
  children,
}: {
  icon: "folder" | "search" | "download";
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section style={sectionCard}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 12, marginBottom: 10 }}>
        <div
          style={{
            width: 38,
            height: 38,
            borderRadius: 12,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "var(--color-primary)",
            background: "color-mix(in srgb, var(--color-primary) 16%, transparent)",
            flexShrink: 0,
          }}
        >
          <AppIcon name={icon} size={18} strokeWidth={2.1} />
        </div>
        <div>
          <div style={{ fontSize: 15, fontWeight: 700, color: "var(--color-text)" }}>{title}</div>
        </div>
      </div>
      <div style={{ display: "grid", gap: 8 }}>{children}</div>
    </section>
  );
}

export default function StepConfirm({
  config,
  language,
  onComplete,
}: {
  config: any;
  language: AppLanguage;
  onComplete: () => void;
}) {
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    await invoke("save_config", { config });
    invoke("start_indexing");
    onComplete();
  };

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <div style={{ ...sectionCard, padding: "1rem 1.05rem" }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: "var(--color-text)", marginBottom: 6 }}>
          {t(language, "wizard.confirmTitle")}
        </div>
        <p style={{ ...subtextStyle, margin: 0 }}>{t(language, "wizard.confirmDescription")}</p>
      </div>

      <div style={responsiveSummaryGrid}>
        <SummaryCard icon="folder" title={t(language, "wizard.stepFtp")}>
          <div style={{ fontSize: 13, fontWeight: 700, color: "var(--color-text)" }}>
            {config.ftp_user}@{config.ftp_host}:{config.ftp_port}
          </div>
          <div style={subtextStyle}>{config.ftp_root}</div>
        </SummaryCard>

        <SummaryCard icon="search" title={t(language, "wizard.stepTmdb")}>
          <div style={{ fontSize: 13, fontWeight: 700, color: "var(--color-text)" }}>
            {t(language, "wizard.tmdbConfigured")}
          </div>
          <div style={subtextStyle}>
            {t(language, "settings.defaultLanguage")}: {config.default_language === "en" ? t(language, "common.languageEnglish") : t(language, "common.languageSpanish")}
          </div>
        </SummaryCard>

        <SummaryCard icon="download" title={t(language, "settings.downloadsTitle")}>
          <div style={{ fontSize: 13, fontWeight: 700, color: "var(--color-text)" }}>
            {config.download_folder || t(language, "settings.downloadFolderPlaceholder")}
          </div>
          <div style={subtextStyle}>
            {t(language, "settings.maxConcurrent")}: {config.max_concurrent_downloads}
          </div>
        </SummaryCard>
      </div>

      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <button onClick={save} disabled={saving} style={successBtn(saving)}>
          <AppIcon name="check" size={15} strokeWidth={2.4} />
          {saving ? t(language, "common.saving") : t(language, "wizard.saveAndStart")}
        </button>
      </div>
    </div>
  );
}
