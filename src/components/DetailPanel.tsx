import React, { useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import type { DownloadItem } from "../hooks/useDownloads";
import type { MediaItem } from "../hooks/useIndexing";
import AppIcon from "./AppIcon";
import FixMatchModal from "./FixMatchModal";
import {
  AppLanguage,
  getLocalizedOverview,
  getLocalizedPosterPath,
  getLocalizedTitle,
} from "../utils/mediaLanguage";
import { t } from "../utils/i18n";

const TMDB_IMG = "https://image.tmdb.org/t/p/w342";

const GENRE_MAP: Record<number, string> = {
  28: "detail.genre.action",
  12: "detail.genre.adventure",
  16: "detail.genre.animation",
  35: "detail.genre.comedy",
  80: "detail.genre.crime",
  99: "detail.genre.documentary",
  18: "detail.genre.drama",
  10751: "detail.genre.family",
  14: "detail.genre.fantasy",
  36: "detail.genre.history",
  27: "detail.genre.horror",
  10402: "detail.genre.music",
  9648: "detail.genre.mystery",
  10749: "detail.genre.romance",
  878: "detail.genre.scifi",
  10770: "detail.genre.tvmovie",
  53: "detail.genre.thriller",
  10752: "detail.genre.war",
  37: "detail.genre.western",
};

const metaPill: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: "0.38rem",
  minHeight: "2rem",
  padding: "0.3rem 0.7rem",
  borderRadius: 9999,
  border: "1px solid color-mix(in srgb, var(--color-border) 84%, transparent)",
  background: "color-mix(in srgb, var(--color-surface-2) 68%, transparent)",
  fontSize: "0.78rem",
  color: "var(--color-text-muted)",
};

export default function DetailPanel({
  item,
  language,
  relatedItems = [],
  groupedView = false,
  onClose,
  onOpenItem,
  onUpdated,
  downloadItem,
  downloadMap,
  downloadedBadgeMap,
  isDownloaded = false,
  onDownload,
  isDownloadPending,
  onRetry,
  onDevCheckInLibrary,
}: {
  item: MediaItem;
  language: AppLanguage;
  relatedItems?: MediaItem[];
  groupedView?: boolean;
  onClose: () => void;
  onOpenItem?: (item: MediaItem) => void;
  onUpdated?: (id: number, patch: Partial<MediaItem>) => void;
  downloadItem?: DownloadItem;
  downloadMap: Map<string, DownloadItem>;
  downloadedBadgeMap: Record<
    number,
    {
      downloaded?: boolean;
      inEmby?: boolean;
      plexInLibrary?: boolean;
      embyInLibrary?: boolean;
      cache?: string;
      debug?: string;
    }
  >;
  isDownloaded?: boolean;
  onDownload: (item: MediaItem) => Promise<number>;
  isDownloadPending: (ftpPath: string) => boolean;
  onRetry?: (id: number) => void;
  onDevCheckInLibrary?: (item: MediaItem) => Promise<void>;
}) {
  const [showFix, setShowFix] = useState(false);
  const [openingUrl, setOpeningUrl] = useState<string | null>(null);
  const [devChecking, setDevChecking] = useState(false);

  const handleOpenUrl = (url: string) => {
    setOpeningUrl(url);
    openUrl(url)
      .catch((e) => console.error("[openUrl] failed to open", url, e))
      .finally(() => setTimeout(() => setOpeningUrl(null), 2000));
  };

  const title = getLocalizedTitle(item, language);
  const overview = getLocalizedOverview(item, language);
  const posterPath = getLocalizedPosterPath(item, language);
  const rating = item.tmdb_rating ? item.tmdb_rating.toFixed(1) : null;
  const relatedVersions = groupedView
    ? relatedItems
    : relatedItems.filter((candidate) => candidate.id !== item.id);
  const genres = (() => {
    const raw = item.tmdb_genres;
    if (!raw) return [];
    const ids: number[] = typeof raw === "string" ? JSON.parse(raw) : raw;
    return ids
      .map((id) => GENRE_MAP[id])
      .filter(Boolean)
      .map((key) => t(language, key as never));
  })();
  const searchTitle =
    item.tmdb_title_en ?? item.tmdb_title ?? item.title ?? title;
  const searchQuery = [
    searchTitle,
    item.year ?? item.tmdb_release_date?.slice(0, 4),
  ]
    .filter(Boolean)
    .join(" ");
  const tmdbMediaType =
    item.tmdb_type ?? (item.media_type === "tv" ? "tv" : "movie");
  const tmdbUrl = item.tmdb_id
    ? `https://www.themoviedb.org/${tmdbMediaType}/${item.tmdb_id}`
    : `https://www.themoviedb.org/search?query=${encodeURIComponent(searchQuery)}`;
  const imdbUrl = item.imdb_id
    ? `https://www.imdb.com/title/${encodeURIComponent(item.imdb_id)}/`
    : `https://www.imdb.com/find/?q=${encodeURIComponent(searchQuery)}&s=tt`;
  const externalLinkBtn: React.CSSProperties = {
    flex: 1,
    minWidth: 0,
    padding: "10px 12px",
    borderRadius: "var(--radius-full)",
    border:
      "1px solid color-mix(in srgb, var(--color-border) 78%, transparent)",
    background: "color-mix(in srgb, var(--color-surface-2) 76%, transparent)",
    color: "var(--color-text)",
    cursor: "pointer",
    fontSize: 12,
    fontWeight: 700,
  };
  const showDevMeta = import.meta.env.DEV;
  const devBadge = downloadedBadgeMap[item.id];

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{
          position: "fixed",
          inset: 0,
          background: "color-mix(in srgb, black 55%, transparent)",
          zIndex: "var(--z-detail-backdrop)",
          backdropFilter: "blur(4px)",
        }}
      />

      {/* Panel */}
      <div
        style={{
          position: "fixed",
          top: 0,
          right: 0,
          bottom: 0,
          width: 500,
          background: "var(--color-bg)",
          zIndex: "var(--z-detail-panel)",
          overflowY: "auto",
          borderLeft:
            "1px solid color-mix(in srgb, var(--color-border) 70%, transparent)",
          boxShadow: "-4px 0 32px color-mix(in srgb, black 50%, transparent)",
          display: "flex",
          flexDirection: "column",
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: "1.25rem 1.5rem 1rem",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            borderBottom:
              "1px solid color-mix(in srgb, var(--color-border) 70%, transparent)",
            flexShrink: 0,
          }}
        >
          <span
            style={{
              color: "var(--color-text-muted)",
              fontSize: 13,
              fontWeight: 600,
            }}
          >
            {t(language, "detail.details")}
          </span>
          <button
            onClick={onClose}
            style={{
              width: 32,
              height: 32,
              borderRadius: 8,
              border: "none",
              background: "transparent",
              color: "var(--color-text-muted)",
              cursor: "pointer",
              fontSize: 16,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLButtonElement).style.background =
                "color-mix(in srgb, var(--color-border) 60%, transparent)";
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLButtonElement).style.background =
                "transparent";
            }}
          >
            <AppIcon name="close" size={16} strokeWidth={2.3} />
          </button>
        </div>

        {/* Hero */}
        <div
          style={{
            background:
              "linear-gradient(135deg, var(--color-surface) 0%, var(--color-bg) 100%)",
            padding: "1.5rem",
            display: "flex",
            gap: "1rem",
            borderBottom:
              "1px solid color-mix(in srgb, var(--color-border) 70%, transparent)",
          }}
        >
          {posterPath ? (
            <img
              src={`${TMDB_IMG}${posterPath}`}
              alt={title}
              style={{
                width: 110,
                aspectRatio: "2/3",
                borderRadius: "var(--radius-lg)",
                objectFit: "cover",
                flexShrink: 0,
                border:
                  "1px solid color-mix(in srgb, var(--color-border) 60%, transparent)",
              }}
            />
          ) : (
            <div
              style={{
                width: 110,
                aspectRatio: "2/3",
                borderRadius: "var(--radius-lg)",
                background: "var(--color-surface-2)",
                flexShrink: 0,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 32,
                color: "var(--color-text-muted)",
                border:
                  "1px solid color-mix(in srgb, var(--color-border) 60%, transparent)",
              }}
            >
              🎬
            </div>
          )}

          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 8,
              minWidth: 0,
            }}
          >
            <h2
              style={{
                margin: 0,
                fontSize: "1.1rem",
                fontWeight: 700,
                color: "var(--color-text)",
                lineHeight: 1.3,
                letterSpacing: "-0.02em",
              }}
            >
              {title}
            </h2>

            <div style={{ display: "flex", flexWrap: "wrap", gap: "0.4rem" }}>
              {(item.tmdb_release_date || item.year) && (
                <span style={metaPill}>
                  {item.tmdb_release_date
                    ? new Date(item.tmdb_release_date).getFullYear()
                    : item.year}
                </span>
              )}
              {rating && (
                <span style={metaPill}>
                  <AppIcon name="star" size={13} strokeWidth={2} />
                  {rating}
                </span>
              )}
              {genres.slice(0, 3).map((g) => (
                <span key={g} style={metaPill}>
                  {g}
                </span>
              ))}
            </div>
          </div>
        </div>

        {/* Overview */}
        {overview && (
          <div
            style={{
              padding: "1rem 1.5rem",
              borderBottom:
                "1px solid color-mix(in srgb, var(--color-border) 70%, transparent)",
            }}
          >
            <p
              style={{
                margin: 0,
                fontSize: "0.9rem",
                lineHeight: 1.7,
                color:
                  "color-mix(in srgb, var(--color-text) 76%, var(--color-text-muted))",
              }}
            >
              {overview}
            </p>
          </div>
        )}

        {!groupedView && (
          <div
            style={{
              padding: "1rem 1.5rem",
              borderBottom:
                "1px solid color-mix(in srgb, var(--color-border) 70%, transparent)",
            }}
          >
            <h3
              style={{
                margin: "0 0 0.75rem",
                fontSize: "0.7rem",
                fontWeight: 700,
                color: "var(--color-text-muted)",
                textTransform: "uppercase",
                letterSpacing: "0.08em",
              }}
            >
              {t(language, "detail.fileInfo")}
            </h3>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: "8px 16px",
              }}
            >
              {[
                {
                  label: t(language, "detail.resolution"),
                  value: item.resolution,
                },
                { label: t(language, "detail.videoCodec"), value: item.codec },
                { label: t(language, "detail.audio"), value: item.audio_codec },
                { label: t(language, "filter.hdr"), value: item.hdr },
                {
                  label: t(language, "detail.size"),
                  value: item.size_bytes
                    ? formatSize(item.size_bytes)
                    : undefined,
                },
              ]
                .filter((r) => r.value)
                .map(({ label, value }) => (
                  <div key={label}>
                    <div
                      style={{
                        color: "var(--color-text-muted)",
                        fontSize: "0.7rem",
                        textTransform: "uppercase",
                        letterSpacing: "0.06em",
                        marginBottom: 2,
                      }}
                    >
                      {label}
                    </div>
                    <div
                      style={{
                        color: "var(--color-text)",
                        fontSize: "0.85rem",
                        fontWeight: 500,
                      }}
                    >
                      {value}
                    </div>
                  </div>
                ))}
            </div>
          </div>
        )}

        {relatedVersions.length > 0 && (
          <div
            style={{
              padding: "1rem 1.5rem",
              borderBottom:
                "1px solid color-mix(in srgb, var(--color-border) 70%, transparent)",
            }}
          >
            <h3
              style={{
                margin: "0 0 0.75rem",
                fontSize: "0.7rem",
                fontWeight: 700,
                color: "var(--color-text-muted)",
                textTransform: "uppercase",
                letterSpacing: "0.08em",
              }}
            >
              {groupedView
                ? t(language, "detail.availableVersions")
                : t(language, "detail.otherVersions")}
            </h3>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {relatedVersions.map((version) => (
                <div
                  key={version.id}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "minmax(0, 1fr) auto",
                    gap: 12,
                    alignItems: "center",
                    padding: "0.8rem 0.9rem",
                    borderRadius: "var(--radius)",
                    border:
                      "1px solid color-mix(in srgb, var(--color-border) 75%, transparent)",
                    background:
                      "color-mix(in srgb, var(--color-surface-2) 72%, transparent)",
                  }}
                >
                  <div style={{ minWidth: 0 }}>
                    <div
                      style={{
                        fontSize: 13,
                        fontWeight: 700,
                        color: "var(--color-text)",
                        marginBottom: 4,
                      }}
                    >
                      {[version.release_type, version.resolution, version.codec]
                        .filter(Boolean)
                        .join(" · ") || version.filename}
                    </div>
                    <div
                      style={{
                        fontSize: 12,
                        color: "var(--color-text-muted)",
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                    >
                      {version.filename}
                    </div>
                  </div>
                  <div
                    style={{ display: "flex", alignItems: "center", gap: 8 }}
                  >
                    {groupedView && onOpenItem && (
                      <button
                        onClick={() => onOpenItem(version)}
                        style={{
                          padding: "9px 12px",
                          borderRadius: "var(--radius-full)",
                          border:
                            "1px solid color-mix(in srgb, var(--color-border) 78%, transparent)",
                          background:
                            "color-mix(in srgb, var(--color-surface) 92%, transparent)",
                          color: "var(--color-text)",
                          cursor: "pointer",
                          fontSize: 12,
                          fontWeight: 700,
                        }}
                      >
                        {t(language, "detail.viewFileDetails")}
                      </button>
                    )}
                    {(() => {
                      const versionDownloadItem = downloadMap.get(
                        version.ftp_path,
                      );
                      const versionIsPending = isDownloadPending(
                        version.ftp_path,
                      );
                      const versionIsActive =
                        versionIsPending ||
                        versionDownloadItem?.status === "queued" ||
                        versionDownloadItem?.status === "downloading";
                      const versionIsDownloaded =
                        versionDownloadItem?.status === "done" ||
                        downloadedBadgeMap[version.id]?.downloaded === true;
                      const downloadLabel = versionIsDownloaded
                        ? t(language, "detail.alreadyDownloaded")
                        : versionDownloadItem?.status === "downloading"
                          ? t(language, "downloads.downloading")
                          : versionIsActive
                            ? t(language, "downloads.queued")
                            : t(language, "detail.download");

                      return (
                        <button
                          onClick={() => void onDownload(version)}
                          disabled={versionIsActive || versionIsDownloaded}
                          title={
                            versionIsDownloaded
                              ? t(language, "detail.alreadyDownloadedHint")
                              : downloadLabel
                          }
                          style={{
                            padding: "9px 12px",
                            borderRadius: "var(--radius-full)",
                            border: "none",
                            background: versionIsDownloaded
                              ? "color-mix(in srgb, var(--color-success) 18%, var(--color-surface) 82%)"
                              : versionIsActive
                                ? "color-mix(in srgb, var(--color-warning) 26%, var(--color-surface) 74%)"
                                : "color-mix(in srgb, var(--color-primary) 16%, transparent)",
                            color: versionIsDownloaded
                              ? "var(--color-success)"
                              : versionIsActive
                                ? "var(--color-warning)"
                                : "var(--color-primary)",
                            cursor:
                              versionIsActive || versionIsDownloaded
                                ? "default"
                                : "pointer",
                            fontSize: 12,
                            fontWeight: 700,
                            opacity:
                              versionIsActive || versionIsDownloaded ? 0.8 : 1,
                          }}
                        >
                          {downloadLabel}
                        </button>
                      );
                    })()}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {!groupedView && (
          <div
            style={{
              padding: "0.75rem 1.5rem",
              borderBottom:
                "1px solid color-mix(in srgb, var(--color-border) 70%, transparent)",
            }}
          >
            <div
              style={{
                color: "var(--color-text-muted)",
                fontSize: "0.7rem",
                textTransform: "uppercase",
                letterSpacing: "0.06em",
                marginBottom: 4,
              }}
            >
              {t(language, "detail.filename")}
            </div>
            <div
              style={{
                color: "var(--color-text-muted)",
                fontSize: 12,
                wordBreak: "break-all",
                fontFamily: "monospace",
              }}
            >
              {item.filename}
            </div>
          </div>
        )}

        <div
          style={{
            padding: "1rem 1.5rem",
            borderBottom:
              "1px solid color-mix(in srgb, var(--color-border) 70%, transparent)",
          }}
        >
          <div
            style={{
              color: "var(--color-text-muted)",
              fontSize: "0.7rem",
              textTransform: "uppercase",
              letterSpacing: "0.06em",
              marginBottom: 10,
            }}
          >
            {t(language, "detail.links")}
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            <button
              onClick={() => handleOpenUrl(tmdbUrl)}
              style={{
                ...externalLinkBtn,
                ...(openingUrl === tmdbUrl && { opacity: 0.6 }),
              }}
              title={tmdbUrl}
            >
              {openingUrl === tmdbUrl ? "↗ …" : t(language, "detail.openTmdb")}
            </button>
            <button
              onClick={() => handleOpenUrl(imdbUrl)}
              style={{
                ...externalLinkBtn,
                ...(openingUrl === imdbUrl && { opacity: 0.6 }),
              }}
              title={imdbUrl}
            >
              {openingUrl === imdbUrl ? "↗ …" : t(language, "detail.openImdb")}
            </button>
          </div>
        </div>

        {showDevMeta && (
          <div
            style={{
              padding: "0.85rem 1.5rem",
              borderBottom:
                "1px solid color-mix(in srgb, var(--color-border) 70%, transparent)",
            }}
          >
            <div
              style={{
                color: "var(--color-text-muted)",
                fontSize: "0.7rem",
                textTransform: "uppercase",
                letterSpacing: "0.06em",
                marginBottom: 8,
              }}
            >
              Debug (dev)
            </div>
            <div
              style={{
                fontFamily: "monospace",
                fontSize: 12,
                color: "var(--color-text-muted)",
                display: "grid",
                gap: 3,
                wordBreak: "break-all",
              }}
            >
              <div>item_id: {item.id}</div>
              <div>imdb_id: {item.imdb_id ?? "-"}</div>
              <div>tmdb_id: {item.tmdb_id ?? "-"}</div>
              <div>badge.local: {devBadge?.downloaded ? "true" : "false"}</div>
              <div>badge.in_library: {devBadge?.inEmby ? "true" : "false"}</div>
              <div>
                badge.plex: {devBadge?.plexInLibrary ? "true" : "false"}
              </div>
              <div>
                badge.emby: {devBadge?.embyInLibrary ? "true" : "false"}
              </div>
              <div>badge.cache: {devBadge?.cache ?? "-"}</div>
              <div>badge.debug: {devBadge?.debug ?? "-"}</div>
            </div>
            {onDevCheckInLibrary && (
              <button
                onClick={() => {
                  setDevChecking(true);
                  onDevCheckInLibrary(item)
                    .catch(() => {})
                    .finally(() => setDevChecking(false));
                }}
                disabled={devChecking}
                style={{
                  marginTop: 10,
                  padding: "8px 10px",
                  borderRadius: "var(--radius)",
                  border:
                    "1px solid color-mix(in srgb, var(--color-primary) 50%, transparent)",
                  background:
                    "color-mix(in srgb, var(--color-primary) 14%, transparent)",
                  color: "var(--color-primary)",
                  cursor: devChecking ? "default" : "pointer",
                  fontSize: 12,
                  fontWeight: 700,
                  opacity: devChecking ? 0.7 : 1,
                }}
              >
                {devChecking ? "Checking…" : "Check In Library (dev)"}
              </button>
            )}
          </div>
        )}

        {/* Actions */}
        <div
          style={{
            padding: "1rem 1.5rem",
            marginTop: "auto",
            display: "flex",
            flexDirection: "column",
            gap: 8,
          }}
        >
          {!groupedView &&
            renderDownloadButton(
              item,
              downloadItem,
              isDownloaded,
              isDownloadPending(item.ftp_path),
              onDownload,
              onRetry,
              language,
            )}
          <button
            onClick={() => setShowFix(true)}
            style={{
              width: "100%",
              padding: "10px 0",
              borderRadius: "var(--radius)",
              background:
                "color-mix(in srgb, var(--color-surface-2) 80%, transparent)",
              color: "var(--color-text-muted)",
              border:
                "1px solid color-mix(in srgb, var(--color-border) 80%, transparent)",
              fontSize: 14,
              fontWeight: 500,
              cursor: "pointer",
            }}
          >
            <span
              style={{ display: "inline-flex", alignItems: "center", gap: 8 }}
            >
              <AppIcon name="edit" size={16} strokeWidth={2.3} />
              {t(language, "detail.fixMatch")}
            </span>
          </button>
        </div>

        {showFix && (
          <FixMatchModal
            itemIds={[item.id]}
            initialQuery={item.title ?? item.filename ?? ""}
            initialMediaType={item.tmdb_type ?? "movie"}
            language={language}
            onApply={(_, movie) => {
              onUpdated?.(item.id, {
                tmdb_id: movie.id,
                tmdb_title: movie.title,
                tmdb_title_en: movie.title_en,
                tmdb_poster: movie.poster_path,
                tmdb_poster_en: movie.poster_path_en,
                tmdb_rating: movie.vote_average,
                tmdb_overview: movie.overview,
                tmdb_overview_en: movie.overview_en,
              });
            }}
            onClose={() => setShowFix(false)}
          />
        )}
      </div>
    </>
  );
}

function formatSpeed(bps: number): string {
  if (bps >= 1_000_000) return (bps / 1_000_000).toFixed(1) + " MB/s";
  return (bps / 1024).toFixed(0) + " KB/s";
}

function renderDownloadButton(
  item: MediaItem,
  downloadItem: DownloadItem | undefined,
  isDownloaded: boolean,
  isPendingDownload: boolean,
  onDownload: (item: MediaItem) => Promise<number>,
  onRetry: ((id: number) => void) | undefined,
  language: AppLanguage,
): React.ReactNode {
  const dlStatus = downloadItem?.status;
  const pct =
    dlStatus === "downloading" && downloadItem && downloadItem.bytes_total > 0
      ? Math.min(
          100,
          (downloadItem.bytes_done / downloadItem.bytes_total) * 100,
        )
      : 0;

  const baseStyle: React.CSSProperties = {
    position: "relative",
    width: "100%",
    padding: "12px 0",
    borderRadius: "var(--radius)",
    border: "none",
    fontSize: 15,
    fontWeight: 600,
    overflow: "hidden",
  };

  if (dlStatus === "downloading") {
    return (
      <button
        disabled
        style={{
          ...baseStyle,
          background: "var(--color-primary)",
          color: "#fff",
          cursor: "default",
        }}
      >
        {/* Progress fill */}
        <div
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            bottom: 0,
            width: `${pct}%`,
            background: "color-mix(in srgb, white 20%, transparent)",
            transition: "width 0.6s ease",
            borderRadius: "inherit",
          }}
        />
        <span
          style={{
            position: "relative",
            zIndex: 1,
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
          }}
        >
          <AppIcon name="download" size={16} strokeWidth={2.3} />
          {`${t(language, "downloads.downloading")} · ${pct.toFixed(0)}%${downloadItem?.speed_bps ? " · " + formatSpeed(downloadItem.speed_bps) : ""}`}
        </span>
      </button>
    );
  }

  if (isPendingDownload || dlStatus === "queued") {
    return (
      <button
        disabled
        style={{
          ...baseStyle,
          background: "var(--color-warning)",
          color: "#fff",
          cursor: "default",
        }}
      >
        <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
          <AppIcon name="clock" size={16} strokeWidth={2.3} />
          {t(language, "downloads.queued")}
        </span>
      </button>
    );
  }

  if (dlStatus === "done") {
    return (
      <button
        disabled
        title={t(language, "detail.alreadyDownloadedHint")}
        style={{
          ...baseStyle,
          background: "var(--color-success)",
          color: "#fff",
          cursor: "default",
        }}
      >
        <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
          <AppIcon name="check" size={16} strokeWidth={2.3} />
          {t(language, "downloads.done")}
        </span>
      </button>
    );
  }

  if (isDownloaded) {
    return (
      <button
        disabled
        title={t(language, "detail.alreadyDownloadedHint")}
        style={{
          ...baseStyle,
          background:
            "color-mix(in srgb, var(--color-success) 18%, var(--color-surface) 82%)",
          color: "var(--color-success)",
          border:
            "1px solid color-mix(in srgb, var(--color-success) 36%, transparent)",
          cursor: "default",
        }}
      >
        <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
          <AppIcon name="check" size={16} strokeWidth={2.3} />
          {t(language, "detail.alreadyDownloaded")}
        </span>
      </button>
    );
  }

  if (dlStatus === "error") {
    return (
      <button
        onClick={() => downloadItem && onRetry?.(downloadItem.id)}
        style={{
          ...baseStyle,
          background: "var(--color-danger)",
          color: "#fff",
          cursor: "pointer",
        }}
      >
        <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
          <AppIcon name="refresh-cw" size={16} strokeWidth={2.3} />
          {t(language, "downloads.retry")}
        </span>
      </button>
    );
  }

  // idle / cancelled / undefined
  return (
    <button
      onClick={() => void onDownload(item)}
      style={{
        ...baseStyle,
        background: "var(--color-primary)",
        color: "#fff",
        cursor: "pointer",
      }}
    >
      <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
        <AppIcon name="download" size={16} strokeWidth={2.3} />
        {t(language, "detail.download")}
      </span>
    </button>
  );
}

function formatSize(bytes: number): string {
  if (bytes >= 1e9) return (bytes / 1e9).toFixed(2) + " GB";
  if (bytes >= 1e6) return (bytes / 1e6).toFixed(1) + " MB";
  return (bytes / 1e3).toFixed(0) + " KB";
}
