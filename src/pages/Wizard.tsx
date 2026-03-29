import { useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";
import StepFTP from "../components/wizard/StepFTP";
import StepTMDB from "../components/wizard/StepTMDB";
import StepConfirm from "../components/wizard/StepConfirm";
import { t } from "../utils/i18n";
import type { AppLanguage } from "../utils/mediaLanguage";

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

export default function Wizard({ onComplete }: { onComplete: () => void }) {
  const [step, setStep] = useState(0);
  const language: AppLanguage = "es";
  const [restoring, setRestoring] = useState(false);
  const [restoreError, setRestoreError] = useState("");
  const [config, setConfig] = useState<Config>({
    ftp_host: "",
    ftp_port: 21,
    ftp_user: "",
    ftp_pass: "",
    ftp_root: "/",
    tmdb_api_key: "",
    default_language: "es",
    download_folder: "",
    folder_types: "{}",
    max_concurrent_downloads: 2,
    emby_url: "",
    emby_api_key: "",
    plex_url: "",
    plex_token: "",
    auto_check_updates: false,
    updater_endpoint: "",
    updater_pubkey: "",
  });

  const next = (partial: Partial<Config>) => {
    setConfig((c) => ({ ...c, ...partial }));
    setStep((current) => (typeof current === "number" ? current + 1 : 0));
  };

  const steps = [
    t(language, "wizard.stepFtp"),
    t(language, "wizard.stepTmdb"),
    t(language, "wizard.stepConfirm"),
  ];

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
      onComplete();
    } catch (error: any) {
      setRestoreError(String(error));
    } finally {
      setRestoring(false);
    }
  };

  return (
    <div
      style={{ maxWidth: 480, margin: "40px auto", fontFamily: "sans-serif" }}
    >
      {step === 0 ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div>
            <h1 style={{ margin: 0, fontSize: 28 }}>
              {t(language, "wizard.welcomeTitle")}
            </h1>
            <p style={{ margin: "8px 0 0", color: "#6b7280", lineHeight: 1.6 }}>
              {t(language, "wizard.welcomeDescription")}
            </p>
          </div>
          <button
            onClick={() => setStep(1)}
            style={{
              padding: "12px 18px",
              borderRadius: 10,
              border: "none",
              cursor: "pointer",
              background: "#2563eb",
              color: "#fff",
              fontWeight: 700,
              fontSize: 15,
              textAlign: "left",
            }}
          >
            {t(language, "wizard.startFresh")}
          </button>
          <button
            onClick={restoreBackup}
            disabled={restoring}
            style={{
              padding: "12px 18px",
              borderRadius: 10,
              border: "1px solid #d1d5db",
              cursor: restoring ? "not-allowed" : "pointer",
              background: "#fff",
              color: "#111827",
              fontWeight: 700,
              fontSize: 15,
              textAlign: "left",
            }}
          >
            {restoring
              ? t(language, "wizard.restoringBackup")
              : t(language, "wizard.restoreBackup")}
          </button>
          <p
            style={{
              margin: 0,
              color: "#6b7280",
              fontSize: 13,
              lineHeight: 1.6,
            }}
          >
            {t(language, "wizard.restoreHelp")}
          </p>
          {restoreError && (
            <div style={{ color: "#b91c1c", fontSize: 13, lineHeight: 1.5 }}>
              {restoreError}
            </div>
          )}
        </div>
      ) : (
        <>
          <div style={{ display: "flex", gap: 8, marginBottom: 24 }}>
            {steps.map((label, i) => (
              <span
                key={i}
                style={{
                  padding: "4px 12px",
                  borderRadius: 4,
                  background: i + 1 === step ? "#3b82f6" : "#e5e7eb",
                  color: i + 1 === step ? "#fff" : "#374151",
                  fontWeight: i + 1 === step ? 600 : 400,
                }}
              >
                {i + 1}. {label}
              </span>
            ))}
          </div>
          {step === 1 && (
            <StepFTP defaults={config} language={language} onNext={next} />
          )}
          {step === 2 && (
            <StepTMDB defaults={config} language={language} onNext={next} />
          )}
          {step === 3 && (
            <StepConfirm
              config={config}
              language={language}
              onComplete={onComplete}
            />
          )}
        </>
      )}
    </div>
  );
}
