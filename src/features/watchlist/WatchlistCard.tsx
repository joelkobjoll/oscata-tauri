import { useState } from "react";
import { X } from "lucide-react";
import type { WatchlistItem } from "./types";
import { AppLanguage } from "../../utils/mediaLanguage";

interface WatchlistCardProps {
  item: WatchlistItem;
  language: AppLanguage;
  onOpen: (item: WatchlistItem) => void;
  onRemove: (id: number) => void;
}

const TMDB_IMG = "https://image.tmdb.org/t/p/w300";

export default function WatchlistCard({
  item,
  language,
  onOpen,
  onRemove,
}: WatchlistCardProps) {
  const [hovered, setHovered] = useState(false);

  const poster = item.poster
    ? item.poster.startsWith("http")
      ? item.poster
      : `${TMDB_IMG}${item.poster}`
    : null;

  const displayTitle =
    language === "es" ? item.title : (item.title_en ?? item.title);

  const nextEpSoon =
    item.next_episode_date && new Date(item.next_episode_date) > new Date();

  return (
    <div
      onClick={() => onOpen(item)}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        position: "relative",
        cursor: "pointer",
        borderRadius: "var(--radius-lg)",
        overflow: "hidden",
        background: "var(--color-surface)",
        border: `1px solid ${hovered ? "var(--color-primary)" : "var(--color-border)"}`,
        transition: "border-color 0.15s ease, transform 0.15s ease",
        transform: hovered ? "translateY(-2px)" : "none",
        aspectRatio: "2 / 3",
      }}
    >
      {/* Poster */}
      {poster ? (
        <img
          src={poster}
          alt={displayTitle}
          style={{
            width: "100%",
            height: "100%",
            objectFit: "cover",
            display: "block",
          }}
        />
      ) : (
        <div
          style={{
            width: "100%",
            height: "100%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "var(--color-surface-2)",
            color: "var(--color-text-muted)",
            fontSize: 12,
            padding: 8,
            textAlign: "center",
          }}
        >
          {displayTitle}
        </div>
      )}

      {/* gradient overlay */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: hovered
            ? "linear-gradient(to top, rgba(0,0,0,0.85) 40%, rgba(0,0,0,0.2) 100%)"
            : "linear-gradient(to top, rgba(0,0,0,0.75) 25%, transparent 60%)",
          transition: "background 0.15s ease",
        }}
      />

      {/* Status chip — bottom left */}
      <div
        style={{
          position: "absolute",
          bottom: 8,
          left: 8,
          right: 8,
          display: "flex",
          flexWrap: "wrap",
          gap: 4,
        }}
      >
        <span
          style={{
            background:
              item.library_status === "available"
                ? "var(--color-success)"
                : "rgba(0,0,0,0.7)",
            color:
              item.library_status === "available"
                ? "#fff"
                : "var(--color-text-muted)",
            fontSize: 10,
            fontWeight: 600,
            borderRadius: "var(--radius-full)",
            padding: "2px 7px",
            letterSpacing: "0.04em",
            textTransform: "uppercase",
          }}
        >
          {item.library_status === "available" ? "Disponible" : "Pendiente"}
        </span>

        {/* Type badge */}
        <span
          style={{
            background:
              item.tmdb_type === "tv"
                ? "var(--color-teal)"
                : "var(--color-primary)",
            color: "#fff",
            fontSize: 10,
            fontWeight: 600,
            borderRadius: "var(--radius-full)",
            padding: "2px 7px",
            letterSpacing: "0.04em",
            textTransform: "uppercase",
          }}
        >
          {item.tmdb_type === "tv" ? "TV" : "Película"}
        </span>

        {/* Auto-download badge */}
        {item.auto_download === 1 && (
          <span
            style={{
              background: "rgba(0,0,0,0.7)",
              color: "var(--color-warning)",
              fontSize: 10,
              fontWeight: 600,
              borderRadius: "var(--radius-full)",
              padding: "2px 7px",
              letterSpacing: "0.04em",
            }}
          >
            ↓ Auto
          </span>
        )}

        {/* Library count — TV episodes in library */}
        {item.library_count > 0 && (
          <span
            style={{
              background: "rgba(0,0,0,0.7)",
              color: "var(--color-teal)",
              fontSize: 10,
              fontWeight: 600,
              borderRadius: "var(--radius-full)",
              padding: "2px 7px",
              letterSpacing: "0.04em",
            }}
          >
            {item.library_count}{" "}
            {item.tmdb_type === "tv" ? "ep." : "archivo(s)"}
          </span>
        )}

        {/* Next episode date */}
        {nextEpSoon && (
          <span
            style={{
              background: "rgba(0,0,0,0.7)",
              color: "var(--color-warning)",
              fontSize: 10,
              fontWeight: 600,
              borderRadius: "var(--radius-full)",
              padding: "2px 7px",
            }}
          >
            ▷{" "}
            {new Date(item.next_episode_date!).toLocaleDateString("es-ES", {
              day: "numeric",
              month: "short",
            })}
          </span>
        )}
      </div>

      {/* Hover overlay: remove button */}
      {hovered && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onRemove(item.id);
          }}
          style={{
            position: "absolute",
            top: 8,
            right: 8,
            background: "rgba(0,0,0,0.75)",
            border: "none",
            borderRadius: "50%",
            width: 28,
            height: 28,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            cursor: "pointer",
            color: "var(--color-danger)",
            transition: "background 0.15s ease",
            padding: 0,
          }}
          title="Quitar del watchlist"
        >
          <X size={14} strokeWidth={2.5} aria-hidden="true" />
        </button>
      )}
    </div>
  );
}
