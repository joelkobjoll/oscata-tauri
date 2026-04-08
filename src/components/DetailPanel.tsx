import React, { useState } from "react";
import { Check, Clock, Download, Pencil, RefreshCw, X } from "lucide-react";
import { isTauri } from "../lib/transport";
import { useIsMobile } from "../hooks/useIsMobile";
import { PlexIcon, EmbyIcon } from "./ServerIcons";
import type { DownloadItem } from "../hooks/useDownloads";
import type { MediaItem } from "../hooks/useIndexing";
import FixMatchModal from "./FixMatchModal";
import TrailerModal from "./TrailerModal";
import {
  AppLanguage,
  getLocalizedOverview,
  getLocalizedPosterPath,
  getLocalizedTitle,
  resolveImageUrl,
} from "../utils/mediaLanguage";
import { t } from "../utils/i18n";
import { GENRE_MAP } from "../utils/genres";
import imdbLogo from "../assets/imdb.png";
import tmdbLogo from "../assets/tmdb.svg";
import { formatBytes } from "../lib/format";
import WatchlistButton from "../features/watchlist/WatchlistButton";
import type { AddWatchlistParams } from "../features/watchlist/types";

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
  watchlistedTmdbIds,
  onAddToWatchlist,
  onOpenWatchlist,
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
  watchlistedTmdbIds?: Set<number>;
  onAddToWatchlist?: (params: AddWatchlistParams) => Promise<void>;
  onOpenWatchlist?: () => void;
}) {
  const [showFix, setShowFix] = useState(false);
  const [showTrailer, setShowTrailer] = useState(false);
  const [openingUrl, setOpeningUrl] = useState<string | null>(null);
  const [devChecking, setDevChecking] = useState(false);
  const isMobile = useIsMobile();

  const handleOpenUrl = (url: string) => {
    setOpeningUrl(url);
    if (isTauri()) {
      import("@tauri-apps/plugin-opener")
        .then(({ openUrl }) => openUrl(url))
        .catch((e) => console.error("[openUrl] failed to open", url, e))
        .finally(() => setTimeout(() => setOpeningUrl(null), 2000));
    } else {
      window.open(url, "_blank", "noopener,noreferrer");
      setTimeout(() => setOpeningUrl(null), 2000);
    }
  };

  const title = getLocalizedTitle(item, language);
  const overview = getLocalizedOverview(item, language);
  const posterPath = getLocalizedPosterPath(item, language);
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
        className="panel-slide-right"
        style={{
          position: "fixed",
          top: 0,
          right: 0,
          bottom: 0,
          width: isMobile ? "100vw" : 500,
          background: "var(--color-bg)",
          zIndex: "var(--z-detail-panel)",
          overflowY: "auto",
          borderLeft: isMobile
            ? "none"
            : "1px solid color-mix(in srgb, var(--color-border) 70%, transparent)",
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
            <X
              size={16}
              strokeWidth={2.3}
              aria-hidden="true"
              style={{ display: "block" }}
            />
          </button>
        </div>

        {/* Hero */}
        <div
          style={{
            background:
              "linear-gradient(135deg, var(--color-surface) 0%, var(--color-bg) 100%)",
            padding: isMobile ? "1rem" : "1.5rem",
            display: "flex",
            gap: "1rem",
            flexDirection: isMobile ? "column" : "row",
            alignItems: isMobile ? "center" : "flex-start",
            borderBottom:
              "1px solid color-mix(in srgb, var(--color-border) 70%, transparent)",
          }}
        >
          {posterPath ? (
            <img
              src={resolveImageUrl(posterPath, "w342") ?? ""}
              alt={title}
              style={{
                width: isMobile ? 110 : 110,
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
              width: isMobile ? "100%" : undefined,
            }}
          >
            <h2
              style={{
                margin: 0,
                fontSize: isMobile ? "1.25rem" : "1.1rem",
                fontWeight: 700,
                color: "var(--color-text)",
                lineHeight: 1.3,
                letterSpacing: "-0.02em",
                textAlign: isMobile ? "center" : "left",
              }}
            >
              {title}
            </h2>

            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: "0.4rem",
                justifyContent: isMobile ? "center" : "flex-start",
              }}
            >
              {(item.tmdb_release_date || item.year) && (
                <span style={metaPill}>
                  {item.tmdb_release_date
                    ? new Date(item.tmdb_release_date).getFullYear()
                    : item.year}
                </span>
              )}
              {/* TMDB rating */}
              {item.tmdb_rating != null && item.tmdb_rating > 0 && (
                <span style={metaPill}>
                  <img
                    src={tmdbLogo}
                    alt="TMDB"
                    style={{
                      height: 9,
                      width: "auto",
                      display: "block",
                      opacity: 0.85,
                    }}
                  />
                  {item.tmdb_rating.toFixed(1)}
                </span>
              )}
              {/* IMDb rating */}
              {item.imdb_rating != null && item.imdb_rating > 0 && (
                <span style={metaPill}>
                  <img
                    src={imdbLogo}
                    alt="IMDb"
                    style={{
                      height: 11,
                      width: "auto",
                      display: "block",
                      opacity: 0.9,
                    }}
                  />
                  {item.imdb_rating.toFixed(1)}
                </span>
              )}
              {genres.map((g) => (
                <span key={g} style={metaPill}>
                  {g}
                </span>
              ))}
              {devBadge?.plexInLibrary && (
                <span
                  title="In Plex"
                  style={{
                    ...metaPill,
                    width: "2rem",
                    height: "2rem",
                    minHeight: "2rem",
                    justifyContent: "center",
                    padding: 0,
                    borderRadius: "50%",
                    borderColor: "#282a2d",
                    background: "#282a2d",
                  }}
                >
                  <PlexIcon size={14} />
                </span>
              )}
              {devBadge?.embyInLibrary && (
                <span
                  title="In Emby"
                  style={{
                    ...metaPill,
                    width: "2rem",
                    height: "2rem",
                    minHeight: "2rem",
                    justifyContent: "center",
                    padding: 0,
                    borderRadius: "50%",
                    borderColor:
                      "color-mix(in srgb, var(--color-border) 84%, transparent)",
                  }}
                >
                  <EmbyIcon size={14} />
                </span>
              )}
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
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        fontSize: 12,
                        color: "var(--color-text-muted)",
                      }}
                    >
                      <span
                        style={{
                          whiteSpace: "nowrap",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                        }}
                      >
                        {version.filename}
                      </span>
                      {version.size_bytes != null && version.size_bytes > 0 && (
                        <span style={{ whiteSpace: "nowrap", flexShrink: 0 }}>
                          {formatBytes(version.size_bytes)}
                        </span>
                      )}
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
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            {(item.youtube_trailer_url ?? item.imdb_trailer_url) && (
              <button
                onClick={() => setShowTrailer(true)}
                style={{
                  ...externalLinkBtn,
                  background:
                    "color-mix(in srgb, var(--color-danger) 18%, var(--color-surface-2) 82%)",
                  borderColor:
                    "color-mix(in srgb, var(--color-danger) 38%, var(--color-border) 62%)",
                  color: "var(--color-text)",
                }}
              >
                ▶ {t(language, "detail.watchTrailer")}
              </button>
            )}
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
              <div>ftp_path: {item.ftp_path}</div>
              <div>filename: {item.filename}</div>
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
          {item.tmdb_id != null &&
            watchlistedTmdbIds !== undefined &&
            onAddToWatchlist !== undefined && (
              <WatchlistButton
                tmdbId={item.tmdb_id}
                tmdbType={
                  item.tmdb_type === "tv" || item.media_type === "tv"
                    ? "tv"
                    : "movie"
                }
                title={item.tmdb_title ?? item.title ?? item.filename}
                titleEn={item.tmdb_title ?? undefined}
                poster={item.tmdb_poster ?? undefined}
                year={item.year ?? undefined}
                language={language}
                watchlistedTmdbIds={watchlistedTmdbIds}
                onAdd={onAddToWatchlist}
                onNavigateToWatchlist={onOpenWatchlist}
                fullWidth
              />
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
              <Pencil
                size={16}
                strokeWidth={2.3}
                aria-hidden="true"
                style={{ display: "block" }}
              />
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

        {showTrailer && (item.youtube_trailer_url ?? item.imdb_trailer_url) && (
          <TrailerModal
            trailerUrl={(item.youtube_trailer_url ?? item.imdb_trailer_url)!}
            title={title}
            onClose={() => setShowTrailer(false)}
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
          <Download
            size={16}
            strokeWidth={2.3}
            aria-hidden="true"
            style={{ display: "block" }}
          />
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
          <Clock
            size={16}
            strokeWidth={2.3}
            aria-hidden="true"
            style={{ display: "block" }}
          />
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
          <Check
            size={16}
            strokeWidth={2.3}
            aria-hidden="true"
            style={{ display: "block" }}
          />
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
          <Check
            size={16}
            strokeWidth={2.3}
            aria-hidden="true"
            style={{ display: "block" }}
          />
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
          <RefreshCw
            size={16}
            strokeWidth={2.3}
            aria-hidden="true"
            style={{ display: "block" }}
          />
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
        <Download
          size={16}
          strokeWidth={2.3}
          aria-hidden="true"
          style={{ display: "block" }}
        />
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
