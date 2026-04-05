import { useState } from "react";
import type { AppLanguage } from "../../utils/mediaLanguage";
import { t } from "../../utils/i18n";
import type { AddWatchlistParams } from "./types";

interface WatchlistButtonProps {
  tmdbId: number;
  tmdbType: "movie" | "tv";
  title: string;
  titleEn?: string;
  poster?: string;
  year?: number;
  language: AppLanguage;
  watchlistedTmdbIds: Set<number>;
  onAdd: (params: AddWatchlistParams) => Promise<void>;
  onNavigateToWatchlist?: () => void;
  /** Render as a full-width pill button (for side panels) */
  fullWidth?: boolean;
}

export default function WatchlistButton({
  tmdbId,
  tmdbType,
  title,
  titleEn,
  poster,
  year,
  language,
  watchlistedTmdbIds,
  onAdd,
  onNavigateToWatchlist,
  fullWidth = false,
}: WatchlistButtonProps) {
  const [hovered, setHovered] = useState(false);
  const [adding, setAdding] = useState(false);

  const isAdded = watchlistedTmdbIds.has(tmdbId);

  const handleClick = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isAdded) {
      onNavigateToWatchlist?.();
      return;
    }
    setAdding(true);
    try {
      await onAdd({
        tmdb_id: tmdbId,
        tmdb_type: tmdbType,
        title,
        title_en: titleEn,
        poster,
        year,
        scope: "all",
        auto_download: false,
      });
    } finally {
      setAdding(false);
    }
  };

  return (
    <button
      onClick={(e) => void handleClick(e)}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      disabled={adding}
      title={
        isAdded
          ? t(language, "watchlist.inWatchlist")
          : t(language, "watchlist.addToWatchlist")
      }
      style={
        fullWidth
          ? {
              width: "100%",
              padding: "10px 0",
              borderRadius: "var(--radius)",
              background: isAdded
                ? hovered
                  ? "var(--color-primary-hover)"
                  : "color-mix(in srgb, var(--color-primary) 25%, transparent)"
                : "color-mix(in srgb, var(--color-surface-2) 80%, transparent)",
              color: isAdded
                ? "var(--color-primary)"
                : "var(--color-text-muted)",
              border: `1px solid ${
                isAdded
                  ? "color-mix(in srgb, var(--color-primary) 60%, transparent)"
                  : "color-mix(in srgb, var(--color-border) 80%, transparent)"
              }`,
              fontSize: 14,
              fontWeight: 500,
              cursor: adding ? "wait" : "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
              transition: "background 0.15s ease, border-color 0.15s ease",
            }
          : {
              background: isAdded
                ? hovered
                  ? "rgba(124,110,247,0.9)"
                  : "rgba(124,110,247,0.75)"
                : hovered
                  ? "rgba(0,0,0,0.85)"
                  : "rgba(0,0,0,0.6)",
              border: `1px solid ${isAdded ? "var(--color-primary)" : "rgba(255,255,255,0.2)"}`,
              borderRadius: "50%",
              width: 30,
              height: 30,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: adding ? "wait" : "pointer",
              color: isAdded ? "#fff" : "rgba(255,255,255,0.8)",
              fontSize: 15,
              lineHeight: 1,
              transition: "background 0.15s ease, border-color 0.15s ease",
              flexShrink: 0,
            }
      }
    >
      {fullWidth ? (
        <>
          <span style={{ fontSize: 16 }}>🔖</span>
          {adding
            ? "…"
            : isAdded
              ? t(language, "watchlist.inWatchlist")
              : t(language, "watchlist.addToWatchlist")}
        </>
      ) : adding ? (
        "…"
      ) : isAdded ? (
        "🔖"
      ) : (
        "＋"
      )}
    </button>
  );
}
