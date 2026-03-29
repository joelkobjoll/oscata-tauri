import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { AppLanguage } from "../../utils/mediaLanguage";
import { t } from "../../utils/i18n";

export default function StepConfirm({ config, language, onComplete }: { config: any; language: AppLanguage; onComplete: () => void }) {
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    await invoke("save_config", { config });
    invoke("start_indexing"); // fire and forget — events drive UI
    onComplete();
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <h2 style={{ margin: 0 }}>{t(language, "wizard.confirmTitle")}</h2>
      <ul style={{ margin: 0, paddingLeft: 20, lineHeight: 1.8 }}>
        <li>
          FTP: {config.ftp_user}@{config.ftp_host}:{config.ftp_port}
          {config.ftp_root}
        </li>
        <li>{t(language, "wizard.tmdbConfigured")}</li>
      </ul>
      <button
        onClick={save}
        disabled={saving}
        style={{
          padding: "10px 20px",
          borderRadius: 4,
          border: "none",
          cursor: saving ? "not-allowed" : "pointer",
          background: saving ? "#9ca3af" : "#16a34a",
          color: "#fff",
          fontWeight: 600,
          fontSize: 15,
        }}
      >
        {saving ? t(language, "common.saving") : t(language, "wizard.saveAndStart")}
      </button>
    </div>
  );
}
