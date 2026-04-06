import { useState } from "react";
import { apiBase, getToken } from "../lib/transport";
import AppIcon from "../components/AppIcon";

interface WebSetupWizardProps {
  onComplete: () => void;
}

interface FtpFields {
  ftp_host: string;
  ftp_port: number;
  ftp_user: string;
  ftp_pass: string;
  ftp_root: string;
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
  padding: "1.25rem",
};

const labelStyle: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 700,
  letterSpacing: "0.04em",
  textTransform: "uppercase",
  color: "var(--color-text-muted)",
  display: "block",
  marginBottom: 6,
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

const primaryBtn = (disabled?: boolean): React.CSSProperties => ({
  padding: "10px 20px",
  borderRadius: "var(--radius-full)",
  border: "none",
  background: disabled
    ? "color-mix(in srgb, var(--color-primary) 46%, transparent)"
    : "var(--color-primary)",
  color: "#fff",
  cursor: disabled ? "not-allowed" : "pointer",
  fontSize: 14,
  fontWeight: 700,
  display: "inline-flex",
  alignItems: "center",
  gap: 8,
  opacity: disabled ? 0.7 : 1,
  transition: "opacity 0.15s ease",
});

const secondaryBtn: React.CSSProperties = {
  padding: "10px 20px",
  borderRadius: "var(--radius-full)",
  border: "1px solid color-mix(in srgb, var(--color-border) 80%, transparent)",
  background: "color-mix(in srgb, var(--color-surface) 88%, transparent)",
  color: "var(--color-text-muted)",
  cursor: "pointer",
  fontSize: 14,
  fontWeight: 600,
  display: "inline-flex",
  alignItems: "center",
  gap: 8,
};

function authedFetch(path: string, options: RequestInit = {}) {
  const token = getToken();
  return fetch(`${apiBase}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers ?? {}),
    },
  });
}

// ── Step 1: FTP ───────────────────────────────────────────────────────────────

function StepFTP({
  defaults,
  onNext,
}: {
  defaults: FtpFields;
  onNext: (f: FtpFields) => void;
}) {
  const [form, setForm] = useState(defaults);
  const [testing, setTesting] = useState(false);
  const [testStatus, setTestStatus] = useState<"idle" | "ok" | "error">("idle");
  const [testError, setTestError] = useState("");

  const set =
    (key: keyof FtpFields) =>
    (e: React.ChangeEvent<HTMLInputElement>) =>
      setForm((f) => ({
        ...f,
        [key]: key === "ftp_port" ? Number(e.target.value) : e.target.value,
      }));

  const testConnection = async () => {
    setTesting(true);
    setTestStatus("idle");
    setTestError("");
    try {
      const res = await authedFetch("/ftp/test", {
        method: "POST",
        body: JSON.stringify({
          host: form.ftp_host,
          port: form.ftp_port,
          user: form.ftp_user,
          pass: form.ftp_pass,
        }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error ?? `Error ${res.status}`);
      }
      setTestStatus("ok");
    } catch (err: unknown) {
      setTestStatus("error");
      setTestError(err instanceof Error ? err.message : String(err));
    } finally {
      setTesting(false);
    }
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onNext(form);
      }}
      style={{ display: "grid", gap: 20 }}
    >
      <div>
        <h2 style={{ margin: "0 0 6px", fontSize: 22, fontWeight: 800, letterSpacing: "-0.03em", color: "var(--color-text)" }}>
          Servidor FTP
        </h2>
        <p style={{ margin: 0, fontSize: 13, color: "var(--color-text-muted)" }}>
          Oscata se conecta a tu servidor FTP para indexar y descargar archivos.
        </p>
      </div>

      <section style={sectionCard}>
        <div style={{ display: "grid", gap: 14 }}>
          <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) 140px", gap: 12 }}>
            <div>
              <label style={labelStyle}>Host</label>
              <input style={inputStyle} value={form.ftp_host} onChange={set("ftp_host")} placeholder="192.168.1.100" required />
            </div>
            <div>
              <label style={labelStyle}>Puerto</label>
              <input style={inputStyle} type="number" value={form.ftp_port} onChange={set("ftp_port")} min={1} max={65535} required />
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div>
              <label style={labelStyle}>Usuario</label>
              <input style={inputStyle} value={form.ftp_user} onChange={set("ftp_user")} autoComplete="username" />
            </div>
            <div>
              <label style={labelStyle}>Contraseña</label>
              <input style={inputStyle} type="password" value={form.ftp_pass} onChange={set("ftp_pass")} autoComplete="current-password" />
            </div>
          </div>

          <div>
            <label style={labelStyle}>Ruta raíz</label>
            <input style={inputStyle} value={form.ftp_root} onChange={set("ftp_root")} placeholder="/Compartida" required />
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            <button
              type="button"
              onClick={testConnection}
              disabled={testing || !form.ftp_host}
              style={primaryBtn(testing || !form.ftp_host)}
            >
              {testing ? (
                <AppIcon name="refresh-cw" size={14} strokeWidth={2} />
              ) : (
                <AppIcon name="wifi-off" size={14} strokeWidth={2} />
              )}
              {testing ? "Probando..." : "Probar conexión"}
            </button>

            {testStatus === "ok" && (
              <span style={{ fontSize: 13, color: "var(--color-success)", display: "flex", alignItems: "center", gap: 6 }}>
                <AppIcon name="check" size={14} strokeWidth={2} />
                Conexión correcta
              </span>
            )}
            {testStatus === "error" && (
              <span style={{ fontSize: 13, color: "var(--color-danger)" }}>{testError || "Error de conexión"}</span>
            )}
          </div>
        </div>
      </section>

      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <button type="submit" style={primaryBtn(false)}>
          Siguiente
          <AppIcon name="chevron-right" size={14} strokeWidth={2.2} />
        </button>
      </div>
    </form>
  );
}

// ── Step 2: TMDB ──────────────────────────────────────────────────────────────

function StepTMDB({
  defaultKey,
  onBack,
  onFinish,
  saving,
}: {
  defaultKey: string;
  onBack: () => void;
  onFinish: (key: string) => void;
  saving: boolean;
}) {
  const [key, setKey] = useState(defaultKey);

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onFinish(key);
      }}
      style={{ display: "grid", gap: 20 }}
    >
      <div>
        <h2 style={{ margin: "0 0 6px", fontSize: 22, fontWeight: 800, letterSpacing: "-0.03em", color: "var(--color-text)" }}>
          API de TMDB
        </h2>
        <p style={{ margin: 0, fontSize: 13, color: "var(--color-text-muted)" }}>
          Se usa para obtener portadas, sinopsis y metadatos de películas y series.{" "}
          <a
            href="https://www.themoviedb.org/settings/api"
            target="_blank"
            rel="noreferrer"
            style={{ color: "var(--color-primary)" }}
          >
            Consigue tu clave API aquí.
          </a>
        </p>
      </div>

      <section style={sectionCard}>
        <label style={labelStyle}>Clave API (v3 — Read Access Token)</label>
        <input
          style={inputStyle}
          value={key}
          onChange={(e) => setKey(e.target.value)}
          placeholder="eyJhbGciOiJIUzI1NiJ9..."
          required
        />
        <p style={{ margin: "8px 0 0", fontSize: 12, color: "var(--color-text-muted)" }}>
          Puedes cambiarla más adelante en Ajustes.
        </p>
      </section>

      <div style={{ display: "flex", justifyContent: "space-between" }}>
        <button type="button" onClick={onBack} style={secondaryBtn}>
          <span style={{ transform: "rotate(180deg)", display: "inline-flex" }}>
            <AppIcon name="chevron-right" size={14} strokeWidth={2.2} />
          </span>
          Atrás
        </button>
        <button type="submit" disabled={saving || !key.trim()} style={primaryBtn(saving || !key.trim())}>
          {saving ? (
            <AppIcon name="refresh-cw" size={14} strokeWidth={2} />
          ) : (
            <AppIcon name="check" size={14} strokeWidth={2.5} />
          )}
          {saving ? "Guardando..." : "Guardar y empezar"}
        </button>
      </div>
    </form>
  );
}

// ── Shell ─────────────────────────────────────────────────────────────────────

export default function WebSetupWizard({ onComplete }: WebSetupWizardProps) {
  const [step, setStep] = useState<1 | 2>(1);
  const [ftp, setFtp] = useState<FtpFields>({
    ftp_host: "",
    ftp_port: 21,
    ftp_user: "",
    ftp_pass: "",
    ftp_root: "/Compartida",
  });
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");

  const handleFinish = async (tmdbKey: string) => {
    setSaving(true);
    setSaveError("");
    try {
      // Load any pre-existing config to avoid overwriting unrelated fields
      const existing = (await authedFetch("/settings").then((r) =>
        r.ok ? r.json() : {}
      )) as Record<string, unknown>;
      const config = {
        ...existing,
        ...ftp,
        tmdb_api_key: tmdbKey,
        default_language: existing.default_language ?? "es",
        download_folder: existing.download_folder ?? "/downloads",
        folder_types: existing.folder_types ?? "{}",
        max_concurrent_downloads: existing.max_concurrent_downloads ?? 2,
      };
      const res = await authedFetch("/settings", {
        method: "PUT",
        body: JSON.stringify(config),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error ?? `Error ${res.status}`);
      }
      onComplete();
    } catch (err: unknown) {
      setSaveError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const STEPS = ["Servidor FTP", "API de TMDB"];

  return (
    <div
      style={{
        minHeight: "100dvh",
        padding: "clamp(1rem, 3vw, 2rem) clamp(1rem, 3vw, 1.5rem)",
        background:
          "radial-gradient(circle at top, color-mix(in srgb, var(--color-primary) 12%, transparent), transparent 42%), var(--color-bg)",
      }}
    >
      <div style={{ maxWidth: 740, margin: "0 auto", display: "grid", gap: 20 }}>
        {/* Header */}
        <section style={{ ...shellCard, padding: "1.25rem 1.5rem" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <div
              style={{
                width: 42,
                height: 42,
                borderRadius: 14,
                background: "color-mix(in srgb, var(--color-primary) 16%, transparent)",
                color: "var(--color-primary)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
              }}
            >
              <AppIcon name="settings" size={20} strokeWidth={2.1} />
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 22, fontWeight: 800, letterSpacing: "-0.03em", color: "var(--color-text)" }}>
                Configuración inicial
              </div>
              <div style={{ fontSize: 13, color: "var(--color-text-muted)", marginTop: 2 }}>
                Solo necesitas hacer esto una vez.
              </div>
            </div>
            {/* Step pills */}
            <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
              {STEPS.map((label, i) => {
                const num = i + 1;
                const active = num === step;
                const done = num < step;
                return (
                  <div
                    key={label}
                    style={{
                      padding: "4px 12px",
                      borderRadius: "var(--radius-full)",
                      fontSize: 12,
                      fontWeight: 700,
                      background: active
                        ? "var(--color-primary)"
                        : done
                          ? "color-mix(in srgb, var(--color-success) 20%, transparent)"
                          : "color-mix(in srgb, var(--color-border) 60%, transparent)",
                      color: active ? "#fff" : done ? "var(--color-success)" : "var(--color-text-muted)",
                      transition: "background 0.15s ease, color 0.15s ease",
                    }}
                  >
                    {done ? "✓" : num}. {label}
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        {/* Content */}
        <section style={{ ...shellCard, padding: "1.5rem" }}>
          {step === 1 && (
            <StepFTP
              defaults={ftp}
              onNext={(f) => {
                setFtp(f);
                setStep(2);
              }}
            />
          )}
          {step === 2 && (
            <StepTMDB
              defaultKey=""
              onBack={() => setStep(1)}
              onFinish={handleFinish}
              saving={saving}
            />
          )}
          {saveError && (
            <div
              style={{
                marginTop: 14,
                padding: "0.75rem 1rem",
                borderRadius: "var(--radius)",
                background: "color-mix(in srgb, var(--color-danger) 12%, transparent)",
                border: "1px solid color-mix(in srgb, var(--color-danger) 30%, transparent)",
                color: "var(--color-danger)",
                fontSize: 13,
              }}
            >
              {saveError}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
