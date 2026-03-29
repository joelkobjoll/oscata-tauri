import { useMemo, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";
import AppIcon from "../components/AppIcon";
import StepFTP from "../components/wizard/StepFTP";
import StepTMDB from "../components/wizard/StepTMDB";
import StepConfirm from "../components/wizard/StepConfirm";
import { t } from "../utils/i18n";
import { DEFAULT_FOLDER_TYPES_STRING, mergeInferredFolderTypes } from "../utils/folderTypes";
import type { AppLanguage } from "../utils/mediaLanguage";

const DEFAULT_FTP_ROOT = "/Compartida";

interface Config {
  ftp_host: string;
  ftp_port: number;
  ftp_user: string;
  ftp_pass: string;
  ftp_root: string;
  tmdb_api_key: string;
  default_language: "es" | "en";
  download_folder: string;
  folder_types: string;
  max_concurrent_downloads: number;
  emby_url: string;
  emby_api_key: string;
  plex_url: string;
  plex_token: string;
  auto_check_updates: boolean;
  updater_endpoint: string;
  updater_pubkey: string;
}

const shellCard: React.CSSProperties = {
  borderRadius: "calc(var(--radius-lg) + 6px)",
  border: "1px solid color-mix(in srgb, var(--color-border) 82%, transparent)",
  background:
    "linear-gradient(180deg, color-mix(in srgb, var(--color-surface) 97%, transparent), color-mix(in srgb, var(--color-surface-2) 94%, transparent))",
  boxShadow: "0 24px 80px color-mix(in srgb, black 30%, transparent)",
};

const sectionCard: React.CSSProperties = {
  borderRadius: "var(--radius-lg)",
  border: "1px solid color-mix(in srgb, var(--color-border) 76%, transparent)",
  background:
    "linear-gradient(180deg, color-mix(in srgb, var(--color-surface) 96%, transparent), color-mix(in srgb, var(--color-surface-2) 92%, transparent))",
  boxShadow:
    "0 14px 30px color-mix(in srgb, black 16%, transparent), inset 0 1px 0 color-mix(in srgb, white 4%, transparent)",
};

const subtextStyle: React.CSSProperties = {
  margin: 0,
  fontSize: 13,
  lineHeight: 1.6,
  color: "var(--color-text-muted)",
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

const responsiveOverviewGrid: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
  gap: 20,
  alignItems: "start",
};

const responsiveWizardGrid: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "minmax(260px, 300px) minmax(0, 1fr)",
  gap: 20,
  alignItems: "start",
};

function ChoiceCard({
  icon,
  title,
  description,
  emphasis = false,
  disabled = false,
  onClick,
}: {
  icon: "folder" | "download";
  title: string;
  description: string;
  emphasis?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        ...sectionCard,
        padding: "1.1rem",
        textAlign: "left",
        cursor: disabled ? "not-allowed" : "pointer",
        display: "grid",
        gap: 14,
        opacity: disabled ? 0.7 : 1,
        border: emphasis
          ? "1px solid color-mix(in srgb, var(--color-primary) 46%, transparent)"
          : sectionCard.border,
        background: emphasis
          ? "linear-gradient(180deg, color-mix(in srgb, var(--color-primary) 12%, var(--color-surface)), color-mix(in srgb, var(--color-surface-2) 92%, transparent))"
          : sectionCard.background,
      }}
    >
      <div
        style={{
          width: 42,
          height: 42,
          borderRadius: 14,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: emphasis ? "var(--color-primary)" : "var(--color-success)",
          background: emphasis
            ? "color-mix(in srgb, var(--color-primary) 16%, transparent)"
            : "color-mix(in srgb, var(--color-success) 16%, transparent)",
        }}
      >
        <AppIcon name={icon} size={18} strokeWidth={2.1} />
      </div>
      <div style={{ display: "grid", gap: 6 }}>
        <div
          style={{
            fontSize: 16,
            fontWeight: 800,
            color: "var(--color-text)",
            letterSpacing: "-0.02em",
          }}
        >
          {title}
        </div>
        <p style={subtextStyle}>{description}</p>
      </div>
    </button>
  );
}

export default function Wizard({
  onComplete,
}: {
  onComplete: (options?: { startIndexing?: boolean }) => void;
}) {
  const [step, setStep] = useState(0);
  const language: AppLanguage = "es";
  const [restoring, setRestoring] = useState(false);
  const [restoreError, setRestoreError] = useState("");
  const [config, setConfig] = useState<Config>({
    ftp_host: "",
    ftp_port: 21,
    ftp_user: "",
    ftp_pass: "",
    ftp_root: DEFAULT_FTP_ROOT,
    tmdb_api_key: "",
    default_language: "es",
    download_folder: "",
    folder_types: DEFAULT_FOLDER_TYPES_STRING,
    max_concurrent_downloads: 2,
    emby_url: "",
    emby_api_key: "",
    plex_url: "",
    plex_token: "",
    auto_check_updates: false,
    updater_endpoint: "",
    updater_pubkey: "",
  });

  const next = async (partial: Partial<Config>) => {
    const merged = { ...config, ...partial };

    if (step === 1) {
      try {
        const dirs = await invoke<string[]>("ftp_list_root_dirs_preview", {
          host: merged.ftp_host,
          port: merged.ftp_port,
          user: merged.ftp_user,
          pass: merged.ftp_pass,
          root: merged.ftp_root,
        });
        merged.folder_types = mergeInferredFolderTypes(merged.folder_types, dirs);
      } catch {
        // Leave folder mapping empty if FTP root inference is unavailable.
      }
    }

    setConfig(merged);
    setStep((current) => (typeof current === "number" ? current + 1 : 0));
  };

  const steps = useMemo(
    () => [
      {
        label: t(language, "wizard.stepFtp"),
        description: t(language, "settings.ftpDescription"),
        icon: "folder" as const,
      },
      {
        label: t(language, "wizard.stepTmdb"),
        description: t(language, "settings.metaDescription"),
        icon: "search" as const,
      },
      {
        label: t(language, "wizard.stepConfirm"),
        description: t(language, "wizard.confirmDescription"),
        icon: "settings" as const,
      },
    ],
    [language],
  );

  const restoreBackup = async () => {
    setRestoreError("");
    setRestoring(true);
    try {
      const selected = await open({
        multiple: false,
        filters: [
          { name: "SQLite", extensions: ["db", "sqlite", "sqlite3"] },
          { name: "All files", extensions: ["*"] },
        ],
      });
      if (typeof selected !== "string") return;
      await invoke("import_library_backup", { sourcePath: selected });
      onComplete({ startIndexing: false });
    } catch (error: any) {
      setRestoreError(String(error));
    } finally {
      setRestoring(false);
    }
  };

  const currentStep = step > 0 ? steps[step - 1] : null;

  return (
    <div
      style={{
        minHeight: "100dvh",
        padding: "clamp(1rem, 3vw, 2rem) clamp(1rem, 3vw, 1.5rem)",
        background:
          "radial-gradient(circle at top, color-mix(in srgb, var(--color-primary) 12%, transparent), transparent 42%), var(--color-bg)",
      }}
    >
      <div style={{ maxWidth: 1120, margin: "0 auto", display: "grid", gap: 20 }}>
        <section style={{ ...shellCard, padding: "1.35rem 1.5rem" }}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "flex-start",
              gap: 18,
              flexWrap: "wrap",
            }}
          >
            <div style={{ display: "flex", alignItems: "flex-start", gap: 14 }}>
              <div
                style={{
                  width: 46,
                  height: 46,
                  borderRadius: 14,
                  background:
                    "color-mix(in srgb, var(--color-primary) 16%, transparent)",
                  color: "var(--color-primary)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                }}
              >
                <AppIcon name="settings" size={20} strokeWidth={2.1} />
              </div>
              <div>
                <h1
                  style={{
                    margin: 0,
                    fontSize: 28,
                    fontWeight: 800,
                    letterSpacing: "-0.03em",
                    color: "var(--color-text)",
                  }}
                >
                  {t(language, "wizard.welcomeTitle")}
                </h1>
                <p style={{ ...subtextStyle, marginTop: 8, maxWidth: 760 }}>
                  {t(language, "wizard.welcomeDescription")}
                </p>
              </div>
            </div>

            {step > 0 && (
              <button
                onClick={() => setStep((current) => Math.max(0, current - 1))}
                style={ghostBtn}
              >
                <span style={{ transform: "rotate(180deg)", display: "inline-flex" }}>
                  <AppIcon name="chevron-right" size={14} strokeWidth={2.2} />
                </span>
                {t(language, "library.prev")}
              </button>
            )}
          </div>
        </section>

        {step === 0 ? (
          <div style={responsiveOverviewGrid}>
            <section style={{ ...shellCard, padding: "1.4rem 1.5rem" }}>
              <div style={{ display: "grid", gap: 16 }}>
                <div style={{ display: "grid", gap: 6 }}>
                  <h2
                    style={{
                      margin: 0,
                      fontSize: 24,
                      fontWeight: 800,
                      letterSpacing: "-0.03em",
                      color: "var(--color-text)",
                    }}
                  >
                    {t(language, "wizard.setupOverview")}
                  </h2>
                  <p style={subtextStyle}>{t(language, "settings.subtitle")}</p>
                </div>

                <div style={{ display: "grid", gap: 12 }}>
                  <div style={{ ...sectionCard, padding: "1rem" }}>
                    <div
                      style={{
                        fontSize: 13,
                        fontWeight: 700,
                        color: "var(--color-text)",
                        marginBottom: 4,
                      }}
                    >
                      {t(language, "wizard.stepFtp")}
                    </div>
                    <p style={subtextStyle}>{t(language, "settings.ftpDescription")}</p>
                  </div>
                  <div style={{ ...sectionCard, padding: "1rem" }}>
                    <div
                      style={{
                        fontSize: 13,
                        fontWeight: 700,
                        color: "var(--color-text)",
                        marginBottom: 4,
                      }}
                    >
                      {t(language, "wizard.stepTmdb")}
                    </div>
                    <p style={subtextStyle}>
                      {t(language, "settings.metaDescription")} {t(language, "settings.downloadsDescription")}
                    </p>
                  </div>
                  <div style={{ ...sectionCard, padding: "1rem" }}>
                    <div
                      style={{
                        fontSize: 13,
                        fontWeight: 700,
                        color: "var(--color-text)",
                        marginBottom: 4,
                      }}
                    >
                      {t(language, "wizard.stepConfirm")}
                    </div>
                    <p style={subtextStyle}>{t(language, "wizard.confirmDescription")}</p>
                  </div>
                </div>
              </div>
            </section>

            <section style={{ display: "grid", gap: 14 }}>
              <ChoiceCard
                icon="folder"
                emphasis
                title={t(language, "wizard.startFresh")}
                description={t(language, "wizard.startFreshDescription")}
                onClick={() => setStep(1)}
              />
              <ChoiceCard
                icon="download"
                title={restoring ? t(language, "wizard.restoringBackup") : t(language, "wizard.restoreBackup")}
                description={t(language, "wizard.restoreHelp")}
                disabled={restoring}
                onClick={restoreBackup}
              />
              {restoreError && (
                <div
                  style={{
                    ...sectionCard,
                    padding: "0.95rem 1rem",
                    color: "var(--color-danger)",
                    fontSize: 13,
                    lineHeight: 1.5,
                  }}
                >
                  {restoreError}
                </div>
              )}
            </section>
          </div>
        ) : (
          <div style={responsiveWizardGrid}>
            <aside style={{ display: "grid", gap: 16, alignSelf: "start", minWidth: 0 }}>
              <section style={{ ...shellCard, padding: "1rem" }}>
                <div style={{ display: "grid", gap: 10 }}>
                  {steps.map((item, index) => {
                    const isActive = index + 1 === step;
                    const isDone = index + 1 < step;
                    return (
                      <div
                        key={item.label}
                        style={{
                          ...sectionCard,
                          padding: "0.9rem",
                          border: isActive
                            ? "1px solid color-mix(in srgb, var(--color-primary) 44%, transparent)"
                            : sectionCard.border,
                          background: isActive
                            ? "linear-gradient(180deg, color-mix(in srgb, var(--color-primary) 10%, var(--color-surface)), color-mix(in srgb, var(--color-surface-2) 92%, transparent))"
                            : sectionCard.background,
                          opacity: isDone || isActive ? 1 : 0.72,
                        }}
                      >
                        <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                          <div
                            style={{
                              width: 34,
                              height: 34,
                              borderRadius: 12,
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              color: isDone
                                ? "var(--color-success)"
                                : isActive
                                  ? "var(--color-primary)"
                                  : "var(--color-text-muted)",
                              background: isDone
                                ? "color-mix(in srgb, var(--color-success) 14%, transparent)"
                                : isActive
                                  ? "color-mix(in srgb, var(--color-primary) 14%, transparent)"
                                  : "color-mix(in srgb, var(--color-surface-2) 88%, transparent)",
                              flexShrink: 0,
                            }}
                          >
                            {isDone ? (
                              <AppIcon name="check" size={16} strokeWidth={2.6} />
                            ) : (
                              <AppIcon name={item.icon} size={16} strokeWidth={2.1} />
                            )}
                          </div>
                          <div style={{ minWidth: 0 }}>
                            <div
                              style={{
                                fontSize: 13,
                                fontWeight: 700,
                                color: "var(--color-text)",
                                marginBottom: 3,
                              }}
                            >
                              {index + 1}. {item.label}
                            </div>
                            <p style={subtextStyle}>{item.description}</p>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>

              <section style={{ ...shellCard, padding: "1rem" }}>
                <div
                  style={{
                    fontSize: 13,
                    fontWeight: 800,
                    letterSpacing: "0.06em",
                    textTransform: "uppercase",
                    color: "var(--color-text-muted)",
                    marginBottom: 10,
                  }}
                >
                  {t(language, "wizard.summaryTitle")}
                </div>
                <div style={{ display: "grid", gap: 10 }}>
                  <div style={{ ...sectionCard, padding: "0.85rem", minWidth: 0 }}>
                    <div style={{ fontSize: 12, color: "var(--color-text-muted)", marginBottom: 4 }}>
                      {t(language, "wizard.stepFtp")}
                    </div>
                    <div
                      style={{
                        fontSize: 13,
                        fontWeight: 700,
                        color: "var(--color-text)",
                        overflowWrap: "anywhere",
                        wordBreak: "break-word",
                        lineHeight: 1.35,
                      }}
                    >
                      {config.ftp_host ? `${config.ftp_user || "user"}@${config.ftp_host}:${config.ftp_port}` : "—"}
                    </div>
                    <div
                      style={{
                        ...subtextStyle,
                        marginTop: 4,
                        overflowWrap: "anywhere",
                        wordBreak: "break-word",
                      }}
                    >
                      {config.ftp_root || "/"}
                    </div>
                  </div>
                  <div style={{ ...sectionCard, padding: "0.85rem", minWidth: 0 }}>
                    <div style={{ fontSize: 12, color: "var(--color-text-muted)", marginBottom: 4 }}>
                      {t(language, "wizard.stepTmdb")}
                    </div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: "var(--color-text)" }}>
                      {config.tmdb_api_key ? t(language, "wizard.tmdbConfigured") : "—"}
                    </div>
                    <div style={{ ...subtextStyle, marginTop: 4 }}>
                      {t(language, "settings.defaultLanguage")}: {config.default_language === "en" ? t(language, "common.languageEnglish") : t(language, "common.languageSpanish")}
                    </div>
                  </div>
                  <div style={{ ...sectionCard, padding: "0.85rem", minWidth: 0 }}>
                    <div style={{ fontSize: 12, color: "var(--color-text-muted)", marginBottom: 4 }}>
                      {t(language, "settings.downloadsTitle")}
                    </div>
                    <div
                      style={{
                        fontSize: 13,
                        fontWeight: 700,
                        color: "var(--color-text)",
                        overflowWrap: "anywhere",
                        wordBreak: "break-word",
                        lineHeight: 1.35,
                      }}
                    >
                      {config.download_folder || "—"}
                    </div>
                    <div style={{ ...subtextStyle, marginTop: 4 }}>
                      {t(language, "settings.maxConcurrent")}: {config.max_concurrent_downloads}
                    </div>
                  </div>
                </div>
              </section>
            </aside>

            <section style={{ ...shellCard, overflow: "hidden", alignSelf: "start", minWidth: 0 }}>
              <div
                style={{
                  padding: "1.2rem 1.35rem 1rem",
                  borderBottom:
                    "1px solid color-mix(in srgb, var(--color-border) 72%, transparent)",
                }}
              >
                <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
                  <div
                    style={{
                      width: 40,
                      height: 40,
                      borderRadius: 13,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      color: "var(--color-primary)",
                      background:
                        "color-mix(in srgb, var(--color-primary) 16%, transparent)",
                      flexShrink: 0,
                    }}
                  >
                    {currentStep && <AppIcon name={currentStep.icon} size={18} strokeWidth={2.1} />}
                  </div>
                  <div>
                    <h2
                      style={{
                        margin: 0,
                        fontSize: 20,
                        fontWeight: 800,
                        letterSpacing: "-0.02em",
                        color: "var(--color-text)",
                      }}
                    >
                      {currentStep?.label}
                    </h2>
                    <p style={{ ...subtextStyle, marginTop: 6 }}>{currentStep?.description}</p>
                  </div>
                </div>
              </div>

              <div style={{ padding: "1.25rem 1.35rem 1.35rem" }}>
                {step === 1 && <StepFTP defaults={config} language={language} onNext={next} />}
                {step === 2 && <StepTMDB defaults={config} language={language} onNext={next} />}
                {step === 3 && (
                  <StepConfirm config={config} language={language} onComplete={onComplete} />
                )}
              </div>
            </section>
          </div>
        )}
      </div>
    </div>
  );
}
