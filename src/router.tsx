import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import Wizard from "./pages/Wizard";
import Library from "./pages/Library";
import { isTauri } from "./lib/transport";
import { prefetchConfig } from "./lib/configCache";
import { AuthProvider, useAuth } from "./lib/AuthContext";
import { apiBase } from "./lib/transport";
import Login from "./pages/Login";
import WebBootstrap from "./pages/WebBootstrap";
import WebSetupWizard from "./pages/WebSetupWizard";
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
  const [startIndexingAfterWizard, setStartIndexingAfterWizard] =
    useState(false);

  useEffect(() => {
    invoke<boolean>("has_config")
      .then(setReady)
      .catch(() => setReady(false));
  }, []);

  if (ready === null) return <LoadingScreen />;
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
  const { user } = useAuth();
  const [bootstrapRequired, setBootstrapRequired] = useState<boolean | null>(
    null,
  );
  const [hasConfig, setHasConfig] = useState<boolean | null>(null);
  const [page, setPage] = useState<"library" | "users">(
    () => window.location.pathname === "/usuarios" ? "users" : "library"
  );
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const inviteToken = new URLSearchParams(window.location.search).get("invite");

  useEffect(() => {
    // Pre-fetch the app config so Settings opens instantly (avoids the
    // full-screen loading overlay that shows while form === null).
    prefetchConfig();
  }, []);

  useEffect(() => {
    if (!menuOpen) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [menuOpen]);

  useEffect(() => {
    const handlePop = () => {
      setPage(window.location.pathname === "/usuarios" ? "users" : "library");
    };
    window.addEventListener("popstate", handlePop);
    return () => window.removeEventListener("popstate", handlePop);
  }, []);

  useEffect(() => {
    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    const loadBootstrapStatus = async () => {
      try {
        const response = await fetch(`${apiBase}/server-info`, {
          cache: "no-store",
        });
        if (!response.ok) throw new Error(`server-info ${response.status}`);
        const info = await response.json();
        if (!cancelled) {
          setBootstrapRequired(Boolean(info.bootstrap_required));
          setHasConfig(Boolean(info.has_config));
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

  if (user === null || bootstrapRequired === null || (user !== false && hasConfig === null)) {
    return <LoadingScreen />;
  }

  if (bootstrapRequired && user === false) {
    return (
      <WebBootstrap
        onComplete={() => {
          setBootstrapRequired(false);
          // Fresh install: no config yet after bootstrap
          setHasConfig(false);
        }}
      />
    );
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

  // Logged in but no FTP/TMDB config yet → show the initial setup wizard
  if (hasConfig === false) {
    return (
      <WebSetupWizard
        onComplete={() => {
          setHasConfig(true);
          prefetchConfig();
        }}
      />
    );
  }

  const isAdmin = user.role === "admin";

  // Single avatar button — opens a dropdown with user info, theme, and admin links
  const avatarBtn: React.CSSProperties = {
    width: 40,
    height: 40,
    borderRadius: 999,
    border: menuOpen
      ? "1px solid color-mix(in srgb, var(--color-primary) 50%, transparent)"
      : "1px solid color-mix(in srgb, var(--color-border) 84%, transparent)",
    background: menuOpen
      ? "color-mix(in srgb, var(--color-primary) 18%, transparent)"
      : "color-mix(in srgb, var(--color-surface) 94%, transparent)",
    color: menuOpen ? "var(--color-primary)" : "var(--color-text)",
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: 13,
    fontWeight: 700,
    boxShadow: "inset 0 1px 0 color-mix(in srgb, white 4%, transparent)",
    transition: "background 0.15s ease, border-color 0.15s ease, color 0.15s ease",
    userSelect: "none",
    flexShrink: 0,
  };

  const headerSlot = (
    <div ref={menuRef} style={{ position: "relative" }}>
      <button
        onClick={() => setMenuOpen((v) => !v)}
        style={avatarBtn}
        title={user.email}
      >
        {user.email.charAt(0).toUpperCase()}
      </button>

      {menuOpen && (
        <div
          style={{
            position: "absolute",
            right: 0,
            top: "calc(100% + 8px)",
            background: "var(--color-surface)",
            border: "1px solid var(--color-border)",
            borderRadius: "var(--radius-lg)",
            boxShadow: "0 12px 32px rgba(0,0,0,0.45), 0 2px 8px rgba(0,0,0,0.2)",
            minWidth: 200,
            zIndex: 70,
            padding: "4px",
          }}
        >
          {/* User info header */}
          <div
            style={{
              padding: "10px 12px 8px",
              borderBottom: "1px solid var(--color-border)",
              marginBottom: 4,
            }}
          >
            <div style={{ fontSize: 12, fontWeight: 600, color: "var(--color-text)", marginBottom: 2 }}>
              {user.email}
            </div>
            <div style={{ fontSize: 11, color: "var(--color-text-muted)", textTransform: "capitalize" }}>
              {user.role}
            </div>
          </div>

          {/* Theme row */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "6px 12px",
              gap: 8,
            }}
          >
            <span style={{ fontSize: 13, color: "var(--color-text-muted)" }}>Tema</span>
            <ThemeToggle />
          </div>

          {/* Admin section */}
          {isAdmin && (
            <>
              <div
                style={{
                  borderTop: "1px solid var(--color-border)",
                  margin: "4px 0",
                }}
              />
              <button
                onClick={() => { window.history.pushState({}, "", "/usuarios"); setPage("users"); setMenuOpen(false); }}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  width: "100%",
                  textAlign: "left",
                  padding: "8px 12px",
                  background: page === "users"
                    ? "color-mix(in srgb, var(--color-primary) 14%, transparent)"
                    : "none",
                  border: "none",
                  borderRadius: "6px",
                  color: page === "users" ? "var(--color-primary)" : "var(--color-text)",
                  fontSize: 13,
                  fontWeight: 500,
                  cursor: "pointer",
                  transition: "background 0.12s ease",
                }}
                onMouseEnter={(e) => {
                  if (page !== "users") (e.currentTarget as HTMLButtonElement).style.background = "color-mix(in srgb, var(--color-text) 6%, transparent)";
                }}
                onMouseLeave={(e) => {
                  if (page !== "users") (e.currentTarget as HTMLButtonElement).style.background = "none";
                }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
                  <circle cx="9" cy="7" r="4"/>
                  <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
                  <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
                </svg>
                Gestionar usuarios
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );

  return (
    <>
      {page === "library" && <Library startIndexingOnMount={false} headerSlot={headerSlot} />}
      {page === "users" && isAdmin && <WebUsers />}
    </>
  );
}

function LoadingScreen() {
  return (
    <div
      style={{
        height: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 28,
        background: "var(--color-bg)",
      }}
    >
      {/* Wordmark */}
      <div
        style={{
          fontSize: 28,
          fontWeight: 800,
          letterSpacing: "-0.03em",
          color: "var(--color-text)",
          fontFamily: "var(--font-sans)",
          userSelect: "none",
        }}
      >
        osc
        <span style={{ color: "var(--color-primary)" }}>ata</span>
      </div>

      {/* Spinner ring */}
      <svg
        width="36"
        height="36"
        viewBox="0 0 36 36"
        fill="none"
        style={{ animation: "spin 0.9s linear infinite" }}
      >
        <circle
          cx="18"
          cy="18"
          r="15"
          stroke="var(--color-border)"
          strokeWidth="3"
        />
        <path
          d="M18 3 A15 15 0 0 1 33 18"
          stroke="var(--color-primary)"
          strokeWidth="3"
          strokeLinecap="round"
        />
      </svg>
    </div>
  );
}
