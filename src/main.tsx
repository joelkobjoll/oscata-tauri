import "./index.css";
import React from "react";
import ReactDOM from "react-dom/client";
import Router from "./router";
import ThemeProvider from "./components/ThemeProvider";

// Disable right-click context menu for a native app feel.
document.addEventListener("contextmenu", (e) => e.preventDefault());

async function setupWatchdogBridge() {
  if (!("__TAURI_INTERNALS__" in window)) return;

  const [{ listen }, { invoke }] = await Promise.all([
    import("@tauri-apps/api/event"),
    import("@tauri-apps/api/core"),
  ]);

  const unlisten = await listen<{ nonce: number }>("watchdog:ping", (event) => {
    const nonce = event.payload?.nonce;
    if (typeof nonce !== "number") return;
    invoke("watchdog_pong", { nonce }).catch(() => {});
  });

  window.addEventListener(
    "beforeunload",
    () => {
      unlisten();
    },
    { once: true },
  );
}

void setupWatchdogBridge();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ThemeProvider>
      <Router />
    </ThemeProvider>
  </React.StrictMode>,
);
