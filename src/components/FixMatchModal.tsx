import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { call } from "../lib/transport";
import AppIcon from "./AppIcon";
import type { AppLanguage } from "../utils/mediaLanguage";
import { resolveImageUrl } from "../utils/mediaLanguage";
import { t } from "../utils/i18n";

interface TmdbResult {
  id: number;
  title: string;
  title_en?: string;
  release_date?: string;
  overview?: string;
  overview_en?: string;
  poster_path?: string;
  poster_path_en?: string;
  vote_average?: number;
}

export default function FixMatchModal({
  itemIds,
  initialQuery,
  initialMediaType = "movie",
  language,
  onApply,
  onClose,
}: {
  itemIds: number[];
  initialQuery: string;
  initialMediaType?: string;
  language: AppLanguage;
  onApply: (itemId: number, movie: TmdbResult) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState(initialQuery);
  const [mediaType, setMediaType] = useState<"movie" | "tv" | "documentary">(
    initialMediaType === "tv"
      ? "tv"
      : initialMediaType === "documentary"
        ? "documentary"
        : "movie",
  );
  const [results, setResults] = useState<TmdbResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState<number | null>(null);
  const [error, setError] = useState("");

  const search = async (nextQuery = query, nextType = mediaType) => {
    if (!nextQuery.trim()) return;
    setLoading(true);
    setError("");
    try {
      const res = await call<TmdbResult[]>("search_tmdb", {
        query: nextQuery,
        mediaType: nextType,
      });
      setResults(res);
      if (res.length === 0) setError(t(language, "modal.noResults"));
    } catch (e: any) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (initialQuery.trim()) {
      void search(initialQuery, mediaType);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const apply = async (movie: TmdbResult) => {
    setApplying(movie.id);
    setError("");
    try {
      for (const id of itemIds) {
        await call("apply_tmdb_match", {
          itemId: id,
          tmdbId: movie.id,
          mediaType,
        });
        onApply(id, movie);
      }
      onClose();
    } catch (e: any) {
      setError(String(e));
    } finally {
      setApplying(null);
    }
  };

  const scopeLabel =
    itemIds.length > 1
      ? t(language, "modal.applyMany", { count: itemIds.length })
      : t(language, "modal.applyOne");

  const modalContent = (
    <div
      className="modal-overlay"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        className="modal-panel-enter"
        style={{
          width: "100%",
          maxWidth: 860,
          maxHeight: "calc(100dvh - 2.5rem)",
          display: "grid",
          gridTemplateColumns: "280px minmax(0, 1fr)",
          overflow: "hidden",
          borderRadius: "calc(var(--radius-lg) + 4px)",
          border:
            "1px solid color-mix(in srgb, var(--color-border) 82%, transparent)",
          background:
            "linear-gradient(155deg, color-mix(in srgb, var(--color-surface) 94%, var(--color-bg) 6%), color-mix(in srgb, var(--color-surface-2) 88%, var(--color-bg) 12%))",
          boxShadow:
            "0 18px 44px color-mix(in srgb, black 34%, transparent), 0 30px 90px color-mix(in srgb, black 26%, transparent)",
        }}
      >
        <aside
          style={{
            padding: "1.4rem",
            borderRight:
              "1px solid color-mix(in srgb, var(--color-border) 70%, transparent)",
            background:
              "linear-gradient(180deg, color-mix(in srgb, var(--color-surface) 92%, transparent), color-mix(in srgb, var(--color-surface-2) 82%, transparent))",
            display: "flex",
            flexDirection: "column",
            gap: 18,
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
            <div>
              <div
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  letterSpacing: "0.08em",
                  textTransform: "uppercase",
                  color: "var(--color-primary)",
                  marginBottom: 8,
                }}
              >
                {t(language, "modal.matchEditor")}
              </div>
              <h2
                style={{
                  margin: 0,
                  fontSize: 22,
                  lineHeight: 1.05,
                  letterSpacing: "-0.03em",
                  color: "var(--color-text)",
                }}
              >
                {t(language, "modal.fixTmdb")}
              </h2>
            </div>
            <button
              onClick={onClose}
              style={{
                width: 34,
                height: 34,
                borderRadius: 999,
                border:
                  "1px solid color-mix(in srgb, var(--color-border) 80%, transparent)",
                background:
                  "color-mix(in srgb, var(--color-surface) 92%, transparent)",
                color: "var(--color-text-muted)",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <AppIcon name="close" size={15} strokeWidth={2.3} />
            </button>
          </div>

          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 10,
              padding: "1rem",
              borderRadius: "var(--radius-lg)",
              border:
                "1px solid color-mix(in srgb, var(--color-border) 76%, transparent)",
              background:
                "color-mix(in srgb, var(--color-bg) 44%, transparent)",
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
              {t(language, "modal.searchTarget")}
            </span>
            <div
              style={{
                fontSize: 18,
                fontWeight: 700,
                lineHeight: 1.2,
                color: "var(--color-text)",
              }}
            >
              {initialQuery || t(language, "modal.untitled")}
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              <span
                style={{
                  padding: "0.3rem 0.65rem",
                  borderRadius: 999,
                  background:
                    "color-mix(in srgb, var(--color-primary) 16%, transparent)",
                  color: "var(--color-primary)",
                  fontSize: 12,
                  fontWeight: 700,
                }}
              >
                {scopeLabel}
              </span>
              <span
                style={{
                  padding: "0.3rem 0.65rem",
                  borderRadius: 999,
                  background:
                    "color-mix(in srgb, var(--color-surface) 92%, transparent)",
                  color: "var(--color-text-muted)",
                  fontSize: 12,
                  fontWeight: 700,
                }}
              >
                {mediaType === "tv"
                  ? "TV"
                  : mediaType === "documentary"
                    ? t(language, "modal.documentary")
                    : t(language, "modal.movie")}
              </span>
              <span
                style={{
                  padding: "0.3rem 0.65rem",
                  borderRadius: 999,
                  background:
                    "color-mix(in srgb, var(--color-surface) 92%, transparent)",
                  color: "var(--color-text-muted)",
                  fontSize: 12,
                  fontWeight: 700,
                }}
              >
                {language === "es"
                  ? t(language, "common.languageSpanish")
                  : t(language, "common.languageEnglish")}
              </span>
            </div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <span
              style={{
                fontSize: 11,
                fontWeight: 700,
                letterSpacing: "0.06em",
                textTransform: "uppercase",
                color: "var(--color-text-muted)",
              }}
            >
              {t(language, "modal.type")}
            </span>
            <div style={{ display: "grid", gap: 8 }}>
              {(
                [
                  ["movie", t(language, "modal.movie")],
                  ["tv", "TV"],
                  ["documentary", t(language, "modal.doc")],
                ] as const
              ).map(([value, label]) => {
                const active = mediaType === value;
                return (
                  <button
                    key={value}
                    onClick={() => {
                      setMediaType(value);
                      setResults([]);
                      setError("");
                    }}
                    style={{
                      padding: "0.82rem 0.9rem",
                      borderRadius: "var(--radius)",
                      border: active
                        ? "1px solid color-mix(in srgb, var(--color-primary) 44%, transparent)"
                        : "1px solid color-mix(in srgb, var(--color-border) 82%, transparent)",
                      background: active
                        ? "color-mix(in srgb, var(--color-primary) 16%, transparent)"
                        : "color-mix(in srgb, var(--color-surface-2) 74%, transparent)",
                      color: active
                        ? "var(--color-text)"
                        : "var(--color-text-muted)",
                      fontSize: 13,
                      fontWeight: 700,
                      cursor: "pointer",
                      textAlign: "left",
                    }}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </div>
        </aside>

        <section
          style={{ minWidth: 0, display: "flex", flexDirection: "column" }}
        >
          <div
            style={{
              padding: "1.35rem 1.5rem 1rem",
              borderBottom:
                "1px solid color-mix(in srgb, var(--color-border) 70%, transparent)",
              display: "flex",
              flexDirection: "column",
              gap: 12,
            }}
          >
            <div style={{ display: "flex", gap: 10 }}>
              <div
                style={{
                  flex: 1,
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  minHeight: 46,
                  padding: "0 14px",
                  borderRadius: "var(--radius-full)",
                  border:
                    "1px solid color-mix(in srgb, var(--color-border) 84%, transparent)",
                  background:
                    "color-mix(in srgb, var(--color-bg) 32%, transparent)",
                }}
              >
                <span style={{ color: "var(--color-text-muted)" }}>
                  <AppIcon name="search" size={15} strokeWidth={2.2} />
                </span>
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && search()}
                  placeholder={t(language, "modal.searchPlaceholder")}
                  autoFocus
                  style={{
                    width: "100%",
                    border: "none",
                    outline: "none",
                    background: "transparent",
                    color: "var(--color-text)",
                    fontSize: 14,
                  }}
                />
              </div>
              <button
                onClick={() => search()}
                disabled={loading}
                style={{
                  minWidth: 110,
                  padding: "0 18px",
                  borderRadius: "var(--radius-full)",
                  border: "none",
                  background: "var(--color-primary)",
                  color: "#fff",
                  cursor: loading ? "default" : "pointer",
                  fontSize: 14,
                  fontWeight: 700,
                  opacity: loading ? 0.65 : 1,
                }}
              >
                {loading
                  ? t(language, "modal.searching")
                  : t(language, "modal.search")}
              </button>
            </div>

            {error && (
              <div
                style={{
                  padding: "0.8rem 1rem",
                  borderRadius: "var(--radius)",
                  border:
                    "1px solid color-mix(in srgb, var(--color-warning) 36%, transparent)",
                  background:
                    "color-mix(in srgb, var(--color-warning) 10%, transparent)",
                  color: "var(--color-warning)",
                  fontSize: 13,
                  fontWeight: 600,
                }}
              >
                {error}
              </div>
            )}
          </div>

          <div
            style={{
              flex: 1,
              overflowY: "auto",
              padding: "1rem 1.25rem 1.25rem",
              display: "flex",
              flexDirection: "column",
              gap: 10,
            }}
          >
            {results.length === 0 && !loading ? (
              <div
                style={{
                  minHeight: 220,
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 10,
                  borderRadius: "var(--radius-lg)",
                  border:
                    "1px dashed color-mix(in srgb, var(--color-border) 70%, transparent)",
                  background:
                    "color-mix(in srgb, var(--color-bg) 24%, transparent)",
                  color: "var(--color-text-muted)",
                  textAlign: "center",
                  padding: "1.5rem",
                }}
              >
                <AppIcon name="search" size={28} strokeWidth={1.8} />
                <div
                  style={{
                    fontSize: 15,
                    fontWeight: 700,
                    color: "var(--color-text)",
                  }}
                >
                  {t(language, "modal.emptyTitle")}
                </div>
                <div style={{ maxWidth: 420, fontSize: 13, lineHeight: 1.6 }}>
                  {t(language, "modal.emptyBody")}
                </div>
              </div>
            ) : (
              results.map((movie) => {
                const year = movie.release_date?.slice(0, 4);
                const isApplying = applying === movie.id;
                const title =
                  language === "en"
                    ? (movie.title_en ?? movie.title)
                    : movie.title;
                const altTitle =
                  language === "en" ? movie.title : movie.title_en;
                const overview =
                  language === "en"
                    ? (movie.overview_en ?? movie.overview)
                    : movie.overview;
                const posterPath =
                  language === "en"
                    ? (movie.poster_path_en ?? movie.poster_path)
                    : movie.poster_path;
                return (
                  <div
                    key={movie.id}
                    style={{
                      display: "grid",
                      gridTemplateColumns: "92px minmax(0, 1fr) auto",
                      gap: 14,
                      alignItems: "center",
                      padding: "0.9rem",
                      borderRadius: "calc(var(--radius-lg) + 2px)",
                      border:
                        "1px solid color-mix(in srgb, var(--color-border) 78%, transparent)",
                      background:
                        "linear-gradient(155deg, color-mix(in srgb, var(--color-surface) 90%, transparent), color-mix(in srgb, var(--color-surface-2) 78%, transparent))",
                      boxShadow:
                        "0 12px 28px color-mix(in srgb, black 14%, transparent)",
                    }}
                  >
                    {posterPath ? (
                      <img
                        src={resolveImageUrl(posterPath, "w154") ?? ""}
                        alt={title}
                        style={{
                          width: 92,
                          aspectRatio: "2 / 3",
                          objectFit: "cover",
                          borderRadius: "var(--radius)",
                          border:
                            "1px solid color-mix(in srgb, var(--color-border) 70%, transparent)",
                        }}
                      />
                    ) : (
                      <div
                        style={{
                          width: 92,
                          aspectRatio: "2 / 3",
                          borderRadius: "var(--radius)",
                          border:
                            "1px solid color-mix(in srgb, var(--color-border) 70%, transparent)",
                          background:
                            "color-mix(in srgb, var(--color-surface-2) 84%, transparent)",
                        }}
                      />
                    )}

                    <div
                      style={{
                        minWidth: 0,
                        display: "flex",
                        flexDirection: "column",
                        gap: 7,
                      }}
                    >
                      <div
                        style={{
                          fontSize: 18,
                          fontWeight: 700,
                          color: "var(--color-text)",
                          lineHeight: 1.15,
                        }}
                      >
                        {title}
                        {year && (
                          <span
                            style={{
                              marginLeft: 8,
                              fontSize: 14,
                              fontWeight: 500,
                              color: "var(--color-text-muted)",
                            }}
                          >
                            {year}
                          </span>
                        )}
                      </div>

                      {altTitle && altTitle !== title && (
                        <div
                          style={{
                            fontSize: 13,
                            color: "var(--color-text-muted)",
                          }}
                        >
                          {altTitle}
                        </div>
                      )}

                      <div
                        style={{ display: "flex", flexWrap: "wrap", gap: 8 }}
                      >
                        <span
                          style={{
                            padding: "0.24rem 0.6rem",
                            borderRadius: 999,
                            background:
                              "color-mix(in srgb, var(--color-surface) 94%, transparent)",
                            color: "var(--color-text-muted)",
                            fontSize: 12,
                            fontWeight: 700,
                          }}
                        >
                          TMDB #{movie.id}
                        </span>
                        {movie.vote_average != null &&
                          movie.vote_average > 0 && (
                            <span
                              style={{
                                padding: "0.24rem 0.6rem",
                                borderRadius: 999,
                                background:
                                  "color-mix(in srgb, var(--color-primary) 16%, transparent)",
                                color: "var(--color-primary)",
                                fontSize: 12,
                                fontWeight: 700,
                              }}
                            >
                              {t(language, "modal.rating", {
                                rating: movie.vote_average.toFixed(1),
                              })}
                            </span>
                          )}
                      </div>

                      {overview && (
                        <p
                          style={{
                            margin: 0,
                            color: "var(--color-text-muted)",
                            fontSize: 13,
                            lineHeight: 1.6,
                            overflow: "hidden",
                            display: "-webkit-box",
                            WebkitBoxOrient: "vertical",
                            WebkitLineClamp: 3,
                          }}
                        >
                          {overview}
                        </p>
                      )}
                    </div>

                    <button
                      onClick={() => apply(movie)}
                      disabled={applying != null}
                      style={{
                        minWidth: 110,
                        padding: "0.85rem 1rem",
                        borderRadius: "var(--radius-full)",
                        border: "none",
                        background: isApplying
                          ? "color-mix(in srgb, var(--color-border) 92%, transparent)"
                          : "var(--color-success)",
                        color: "#fff",
                        cursor: applying != null ? "default" : "pointer",
                        fontSize: 13,
                        fontWeight: 700,
                        opacity: applying != null && !isApplying ? 0.6 : 1,
                      }}
                    >
                      {isApplying
                        ? t(language, "modal.applying")
                        : t(language, "modal.useMatch")}
                    </button>
                  </div>
                );
              })
            )}
          </div>
        </section>
      </div>
    </div>
  );

  if (typeof document === "undefined") {
    return modalContent;
  }

  return createPortal(modalContent, document.body);
}
