import { useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
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

const responsiveColumnGrid: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
  gap: 16,
  alignItems: "start",
};

export default function StepTMDB({
  defaults,
  language,
  onNext,
}: {
  defaults: any;
  language: AppLanguage;
  onNext: (p: any) => void;
}) {
  const [form, setForm] = useState({
    tmdb_api_key: defaults.tmdb_api_key ?? "",
    default_language: defaults.default_language ?? "es",
    download_folder: defaults.download_folder ?? "",
    max_concurrent_downloads: defaults.max_concurrent_downloads ?? 2,
    metadata_provider: defaults.metadata_provider ?? "tmdb",
    proxy_url: defaults.proxy_url ?? "",
    proxy_api_key: defaults.proxy_api_key ?? "",
  });
  const isProxyMode = form.metadata_provider === "proxy";
  const alreadyConfigured = isProxyMode
    ? !!(defaults.proxy_url && defaults.proxy_api_key)
    : !!defaults.tmdb_api_key;
  const [status, setStatus] = useState<"idle" | "testing" | "ok" | "error">(
    alreadyConfigured ? "ok" : "idle",
  );

  const test = async () => {
    setStatus("testing");
    const ok = await invoke<boolean>("test_metadata_config", {
      provider: form.metadata_provider,
      tmdbApiKey: form.tmdb_api_key,
      proxyUrl: form.proxy_url,
      proxyApiKey: form.proxy_api_key,
    }).catch(() => false);
    setStatus(ok ? "ok" : "error");
  };

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <div style={responsiveColumnGrid}>
        <section style={sectionCard}>
          <div style={{ display: "grid", gap: 12 }}>
            <div style={fieldStyle}>
              <label style={labelStyle}>Proveedor de metadatos</label>
              <select
                style={inputStyle}
                value={form.metadata_provider}
                onChange={(e) => {
                  setForm((current) => ({
                    ...current,
                    metadata_provider: e.target.value,
                  }));
                  setStatus("idle");
                }}
              >
                <option value="tmdb">TMDB (predeterminado)</option>
                <option value="proxy">Metadata Proxy</option>
              </select>
            </div>
            {!isProxyMode && (
              <div style={fieldStyle}>
                <label style={labelStyle}>
                  {t(language, "wizard.tmdbKey")}
                </label>
                <input
                  style={inputStyle}
                  value={form.tmdb_api_key}
                  onChange={(e) => {
                    setForm((current) => ({
                      ...current,
                      tmdb_api_key: e.target.value,
                    }));
                    setStatus("idle");
                  }}
                  placeholder={t(language, "settings.tmdbPlaceholder")}
                />
                <span style={subtextStyle}>
                  {t(language, "wizard.tmdbHelp")}{" "}
                  <a
                    href="https://www.themoviedb.org/settings/api"
                    target="_blank"
                    rel="noreferrer"
                  >
                    themoviedb.org
                  </a>
                </span>
              </div>
            )}
            {isProxyMode && (
              <>
                <div style={fieldStyle}>
                  <label style={labelStyle}>URL del proxy</label>
                  <input
                    style={inputStyle}
                    value={form.proxy_url}
                    onChange={(e) => {
                      setForm((current) => ({
                        ...current,
                        proxy_url: e.target.value,
                      }));
                      setStatus("idle");
                    }}
                    placeholder="https://metadata.example.com"
                  />
                </div>
                <div style={fieldStyle}>
                  <label style={labelStyle}>API key del proxy</label>
                  <input
                    style={inputStyle}
                    type="password"
                    value={form.proxy_api_key}
                    onChange={(e) => {
                      setForm((current) => ({
                        ...current,
                        proxy_api_key: e.target.value,
                      }));
                      setStatus("idle");
                    }}
                    placeholder="Tu clave de API"
                  />
                </div>
              </>
            )}

            <div style={fieldStyle}>
              <label style={labelStyle}>
                {t(language, "settings.defaultLanguage")}
              </label>
              <select
                style={inputStyle}
                value={form.default_language}
                onChange={(e) =>
                  setForm((current) => ({
                    ...current,
                    default_language: e.target.value as "es" | "en",
                  }))
                }
              >
                <option value="es">
                  {t(language, "common.languageSpanish")}
                </option>
                <option value="en">
                  {t(language, "common.languageEnglish")}
                </option>
              </select>
              <span style={subtextStyle}>
                {t(language, "settings.defaultLanguageHelp")}
              </span>
            </div>
          </div>
        </section>

        <section style={sectionCard}>
          <div style={{ display: "grid", gap: 12 }}>
            <div style={fieldStyle}>
              <label style={labelStyle}>
                {t(language, "settings.downloadFolder")}
              </label>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <input
                  style={{ ...inputStyle, flex: 1 }}
                  value={form.download_folder}
                  onChange={(e) =>
                    setForm((current) => ({
                      ...current,
                      download_folder: e.target.value,
                    }))
                  }
                  placeholder={t(
                    language,
                    "settings.downloadFolderPlaceholder",
                  )}
                />
                <button
                  type="button"
                  onClick={async () => {
                    const dir = await open({
                      directory: true,
                      multiple: false,
                    });
                    if (typeof dir === "string") {
                      setForm((current) => ({
                        ...current,
                        download_folder: dir,
                      }));
                    }
                  }}
                  style={{
                    ...ghostBtn(false),
                    whiteSpace: "nowrap",
                    minHeight: 42,
                  }}
                >
                  <AppIcon name="folder" size={15} strokeWidth={2.1} />
                  {t(language, "common.browse")}
                </button>
              </div>
              <span style={subtextStyle}>
                {t(language, "settings.downloadFolderHelp")}
              </span>
            </div>

            <div style={fieldStyle}>
              <label style={labelStyle}>
                {t(language, "settings.maxConcurrent")}
              </label>
              <select
                style={inputStyle}
                value={form.max_concurrent_downloads}
                onChange={(e) =>
                  setForm((current) => ({
                    ...current,
                    max_concurrent_downloads: Number(e.target.value),
                  }))
                }
              >
                {[1, 2, 3, 4, 5].map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
              <span style={subtextStyle}>
                {t(language, "settings.maxConcurrentHelp")}
              </span>
            </div>
          </div>
        </section>
      </div>

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
            <AppIcon name="search" size={15} strokeWidth={2.2} />
            {status === "testing"
              ? t(language, "wizard.validating")
              : t(language, "wizard.validateKey")}
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
              {t(language, "wizard.validKey")}
            </span>
          )}
          {status === "error" && (
            <span style={{ ...subtextStyle, color: "var(--color-danger)" }}>
              {t(language, "wizard.invalidKey")}
            </span>
          )}
        </div>

        <button
          type="button"
          style={primaryBtn(status !== "ok")}
          onClick={() => onNext(form)}
          disabled={status !== "ok"}
        >
          {t(language, "wizard.next")}
        </button>
      </div>
    </div>
  );
}
