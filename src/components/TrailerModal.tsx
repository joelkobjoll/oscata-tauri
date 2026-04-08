import { createPortal } from "react-dom";
import { X } from "lucide-react";

interface TrailerModalProps {
  trailerUrl: string;
  title: string;
  onClose: () => void;
}

function extractYoutubeId(url: string): string | null {
  try {
    const parsed = new URL(url);
    // https://www.youtube.com/watch?v=XXXXX
    const v = parsed.searchParams.get("v");
    if (v) return v;
    // https://youtu.be/XXXXX
    if (parsed.hostname === "youtu.be") return parsed.pathname.slice(1);
    // https://www.youtube.com/embed/XXXXX
    const embedMatch = parsed.pathname.match(/\/embed\/([^/?]+)/);
    if (embedMatch) return embedMatch[1];
  } catch {
    // not a valid URL
  }
  return null;
}

export default function TrailerModal({ trailerUrl, title, onClose }: TrailerModalProps) {
  const videoId = extractYoutubeId(trailerUrl);

  // If we can extract a YT id, use the privacy-friendly nocookie embed.
  // Otherwise fall back to a plain anchor (e.g. IMDb trailer URLs).
  const embedSrc = videoId
    ? `https://www.youtube-nocookie.com/embed/${videoId}?autoplay=1&rel=0`
    : null;

  return createPortal(
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{
          position: "fixed",
          inset: 0,
          background: "color-mix(in srgb, black 72%, transparent)",
          zIndex: 1100,
          backdropFilter: "blur(6px)",
        }}
      />

      {/* Dialog */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 1101,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "1rem",
          pointerEvents: "none",
        }}
      >
        <div
          style={{
            pointerEvents: "auto",
            width: "100%",
            maxWidth: 900,
            background: "var(--color-surface)",
            borderRadius: "var(--radius-lg)",
            border:
              "1px solid color-mix(in srgb, var(--color-border) 70%, transparent)",
            boxShadow: "0 24px 80px color-mix(in srgb, black 60%, transparent)",
            overflow: "hidden",
            display: "flex",
            flexDirection: "column",
          }}
        >
          {/* Header */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "0.85rem 1.1rem",
              borderBottom:
                "1px solid color-mix(in srgb, var(--color-border) 60%, transparent)",
              flexShrink: 0,
            }}
          >
            <span
              style={{
                fontSize: 13,
                fontWeight: 700,
                color: "var(--color-text)",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              🎬 {title}
            </span>
            <button
              onClick={onClose}
              style={{
                width: 30,
                height: 30,
                borderRadius: 8,
                border: "none",
                background: "transparent",
                color: "var(--color-text-muted)",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
              }}
            >
              <X size={16} />
            </button>
          </div>

          {/* Video */}
          <div
            style={{
              position: "relative",
              width: "100%",
              paddingBottom: "56.25%", // 16:9
              background: "#000",
            }}
          >
            {embedSrc ? (
              <iframe
                src={embedSrc}
                title={title}
                allow="autoplay; encrypted-media; picture-in-picture"
                allowFullScreen
                style={{
                  position: "absolute",
                  inset: 0,
                  width: "100%",
                  height: "100%",
                  border: "none",
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
                  flexDirection: "column",
                  gap: 12,
                  color: "var(--color-text-muted)",
                  fontSize: 14,
                }}
              >
                <span>No se puede incrustar este tráiler.</span>
                <a
                  href={trailerUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ color: "var(--color-primary)", textDecoration: "underline" }}
                >
                  Abrir en el navegador
                </a>
              </div>
            )}
          </div>
        </div>
      </div>
    </>,
    document.body,
  );
}
