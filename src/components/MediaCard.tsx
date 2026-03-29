import { memo, useState } from "react";
import { MediaItem } from "../hooks/useIndexing";
import type { DownloadItem } from "../hooks/useDownloads";
import AppIcon from "./AppIcon";
import DownloadRing from "./DownloadRing";
import {
  AppLanguage,
  getLocalizedPosterPath,
  getLocalizedTitle,
} from "../utils/mediaLanguage";

interface Props {
  item: MediaItem;
  language: AppLanguage;
  badges?: {
    downloaded?: boolean;
    inEmby?: boolean;
  };
  downloadItem?: DownloadItem;
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

function MediaCard({
  item,
  language,
  badges,
  downloadItem,
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
        {item.season != null && (
          <div
            style={{
              position: "absolute",
              top: "0.4rem",
              left: "0.4rem",
              background: "color-mix(in srgb, black 82%, transparent)",
              color: "white",
              fontSize: "0.65rem",
              fontWeight: 600,
              padding: "0.15rem 0.4rem",
              borderRadius: 9999,
              border: "1px solid color-mix(in srgb, white 28%, transparent)",
              lineHeight: 1.4,
            }}
          >
            {`S${String(item.season).padStart(2, "0")}${item.episode != null ? `E${String(item.episode).padStart(2, "0")}` : ""}${item.episode_end != null && item.episode_end !== item.episode ? `-E${String(item.episode_end).padStart(2, "0")}` : ""}`}
          </div>
        )}

        {(badges?.downloaded || badges?.inEmby) && (
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
            }}
          >
            {badges.downloaded && (
              <span
                style={{
                  background:
                    "color-mix(in srgb, var(--color-success) 82%, transparent)",
                  color: "#fff",
                  fontSize: "0.6rem",
                  fontWeight: 700,
                  padding: "0.12rem 0.4rem",
                  borderRadius: 999,
                  letterSpacing: "0.04em",
                }}
              >
                DOWNLOADED
              </span>
            )}
            {badges.inEmby && (
              <span
                style={{
                  background:
                    "color-mix(in srgb, var(--color-info) 78%, transparent)",
                  color: "#fff",
                  fontSize: "0.6rem",
                  fontWeight: 700,
                  padding: "0.12rem 0.4rem",
                  borderRadius: 999,
                  letterSpacing: "0.04em",
                }}
              >
                EMBY
              </span>
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
            alignItems: "center",
            gap: "0.2rem",
            zIndex: 4,
          }}
        >
          {item.hdr && (
            <span
              style={{
                background: "color-mix(in srgb, #7c3aed 80%, transparent)",
                color: "white",
                fontSize: "0.6rem",
                fontWeight: 700,
                padding: "0.1rem 0.35rem",
                borderRadius: 4,
                letterSpacing: "0.04em",
              }}
            >
              {item.hdr}
            </span>
          )}
          {item.resolution && (
            <span
              style={{
                background: "color-mix(in srgb, black 82%, transparent)",
                color: "white",
                fontSize: "0.6rem",
                fontWeight: 700,
                padding: "0.1rem 0.35rem",
                borderRadius: 4,
                border: "1px solid color-mix(in srgb, white 20%, transparent)",
                letterSpacing: "0.03em",
              }}
            >
              {item.resolution}
            </span>
          )}
        </div>

        {/* Release type badge bottom-left */}
        {item.release_type && (
          <div
            style={{
              position: "absolute",
              bottom: "0.4rem",
              left: "0.4rem",
              background: RELEASE_TYPE_COLORS[item.release_type] || "#1e293b",
              color: "white",
              fontSize: "0.6rem",
              fontWeight: 600,
              padding: "0.1rem 0.35rem",
              borderRadius: 4,
              letterSpacing: "0.03em",
              zIndex: 4,
            }}
          >
            {item.release_type}
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
              <span
                style={{
                  background: LANG_COLORS[langs[0]] || "#6b7280",
                  color: "white",
                  fontSize: "0.6rem",
                  fontWeight: 600,
                  padding: "0.05rem 0.3rem",
                  borderRadius: 999,
                }}
              >
                {langs[0]}
              </span>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default memo(MediaCard);
