import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import AppIcon from "../components/AppIcon";
import type { AppLanguage } from "../utils/mediaLanguage";
import { t } from "../utils/i18n";
import { mergeInferredFolderTypes, parseFolderTypes } from "../utils/folderTypes";
import { call, isTauri } from "../lib/transport";

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

interface WebGuiConfig {
  enabled: boolean;
  host: string;
  port: number;
  exposed_port: number | null;
  app_url: string;
  otp_enabled: boolean;
  smtp_host: string;
  smtp_port: number;
  smtp_user: string;
  smtp_pass: string;
  smtp_from: string;
}

type ConnectionState = "idle" | "testing" | "ok" | "error";

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

const subtextStyle: React.CSSProperties = {
  fontSize: 12,
  lineHeight: 1.5,
  color: "var(--color-text-muted)",
};

const sectionCardStyle: React.CSSProperties = {
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

const primaryBtn: React.CSSProperties = {
  ...ghostBtn,
  border: "none",
  background: "var(--color-primary)",
  color: "#fff",
};

const successBtn: React.CSSProperties = {
  ...ghostBtn,
  border: "none",
  background: "var(--color-success)",
  color: "#fff",
};

function StatusPill({ state, text }: { state: ConnectionState; text: string }) {
  if (state === "idle") return null;
  const color =
    state === "ok"
      ? "var(--color-success)"
      : state === "error"
        ? "var(--color-danger)"
        : "var(--color-primary)";
  const background =
    state === "ok"
      ? "color-mix(in srgb, var(--color-success) 16%, transparent)"
      : state === "error"
        ? "color-mix(in srgb, var(--color-danger) 16%, transparent)"
        : "color-mix(in srgb, var(--color-primary) 16%, transparent)";

  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "0.38rem 0.65rem",
        borderRadius: "var(--radius-full)",
        background,
        color,
        fontSize: 12,
        fontWeight: 700,
      }}
    >
      <span
        style={{
          width: 6,
          height: 6,
          borderRadius: 999,
          background: "currentColor",
        }}
      />
      {text}
    </span>
  );
}

function SectionCard({
  icon,
  title,
  description,
  children,
}: {
  icon: "folder" | "search" | "download" | "activity" | "settings";
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section style={sectionCardStyle}>
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          gap: 12,
          marginBottom: 14,
        }}
      >
        <div
          style={{
            width: 38,
            height: 38,
            borderRadius: 12,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "var(--color-primary)",
            background:
              "color-mix(in srgb, var(--color-primary) 16%, transparent)",
            flexShrink: 0,
          }}
        >
          <AppIcon name={icon} size={18} strokeWidth={2.1} />
        </div>
        <div>
          <div
            style={{
              fontSize: 15,
              fontWeight: 700,
              color: "var(--color-text)",
              marginBottom: 2,
            }}
          >
            {title}
          </div>
          <div style={subtextStyle}>{description}</div>
        </div>
      </div>
      {children}
    </section>
  );
}

export default function Settings({
  language,
  onClose,
}: {
  language: AppLanguage;
  onClose: () => void;
}) {
  const [form, setForm] = useState<Config | null>(null);
  const [ftpStatus, setFtpStatus] = useState<ConnectionState>("idle");
  const [ftpError, setFtpError] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [rawList, setRawList] = useState<string[] | null>(null);
  const [loadingRaw, setLoadingRaw] = useState(false);
  const [rootDirs, setRootDirs] = useState<string[] | null>(null);
  const [loadingDirs, setLoadingDirs] = useState(false);
  const [embyStatus, setEmbyStatus] = useState<ConnectionState>("idle");
  const [embyMsg, setEmbyMsg] = useState("");
  const [plexStatus, setPlexStatus] = useState<ConnectionState>("idle");
  const [plexMsg, setPlexMsg] = useState("");
  const [backupMessage, setBackupMessage] = useState("");
  const [backupError, setBackupError] = useState("");
  const [backupBusy, setBackupBusy] = useState(false);

  const [webGuiConfig, setWebGuiConfig] = useState<WebGuiConfig | null>(null);
  const [webGuiSaving, setWebGuiSaving] = useState(false);
  const [webGuiSaved, setWebGuiSaved] = useState(false);
  const [webGuiInitBusy, setWebGuiInitBusy] = useState(false);
  const [webGuiMessage, setWebGuiMessage] = useState("");
  const [webGuiError, setWebGuiError] = useState("");
  const webGuiSavedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const webMode = !isTauri();

  useEffect(() => {
    call<Config>("get_config").then(setForm).catch(console.error);
  }, []);

  useEffect(() => {
    call<WebGuiConfig>("get_webgui_config").then(setWebGuiConfig).catch(console.error);
  }, []);

  const saveWebGuiConfig = async () => {
    if (!webGuiConfig) return;
    setWebGuiSaving(true);
    setWebGuiError("");
    try {
      await call("save_webgui_config", { config: webGuiConfig });
      setWebGuiSaved(true);
      setWebGuiMessage("Web interface settings saved.");
      if (webGuiSavedTimer.current) clearTimeout(webGuiSavedTimer.current);
      webGuiSavedTimer.current = setTimeout(() => setWebGuiSaved(false), 3000);
    } catch (e) {
      setWebGuiError(e instanceof Error ? e.message : "Failed to save WebGUI settings");
      console.error("Failed to save WebGUI config:", e);
    } finally {
      setWebGuiSaving(false);
    }
  };

  const saveAndInitWebGui = async () => {
    if (!webGuiConfig) return;
    setWebGuiInitBusy(true);
    setWebGuiError("");
    try {
      await call("save_webgui_config", { config: webGuiConfig });
      if (!webMode) {
        await invoke("init_webgui_now");
      }
      setWebGuiSaved(true);
      setWebGuiMessage(
        webMode
          ? "Web interface settings saved. They are already active in this web session."
          : "Web interface initialized. Open http://localhost:47860 (or your configured host/port).",
      );
      if (webGuiSavedTimer.current) clearTimeout(webGuiSavedTimer.current);
      webGuiSavedTimer.current = setTimeout(() => setWebGuiSaved(false), 3000);
    } catch (e) {
      setWebGuiError(e instanceof Error ? e.message : "Failed to initialize WebGUI");
      console.error("Failed to initialize WebGUI:", e);
    } finally {
      setWebGuiInitBusy(false);
    }
  };


  if (!form) {
    return (
      <div
        style={{
          position: "fixed",
          inset: 0,
          background: "color-mix(in srgb, black 55%, transparent)",
          zIndex: 200,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <div style={{ padding: 24, color: "var(--color-text-muted)" }}>
          {t(language, "common.loading")}
        </div>
      </div>
    );
  }

  const folderTypes: Record<string, string> = parseFolderTypes(form.folder_types);

  const setFolderType = (dir: string, type: string) => {
    const next = { ...folderTypes };
    if (!type) delete next[dir];
    else next[dir] = type;
    setForm((current) =>
      current ? { ...current, folder_types: JSON.stringify(next) } : current,
    );
  };

  const set =
    (key: keyof Config) =>
    (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      setForm((current) =>
        current
          ? ({
              ...current,
              [key]:
                key === "ftp_port"
                  ? Number(event.target.value)
                  : event.target.value,
            } as Config)
          : current,
      );

  const testFtp = async () => {
    setFtpStatus("testing");
    setFtpError("");
    try {
      await invoke("test_ftp_connection", {
        host: form.ftp_host,
        port: form.ftp_port,
        user: form.ftp_user,
        pass: form.ftp_pass,
      });
      setFtpStatus("ok");
    } catch (error: any) {
      setFtpError(String(error));
      setFtpStatus("error");
    }
  };

  const testEmby = async () => {
    setEmbyStatus("testing");
    setEmbyMsg("");
    try {
      const name = await invoke<string>("test_emby_connection", {
        url: form.emby_url,
        apiKey: form.emby_api_key,
      });
      setEmbyMsg(name);
      setEmbyStatus("ok");
    } catch (error: any) {
      setEmbyMsg(String(error));
      setEmbyStatus("error");
    }
  };

  const testPlex = async () => {
    setPlexStatus("testing");
    setPlexMsg("");
    try {
      const name = await invoke<string>("test_plex_connection", {
        url: form.plex_url,
        token: form.plex_token,
      });
      setPlexMsg(name);
      setPlexStatus("ok");
    } catch (error: any) {
      setPlexMsg(String(error));
      setPlexStatus("error");
    }
  };

  const saveConfig = async () => {
    setSaving(true);
    try {
      await call("save_config", { config: form });
      await call("set_max_concurrent", {
        max: form.max_concurrent_downloads ?? 2,
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } finally {
      setSaving(false);
    }
  };

  const saveAndReindex = async () => {
    await saveConfig();
    call("start_indexing").catch(console.error);
    onClose();
  };

  const showRawList = async () => {
    setLoadingRaw(true);
    try {
      await invoke("save_config", { config: form });
      const entries = await invoke<string[]>("ftp_list_raw");
      setRawList(entries);
    } catch (error: any) {
      setRawList([`Error: ${error}`]);
    } finally {
      setLoadingRaw(false);
    }
  };

  const loadRootDirs = async () => {
    setLoadingDirs(true);
    try {
      const dirs = await invoke<string[]>("ftp_list_root_dirs_preview", {
        host: form.ftp_host,
        port: form.ftp_port,
        user: form.ftp_user,
        pass: form.ftp_pass,
        root: form.ftp_root,
      });
      setRootDirs(dirs);
      setForm((current) =>
        current
          ? {
              ...current,
              folder_types: mergeInferredFolderTypes(current.folder_types, dirs),
            }
          : current,
      );
    } catch {
      setRootDirs([]);
    } finally {
      setLoadingDirs(false);
    }
  };

  const ftpStatusText =
    ftpStatus === "ok"
      ? t(language, "common.connected")
      : ftpStatus === "error"
        ? ftpError || t(language, "common.connectionFailed")
        : t(language, "common.testing");

  const exportBackup = async () => {
    setBackupBusy(true);
    setBackupError("");
    setBackupMessage("");
    try {
      const selectedFolder = await open({
        directory: true,
        multiple: false,
      });
      if (typeof selectedFolder !== "string") return;
      const destination = `${selectedFolder.replace(/[\\/]$/, "")}/oscata-library-backup.db`;
      await invoke("export_library_backup", { destinationPath: destination });
      setBackupMessage(t(language, "settings.backupExportSuccess"));
    } catch (error: any) {
      setBackupError(String(error));
    } finally {
      setBackupBusy(false);
    }
  };

  const importBackup = async () => {
    setBackupBusy(true);
    setBackupError("");
    setBackupMessage("");
    try {
      const source = await open({
        multiple: false,
        filters: [
          { name: "SQLite", extensions: ["db", "sqlite", "sqlite3"] },
          { name: "All files", extensions: ["*"] },
        ],
      });
      if (typeof source !== "string") return;
      await invoke("import_library_backup", { sourcePath: source });
      setBackupMessage(t(language, "settings.backupImportSuccess"));
      window.location.reload();
    } catch (error: any) {
      setBackupError(String(error));
    } finally {
      setBackupBusy(false);
    }
  };

  const folderDirs = rootDirs ?? Object.keys(folderTypes);

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "color-mix(in srgb, black 58%, transparent)",
        backdropFilter: "blur(8px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 200,
        padding: "1.5rem",
      }}
      onClick={(event) => event.target === event.currentTarget && onClose()}
    >
      <div
        className="modal-panel-enter"
        style={{
          width: 980,
          maxWidth: "calc(100vw - 3rem)",
          maxHeight: "calc(100dvh - 3rem)",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          borderRadius: "calc(var(--radius-lg) + 6px)",
          border:
            "1px solid color-mix(in srgb, var(--color-border) 82%, transparent)",
          background:
            "linear-gradient(180deg, color-mix(in srgb, var(--color-surface) 97%, transparent), color-mix(in srgb, var(--color-surface-2) 94%, transparent))",
          boxShadow: "0 24px 80px color-mix(in srgb, black 34%, transparent)",
        }}
      >
        <div
          style={{
            padding: "1.25rem 1.5rem 1rem",
            borderBottom:
              "1px solid color-mix(in srgb, var(--color-border) 72%, transparent)",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
            gap: 16,
            flexShrink: 0,
          }}
        >
          <div style={{ display: "flex", alignItems: "flex-start", gap: 14 }}>
            <div
              style={{
                width: 44,
                height: 44,
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
              <h2
                style={{
                  margin: 0,
                  fontSize: 20,
                  fontWeight: 800,
                  color: "var(--color-text)",
                  letterSpacing: "-0.02em",
                }}
              >
                {t(language, "settings.title")}
              </h2>
              <p
                style={{
                  margin: "0.35rem 0 0",
                  ...subtextStyle,
                  maxWidth: 560,
                }}
              >
                {t(language, "settings.subtitle")}
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            style={{
              width: 38,
              height: 38,
              borderRadius: 999,
              border:
                "1px solid color-mix(in srgb, var(--color-border) 76%, transparent)",
              background:
                "color-mix(in srgb, var(--color-surface) 90%, transparent)",
              color: "var(--color-text-muted)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: "pointer",
              flexShrink: 0,
            }}
            aria-label={t(language, "settings.close")}
          >
            <AppIcon name="close" size={16} strokeWidth={2.2} />
          </button>
        </div>

        <div
          style={{
            flex: 1,
            overflowY: "auto",
            padding: "1.25rem 1.5rem 1.5rem",
          }}
        >
          <div style={{ display: "grid", gap: 16 }}>
            <SectionCard
              icon="folder"
              title={t(language, "settings.ftpTitle")}
              description={t(language, "settings.ftpDescription")}
            >
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "minmax(0, 1fr) 120px",
                  gap: 12,
                  marginBottom: 12,
                }}
              >
                <div style={fieldStyle}>
                  <label style={labelStyle}>
                    {t(language, "settings.host")}
                  </label>
                  <input
                    style={inputStyle}
                    value={form.ftp_host}
                    onChange={set("ftp_host")}
                  />
                </div>
                <div style={fieldStyle}>
                  <label style={labelStyle}>
                    {t(language, "settings.port")}
                  </label>
                  <input
                    style={inputStyle}
                    type="number"
                    value={form.ftp_port}
                    onChange={set("ftp_port")}
                  />
                </div>
              </div>

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
                  gap: 12,
                  marginBottom: 12,
                }}
              >
                <div style={fieldStyle}>
                  <label style={labelStyle}>
                    {t(language, "settings.username")}
                  </label>
                  <input
                    style={inputStyle}
                    value={form.ftp_user}
                    onChange={set("ftp_user")}
                  />
                </div>
                <div style={fieldStyle}>
                  <label style={labelStyle}>
                    {t(language, "settings.password")}
                  </label>
                  <input
                    style={inputStyle}
                    type="password"
                    value={form.ftp_pass}
                    onChange={set("ftp_pass")}
                  />
                </div>
              </div>

              <div style={{ ...fieldStyle, marginBottom: 14 }}>
                <label style={labelStyle}>
                  {t(language, "settings.rootPath")}
                </label>
                <input
                  style={inputStyle}
                  value={form.ftp_root}
                  onChange={set("ftp_root")}
                  placeholder="/"
                />
              </div>

              <div
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  gap: 10,
                  alignItems: "center",
                  marginBottom: rawList !== null ? 14 : 0,
                }}
              >
                <button
                  onClick={testFtp}
                  disabled={ftpStatus === "testing"}
                  style={ghostBtn}
                >
                  <AppIcon name="activity" size={15} />
                  {ftpStatus === "testing"
                    ? t(language, "common.testing")
                    : t(language, "settings.testConnection")}
                </button>
                <button
                  onClick={showRawList}
                  disabled={loadingRaw}
                  style={ghostBtn}
                >
                  <AppIcon name="folder" size={15} />
                  {loadingRaw
                    ? t(language, "settings.listing")
                    : t(language, "settings.browseRoot")}
                </button>
                <StatusPill state={ftpStatus} text={ftpStatusText} />
              </div>

              {rawList !== null && (
                <div
                  style={{
                    marginTop: 14,
                    borderRadius: "var(--radius)",
                    border:
                      "1px solid color-mix(in srgb, var(--color-border) 74%, transparent)",
                    background:
                      "color-mix(in srgb, var(--color-bg) 70%, transparent)",
                    overflow: "hidden",
                  }}
                >
                  <div
                    style={{
                      padding: "0.75rem 0.9rem",
                      borderBottom:
                        "1px solid color-mix(in srgb, var(--color-border) 60%, transparent)",
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      gap: 10,
                    }}
                  >
                    <div
                      style={{
                        fontSize: 13,
                        fontWeight: 700,
                        color: "var(--color-text-muted)",
                      }}
                    >
                      {t(language, "settings.rootListing", {
                        count: rawList.length,
                      })}
                    </div>
                    <button
                      onClick={() => setRawList(null)}
                      style={{ ...ghostBtn, padding: "6px 10px", fontSize: 12 }}
                    >
                      {t(language, "settings.dismiss")}
                    </button>
                  </div>
                  <div
                    style={{
                      maxHeight: 220,
                      overflowY: "auto",
                      padding: "0.85rem 0.9rem",
                    }}
                  >
                    {rawList.length === 0 ? (
                      <span style={subtextStyle}>
                        {t(language, "settings.emptyDirectory")}
                      </span>
                    ) : (
                      rawList.map((line, index) => (
                        <div
                          key={index}
                          style={{
                            color: "var(--color-success)",
                            fontSize: 12,
                            fontFamily: "monospace",
                            whiteSpace: "pre-wrap",
                            wordBreak: "break-word",
                            lineHeight: 1.5,
                          }}
                        >
                          {line}
                        </div>
                      ))
                    )}
                  </div>
                </div>
              )}
            </SectionCard>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
                gap: 16,
              }}
            >
              <SectionCard
                icon="search"
                title={t(language, "settings.metaTitle")}
                description={t(language, "settings.metaDescription")}
              >
                <div style={{ display: "grid", gap: 12 }}>
                  <div style={fieldStyle}>
                    <label style={labelStyle}>
                      {t(language, "settings.tmdbKey")}
                    </label>
                    <input
                      style={inputStyle}
                      value={form.tmdb_api_key}
                      onChange={set("tmdb_api_key")}
                      placeholder={t(language, "settings.tmdbPlaceholder")}
                    />
                  </div>
                  <div style={fieldStyle}>
                    <label style={labelStyle}>
                      {t(language, "settings.defaultLanguage")}
                    </label>
                    <select
                      style={inputStyle}
                      value={form.default_language ?? "es"}
                      onChange={set("default_language")}
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
              </SectionCard>

              <SectionCard
                icon="download"
                title={t(language, "settings.downloadsTitle")}
                description={t(language, "settings.downloadsDescription")}
              >
                <div style={{ display: "grid", gap: 12 }}>
                  <div style={fieldStyle}>
                    <label style={labelStyle}>
                      {t(language, "settings.downloadFolder")}
                    </label>
                    <div style={{ display: "flex", gap: 8 }}>
                      <input
                        style={{ ...inputStyle, flex: 1 }}
                        value={form.download_folder}
                        onChange={set("download_folder")}
                        placeholder={t(
                          language,
                          "settings.downloadFolderPlaceholder",
                        )}
                      />
                      <button
                        onClick={async () => {
                          const dir = await open({
                            directory: true,
                            multiple: false,
                          });
                          if (typeof dir === "string") {
                            setForm((current) =>
                              current
                                ? { ...current, download_folder: dir }
                                : current,
                            );
                          }
                        }}
                        style={{ ...ghostBtn, whiteSpace: "nowrap" }}
                      >
                        <AppIcon name="folder" size={15} />
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
                    <input
                      type="number"
                      min={1}
                      max={5}
                      style={{ ...inputStyle, width: 96 }}
                      value={form.max_concurrent_downloads ?? 2}
                      onChange={(event) =>
                        setForm((current) =>
                          current
                            ? {
                                ...current,
                                max_concurrent_downloads: Math.min(
                                  5,
                                  Math.max(1, Number(event.target.value)),
                                ),
                              }
                            : current,
                        )
                      }
                    />
                    <span style={subtextStyle}>
                      {t(language, "settings.maxConcurrentHelp")}
                    </span>
                  </div>
                </div>
              </SectionCard>
            </div>

            <SectionCard
              icon="folder"
              title={t(language, "settings.backupsTitle")}
              description={t(language, "settings.backupsDescription")}
            >
              <div style={{ display: "grid", gap: 12 }}>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
                  <button
                    onClick={exportBackup}
                    disabled={backupBusy}
                    style={ghostBtn}
                  >
                    <AppIcon name="download" size={15} />
                    {t(language, "settings.exportBackup")}
                  </button>
                  <button
                    onClick={importBackup}
                    disabled={backupBusy}
                    style={ghostBtn}
                  >
                    <AppIcon name="folder" size={15} />
                    {t(language, "settings.importBackup")}
                  </button>
                </div>
                <span style={subtextStyle}>
                  {t(language, "settings.backupsHelp")}
                </span>
                {backupMessage && (
                  <span
                    style={{ ...subtextStyle, color: "var(--color-success)" }}
                  >
                    {backupMessage}
                  </span>
                )}
                {backupError && (
                  <span
                    style={{ ...subtextStyle, color: "var(--color-danger)" }}
                  >
                    {backupError}
                  </span>
                )}
              </div>
            </SectionCard>

            <SectionCard
              icon="activity"
              title={t(language, "settings.mediaServersTitle")}
              description={t(language, "settings.mediaServersDescription")}
            >
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
                  gap: 12,
                }}
              >
                <div
                  style={{
                    borderRadius: "var(--radius)",
                    border:
                      "1px solid color-mix(in srgb, var(--color-border) 72%, transparent)",
                    background:
                      "color-mix(in srgb, var(--color-surface-2) 78%, transparent)",
                    padding: "0.9rem",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      gap: 12,
                      marginBottom: 12,
                    }}
                  >
                    <div>
                      <div
                        style={{
                          fontSize: 14,
                          fontWeight: 700,
                          color: "var(--color-text)",
                        }}
                      >
                        Emby
                      </div>
                      <div style={subtextStyle}>
                        {t(language, "settings.embyDescription")}
                      </div>
                    </div>
                    <StatusPill
                      state={embyStatus}
                      text={
                        embyStatus === "ok"
                          ? `${t(language, "common.connected")} — ${embyMsg}`
                          : embyStatus === "error"
                            ? embyMsg
                            : t(language, "common.testing")
                      }
                    />
                  </div>

                  <div style={{ display: "grid", gap: 12 }}>
                    <div style={fieldStyle}>
                      <label style={labelStyle}>
                        {t(language, "settings.serverUrl")}
                      </label>
                      <input
                        style={inputStyle}
                        value={form.emby_url}
                        onChange={set("emby_url")}
                        placeholder="http://192.168.1.x:8096"
                      />
                    </div>
                    <div style={fieldStyle}>
                      <label style={labelStyle}>
                        {t(language, "settings.apiKey")}
                      </label>
                      <input
                        style={inputStyle}
                        value={form.emby_api_key}
                        onChange={set("emby_api_key")}
                        placeholder={t(language, "settings.embyApiPlaceholder")}
                        type="password"
                      />
                    </div>
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        gap: 10,
                        flexWrap: "wrap",
                      }}
                    >
                      <span style={subtextStyle}>
                        {t(language, "settings.embyHelp")}
                      </span>
                      <button
                        onClick={testEmby}
                        disabled={
                          embyStatus === "testing" ||
                          !form.emby_url ||
                          !form.emby_api_key
                        }
                        style={ghostBtn}
                      >
                        <AppIcon name="activity" size={15} />
                        {embyStatus === "testing"
                          ? t(language, "common.testing")
                          : t(language, "settings.testConnection")}
                      </button>
                    </div>
                  </div>
                </div>

                <div
                  style={{
                    borderRadius: "var(--radius)",
                    border:
                      "1px solid color-mix(in srgb, var(--color-border) 72%, transparent)",
                    background:
                      "color-mix(in srgb, var(--color-surface-2) 78%, transparent)",
                    padding: "0.9rem",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      gap: 12,
                      marginBottom: 12,
                    }}
                  >
                    <div>
                      <div
                        style={{
                          fontSize: 14,
                          fontWeight: 700,
                          color: "var(--color-text)",
                        }}
                      >
                        Plex
                      </div>
                      <div style={subtextStyle}>
                        {t(language, "settings.plexDescription")}
                      </div>
                    </div>
                    <StatusPill
                      state={plexStatus}
                      text={
                        plexStatus === "ok"
                          ? `${t(language, "common.connected")} — ${plexMsg}`
                          : plexStatus === "error"
                            ? plexMsg
                            : t(language, "common.testing")
                      }
                    />
                  </div>

                  <div style={{ display: "grid", gap: 12 }}>
                    <div style={fieldStyle}>
                      <label style={labelStyle}>
                        {t(language, "settings.serverUrl")}
                      </label>
                      <input
                        style={inputStyle}
                        value={form.plex_url}
                        onChange={set("plex_url")}
                        placeholder="http://192.168.1.x:32400"
                      />
                    </div>
                    <div style={fieldStyle}>
                      <label style={labelStyle}>
                        {t(language, "settings.plexToken")}
                      </label>
                      <input
                        style={inputStyle}
                        value={form.plex_token}
                        onChange={set("plex_token")}
                        placeholder={t(
                          language,
                          "settings.plexTokenPlaceholder",
                        )}
                        type="password"
                      />
                    </div>
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        gap: 10,
                        flexWrap: "wrap",
                      }}
                    >
                      <span style={subtextStyle}>
                        {t(language, "settings.plexHelp")}
                      </span>
                      <button
                        onClick={testPlex}
                        disabled={
                          plexStatus === "testing" ||
                          !form.plex_url ||
                          !form.plex_token
                        }
                        style={ghostBtn}
                      >
                        <AppIcon name="activity" size={15} />
                        {plexStatus === "testing"
                          ? t(language, "common.testing")
                          : t(language, "settings.testConnection")}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </SectionCard>

            <SectionCard
              icon="folder"
              title={t(language, "settings.folderTypesTitle")}
              description={t(language, "settings.folderTypesDescription")}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  gap: 12,
                  alignItems: "center",
                  marginBottom: 14,
                  flexWrap: "wrap",
                }}
              >
                <div style={subtextStyle}>
                  {t(language, "settings.folderTypesHelp")}
                </div>
                <button
                  onClick={loadRootDirs}
                  disabled={loadingDirs}
                  style={ghostBtn}
                >
                  <AppIcon name="refresh" size={15} />
                  {loadingDirs
                    ? t(language, "settings.loading")
                    : t(language, "settings.loadRootFolders")}
                </button>
              </div>

              {folderDirs.length > 0 ? (
                <div style={{ display: "grid", gap: 8 }}>
                  {folderDirs.map((dir) => (
                    <div
                      key={dir}
                      style={{
                        display: "grid",
                        gridTemplateColumns: "minmax(0, 1fr) 220px",
                        gap: 12,
                        alignItems: "center",
                        padding: "0.8rem 0.9rem",
                        borderRadius: "var(--radius)",
                        border:
                          "1px solid color-mix(in srgb, var(--color-border) 70%, transparent)",
                        background:
                          "color-mix(in srgb, var(--color-surface-2) 70%, transparent)",
                      }}
                    >
                      <div style={{ minWidth: 0 }}>
                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 8,
                            marginBottom: 4,
                          }}
                        >
                          <AppIcon name="folder" size={15} />
                          <span
                            style={{
                              fontSize: 14,
                              fontWeight: 700,
                              color: "var(--color-text)",
                              whiteSpace: "nowrap",
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                            }}
                          >
                            {dir}
                          </span>
                        </div>
                        <div style={{ ...subtextStyle, fontSize: 11 }}>
                          {t(language, "settings.folderRowHelp")}
                        </div>
                      </div>
                      <select
                        value={folderTypes[dir] ?? ""}
                        onChange={(event) =>
                          setFolderType(dir, event.target.value)
                        }
                        style={inputStyle}
                      >
                        <option value="">
                          {t(language, "settings.ignore")}
                        </option>
                        <option value="movie">
                          {t(language, "settings.movies")}
                        </option>
                        <option value="tv">
                          {t(language, "settings.tvShows")}
                        </option>
                        <option value="documentary">
                          {t(language, "settings.documentaries")}
                        </option>
                        <option value="mixed">
                          {t(language, "settings.mixed")}
                        </option>
                      </select>
                    </div>
                  ))}
                </div>
              ) : (
                <div
                  style={{
                    borderRadius: "var(--radius)",
                    border:
                      "1px dashed color-mix(in srgb, var(--color-border) 76%, transparent)",
                    padding: "1rem",
                    color: "var(--color-text-muted)",
                    fontSize: 13,
                  }}
                >
                  {t(language, "settings.noRootFolders")}
                </div>
              )}
            </SectionCard>

            {webGuiConfig && (
              <SectionCard
                icon="settings"
                title="Web Interface (LAN)"
                description="Expose a browser-accessible web interface on your local network. Restart the app after changing settings."
              >
                <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>

                  {/* Enable toggle */}
                  <label style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer" }}>
                    <input type="checkbox" checked={webGuiConfig.enabled} onChange={e => setWebGuiConfig(c => c ? { ...c, enabled: e.target.checked } : c)} />
                    <span style={{ fontSize: 14, fontWeight: 600, color: "var(--color-text)" }}>Enable web interface</span>
                  </label>

                  {webGuiConfig.enabled && (
                    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 120px", gap: 10 }}>
                        <div style={fieldStyle}>
                          <label style={labelStyle}>Bind host</label>
                          <input style={inputStyle} value={webGuiConfig.host} onChange={e => setWebGuiConfig(c => c ? { ...c, host: e.target.value } : c)} placeholder="0.0.0.0" />
                        </div>
                        <div style={fieldStyle}>
                          <label style={labelStyle}>Port</label>
                          <input style={inputStyle} type="number" min={1024} max={65535} value={webGuiConfig.port} onChange={e => setWebGuiConfig(c => c ? { ...c, port: parseInt(e.target.value) || c.port } : c)} />
                        </div>
                      </div>

                      <div style={{ display: "grid", gridTemplateColumns: "120px 1fr", gap: 10 }}>
                        <div style={fieldStyle}>
                          <label style={labelStyle}>Exposed port</label>
                          <input style={inputStyle} type="number" min={0} max={65535} value={webGuiConfig.exposed_port ?? ""} placeholder="Same as port" onChange={e => setWebGuiConfig(c => c ? { ...c, exposed_port: e.target.value ? parseInt(e.target.value) : null } : c)} />
                        </div>
                        <div style={fieldStyle}>
                          <label style={labelStyle}>App URL (optional, for email links)</label>
                          <input style={inputStyle} value={webGuiConfig.app_url} placeholder="http://192.168.1.x:47860" onChange={e => setWebGuiConfig(c => c ? { ...c, app_url: e.target.value } : c)} />
                        </div>
                      </div>

                      {/* OTP / SMTP */}
                      <label style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer" }}>
                        <input type="checkbox" checked={webGuiConfig.otp_enabled} onChange={e => setWebGuiConfig(c => c ? { ...c, otp_enabled: e.target.checked } : c)} />
                        <span style={{ fontSize: 13, fontWeight: 600, color: "var(--color-text)" }}>Require email OTP on login</span>
                      </label>

                      {webGuiConfig.otp_enabled && (
                        <div style={{ display: "flex", flexDirection: "column", gap: 10, padding: "10px 12px", borderRadius: "var(--radius)", border: "1px solid var(--color-border)", background: "var(--color-surface-2)" }}>
                          <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase" as const, color: "var(--color-text-muted)" }}>SMTP settings</div>
                          <div style={{ display: "grid", gridTemplateColumns: "1fr 100px", gap: 10 }}>
                            <div style={fieldStyle}>
                              <label style={labelStyle}>SMTP host</label>
                              <input style={inputStyle} value={webGuiConfig.smtp_host} placeholder="smtp.gmail.com" onChange={e => setWebGuiConfig(c => c ? { ...c, smtp_host: e.target.value } : c)} />
                            </div>
                            <div style={fieldStyle}>
                              <label style={labelStyle}>Port</label>
                              <input style={inputStyle} type="number" value={webGuiConfig.smtp_port} onChange={e => setWebGuiConfig(c => c ? { ...c, smtp_port: parseInt(e.target.value) || c.smtp_port } : c)} />
                            </div>
                          </div>
                          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                            <div style={fieldStyle}>
                              <label style={labelStyle}>Username</label>
                              <input style={inputStyle} value={webGuiConfig.smtp_user} onChange={e => setWebGuiConfig(c => c ? { ...c, smtp_user: e.target.value } : c)} />
                            </div>
                            <div style={fieldStyle}>
                              <label style={labelStyle}>Password</label>
                              <input style={inputStyle} type="password" value={webGuiConfig.smtp_pass} onChange={e => setWebGuiConfig(c => c ? { ...c, smtp_pass: e.target.value } : c)} />
                            </div>
                          </div>
                          <div style={fieldStyle}>
                            <label style={labelStyle}>From address</label>
                            <input style={inputStyle} type="email" value={webGuiConfig.smtp_from} placeholder="oscata@yourdomain.com" onChange={e => setWebGuiConfig(c => c ? { ...c, smtp_from: e.target.value } : c)} />
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                    <button style={webGuiSaved ? successBtn : primaryBtn} disabled={webGuiSaving} onClick={saveWebGuiConfig}>
                      {webGuiSaving ? "Saving…" : webGuiSaved ? "✓ Saved" : "Save Web Interface Settings"}
                    </button>
                    <button style={ghostBtn} disabled={webGuiInitBusy} onClick={saveAndInitWebGui}>
                      {webGuiInitBusy ? "Starting…" : "Save + Initialize Now"}
                    </button>
                  </div>
                  {webGuiMessage && (
                    <div style={{ ...subtextStyle, color: "var(--color-success)" }}>{webGuiMessage}</div>
                  )}
                  {webGuiError && (
                    <div style={{ ...subtextStyle, color: "var(--color-danger)" }}>{webGuiError}</div>
                  )}
                </div>
              </SectionCard>
            )}
          </div>
        </div>

        <div
          style={{
            padding: "1rem 1.5rem",
            borderTop:
              "1px solid color-mix(in srgb, var(--color-border) 70%, transparent)",
            background:
              "color-mix(in srgb, var(--color-surface-2) 46%, transparent)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            flexWrap: "wrap",
            flexShrink: 0,
          }}
        >
          <div style={subtextStyle}>{t(language, "settings.footerHelp")}</div>

          <div
            style={{
              display: "flex",
              gap: 8,
              flexWrap: "wrap",
              justifyContent: "flex-end",
            }}
          >
            <button onClick={onClose} style={ghostBtn}>
              {t(language, "common.cancel")}
            </button>
            <button onClick={saveConfig} disabled={saving} style={primaryBtn}>
              {saved
                ? t(language, "common.saved")
                : saving
                  ? t(language, "common.saving")
                  : t(language, "common.save")}
            </button>
            <button
              onClick={saveAndReindex}
              disabled={saving}
              style={successBtn}
            >
              <AppIcon name="refresh" size={15} />
              {t(language, "settings.saveAndReindex")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
