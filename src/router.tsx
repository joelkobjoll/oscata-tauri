import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import Wizard from "./pages/Wizard";
import Library from "./pages/Library";
import { t } from "./utils/i18n";
import type { AppLanguage } from "./utils/mediaLanguage";
import { isTauri } from "./lib/transport";
import { AuthProvider, useAuth } from "./lib/AuthContext";
import { apiBase } from "./lib/transport";
import Login from "./pages/Login";
import WebBootstrap from "./pages/WebBootstrap";
import Settings from "./pages/Settings";
import WebUsers from "./pages/WebUsers";
import InviteAccept from "./pages/InviteAccept";
import ThemeToggle from "./components/ThemeToggle";

export default function Router() {
  if (!isTauri()) {
    return (
      <AuthProvider>
        <WebRouter />
      </AuthProvider>
    );
  }
  const [ready, setReady] = useState<boolean | null>(null);
  const [startIndexingAfterWizard, setStartIndexingAfterWizard] = useState(false);
  const language: AppLanguage = "es";

  useEffect(() => {
    invoke<boolean>("has_config").then(setReady).catch(() => setReady(false));
  }, []);

  if (ready === null) return (
    <div style={{ height: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "var(--color-bg)" }}>
      <div style={{ color: "var(--color-text-muted)", fontSize: 14 }}>{t(language, "router.loading")}</div>
    </div>
  );
  return ready ? (
    <Library startIndexingOnMount={startIndexingAfterWizard} />
  ) : (
    <Wizard
      onComplete={(options) => {
        setStartIndexingAfterWizard(options?.startIndexing === true);
        setReady(true);
      }}
    />
  );
}

function WebRouter() {
  const language: AppLanguage = "es";
  const { user } = useAuth();
  const [bootstrapRequired, setBootstrapRequired] = useState<boolean | null>(null);
  const [page, setPage] = useState<"library" | "settings" | "users">("library");
  const inviteToken = new URLSearchParams(window.location.search).get("invite");

  useEffect(() => {
    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    const loadBootstrapStatus = async () => {
      try {
        const response = await fetch(`${apiBase}/server-info`, { cache: "no-store" });
        if (!response.ok) throw new Error(`server-info ${response.status}`);
        const info = await response.json();
        if (!cancelled) {
          setBootstrapRequired(Boolean(info.bootstrap_required));
        }
      } catch {
        // Keep loading and retry; never assume login path when bootstrap state is unknown.
        if (!cancelled) {
          setBootstrapRequired(null);
          retryTimer = setTimeout(loadBootstrapStatus, 1200);
        }
      }
    };

    loadBootstrapStatus();

    return () => {
      cancelled = true;
      if (retryTimer) clearTimeout(retryTimer);
    };
  }, []);

  if (user === null || bootstrapRequired === null) {
    return (
      <div style={{ height: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "var(--color-bg)" }}>
        <div style={{ color: "var(--color-text-muted)", fontSize: 14 }}>{t(language, "router.loading")}</div>
      </div>
    );
  }

  if (bootstrapRequired && user === false) {
    return <WebBootstrap onComplete={() => setBootstrapRequired(false)} />;
  }

  if (user === false && inviteToken) {
    return (
      <InviteAccept
        token={inviteToken}
        onAccepted={() => {
          window.history.replaceState({}, "", window.location.pathname);
        }}
      />
    );
  }

  if (user === false) {
    return <Login />;
  }

  const isAdmin = user.role === "admin";

  const shellStyle: React.CSSProperties = {
    minHeight: "100dvh",
    display: "flex",
    flexDirection: "column",
    background: "var(--color-bg)",
  };

  const navBtn = (active: boolean): React.CSSProperties => ({
    padding: "0.5rem 0.8rem",
    borderRadius: "var(--radius)",
    border: active ? "1px solid color-mix(in srgb, var(--color-primary) 45%, transparent)" : "1px solid var(--color-border)",
    background: active ? "color-mix(in srgb, var(--color-primary) 20%, var(--color-surface))" : "var(--color-surface)",
    color: active ? "var(--color-text)" : "var(--color-text-muted)",
    cursor: "pointer",
    fontSize: 13,
    fontWeight: 700,
  });

  return (
    <div style={shellStyle}>
      <div
        style={{
          position: "sticky",
          top: 0,
          zIndex: 10,
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexWrap: "wrap",
          gap: "0.5rem",
          padding: "0.8rem 1rem",
          borderBottom: "1px solid var(--color-border)",
          background: "color-mix(in srgb, var(--color-bg) 88%, black)",
        }}
      >
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <button style={navBtn(page === "library")} onClick={() => setPage("library")}>
            Library
          </button>
          <button style={navBtn(page === "settings")} onClick={() => setPage("settings")}>
            Settings
          </button>
          {isAdmin && (
            <button style={navBtn(page === "users")} onClick={() => setPage("users")}>
              Users
            </button>
          )}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <ThemeToggle />
          <div style={{ color: "var(--color-text-muted)", fontSize: 12, maxWidth: "30vw", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{user.email}</div>
        </div>
      </div>

      {page === "library" && <Library startIndexingOnMount={false} />}
      {page === "settings" && <Settings language={language} onClose={() => setPage("library")} />}
      {page === "users" && isAdmin && <WebUsers />}
    </div>
  );
}
