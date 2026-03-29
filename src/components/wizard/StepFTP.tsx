import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { AppLanguage } from "../../utils/mediaLanguage";
import { t } from "../../utils/i18n";

const fieldStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 4,
  marginBottom: 12,
};
const inputStyle: React.CSSProperties = {
  padding: "6px 10px",
  border: "1px solid #d1d5db",
  borderRadius: 4,
  fontSize: 14,
};
const btnStyle = (disabled?: boolean): React.CSSProperties => ({
  padding: "8px 16px",
  borderRadius: 4,
  border: "none",
  cursor: disabled ? "not-allowed" : "pointer",
  background: disabled ? "#9ca3af" : "#3b82f6",
  color: "#fff",
  fontWeight: 600,
  marginTop: 4,
});

export default function StepFTP({ defaults, language, onNext }: { defaults: any; language: AppLanguage; onNext: (p: any) => void }) {
  const [form, setForm] = useState(defaults);
  const [status, setStatus] = useState<"idle" | "testing" | "ok" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState("");

  const set = (key: string) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f: any) => ({ ...f, [key]: key === "ftp_port" ? Number(e.target.value) : e.target.value }));

  const test = async () => {
    setStatus("testing");
    setErrorMsg("");
    try {
      await invoke("test_ftp_connection", {
        host: form.ftp_host,
        port: form.ftp_port,
        user: form.ftp_user,
        pass: form.ftp_pass,
      });
      setStatus("ok");
    } catch (e: any) {
      setErrorMsg(String(e));
      setStatus("error");
    }
  };

  return (
    <form onSubmit={(e) => { e.preventDefault(); onNext(form); }}>
      <div style={fieldStyle}>
        <label>{t(language, "wizard.host")}</label>
        <input style={inputStyle} value={form.ftp_host} onChange={set("ftp_host")} required />
      </div>
      <div style={fieldStyle}>
        <label>{t(language, "wizard.port")}</label>
        <input style={inputStyle} type="number" value={form.ftp_port} onChange={set("ftp_port")} />
      </div>
      <div style={fieldStyle}>
        <label>{t(language, "wizard.username")}</label>
        <input style={inputStyle} value={form.ftp_user} onChange={set("ftp_user")} required />
      </div>
      <div style={fieldStyle}>
        <label>{t(language, "wizard.password")}</label>
        <input style={inputStyle} type="password" value={form.ftp_pass} onChange={set("ftp_pass")} />
      </div>
      <div style={fieldStyle}>
        <label>{t(language, "wizard.rootPath")}</label>
        <input style={inputStyle} value={form.ftp_root} onChange={set("ftp_root")} placeholder="/" />
      </div>

      <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 8 }}>
        <button type="button" style={btnStyle(status === "testing")} onClick={test} disabled={status === "testing"}>
          {status === "testing" ? t(language, "common.testing") : t(language, "wizard.testConnection")}
        </button>
        {status === "ok" && <span style={{ color: "#16a34a" }}>✓ {t(language, "common.connected")}</span>}
        {status === "error" && (
          <span style={{ color: "#dc2626" }}>✗ {errorMsg || t(language, "wizard.failedCredentials")}</span>
        )}
      </div>

      <div style={{ marginTop: 16 }}>
        <button type="submit" style={btnStyle(status !== "ok")} disabled={status !== "ok"}>
          {t(language, "wizard.next")}
        </button>
      </div>
    </form>
  );
}
