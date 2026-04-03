import { memo, useState } from "react";
import { MediaItem } from "../hooks/useIndexing";
import type { DownloadItem } from "../hooks/useDownloads";
import AppIcon from "./AppIcon";
import DownloadRing from "./DownloadRing";
import { PlexIcon, EmbyIcon } from "./ServerIcons";
import {
  AppLanguage,
  getLocalizedPosterPath,
  getLocalizedTitle,
} from "../utils/mediaLanguage";
import { formatBytes } from "../lib/format";

interface Props {
  item: MediaItem;
  language: AppLanguage;
  badges?: {
    downloaded?: boolean;
    inEmby?: boolean;
    plexInLibrary?: boolean;
    embyInLibrary?: boolean;
  };
  downloadItem?: DownloadItem;
  hideEpisodeBadge?: boolean;
  showFileSize?: boolean;
  onDownload: (item: MediaItem) => void;
  onSelect?: (item: MediaItem) => void;
}

const RELEASE_TYPE_COLORS: Record<string, string> = {
  BDREMUX: "#065f46",
  BluRay: "#064e3b",
  "WEB-DL": "#1e3a5f",
  WEBRip: "#1e3a5f",
  HDTV: "#3b1f6e",
  BDRip: "#3b3b00",
  DVDRip: "#4b1515",
  CAM: "#7f1d1d",
};

const LANG_COLORS: Record<string, string> = {
  DUAL: "#b45309",
  MULTI: "#7c3aed",
  DUBBED: "#6b7280",
  SUBBED: "#6b7280",
};

type BadgeTone = "neutral" | "success" | "info" | "violet" | "release";

function badgeSurface(
  tone: BadgeTone,
  releaseColor?: string,
  options?: { compact?: boolean; shadow?: boolean; iconOnly?: boolean },
): React.CSSProperties {
  const background = {
    neutral: "color-mix(in srgb, black 78%, transparent)",
    success: "color-mix(in srgb, var(--color-success) 72%, black 12%)",
    info: "color-mix(in srgb, var(--color-info) 72%, black 12%)",
    violet: "color-mix(in srgb, #7c3aed 74%, black 10%)",
    release: releaseColor ?? "color-mix(in srgb, #1e293b 80%, black 10%)",
  }[tone];

  return {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    minHeight: options?.compact ? 18 : 22,
    minWidth: options?.iconOnly ? (options?.compact ? 18 : 22) : undefined,
    padding: options?.iconOnly
      ? 0
      : options?.compact
        ? "0.12rem 0.38rem"
        : "0.16rem 0.48rem",
    borderRadius: 999,
    border: "1px solid color-mix(in srgb, white 16%, transparent)",
    background,
    color: "#fff",
    boxShadow:
      options?.shadow === false
        ? "none"
        : "0 6px 16px color-mix(in srgb, black 28%, transparent)",
    backdropFilter: "blur(8px)",
    WebkitBackdropFilter: "blur(8px)",
    fontSize: options?.compact ? "0.56rem" : "0.62rem",
    fontWeight: 800,
    lineHeight: 1,
    letterSpacing: "0.07em",
    textTransform: options?.iconOnly ? "none" : "uppercase",
    whiteSpace: "nowrap",
  };
}

function OverlayBadge({
  children,
  tone = "neutral",
  releaseColor,
  iconOnly = false,
  style,
  title,
}: {
  children: React.ReactNode;
  tone?: BadgeTone;
  releaseColor?: string;
  iconOnly?: boolean;
  style?: React.CSSProperties;
  title?: string;
}) {
  return (
    <span
      title={title}
      style={{
        ...badgeSurface(tone, releaseColor, { iconOnly }),
        maxWidth: "100%",
        overflow: "hidden",
        textOverflow: "ellipsis",
        ...style,
      }}
    >
      {children}
    </span>
  );
}

function InlineBadge({
  children,
  tone = "neutral",
  releaseColor,
}: {
  children: React.ReactNode;
  tone?: BadgeTone;
  releaseColor?: string;
}) {
  return (
    <span
      style={badgeSurface(tone, releaseColor, { compact: true, shadow: false })}
    >
      {children}
    </span>
  );
}

function MediaCard({
  item,
  language,
  badges,
  downloadItem,
  hideEpisodeBadge = false,
  showFileSize = false,
  onDownload: _onDownload,
  onSelect,
}: Props) {
  const [imgLoaded, setImgLoaded] = useState(false);
  const isTV =
    item.tmdb_type === "tv" ||
    item.media_type === "tv" ||
    item.media_type === "documentary";
  const posterPath = getLocalizedPosterPath(item, language);
  const poster = posterPath
    ? `https://image.tmdb.org/t/p/w300${posterPath}`
    : null;
  const title = getLocalizedTitle(item, language);
  const year = item.year;
  const hasMetadata = !!item.tmdb_id;
  const inPlex = badges?.plexInLibrary === true;
  const inEmby = badges?.embyInLibrary === true;
  const hasCombinedLibraryFlag = badges?.inEmby === true;
  const showLibraryFallback = hasCombinedLibraryFlag && !inPlex && !inEmby;

  const langs =
    item.languages
      ?.split(",")
      .map((l) => l.trim())
      .filter(Boolean) ?? [];

  return (
    <div
      className="media-card"
      onClick={() => onSelect?.(item)}
      style={{
        cursor: "pointer",
        display: "flex",
        flexDirection: "column",
        gap: "0.4rem",
        opacity: hasMetadata ? 1 : 0.7,
      }}
    >
      {/* Poster */}
      <div
        className="media-card-poster"
        style={{
          position: "relative",
          aspectRatio: "2 / 3",
          borderRadius: "var(--radius-lg)",
          overflow: "hidden",
          background: "var(--color-surface-2)",
          border:
            "1px solid color-mix(in srgb, var(--color-border) 80%, transparent)",
          transition: "border-color 0.18s ease, box-shadow 0.18s ease",
        }}
      >
        {/* Shimmer while loading */}
        {!imgLoaded && (
          <div
            className="poster-shimmer"
            style={{ position: "absolute", inset: 0 }}
          />
        )}

        {poster ? (
          <img
            className={`media-card-img ${imgLoaded ? "loaded" : ""}`}
            src={poster}
            alt={title}
            loading="lazy"
            decoding="async"
            onLoad={() => setImgLoaded(true)}
            style={{
              width: "100%",
              height: "100%",
              objectFit: "cover",
              opacity: imgLoaded ? 1 : 0,
              transition: "opacity 0.3s ease, transform 0.2s ease",
              display: "block",
            }}
          />
        ) : (
          <div
            style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 48,
              color: "var(--color-text-muted)",
            }}
          >
            <AppIcon name={isTV ? "tv" : "movie"} size={36} strokeWidth={1.9} />
          </div>
        )}

        {/* Bottom gradient for badges */}
        <div
          style={{
            position: "absolute",
            bottom: 0,
            left: 0,
            right: 0,
            height: "50%",
            background:
              "linear-gradient(to top, color-mix(in srgb, black 72%, transparent), transparent)",
            pointerEvents: "none",
          }}
        />

        {/* S/E badge top-left */}
        {!hideEpisodeBadge && item.season != null && (
          <div
            style={{
              position: "absolute",
              top: "0.4rem",
              left: "0.4rem",
              zIndex: 4,
              maxWidth: "calc(100% - 3.4rem)",
            }}
          >
            <OverlayBadge
              title={`S${String(item.season).padStart(2, "0")}${item.episode != null ? `E${String(item.episode).padStart(2, "0")}` : ""}${item.episode_end != null && item.episode_end !== item.episode ? `-E${String(item.episode_end).padStart(2, "0")}` : ""}`}
            >
              {`S${String(item.season).padStart(2, "0")}${item.episode != null ? `E${String(item.episode).padStart(2, "0")}` : ""}${item.episode_end != null && item.episode_end !== item.episode ? `-E${String(item.episode_end).padStart(2, "0")}` : ""}`}
            </OverlayBadge>
          </div>
        )}

        {(badges?.downloaded || inPlex || inEmby || showLibraryFallback) && (
          <div
            style={{
              position: "absolute",
              top: "0.4rem",
              right: "0.4rem",
              display: "flex",
              flexDirection: "column",
              gap: 4,
              alignItems: "flex-end",
              zIndex: 4,
              maxWidth: "calc(40% - 0.4rem)",
            }}
          >
            {badges.downloaded && (
              <OverlayBadge tone="success" iconOnly>
                <AppIcon name="check" size={12} strokeWidth={2.8} />
              </OverlayBadge>
            )}
            {inPlex && (
              <OverlayBadge
                tone="info"
                title="In Plex"
                iconOnly
                style={{ background: "#282a2d", borderColor: "#282a2d" }}
              >
                <PlexIcon size={13} />
              </OverlayBadge>
            )}
            {inEmby && (
              <OverlayBadge tone="neutral" title="In Emby" iconOnly>
                <EmbyIcon size={13} />
              </OverlayBadge>
            )}
            {showLibraryFallback && (
              <OverlayBadge tone="info" title="In Library" iconOnly>
                <AppIcon name="check" size={11} strokeWidth={2.8} />
              </OverlayBadge>
            )}
          </div>
        )}

        {/* Resolution + HDR badges bottom-right */}
        <div
          style={{
            position: "absolute",
            bottom: "0.4rem",
            right: "0.4rem",
            display: "flex",
            flexDirection: "column",
            alignItems: "flex-end",
            gap: "0.2rem",
            zIndex: 4,
            maxWidth: "calc(42% - 0.4rem)",
          }}
        >
          {item.hdr && (
            <OverlayBadge tone="violet" title={item.hdr}>
              {item.hdr}
            </OverlayBadge>
          )}
          {item.resolution && (
            <OverlayBadge title={item.resolution}>
              {item.resolution}
            </OverlayBadge>
          )}
        </div>

        {/* Release type badge bottom-left */}
        {item.release_type && (
          <div
            style={{
              position: "absolute",
              bottom: "0.4rem",
              left: "0.4rem",
              zIndex: 4,
              maxWidth: "calc(58% - 0.4rem)",
            }}
          >
            <OverlayBadge
              tone="release"
              releaseColor={RELEASE_TYPE_COLORS[item.release_type] || "#1e293b"}
              title={item.release_type}
            >
              {item.release_type}
            </OverlayBadge>
          </div>
        )}

        {/* Download ring overlay */}
        <DownloadRing downloadItem={downloadItem} />
      </div>

      {/* Card info */}
      <div
        style={{
          padding: "0 0.1rem",
          display: "flex",
          flexDirection: "column",
          gap: "0.15rem",
        }}
      >
        <div
          style={{
            fontSize: "0.78rem",
            fontWeight: 600,
            color: "var(--color-text)",
            lineHeight: 1.3,
            overflow: "hidden",
            whiteSpace: "nowrap",
            textOverflow: "ellipsis",
          }}
          title={title}
        >
          {title}
        </div>
        <div
          style={{
            fontSize: "0.7rem",
            color: "var(--color-text-muted)",
            display: "flex",
            alignItems: "center",
            gap: "0.35rem",
          }}
        >
          {year && <span>{year}</span>}
          {item.tmdb_rating != null && item.tmdb_rating > 0 && (
            <>
              <span style={{ opacity: 0.4 }}>·</span>
              <span>{item.tmdb_rating.toFixed(1)}</span>
            </>
          )}
          {langs.length > 0 && langs[0] !== "EN" && langs[0] !== "en" && (
            <>
              <span style={{ opacity: 0.4 }}>·</span>
              <span style={{ display: "inline-flex" }}>
                <InlineBadge
                  tone="release"
                  releaseColor={LANG_COLORS[langs[0]] || "#6b7280"}
                >
                  {langs[0]}
                </InlineBadge>
              </span>
            </>
          )}
          {showFileSize && item.size_bytes != null && item.size_bytes > 0 && (
            <>
              <span style={{ opacity: 0.4 }}>·</span>
              <span>{formatBytes(item.size_bytes)}</span>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default memo(MediaCard);
