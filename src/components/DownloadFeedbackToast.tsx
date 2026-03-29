import { useEffect, useState } from "react";
import AppIcon from "./AppIcon";
import type { AppLanguage } from "../utils/mediaLanguage";
import { t } from "../utils/i18n";

type ToastItem = {
  id: number;
  kind: "success" | "error";
  title: string;
};

type DownloadFeedbackDetail = {
  kind: "success" | "error";
  title: string;
};

export default function DownloadFeedbackToast({ language }: { language: AppLanguage }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  useEffect(() => {
    const onFeedback = (event: Event) => {
      const detail = (event as CustomEvent<DownloadFeedbackDetail>).detail;
      if (!detail?.title) return;
      const id = Date.now() + Math.floor(Math.random() * 1000);
      setToasts((current) => [...current, { id, kind: detail.kind, title: detail.title }].slice(-3));
      window.setTimeout(() => {
        setToasts((current) => current.filter((toast) => toast.id !== id));
      }, 2800);
    };

    window.addEventListener("download:feedback", onFeedback as EventListener);
    return () => window.removeEventListener("download:feedback", onFeedback as EventListener);
  }, []);

  if (toasts.length === 0) return null;

  return (
    <div
      style={{
        position: "fixed",
        right: 18,
        top: 78,
        display: "flex",
        flexDirection: "column",
        gap: 10,
        zIndex: 250,
        pointerEvents: "none",
      }}
    >
      {toasts.map((toast) => {
        const isError = toast.kind === "error";
        return (
          <div
            key={toast.id}
            style={{
              width: "min(360px, calc(100vw - 36px))",
              padding: "0.9rem 1rem",
              borderRadius: "calc(var(--radius-lg) + 2px)",
              border: `1px solid ${isError
                ? "color-mix(in srgb, var(--color-danger) 34%, transparent)"
                : "color-mix(in srgb, var(--color-border) 78%, transparent)"}`,
              background:
                "linear-gradient(155deg, color-mix(in srgb, var(--color-surface) 95%, transparent), color-mix(in srgb, var(--color-surface-2) 87%, transparent))",
              boxShadow: "0 18px 40px color-mix(in srgb, black 24%, transparent)",
              backdropFilter: "blur(16px) saturate(150%)",
              WebkitBackdropFilter: "blur(16px) saturate(150%)",
            }}
          >
            <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  width: 32,
                  height: 32,
                  borderRadius: 999,
                  background: isError
                    ? "color-mix(in srgb, var(--color-danger) 14%, transparent)"
                    : "color-mix(in srgb, var(--color-primary) 16%, transparent)",
                  color: isError ? "var(--color-danger)" : "var(--color-primary)",
                  flexShrink: 0,
                }}
              >
                <AppIcon name={isError ? "close" : "download"} size={16} strokeWidth={2.2} />
              </span>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: isError ? "var(--color-danger)" : "var(--color-primary)", marginBottom: 4 }}>
                  {isError ? t(language, "downloads.toastErrorTitle") : t(language, "downloads.toastQueuedTitle")}
                </div>
                <div style={{ fontSize: 13, fontWeight: 700, color: "var(--color-text)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {toast.title}
                </div>
                <div style={{ fontSize: 12, color: "var(--color-text-muted)", marginTop: 4 }}>
                  {isError ? t(language, "downloads.toastErrorBody") : t(language, "downloads.toastQueuedBody")}
                </div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
