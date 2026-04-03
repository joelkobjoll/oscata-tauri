import { useEffect, useRef, useState } from "react";
import AppIcon from "../components/AppIcon";
import type { AppLanguage } from "../utils/mediaLanguage";
import { t } from "../utils/i18n";
import {
  mergeInferredFolderTypes,
  parseFolderTypes,
} from "../utils/folderTypes";
import { call, isTauri } from "../lib/transport";
import { useTheme } from "../hooks/useTheme";
import { GENRE_LIST } from "../utils/genres";

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
  movie_destination: string;
  tv_destination: string;
  documentary_destination: string;
  alphabetical_subfolders: boolean;
  genre_destinations: string; // JSON: GenreDestRule[]
}

interface GenreDestRule {
  id: string;
  label: string;
  genre_ids: number[];
  destination: string;
  media_types: Array<"movie" | "tv" | "documentary" | "all">;
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

const selectStyle: React.CSSProperties = {
  ...inputStyle,
  appearance: "none",
  backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%238888a0' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'/%3E%3C/svg%3E")`,
  backgroundRepeat: "no-repeat",
  backgroundPosition: "right 0.75rem center",
  paddingRight: "2.2rem",
  cursor: "pointer",
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
  const { theme, setTheme } = useTheme();
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
  const [appVersion, setAppVersion] = useState<string>(
    import.meta.env.VITE_APP_VERSION || "0.0.0",
  );
  const webGuiSavedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const webMode = !isTauri();

  useEffect(() => {
    call<Config>("get_config")
      .then((cfg) => {
        const base = cfg.download_folder ?? "";
        setForm({
          ...cfg,
          movie_destination:
            cfg.movie_destination || (base ? `${base}/Movies` : ""),
          tv_destination:
            cfg.tv_destination || (base ? `${base}/TV Shows` : ""),
          documentary_destination:
            cfg.documentary_destination ||
            (base ? `${base}/Documentaries` : ""),
          alphabetical_subfolders: cfg.alphabetical_subfolders ?? true,
          genre_destinations: cfg.genre_destinations ?? "[]",
        });
      })
      .catch(console.error);
  }, []);

  useEffect(() => {
    call<WebGuiConfig>("get_webgui_config")
      .then(setWebGuiConfig)
      .catch(console.error);
  }, []);

  useEffect(() => {
    if (!isTauri()) return;
    import("@tauri-apps/api/app")
      .then(({ getVersion }) => getVersion())
      .then((version) => setAppVersion(version))
      .catch(() => {});
  }, []);

  const saveWebGuiConfig = async () => {
    if (!webGuiConfig) return;
    setWebGuiSaving(true);
    setWebGuiError("");
    try {
      await call("save_webgui_config", { config: webGuiConfig });
      setWebGuiSaved(true);
      setWebGuiMessage(t(language, "settings.webInterfaceSaved"));
      if (webGuiSavedTimer.current) clearTimeout(webGuiSavedTimer.current);
      webGuiSavedTimer.current = setTimeout(() => setWebGuiSaved(false), 3000);
    } catch (e) {
      setWebGuiError(
        e instanceof Error
          ? e.message
          : t(language, "settings.webInterfaceErrorSave"),
      );
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
        const { invoke } = await import("@tauri-apps/api/core");
        await invoke("init_webgui_now");
      }
      setWebGuiSaved(true);
      setWebGuiMessage(
        webMode
          ? t(language, "settings.webInterfaceSavedWeb")
          : t(language, "settings.webInterfaceInitialized"),
      );
      if (webGuiSavedTimer.current) clearTimeout(webGuiSavedTimer.current);
      webGuiSavedTimer.current = setTimeout(() => setWebGuiSaved(false), 3000);
    } catch (e) {
      setWebGuiError(
        e instanceof Error
          ? e.message
          : t(language, "settings.webInterfaceErrorInit"),
      );
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

  const folderTypes: Record<string, string> = parseFolderTypes(
    form.folder_types,
  );

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
      await call("test_ftp_connection", {
        host: form.ftp_host,
        port: form.ftp_port,
        user: form.ftp_user,
        pass: form.ftp_pass,
      });
      setFtpStatus("ok");
    } catch (error: unknown) {
      setFtpError(String(error));
      setFtpStatus("error");
    }
  };

  const testEmby = async () => {
    setEmbyStatus("testing");
    setEmbyMsg("");
    try {
      const name = await call<string>("test_emby_connection", {
        url: form.emby_url,
        apiKey: form.emby_api_key,
      });
      setEmbyMsg(name);
      setEmbyStatus("ok");
    } catch (error: unknown) {
      setEmbyMsg(String(error));
      setEmbyStatus("error");
    }
  };

  const testPlex = async () => {
    setPlexStatus("testing");
    setPlexMsg("");
    try {
      const name = await call<string>("test_plex_connection", {
        url: form.plex_url,
        token: form.plex_token,
      });
      setPlexMsg(name);
      setPlexStatus("ok");
    } catch (error: unknown) {
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
    if (!isTauri()) return;
    setLoadingRaw(true);
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("save_config", { config: form });
      const entries = await invoke<string[]>("ftp_list_raw");
      setRawList(entries);
    } catch (error: unknown) {
      setRawList([`Error: ${String(error)}`]);
    } finally {
      setLoadingRaw(false);
    }
  };

  const loadRootDirs = async () => {
    setLoadingDirs(true);
    try {
      const dirs = await call<string[]>("ftp_list_root_dirs_preview", {
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
              folder_types: mergeInferredFolderTypes(
                current.folder_types,
                dirs,
              ),
            }
          : current,
      );
    } catch {
      setRootDirs([]);
    } finally {
      setLoadingDirs(false);
    }
  };

  const exportBackup = async () => {
    if (!isTauri()) return;
    setBackupBusy(true);
    setBackupError("");
    setBackupMessage("");
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const { invoke } = await import("@tauri-apps/api/core");
      const selectedFolder = await open({
        directory: true,
        multiple: false,
      });
      if (typeof selectedFolder !== "string") return;
      const destination = `${selectedFolder.replace(/[\\/]$/, "")}/oscata-library-backup.db`;
      await invoke("export_library_backup", { destinationPath: destination });
      setBackupMessage(t(language, "settings.backupExportSuccess"));
    } catch (error: unknown) {
      setBackupError(String(error));
    } finally {
      setBackupBusy(false);
    }
  };

  const importBackup = async () => {
    if (!isTauri()) return;
    setBackupBusy(true);
    setBackupError("");
    setBackupMessage("");
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const { invoke } = await import("@tauri-apps/api/core");
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
    } catch (error: unknown) {
      setBackupError(String(error));
    } finally {
      setBackupBusy(false);
    }
  };

  const browseDownloadFolder = async () => {
    if (!isTauri()) return;
    const { open } = await import("@tauri-apps/plugin-dialog");
    const dir = await open({ directory: true, multiple: false });
    if (typeof dir === "string") {
      setForm((current) =>
        current ? { ...current, download_folder: dir } : current,
      );
    }
  };

  const browseDestination = async (
    field: "movie_destination" | "tv_destination" | "documentary_destination",
  ) => {
    if (!isTauri()) return;
    const { open } = await import("@tauri-apps/plugin-dialog");
    const dir = await open({ directory: true, multiple: false });
    if (typeof dir === "string") {
      setForm((current) => (current ? { ...current, [field]: dir } : current));
    }
  };

  const browseGenreRuleDestination = async (ruleId: string) => {
    if (!isTauri()) return;
    const { open } = await import("@tauri-apps/plugin-dialog");
    const dir = await open({ directory: true, multiple: false });
    if (typeof dir === "string") {
      setForm((current) => {
        if (!current) return current;
        const rules: GenreDestRule[] = JSON.parse(
          current.genre_destinations || "[]",
        );
        const updated = rules.map((r) =>
          r.id === ruleId ? { ...r, destination: dir } : r,
        );
        return { ...current, genre_destinations: JSON.stringify(updated) };
      });
    }
  };

  const addGenreRule = () => {
    setForm((current) => {
      if (!current) return current;
      const rules: GenreDestRule[] = JSON.parse(
        current.genre_destinations || "[]",
      );
      const newRule: GenreDestRule = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        label: "",
        genre_ids: [],
        destination: "",
        media_types: ["all"],
      };
      return {
        ...current,
        genre_destinations: JSON.stringify([...rules, newRule]),
      };
    });
  };

  const removeGenreRule = (ruleId: string) => {
    setForm((current) => {
      if (!current) return current;
      const rules: GenreDestRule[] = JSON.parse(
        current.genre_destinations || "[]",
      );
      return {
        ...current,
        genre_destinations: JSON.stringify(
          rules.filter((r) => r.id !== ruleId),
        ),
      };
    });
  };

  const updateGenreRule = (ruleId: string, patch: Partial<GenreDestRule>) => {
    setForm((current) => {
      if (!current) return current;
      const rules: GenreDestRule[] = JSON.parse(
        current.genre_destinations || "[]",
      );
      const updated = rules.map((r) =>
        r.id === ruleId ? { ...r, ...patch } : r,
      );
      return { ...current, genre_destinations: JSON.stringify(updated) };
    });
  };

  const ftpStatusText =
    ftpStatus === "ok"
      ? t(language, "common.connected")
      : ftpStatus === "error"
        ? ftpError || t(language, "common.connectionFailed")
        : t(language, "common.testing");

  const folderDirs = rootDirs ?? Object.keys(folderTypes);

  return (
    <div
      className="settings-overlay"
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
        className="modal-panel-enter settings-panel"
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
              <div
                style={{
                  marginTop: 10,
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "0.3rem 0.65rem",
                  borderRadius: "var(--radius-full)",
                  border:
                    "1px solid color-mix(in srgb, var(--color-border) 78%, transparent)",
                  background:
                    "color-mix(in srgb, var(--color-surface) 92%, transparent)",
                  color: "var(--color-text-muted)",
                  fontSize: 12,
                  fontWeight: 700,
                }}
              >
                <span>{t(language, "settings.currentVersion")}</span>
                <span style={{ color: "var(--color-text)" }}>
                  v{appVersion}
                </span>
              </div>
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
              icon="settings"
              title="Appearance"
              description="Choose how Oscata looks. System follows your OS preference and updates live."
            >
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                {(["system", "dark", "light"] as const).map((option) => {
                  const active = theme === option;
                  const labels: Record<string, string> = {
                    system: "System",
                    dark: "Dark",
                    light: "Light",
                  };
                  return (
                    <button
                      key={option}
                      onClick={() => setTheme(option)}
                      style={{
                        padding: "9px 18px",
                        borderRadius: "var(--radius-full)",
                        border: active
                          ? "1px solid var(--color-primary)"
                          : "1px solid color-mix(in srgb, var(--color-border) 80%, transparent)",
                        background: active
                          ? "color-mix(in srgb, var(--color-primary) 18%, transparent)"
                          : "color-mix(in srgb, var(--color-surface-2) 84%, transparent)",
                        color: active
                          ? "var(--color-primary)"
                          : "var(--color-text-muted)",
                        cursor: "pointer",
                        fontSize: 13,
                        fontWeight: active ? 700 : 600,
                        transition:
                          "background 0.15s ease, color 0.15s ease, border-color 0.15s ease",
                      }}
                    >
                      {labels[option]}
                    </button>
                  );
                })}
              </div>
              <div
                style={{
                  marginTop: 10,
                  fontSize: 12,
                  color: "var(--color-text-muted)",
                  lineHeight: 1.5,
                }}
              >
                {theme === "system"
                  ? "Automatically matches your operating system's dark/light setting."
                  : theme === "dark"
                    ? "Always use dark mode regardless of OS setting."
                    : "Always use light mode regardless of OS setting."}
              </div>
            </SectionCard>

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
                {isTauri() && (
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
                )}
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
                      style={selectStyle}
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
                      {isTauri() && (
                        <button
                          onClick={browseDownloadFolder}
                          style={{ ...ghostBtn, whiteSpace: "nowrap" }}
                        >
                          <AppIcon name="folder" size={15} />
                          {t(language, "common.browse")}
                        </button>
                      )}
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

            {/* ─── Folder Routing ─────────────────────────────────────────── */}
            <SectionCard
              icon="download"
              title={t(language, "settings.folderRoutingTitle")}
              description={t(language, "settings.folderRoutingDescription")}
            >
              {/* ── Three fixed destinations ─────────────────────────────── */}
              <div style={{ display: "grid", gap: 10, marginBottom: 18 }}>
                {(
                  [
                    {
                      labelKey: "settings.movies" as const,
                      field: "movie_destination" as const,
                      placeholder: "e.g. /mnt/media/Movies",
                    },
                    {
                      labelKey: "settings.tvShows" as const,
                      field: "tv_destination" as const,
                      placeholder: "e.g. /mnt/media/TV Shows",
                    },
                    {
                      labelKey: "settings.documentaries" as const,
                      field: "documentary_destination" as const,
                      placeholder: "e.g. /mnt/media/Documentaries",
                    },
                  ] as const
                ).map(({ labelKey, field, placeholder }) => (
                  <div key={field} style={fieldStyle}>
                    <label style={labelStyle}>{t(language, labelKey)}</label>
                    <div style={{ display: "flex", gap: 8 }}>
                      <input
                        style={{ ...inputStyle, flex: 1 }}
                        value={form[field]}
                        onChange={(e) =>
                          setForm((c) =>
                            c ? { ...c, [field]: e.target.value } : c,
                          )
                        }
                        placeholder={placeholder}
                      />
                      {isTauri() && (
                        <button
                          onClick={() => browseDestination(field)}
                          style={{ ...ghostBtn, whiteSpace: "nowrap" }}
                        >
                          <AppIcon name="folder" size={15} />
                          {t(language, "common.browse")}
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              {/* ── Alphabetical subfolders toggle ───────────────────────── */}
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 16,
                  padding: "0.75rem 0.9rem",
                  borderRadius: "var(--radius)",
                  border:
                    "1px solid color-mix(in srgb, var(--color-border) 72%, transparent)",
                  background:
                    "color-mix(in srgb, var(--color-surface-2) 70%, transparent)",
                  marginBottom: 20,
                }}
              >
                <div>
                  <div
                    style={{
                      fontSize: 14,
                      fontWeight: 600,
                      color: "var(--color-text)",
                      marginBottom: 2,
                    }}
                  >
                    {t(language, "settings.alphabeticalSubfolders")}
                  </div>
                  <div style={subtextStyle}>
                    {t(language, "settings.alphabeticalSubfoldersHelp")}
                  </div>
                </div>
                <button
                  role="switch"
                  aria-checked={form.alphabetical_subfolders}
                  onClick={() =>
                    setForm((c) =>
                      c
                        ? {
                            ...c,
                            alphabetical_subfolders: !c.alphabetical_subfolders,
                          }
                        : c,
                    )
                  }
                  style={{
                    flexShrink: 0,
                    width: 44,
                    height: 24,
                    borderRadius: 999,
                    border: "none",
                    cursor: "pointer",
                    background: form.alphabetical_subfolders
                      ? "var(--color-primary)"
                      : "var(--color-border)",
                    position: "relative",
                    transition: "background 0.15s ease",
                  }}
                >
                  <span
                    style={{
                      position: "absolute",
                      top: 3,
                      left: form.alphabetical_subfolders ? 23 : 3,
                      width: 18,
                      height: 18,
                      borderRadius: 999,
                      background: "#fff",
                      transition: "left 0.15s ease",
                    }}
                  />
                </button>
              </div>

              {/* ── Genre rules ──────────────────────────────────────────── */}
              <div style={{ marginBottom: 10 }}>
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    marginBottom: 10,
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
                      {t(language, "settings.genreRules")}
                    </div>
                    <div style={subtextStyle}>
                      {t(language, "settings.genreRulesHelp")}
                    </div>
                  </div>
                  <button
                    onClick={addGenreRule}
                    style={{ ...primaryBtn, whiteSpace: "nowrap" }}
                  >
                    <AppIcon name="activity" size={15} />
                    {t(language, "settings.addRule")}
                  </button>
                </div>

                {(() => {
                  const rules: GenreDestRule[] = (() => {
                    try {
                      return JSON.parse(form.genre_destinations || "[]");
                    } catch {
                      return [];
                    }
                  })();
                  if (rules.length === 0) {
                    return (
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
                        {t(language, "settings.noGenreRules")}
                      </div>
                    );
                  }
                  return (
                    <div style={{ display: "grid", gap: 10 }}>
                      {rules.map((rule) => (
                        <div
                          key={rule.id}
                          style={{
                            borderRadius: "var(--radius)",
                            border:
                              "1px solid color-mix(in srgb, var(--color-border) 72%, transparent)",
                            background:
                              "color-mix(in srgb, var(--color-surface-2) 70%, transparent)",
                            padding: "0.9rem",
                          }}
                        >
                          <div
                            style={{
                              display: "grid",
                              gridTemplateColumns:
                                "minmax(0,1fr) minmax(0,1fr)",
                              gap: 10,
                              marginBottom: 10,
                            }}
                          >
                            <div style={fieldStyle}>
                              <label style={labelStyle}>
                                {t(language, "settings.ruleName")}
                              </label>
                              <input
                                style={inputStyle}
                                value={rule.label}
                                placeholder="e.g. Animation"
                                onChange={(e) =>
                                  updateGenreRule(rule.id, {
                                    label: e.target.value,
                                  })
                                }
                              />
                            </div>
                            <div style={fieldStyle}>
                              <label style={labelStyle}>
                                {t(language, "settings.applyTo")}
                              </label>
                              <select
                                style={selectStyle}
                                value={rule.media_types[0] ?? "all"}
                                onChange={(e) =>
                                  updateGenreRule(rule.id, {
                                    media_types: [
                                      e.target
                                        .value as GenreDestRule["media_types"][0],
                                    ],
                                  })
                                }
                              >
                                <option value="all">
                                  {t(language, "settings.allTypes")}
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
                              </select>
                            </div>
                          </div>

                          <div style={{ ...fieldStyle, marginBottom: 10 }}>
                            <label style={labelStyle}>
                              {t(language, "settings.genres")}
                            </label>
                            <div
                              style={{
                                display: "flex",
                                flexWrap: "wrap",
                                gap: 6,
                                padding: "0.6rem",
                                borderRadius: "var(--radius)",
                                border:
                                  "1px solid color-mix(in srgb, var(--color-border) 78%, transparent)",
                                background:
                                  "color-mix(in srgb, var(--color-surface-2) 84%, transparent)",
                                minHeight: 44,
                              }}
                            >
                              {[...GENRE_LIST]
                                .sort((a, b) =>
                                  t(language, a.i18nKey as never).localeCompare(
                                    t(language, b.i18nKey as never),
                                  ),
                                )
                                .map((g) => {
                                  const active = rule.genre_ids.includes(g.id);
                                  return (
                                    <button
                                      key={g.id}
                                      onClick={() => {
                                        const next = active
                                          ? rule.genre_ids.filter(
                                              (id) => id !== g.id,
                                            )
                                          : [...rule.genre_ids, g.id];
                                        updateGenreRule(rule.id, {
                                          genre_ids: next,
                                        });
                                      }}
                                      style={{
                                        padding: "4px 10px",
                                        borderRadius: "var(--radius-full)",
                                        border: active
                                          ? "1px solid var(--color-primary)"
                                          : "1px solid color-mix(in srgb, var(--color-border) 80%, transparent)",
                                        background: active
                                          ? "color-mix(in srgb, var(--color-primary) 18%, transparent)"
                                          : "transparent",
                                        color: active
                                          ? "var(--color-primary)"
                                          : "var(--color-text-muted)",
                                        cursor: "pointer",
                                        fontSize: 12,
                                        fontWeight: active ? 700 : 500,
                                        transition:
                                          "background 0.15s ease, color 0.15s ease, border-color 0.15s ease",
                                      }}
                                    >
                                      {t(language, g.i18nKey as never)}
                                    </button>
                                  );
                                })}
                            </div>
                          </div>

                          <div
                            style={{
                              display: "flex",
                              gap: 8,
                              alignItems: "flex-end",
                            }}
                          >
                            <div style={{ ...fieldStyle, flex: 1 }}>
                              <label style={labelStyle}>
                                {t(language, "settings.destination")}
                              </label>
                              <input
                                style={inputStyle}
                                value={rule.destination}
                                placeholder="e.g. /mnt/media/Animation"
                                onChange={(e) =>
                                  updateGenreRule(rule.id, {
                                    destination: e.target.value,
                                  })
                                }
                              />
                            </div>
                            {isTauri() && (
                              <button
                                onClick={() =>
                                  browseGenreRuleDestination(rule.id)
                                }
                                style={{ ...ghostBtn, whiteSpace: "nowrap" }}
                              >
                                <AppIcon name="folder" size={15} />
                                {t(language, "common.browse")}
                              </button>
                            )}
                            <button
                              onClick={() => removeGenreRule(rule.id)}
                              style={{
                                ...ghostBtn,
                                border:
                                  "1px solid color-mix(in srgb, var(--color-danger) 60%, transparent)",
                                color: "var(--color-danger)",
                                whiteSpace: "nowrap",
                              }}
                            >
                              <AppIcon name="close" size={14} />
                              {t(language, "common.remove")}
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  );
                })()}
              </div>
            </SectionCard>
            {/* ─── end Folder Routing ───────────────────────────────────── */}

            <SectionCard
              icon="folder"
              title={t(language, "settings.backupsTitle")}
              description={t(language, "settings.backupsDescription")}
            >
              <div style={{ display: "grid", gap: 12 }}>
                {isTauri() ? (
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
                ) : (
                  <span style={subtextStyle}>
                    Backup export and import are only available in the desktop
                    app.
                  </span>
                )}
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
                        style={selectStyle}
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
                title={t(language, "settings.webInterfaceTitle")}
                description={t(language, "settings.webInterfaceDescription")}
              >
                <div
                  style={{ display: "flex", flexDirection: "column", gap: 14 }}
                >
                  {/* Enable toggle */}
                  <label
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                      cursor: "pointer",
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={webGuiConfig.enabled}
                      onChange={(e) =>
                        setWebGuiConfig((c) =>
                          c ? { ...c, enabled: e.target.checked } : c,
                        )
                      }
                    />
                    <span
                      style={{
                        fontSize: 14,
                        fontWeight: 600,
                        color: "var(--color-text)",
                      }}
                    >
                      {t(language, "settings.webInterfaceEnable")}
                    </span>
                  </label>

                  {webGuiConfig.enabled && (
                    <div
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: 12,
                      }}
                    >
                      <div
                        style={{
                          display: "grid",
                          gridTemplateColumns: "1fr 120px",
                          gap: 10,
                        }}
                      >
                        <div style={fieldStyle}>
                          <label style={labelStyle}>
                            {t(language, "settings.webInterfaceBindHost")}
                          </label>
                          <input
                            style={inputStyle}
                            value={webGuiConfig.host}
                            onChange={(e) =>
                              setWebGuiConfig((c) =>
                                c ? { ...c, host: e.target.value } : c,
                              )
                            }
                            placeholder="0.0.0.0"
                          />
                        </div>
                        <div style={fieldStyle}>
                          <label style={labelStyle}>
                            {t(language, "settings.port")}
                          </label>
                          <input
                            style={inputStyle}
                            type="number"
                            min={1024}
                            max={65535}
                            value={webGuiConfig.port}
                            onChange={(e) =>
                              setWebGuiConfig((c) =>
                                c
                                  ? {
                                      ...c,
                                      port: parseInt(e.target.value) || c.port,
                                    }
                                  : c,
                              )
                            }
                          />
                        </div>
                      </div>

                      <div
                        style={{
                          display: "grid",
                          gridTemplateColumns: "120px 1fr",
                          gap: 10,
                        }}
                      >
                        <div style={fieldStyle}>
                          <label style={labelStyle}>
                            {t(language, "settings.webInterfaceExposedPort")}
                          </label>
                          <input
                            style={inputStyle}
                            type="number"
                            min={0}
                            max={65535}
                            value={webGuiConfig.exposed_port ?? ""}
                            placeholder={t(
                              language,
                              "settings.webInterfaceSameAsPort",
                            )}
                            onChange={(e) =>
                              setWebGuiConfig((c) =>
                                c
                                  ? {
                                      ...c,
                                      exposed_port: e.target.value
                                        ? parseInt(e.target.value)
                                        : null,
                                    }
                                  : c,
                              )
                            }
                          />
                        </div>
                        <div style={fieldStyle}>
                          <label style={labelStyle}>
                            {t(language, "settings.webInterfaceAppUrl")}
                          </label>
                          <input
                            style={inputStyle}
                            value={webGuiConfig.app_url}
                            placeholder="http://192.168.1.x:47860"
                            onChange={(e) =>
                              setWebGuiConfig((c) =>
                                c ? { ...c, app_url: e.target.value } : c,
                              )
                            }
                          />
                        </div>
                      </div>

                      {/* OTP / SMTP */}
                      <label
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 10,
                          cursor: "pointer",
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={webGuiConfig.otp_enabled}
                          onChange={(e) =>
                            setWebGuiConfig((c) =>
                              c ? { ...c, otp_enabled: e.target.checked } : c,
                            )
                          }
                        />
                        <span
                          style={{
                            fontSize: 13,
                            fontWeight: 600,
                            color: "var(--color-text)",
                          }}
                        >
                          {t(language, "settings.webInterfaceOtp")}
                        </span>
                      </label>

                      {webGuiConfig.otp_enabled && (
                        <div
                          style={{
                            display: "flex",
                            flexDirection: "column",
                            gap: 10,
                            padding: "10px 12px",
                            borderRadius: "var(--radius)",
                            border: "1px solid var(--color-border)",
                            background: "var(--color-surface-2)",
                          }}
                        >
                          <div
                            style={{
                              fontSize: 12,
                              fontWeight: 700,
                              letterSpacing: "0.04em",
                              textTransform: "uppercase" as const,
                              color: "var(--color-text-muted)",
                            }}
                          >
                            {t(language, "settings.webInterfaceSmtpSettings")}
                          </div>
                          <div
                            style={{
                              display: "grid",
                              gridTemplateColumns: "1fr 100px",
                              gap: 10,
                            }}
                          >
                            <div style={fieldStyle}>
                              <label style={labelStyle}>
                                {t(language, "settings.webInterfaceSmtpHost")}
                              </label>
                              <input
                                style={inputStyle}
                                value={webGuiConfig.smtp_host}
                                placeholder="smtp.gmail.com"
                                onChange={(e) =>
                                  setWebGuiConfig((c) =>
                                    c ? { ...c, smtp_host: e.target.value } : c,
                                  )
                                }
                              />
                            </div>
                            <div style={fieldStyle}>
                              <label style={labelStyle}>
                                {t(language, "settings.port")}
                              </label>
                              <input
                                style={inputStyle}
                                type="number"
                                value={webGuiConfig.smtp_port}
                                onChange={(e) =>
                                  setWebGuiConfig((c) =>
                                    c
                                      ? {
                                          ...c,
                                          smtp_port:
                                            parseInt(e.target.value) ||
                                            c.smtp_port,
                                        }
                                      : c,
                                  )
                                }
                              />
                            </div>
                          </div>
                          <div
                            style={{
                              display: "grid",
                              gridTemplateColumns: "1fr 1fr",
                              gap: 10,
                            }}
                          >
                            <div style={fieldStyle}>
                              <label style={labelStyle}>
                                {t(language, "settings.username")}
                              </label>
                              <input
                                style={inputStyle}
                                value={webGuiConfig.smtp_user}
                                onChange={(e) =>
                                  setWebGuiConfig((c) =>
                                    c ? { ...c, smtp_user: e.target.value } : c,
                                  )
                                }
                              />
                            </div>
                            <div style={fieldStyle}>
                              <label style={labelStyle}>
                                {t(language, "settings.password")}
                              </label>
                              <input
                                style={inputStyle}
                                type="password"
                                value={webGuiConfig.smtp_pass}
                                onChange={(e) =>
                                  setWebGuiConfig((c) =>
                                    c ? { ...c, smtp_pass: e.target.value } : c,
                                  )
                                }
                              />
                            </div>
                          </div>
                          <div style={fieldStyle}>
                            <label style={labelStyle}>
                              {t(language, "settings.webInterfaceFromAddress")}
                            </label>
                            <input
                              style={inputStyle}
                              type="email"
                              value={webGuiConfig.smtp_from}
                              placeholder="oscata@yourdomain.com"
                              onChange={(e) =>
                                setWebGuiConfig((c) =>
                                  c ? { ...c, smtp_from: e.target.value } : c,
                                )
                              }
                            />
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  <div
                    style={{ display: "flex", gap: 10, alignItems: "center" }}
                  >
                    <button
                      style={webGuiSaved ? successBtn : primaryBtn}
                      disabled={webGuiSaving}
                      onClick={saveWebGuiConfig}
                    >
                      {webGuiSaving
                        ? t(language, "common.saving")
                        : webGuiSaved
                          ? `✓ ${t(language, "common.saved")}`
                          : t(language, "settings.webInterfaceSave")}
                    </button>
                    <button
                      style={ghostBtn}
                      disabled={webGuiInitBusy}
                      onClick={saveAndInitWebGui}
                    >
                      {webGuiInitBusy
                        ? t(language, "settings.webInterfaceStarting")
                        : t(language, "settings.webInterfaceInitNow")}
                    </button>
                  </div>
                  {webGuiMessage && (
                    <div
                      style={{ ...subtextStyle, color: "var(--color-success)" }}
                    >
                      {webGuiMessage}
                    </div>
                  )}
                  {webGuiError && (
                    <div
                      style={{ ...subtextStyle, color: "var(--color-danger)" }}
                    >
                      {webGuiError}
                    </div>
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
