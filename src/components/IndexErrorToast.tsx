import { useState } from "react";
import AppIcon from "./AppIcon";
import type { AppLanguage } from "../utils/mediaLanguage";
import { t } from "../utils/i18n";

interface IndexErrorToastProps {
  message: string;
  language: AppLanguage;
  onRetry: () => void;
  onOpenSettings: () => void;
  onDismiss: () => void;
}

export default function IndexErrorToast({
  message,
  language,
  onRetry,
  onOpenSettings,
  onDismiss,
}: IndexErrorToastProps) {
  const [retrying, setRetrying] = useState(false);

  const handleRetry = async () => {
    setRetrying(true);
    onDismiss();
    onRetry();
    // The hook will clear the error on index:start and show new errors if they occur
    setRetrying(false);
  };

  return (
    <div
      style={{
        position: "fixed",
        right: 18,
        bottom: 22,
        width: "min(380px, calc(100vw - 36px))",
        padding: "0.95rem 1rem",
        borderRadius: "calc(var(--radius-lg) + 2px)",
        border:
          "1px solid color-mix(in srgb, var(--color-danger) 34%, transparent)",
        background:
          "linear-gradient(155deg, color-mix(in srgb, var(--color-surface) 95%, transparent), color-mix(in srgb, var(--color-surface-2) 87%, transparent))",
        boxShadow: "0 18px 42px color-mix(in srgb, black 30%, transparent)",
        backdropFilter: "blur(18px) saturate(150%)",
        WebkitBackdropFilter: "blur(18px) saturate(150%)",
        zIndex: 46,
      }}
    >
      {/* Header row */}
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: 12,
          marginBottom: 10,
        }}
      >
        <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              width: 34,
              height: 34,
              borderRadius: 999,
              background:
                "color-mix(in srgb, var(--color-danger) 14%, transparent)",
              color: "var(--color-danger)",
              flexShrink: 0,
            }}
          >
            <AppIcon name="wifi-off" size={17} strokeWidth={2.1} />
          </span>
          <div>
            <div
              style={{
                fontSize: 12,
                fontWeight: 700,
                letterSpacing: "0.06em",
                textTransform: "uppercase",
                color: "var(--color-danger)",
                marginBottom: 4,
              }}
            >
              {t(language, "toast.error.title")}
            </div>
            <div
              style={{
                fontSize: 13,
                fontWeight: 500,
                color: "var(--color-text)",
                wordBreak: "break-word",
              }}
            >
              {message}
            </div>
          </div>
        </div>

        <button
          onClick={onDismiss}
          title={t(language, "toast.error.dismiss")}
          style={{
            width: 30,
            height: 30,
            border:
              "1px solid color-mix(in srgb, var(--color-border) 80%, transparent)",
            borderRadius: 999,
            background:
              "color-mix(in srgb, var(--color-surface) 96%, transparent)",
            color: "var(--color-text-muted)",
            cursor: "pointer",
            fontSize: 16,
            lineHeight: 1,
            flexShrink: 0,
          }}
        >
          ×
        </button>
      </div>

      {/* Action buttons */}
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <button
          onClick={onOpenSettings}
          style={{
            height: 32,
            padding: "0 12px",
            borderRadius: "var(--radius)",
            border:
              "1px solid color-mix(in srgb, var(--color-border) 80%, transparent)",
            background: "none",
            color: "var(--color-text-muted)",
            cursor: "pointer",
            fontSize: 12,
            fontWeight: 600,
          }}
        >
          {t(language, "library.openSettings")}
        </button>
        <button
          onClick={handleRetry}
          disabled={retrying}
          style={{
            height: 32,
            padding: "0 14px",
            borderRadius: "var(--radius)",
            border: "none",
            background:
              "color-mix(in srgb, var(--color-danger) 18%, transparent)",
            color: "var(--color-danger)",
            cursor: retrying ? "not-allowed" : "pointer",
            fontSize: 12,
            fontWeight: 700,
            display: "flex",
            alignItems: "center",
            gap: 6,
            opacity: retrying ? 0.6 : 1,
            transition: "opacity 0.15s ease",
          }}
        >
          <AppIcon name="refresh-cw" size={13} strokeWidth={2.3} />
          {t(language, "toast.error.retry")}
        </button>
      </div>
    </div>
  );
}
