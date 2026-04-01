import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import AppIcon from "../AppIcon";
import type { AppLanguage } from "../../utils/mediaLanguage";
import { t } from "../../utils/i18n";

const fieldStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 6,
};

const labelStyle: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 700,
  letterSpacing: "0.04em",
  textTransform: "uppercase",
  color: "var(--color-text-muted)",
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  padding: "0.72rem 0.9rem",
  borderRadius: "var(--radius)",
  border: "1px solid color-mix(in srgb, var(--color-border) 78%, transparent)",
  background: "color-mix(in srgb, var(--color-surface-2) 84%, transparent)",
  color: "var(--color-text)",
  fontSize: 14,
  outline: "none",
  boxShadow: "inset 0 1px 0 color-mix(in srgb, white 4%, transparent)",
};

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

const ghostBtn = (disabled?: boolean): React.CSSProperties => ({
  padding: "9px 14px",
  borderRadius: "var(--radius-full)",
  border: "1px solid color-mix(in srgb, var(--color-border) 80%, transparent)",
  background: "color-mix(in srgb, var(--color-surface) 88%, transparent)",
  color: "var(--color-text-muted)",
  cursor: disabled ? "not-allowed" : "pointer",
  fontSize: 13,
  fontWeight: 600,
  display: "inline-flex",
  alignItems: "center",
  gap: 8,
  opacity: disabled ? 0.7 : 1,
});

const primaryBtn = (disabled?: boolean): React.CSSProperties => ({
  ...ghostBtn(disabled),
  border: "none",
  background: disabled
    ? "color-mix(in srgb, var(--color-primary) 46%, transparent)"
    : "var(--color-primary)",
  color: "#fff",
});

const responsivePairGrid: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
  gap: 12,
};

export default function StepFTP({
  defaults,
  language,
  onNext,
  transitioning = false,
}: {
  defaults: any;
  language: AppLanguage;
  onNext: (p: any) => void;
  transitioning?: boolean;
}) {
  const [form, setForm] = useState(defaults);
  const [status, setStatus] = useState<"idle" | "testing" | "ok" | "error">(
    defaults.ftp_host ? "ok" : "idle",
  );
  const [errorMsg, setErrorMsg] = useState("");

  const set = (key: string) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f: any) => ({
      ...f,
      [key]: key === "ftp_port" ? Number(e.target.value) : e.target.value,
    }));

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
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onNext(form);
      }}
      style={{ display: "grid", gap: 16 }}
    >
      <section style={sectionCard}>
        <div style={{ display: "grid", gap: 14 }}>
          <div
            style={{
              ...responsivePairGrid,
              gridTemplateColumns: "minmax(0, 1fr) minmax(120px, 180px)",
            }}
          >
            <div style={fieldStyle}>
              <label style={labelStyle}>{t(language, "wizard.host")}</label>
              <input
                style={inputStyle}
                value={form.ftp_host}
                onChange={set("ftp_host")}
                required
              />
            </div>
            <div style={fieldStyle}>
              <label style={labelStyle}>{t(language, "wizard.port")}</label>
              <input
                style={inputStyle}
                type="number"
                value={form.ftp_port}
                onChange={set("ftp_port")}
              />
            </div>
          </div>

          <div style={responsivePairGrid}>
            <div style={fieldStyle}>
              <label style={labelStyle}>{t(language, "wizard.username")}</label>
              <input
                style={inputStyle}
                value={form.ftp_user}
                onChange={set("ftp_user")}
                required
              />
            </div>
            <div style={fieldStyle}>
              <label style={labelStyle}>{t(language, "wizard.password")}</label>
              <input
                style={inputStyle}
                type="password"
                value={form.ftp_pass}
                onChange={set("ftp_pass")}
              />
            </div>
          </div>

          <div style={fieldStyle}>
            <label style={labelStyle}>{t(language, "wizard.rootPath")}</label>
            <input
              style={inputStyle}
              value={form.ftp_root}
              onChange={set("ftp_root")}
              placeholder="/Compartida"
            />
            <span style={subtextStyle}>
              {t(language, "settings.ftpDescription")}
            </span>
          </div>
        </div>
      </section>

      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 10,
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 10,
            alignItems: "center",
          }}
        >
          <button
            type="button"
            style={ghostBtn(status === "testing")}
            onClick={test}
            disabled={status === "testing"}
          >
            <AppIcon name="activity" size={15} strokeWidth={2.1} />
            {status === "testing"
              ? t(language, "common.testing")
              : t(language, "wizard.testConnection")}
          </button>
          {status === "ok" && (
            <span
              style={{
                ...ghostBtn(true),
                cursor: "default",
                opacity: 1,
                border: "none",
                background:
                  "color-mix(in srgb, var(--color-success) 14%, transparent)",
                color: "var(--color-success)",
              }}
            >
              <AppIcon name="check" size={14} strokeWidth={2.5} />
              {t(language, "common.connected")}
            </span>
          )}
          {status === "error" && (
            <span style={{ ...subtextStyle, color: "var(--color-danger)" }}>
              {errorMsg || t(language, "wizard.failedCredentials")}
            </span>
          )}
        </div>

        <button
          type="submit"
          style={primaryBtn(status !== "ok" || transitioning)}
          disabled={status !== "ok" || transitioning}
        >
          {transitioning ? (
            <>
              <AppIcon name="activity" size={14} strokeWidth={2.1} />
              {t(language, "common.loading")}
            </>
          ) : (
            t(language, "wizard.next")
          )}
        </button>
      </div>
    </form>
  );
}
