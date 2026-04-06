import { useEffect, useState } from "react";
import AppIcon from "./AppIcon";
import type { AppLanguage } from "../utils/mediaLanguage";
import { t } from "../utils/i18n";

const MOBILE_BOTTOM_NAV_HEIGHT = 64;

export default function IndexStatus({
  progress,
  isIndexing,
  completionSummary,
  onDismissCompletion,
  onCancelIndex,
  activityLogOpen,
  language,
  tmdbProgress,
  isMobile,
}: {
  progress: { current: number; total: number } | null;
  isIndexing: boolean;
  completionSummary: { newItems: number; removed: number } | null;
  onDismissCompletion: () => void;
  onCancelIndex?: () => void;
  activityLogOpen: boolean;
  language: AppLanguage;
  tmdbProgress?: { done: number; total: number } | null;
  isMobile?: boolean;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const [scanBarOffset, setScanBarOffset] = useState(-45);
  const mobileInset = isMobile ? MOBILE_BOTTOM_NAV_HEIGHT : 0;
  const bottomOffset = (activityLogOpen ? 236 : 22) + mobileInset;

  // Auto-dismiss completion summary after 8 seconds
  useEffect(() => {
    if (!completionSummary) return;
    const timer = window.setTimeout(onDismissCompletion, 8000);
    return () => window.clearTimeout(timer);
  }, [completionSummary, onDismissCompletion]);

  useEffect(() => {
    if (!isIndexing) return;
    setCollapsed(false);
  }, [isIndexing, progress?.total]);

  useEffect(() => {
    if (!progress || collapsed) return;
    const timer = window.setTimeout(() => setCollapsed(true), 3000);
    return () => window.clearTimeout(timer);
  }, [collapsed, progress?.current, progress?.total]);

  // Also animate scan bar during TMDB enrichment phase (no FTP progress, TMDB running)
  useEffect(() => {
    if (!isIndexing || progress) return;

    const timer = window.setInterval(() => {
      setScanBarOffset((prev) => (prev >= 110 ? -45 : prev + 3));
    }, 60);

    return () => window.clearInterval(timer);
  }, [isIndexing, progress]);

  const scanDone = progress == null || progress.current >= progress.total;
  const isTmdbPhase =
    isIndexing &&
    scanDone &&
    tmdbProgress != null &&
    tmdbProgress.done < tmdbProgress.total;
  const tmdbPercent =
    tmdbProgress && tmdbProgress.total > 0
      ? Math.min(
          100,
          Math.round((tmdbProgress.done / tmdbProgress.total) * 100),
        )
      : 0;

  if (!isIndexing && !progress && !completionSummary) return null;

  // Completion summary toast — shown after indexing finishes
  if (!isIndexing && !progress && completionSummary) {
    return (
      <div
        style={{
          position: "fixed",
          right: 18,
          bottom: bottomOffset,
          width: "min(360px, calc(100vw - 36px))",
          padding: "0.95rem 1rem",
          borderRadius: "calc(var(--radius-lg) + 2px)",
          border:
            "1px solid color-mix(in srgb, var(--color-success) 36%, var(--color-border))",
          background:
            "linear-gradient(155deg, color-mix(in srgb, var(--color-surface) 94%, transparent), color-mix(in srgb, var(--color-surface-2) 84%, transparent))",
          boxShadow: "0 18px 42px color-mix(in srgb, black 28%, transparent)",
          backdropFilter: "blur(18px) saturate(150%)",
          WebkitBackdropFilter: "blur(18px) saturate(150%)",
          zIndex: 52,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
            gap: 12,
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
                  "color-mix(in srgb, var(--color-success) 18%, transparent)",
                color: "var(--color-success)",
                flexShrink: 0,
              }}
            >
              <AppIcon name="check" size={17} strokeWidth={2.4} />
            </span>
            <div>
              <div
                style={{
                  fontSize: 12,
                  fontWeight: 700,
                  letterSpacing: "0.06em",
                  textTransform: "uppercase",
                  color: "var(--color-success)",
                  marginBottom: 4,
                }}
              >
                {t(language, "toast.indexComplete")}
              </div>
              <div
                style={{
                  fontSize: 14,
                  fontWeight: 700,
                  color: "var(--color-text)",
                }}
              >
                {completionSummary.newItems > 0
                  ? t(language, "toast.newItemsAdded", {
                      count: completionSummary.newItems,
                    })
                  : t(language, "toast.noNewItems")}
              </div>
              {completionSummary.removed > 0 && (
                <div
                  style={{
                    fontSize: 12,
                    color: "var(--color-text-muted)",
                    marginTop: 3,
                  }}
                >
                  {t(language, "toast.itemsRemoved", {
                    count: completionSummary.removed,
                  })}
                </div>
              )}
            </div>
          </div>
          <button
            onClick={onDismissCompletion}
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
            }}
          >
            ×
          </button>
        </div>
      </div>
    );
  }

  const percent =
    progress && progress.total > 0
      ? Math.min(100, Math.round((progress.current / progress.total) * 100))
      : 0;

  if (collapsed) {
    return (
      <div
        style={{
          position: "fixed",
          right: 18,
          bottom: bottomOffset,
          display: "flex",
          alignItems: "center",
          gap: 4,
          zIndex: 52,
        }}
      >
        <button
          onClick={() => setCollapsed(false)}
          title={t(language, "toast.expand")}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            minHeight: 44,
            padding: "0.7rem 0.85rem",
            borderRadius: 999,
            border:
              "1px solid color-mix(in srgb, var(--color-border) 78%, transparent)",
            background:
              "linear-gradient(155deg, color-mix(in srgb, var(--color-surface) 96%, transparent), color-mix(in srgb, var(--color-surface-2) 88%, transparent))",
            boxShadow: "0 14px 34px color-mix(in srgb, black 24%, transparent)",
            color: "var(--color-text)",
            cursor: "pointer",
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
              background: isTmdbPhase
                ? "color-mix(in srgb, var(--color-teal) 18%, transparent)"
                : "color-mix(in srgb, var(--color-primary) 18%, transparent)",
              color: isTmdbPhase ? "var(--color-teal)" : "var(--color-primary)",
            }}
          >
            <AppIcon name="refresh-cw" size={15} strokeWidth={2.1} />
          </span>
          <span
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "flex-start",
              gap: 2,
            }}
          >
            <span
              style={{
                fontSize: 11,
                fontWeight: 700,
                letterSpacing: "0.06em",
                textTransform: "uppercase",
                color: "var(--color-text-muted)",
              }}
            >
              {isTmdbPhase
                ? t(language, "toast.tmdb")
                : t(language, "toast.refresh")}
            </span>
            <span style={{ fontSize: 13, fontWeight: 800 }}>
              {isTmdbPhase
                ? `${tmdbProgress!.done}/${tmdbProgress!.total}`
                : progress
                  ? `${percent}%`
                  : t(language, "toast.starting")}
            </span>
          </span>
        </button>
        {onCancelIndex && (
          <button
            onClick={onCancelIndex}
            title={language === "es" ? "Cerrar" : "Dismiss"}
            style={{
              width: 32,
              height: 32,
              border:
                "1px solid color-mix(in srgb, var(--color-border) 78%, transparent)",
              borderRadius: 999,
              background:
                "linear-gradient(155deg, color-mix(in srgb, var(--color-surface) 96%, transparent), color-mix(in srgb, var(--color-surface-2) 88%, transparent))",
              boxShadow:
                "0 14px 34px color-mix(in srgb, black 24%, transparent)",
              color: "var(--color-text-muted)",
              cursor: "pointer",
              fontSize: 16,
              lineHeight: 1,
            }}
          >
            ×
          </button>
        )}
      </div>
    );
  }

  return (
    <div
      style={{
        position: "fixed",
        right: 18,
        bottom: bottomOffset,
        width: "min(360px, calc(100vw - 36px))",
        padding: "0.95rem 1rem",
        borderRadius: "calc(var(--radius-lg) + 2px)",
        border:
          "1px solid color-mix(in srgb, var(--color-border) 78%, transparent)",
        background:
          "linear-gradient(155deg, color-mix(in srgb, var(--color-surface) 94%, transparent), color-mix(in srgb, var(--color-surface-2) 84%, transparent))",
        boxShadow: "0 18px 42px color-mix(in srgb, black 28%, transparent)",
        backdropFilter: "blur(18px) saturate(150%)",
        WebkitBackdropFilter: "blur(18px) saturate(150%)",
        zIndex: 52,
        transition: "opacity 160ms ease, transform 160ms ease",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: 12,
          marginBottom: 10,
        }}
      >
        <div style={{ display: "flex", gap: 10 }}>
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              width: 34,
              height: 34,
              borderRadius: 999,
              background: isTmdbPhase
                ? "color-mix(in srgb, var(--color-teal) 16%, transparent)"
                : "color-mix(in srgb, var(--color-primary) 16%, transparent)",
              color: isTmdbPhase ? "var(--color-teal)" : "var(--color-primary)",
              flexShrink: 0,
            }}
          >
            <AppIcon name="refresh-cw" size={18} strokeWidth={2.1} />
          </span>
          <div>
            <div
              style={{
                fontSize: 12,
                fontWeight: 700,
                letterSpacing: "0.06em",
                textTransform: "uppercase",
                color: isTmdbPhase
                  ? "var(--color-teal)"
                  : "var(--color-primary)",
                marginBottom: 4,
              }}
            >
              {isTmdbPhase
                ? t(language, "toast.tmdbTitle")
                : t(language, "toast.refresh")}
            </div>
            <div
              style={{
                fontSize: 14,
                fontWeight: 700,
                color: "var(--color-text)",
              }}
            >
              {isTmdbPhase
                ? t(language, "toast.tmdbOf", {
                    done: tmdbProgress!.done,
                    total: tmdbProgress!.total,
                  })
                : progress
                  ? t(language, "toast.enriching", {
                      current: progress.current,
                      total: progress.total,
                    })
                  : t(language, "toast.scanning")}
            </div>
          </div>
        </div>
        <div style={{ display: "flex", gap: 4 }}>
          <button
            onClick={() => setCollapsed(true)}
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
              fontSize: 14,
              lineHeight: 1,
            }}
            title={t(language, "toast.minimize")}
          >
            −
          </button>
          {onCancelIndex && (
            <button
              onClick={onCancelIndex}
              title={language === "es" ? "Cerrar" : "Dismiss"}
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
              }}
            >
              ×
            </button>
          )}
        </div>
      </div>

      <div
        style={{
          height: 8,
          borderRadius: 999,
          overflow: "hidden",
          background:
            "color-mix(in srgb, var(--color-surface) 90%, transparent)",
          border:
            "1px solid color-mix(in srgb, var(--color-border) 75%, transparent)",
        }}
      >
        {isTmdbPhase ? (
          <div
            style={{
              width: `${tmdbPercent}%`,
              height: "100%",
              background:
                "linear-gradient(90deg, var(--color-teal), color-mix(in srgb, var(--color-teal) 80%, white 20%))",
              transition: "width 0.3s ease",
            }}
          />
        ) : progress && !scanDone ? (
          <div
            style={{
              width: `${percent}%`,
              height: "100%",
              background:
                "linear-gradient(90deg, var(--color-primary), color-mix(in srgb, var(--color-primary-hover) 84%, white 16%))",
            }}
          />
        ) : (
          <div
            style={{
              width: "42%",
              height: "100%",
              transform: `translateX(${scanBarOffset}%)`,
              background:
                "linear-gradient(90deg, color-mix(in srgb, var(--color-primary) 20%, transparent), var(--color-primary), color-mix(in srgb, var(--color-primary-hover) 75%, white 25%))",
              transition: "transform 0.06s linear",
            }}
          />
        )}
      </div>

      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 12,
          marginTop: 10,
        }}
      >
        <span style={{ fontSize: 12, color: "var(--color-text-muted)" }}>
          {isTmdbPhase
            ? t(language, "toast.tmdbOf", {
                done: tmdbProgress!.done,
                total: tmdbProgress!.total,
              })
            : t(
                language,
                progress && !scanDone ? "toast.subtitle" : "toast.scanning",
              )}
        </span>
        {((!scanDone && progress) || isTmdbPhase) && (
          <span
            style={{
              fontSize: 12,
              fontWeight: 700,
              color: "var(--color-text)",
            }}
          >
            {isTmdbPhase ? `${tmdbPercent}%` : `${percent}%`}
          </span>
        )}
      </div>
    </div>
  );
}
