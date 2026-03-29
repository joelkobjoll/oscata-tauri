import { useEffect, useState } from "react";
import AppIcon from "./AppIcon";
import type { AppLanguage } from "../utils/mediaLanguage";
import { t } from "../utils/i18n";

export default function IndexStatus({
  progress,
  language,
}: {
  progress: { current: number; total: number } | null;
  language: AppLanguage;
}) {
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    if (!progress) return;
    setCollapsed(false);
  }, [progress?.total]);

  useEffect(() => {
    if (!progress || collapsed) return;
    const timer = window.setTimeout(() => setCollapsed(true), 3000);
    return () => window.clearTimeout(timer);
  }, [collapsed, progress?.current, progress?.total]);

  if (!progress) return null;

  const percent = progress.total > 0 ? Math.min(100, Math.round((progress.current / progress.total) * 100)) : 0;

  if (collapsed) {
    return (
      <button
        onClick={() => setCollapsed(false)}
        title={t(language, "toast.expand")}
        style={{
          position: "fixed",
          right: 18,
          bottom: 22,
          display: "flex",
          alignItems: "center",
          gap: 10,
          minHeight: 44,
          padding: "0.7rem 0.85rem",
          borderRadius: 999,
          border: "1px solid color-mix(in srgb, var(--color-border) 78%, transparent)",
          background:
            "linear-gradient(155deg, color-mix(in srgb, var(--color-surface) 96%, transparent), color-mix(in srgb, var(--color-surface-2) 88%, transparent))",
          boxShadow: "0 14px 34px color-mix(in srgb, black 24%, transparent)",
          color: "var(--color-text)",
          cursor: "pointer",
          zIndex: 46,
        }}
      >
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: 28,
            height: 28,
            borderRadius: 999,
            background: "color-mix(in srgb, var(--color-primary) 18%, transparent)",
            color: "var(--color-primary)",
          }}
        >
          <AppIcon name="refresh-cw" size={15} strokeWidth={2.1} />
        </span>
        <span style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 2 }}>
          <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--color-text-muted)" }}>
            {t(language, "toast.refresh")}
          </span>
          <span style={{ fontSize: 13, fontWeight: 800 }}>{percent}%</span>
        </span>
      </button>
    );
  }

  return (
    <div
      style={{
        position: "fixed",
        right: 18,
        bottom: 22,
        width: "min(360px, calc(100vw - 36px))",
        padding: "0.95rem 1rem",
        borderRadius: "calc(var(--radius-lg) + 2px)",
        border: "1px solid color-mix(in srgb, var(--color-border) 78%, transparent)",
        background:
          "linear-gradient(155deg, color-mix(in srgb, var(--color-surface) 94%, transparent), color-mix(in srgb, var(--color-surface-2) 84%, transparent))",
        boxShadow: "0 18px 42px color-mix(in srgb, black 28%, transparent)",
        backdropFilter: "blur(18px) saturate(150%)",
        WebkitBackdropFilter: "blur(18px) saturate(150%)",
        zIndex: 46,
        transition: "opacity 160ms ease, transform 160ms ease",
      }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, marginBottom: 10 }}>
        <div style={{ display: "flex", gap: 10 }}>
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              width: 34,
              height: 34,
              borderRadius: 999,
              background: "color-mix(in srgb, var(--color-primary) 16%, transparent)",
              color: "var(--color-primary)",
              flexShrink: 0,
            }}
          >
            <AppIcon name="refresh-cw" size={18} strokeWidth={2.1} />
          </span>
          <div>
          <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--color-primary)", marginBottom: 4 }}>
            {t(language, "toast.refresh")}
          </div>
          <div style={{ fontSize: 14, fontWeight: 700, color: "var(--color-text)" }}>
            {t(language, "toast.indexing", { current: progress.current, total: progress.total })}
          </div>
          </div>
        </div>
        <button
          onClick={() => setCollapsed(true)}
          style={{
            width: 30,
            height: 30,
            border: "1px solid color-mix(in srgb, var(--color-border) 80%, transparent)",
            borderRadius: 999,
            background: "color-mix(in srgb, var(--color-surface) 96%, transparent)",
            color: "var(--color-text-muted)",
            cursor: "pointer",
            fontSize: 16,
            lineHeight: 1,
          }}
          title={t(language, "toast.minimize")}
        >
          ×
        </button>
      </div>

      <div
        style={{
          height: 8,
          borderRadius: 999,
          overflow: "hidden",
          background: "color-mix(in srgb, var(--color-surface) 90%, transparent)",
          border: "1px solid color-mix(in srgb, var(--color-border) 75%, transparent)",
        }}
      >
        <div
          style={{
            width: `${percent}%`,
            height: "100%",
            background: "linear-gradient(90deg, var(--color-primary), color-mix(in srgb, var(--color-primary-hover) 84%, white 16%))",
          }}
        />
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, marginTop: 10 }}>
        <span style={{ fontSize: 12, color: "var(--color-text-muted)" }}>
          {t(language, "toast.subtitle")}
        </span>
        <span style={{ fontSize: 12, fontWeight: 700, color: "var(--color-text)" }}>
          {percent}%
        </span>
      </div>
    </div>
  );
}
