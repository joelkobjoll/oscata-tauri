import { useState } from "react";
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
    setStep((s) => s + 1);
  };

  const steps = [t(language, "wizard.stepFtp"), t(language, "wizard.stepTmdb"), t(language, "wizard.stepConfirm")];

  return (
    <div style={{ maxWidth: 480, margin: "40px auto", fontFamily: "sans-serif" }}>
      <div style={{ display: "flex", gap: 8, marginBottom: 24 }}>
        {steps.map((label, i) => (
          <span
            key={i}
            style={{
              padding: "4px 12px",
              borderRadius: 4,
              background: i === step ? "#3b82f6" : "#e5e7eb",
              color: i === step ? "#fff" : "#374151",
              fontWeight: i === step ? 600 : 400,
            }}
          >
            {i + 1}. {label}
          </span>
        ))}
      </div>
      {step === 0 && <StepFTP defaults={config} language={language} onNext={next} />}
      {step === 1 && <StepTMDB defaults={config} language={language} onNext={next} />}
      {step === 2 && <StepConfirm config={config} language={language} onComplete={onComplete} />}
    </div>
  );
}
