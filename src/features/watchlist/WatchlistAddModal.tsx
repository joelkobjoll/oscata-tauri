import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { call } from "../../lib/transport";
import type { AppLanguage } from "../../utils/mediaLanguage";
import { t } from "../../utils/i18n";
import type { AddWatchlistParams } from "./types";
import { useQualityProfiles } from "./useQualityProfiles";
import Toggle from "../../components/Toggle";

const selectStyle: React.CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  padding: "0.72rem 0.9rem",
  paddingRight: "2.2rem",
  borderRadius: "var(--radius)",
  border: "1px solid color-mix(in srgb, var(--color-border) 78%, transparent)",
  background: "color-mix(in srgb, var(--color-surface-2) 84%, transparent)",
  color: "var(--color-text)",
  fontSize: 14,
  outline: "none",
  appearance: "none",
  backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%238888a0' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'/%3E%3C/svg%3E")`,
  backgroundRepeat: "no-repeat",
  backgroundPosition: "right 0.75rem center",
  cursor: "pointer",
};

interface TmdbResult {
  id: number;
  title: string;
  title_en?: string;
  release_date?: string;
  overview?: string;
  overview_en?: string;
  poster_path?: string;
  vote_average?: number;
}

interface WatchlistAddModalProps {
  language: AppLanguage;
  watchlistedTmdbIds: Set<number>;
  onAdd: (params: AddWatchlistParams) => Promise<void>;
  onClose: () => void;
}

const TMDB_IMG = "https://image.tmdb.org/t/p/w154";

export default function WatchlistAddModal({
  language,
  watchlistedTmdbIds,
  onAdd,
  onClose,
}: WatchlistAddModalProps) {
  const [query, setQuery] = useState("");
  const [mediaType, setMediaType] = useState<"movie" | "tv">("movie");
  const [results, setResults] = useState<TmdbResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<TmdbResult | null>(null);
  const [scope, setScope] = useState<"all" | "latest">("all");
  const [autoDownload, setAutoDownload] = useState(false);
  const [profileId, setProfileId] = useState<number>(0);
  const [adding, setAdding] = useState(false);
  const { profiles } = useQualityProfiles();
  const inputRef = useRef<HTMLInputElement>(null);

  // When profiles load, default to the first available profile.
  useEffect(() => {
    if (profiles.length > 0 && profileId === 0) {
      setProfileId(profiles[0].id);
    }
  }, [profiles, profileId]);

  useEffect(() => {
    setTimeout(() => inputRef.current?.focus(), 50);
  }, []);

  const search = async () => {
    if (!query.trim()) return;
    setLoading(true);
    setError("");
    setResults([]);
    try {
      const res = await call<TmdbResult[]>("search_tmdb", {
        query: query.trim(),
        mediaType,
      });
      setResults(res);
      if (res.length === 0) setError(t(language, "watchlist.noResults"));
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") void search();
    if (e.key === "Escape") {
      if (selected) setSelected(null);
      else onClose();
    }
  };

  const confirmAdd = async () => {
    if (!selected) return;
    setAdding(true);
    try {
      const title =
        language === "es"
          ? selected.title
          : (selected.title_en ?? selected.title);
      const titleEn = selected.title_en ?? selected.title;
      await onAdd({
        tmdb_id: selected.id,
        tmdb_type: mediaType,
        title,
        title_en: titleEn,
        poster: selected.poster_path ?? "",
        overview: selected.overview ?? "",
        overview_en: selected.overview_en ?? "",
        release_date: selected.release_date ?? "",
        year: selected.release_date
          ? parseInt(selected.release_date.slice(0, 4))
          : undefined,
        scope: mediaType === "tv" ? scope : "all",
        auto_download: autoDownload,
        profile_id: profileId,
      });
      onClose();
    } catch (e) {
      setError(String(e));
    } finally {
      setAdding(false);
    }
  };

  const overlay = (
    <div
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.7)",
        backdropFilter: "blur(4px)",
        zIndex: 1000,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
      }}
    >
      <div
        style={{
          background: "var(--color-surface)",
          border: "1px solid var(--color-border)",
          borderRadius: "var(--radius-lg)",
          width: "100%",
          maxWidth: 600,
          maxHeight: "85vh",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: "16px 20px",
            borderBottom: "1px solid var(--color-border)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
          }}
        >
          <h2
            style={{
              margin: 0,
              fontSize: 16,
              fontWeight: 600,
              color: "var(--color-text)",
            }}
          >
            {t(language, "watchlist.addTitle")}
          </h2>
          {selected && (
            <button onClick={() => setSelected(null)} style={ghostBtn}>
              ← {t(language, "watchlist.back")}
            </button>
          )}
          <button onClick={onClose} style={closeBtn}>
            ×
          </button>
        </div>

        {selected ? (
          /* Step 2: Confirm + options */
          <div
            style={{
              padding: 20,
              display: "flex",
              flexDirection: "column",
              gap: 16,
            }}
          >
            <div style={{ display: "flex", gap: 16, alignItems: "flex-start" }}>
              {selected.poster_path && (
                <img
                  src={`${TMDB_IMG}${selected.poster_path}`}
                  alt={selected.title}
                  style={{
                    width: 80,
                    borderRadius: "var(--radius)",
                    flexShrink: 0,
                  }}
                />
              )}
              <div>
                <div
                  style={{
                    fontWeight: 600,
                    color: "var(--color-text)",
                    fontSize: 15,
                  }}
                >
                  {language === "es"
                    ? selected.title
                    : (selected.title_en ?? selected.title)}
                </div>
                {selected.release_date && (
                  <div
                    style={{ color: "var(--color-text-muted)", fontSize: 13 }}
                  >
                    {selected.release_date.slice(0, 4)}
                  </div>
                )}
                {selected.overview && (
                  <div
                    style={{
                      marginTop: 6,
                      color: "var(--color-text-muted)",
                      fontSize: 12,
                      lineHeight: 1.5,
                      maxHeight: 72,
                      overflow: "hidden",
                    }}
                  >
                    {language === "es"
                      ? selected.overview
                      : (selected.overview_en ?? selected.overview)}
                  </div>
                )}
              </div>
            </div>

            {/* TV-only scope */}
            {mediaType === "tv" && (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <label
                  style={{
                    fontSize: 13,
                    color: "var(--color-text-muted)",
                    fontWeight: 500,
                  }}
                >
                  {t(language, "watchlist.coverage")}
                </label>
                <div style={{ display: "flex", gap: 8 }}>
                  {(["all", "latest"] as const).map((s) => (
                    <button
                      key={s}
                      onClick={() => setScope(s)}
                      style={{
                        ...chipBtn,
                        background:
                          scope === s
                            ? "var(--color-primary)"
                            : "var(--color-surface-2)",
                        color: scope === s ? "#fff" : "var(--color-text-muted)",
                      }}
                    >
                      {s === "all"
                        ? t(language, "watchlist.allSeasons")
                        : t(language, "watchlist.latestSeason")}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Auto-download toggle */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 10,
              }}
            >
              <span style={{ color: "var(--color-text)", fontSize: 14 }}>
                {t(language, "watchlist.autoDownload")}
              </span>
              <Toggle checked={autoDownload} onChange={setAutoDownload} />
            </div>

            {/* Quality profile */}
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <label
                style={{
                  fontSize: 13,
                  color: "var(--color-text-muted)",
                  fontWeight: 500,
                }}
              >
                {t(language, "watchlist.qualityProfile")}
              </label>
              <select
                value={profileId}
                onChange={(e) => setProfileId(Number(e.target.value))}
                style={selectStyle}
              >
                {profiles.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>

            {error && (
              <div style={{ color: "var(--color-danger)", fontSize: 13 }}>
                {error}
              </div>
            )}

            <div
              style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}
            >
              <button onClick={() => setSelected(null)} style={ghostBtn}>
                {t(language, "watchlist.cancel")}
              </button>
              <button
                onClick={() => void confirmAdd()}
                disabled={adding}
                style={primaryBtn}
              >
                {adding
                  ? t(language, "watchlist.adding")
                  : t(language, "watchlist.add")}
              </button>
            </div>
          </div>
        ) : (
          /* Step 1: Search */
          <>
            <div
              style={{
                padding: "12px 16px",
                display: "flex",
                gap: 8,
                borderBottom: "1px solid var(--color-border)",
              }}
            >
              {/* Type toggle */}
              <div style={{ display: "flex", gap: 4 }}>
                {(["movie", "tv"] as const).map((mt) => (
                  <button
                    key={mt}
                    onClick={() => setMediaType(mt)}
                    style={{
                      ...chipBtn,
                      background:
                        mediaType === mt
                          ? "var(--color-primary)"
                          : "var(--color-surface-2)",
                      color:
                        mediaType === mt ? "#fff" : "var(--color-text-muted)",
                    }}
                  >
                    {mt === "movie" ? t(language, "watchlist.movie") : "TV"}
                  </button>
                ))}
              </div>

              <input
                ref={inputRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={handleKey}
                placeholder={t(language, "watchlist.searchPlaceholder")}
                style={searchInput}
              />

              <button
                onClick={() => void search()}
                disabled={loading}
                style={primaryBtn}
              >
                {loading
                  ? t(language, "watchlist.searching")
                  : t(language, "watchlist.search")}
              </button>
            </div>

            {error && (
              <div
                style={{
                  padding: "8px 16px",
                  color: "var(--color-text-muted)",
                  fontSize: 13,
                }}
              >
                {error}
              </div>
            )}

            <div style={{ overflowY: "auto", flex: 1 }}>
              {results.map((r) => {
                const alreadyAdded = watchlistedTmdbIds.has(r.id);
                const displayTitle =
                  language === "es" ? r.title : (r.title_en ?? r.title);
                return (
                  <button
                    key={r.id}
                    disabled={alreadyAdded}
                    onClick={() => !alreadyAdded && setSelected(r)}
                    style={{
                      display: "flex",
                      gap: 12,
                      alignItems: "center",
                      width: "100%",
                      padding: "10px 16px",
                      background: "transparent",
                      border: "none",
                      borderBottom: "1px solid var(--color-border)",
                      cursor: alreadyAdded ? "default" : "pointer",
                      textAlign: "left",
                      opacity: alreadyAdded ? 0.5 : 1,
                      transition: "background 0.1s ease",
                    }}
                    onMouseEnter={(e) => {
                      if (!alreadyAdded)
                        (
                          e.currentTarget as HTMLButtonElement
                        ).style.background = "var(--color-surface-2)";
                    }}
                    onMouseLeave={(e) => {
                      (e.currentTarget as HTMLButtonElement).style.background =
                        "transparent";
                    }}
                  >
                    {r.poster_path ? (
                      <img
                        src={`${TMDB_IMG}${r.poster_path}`}
                        alt={displayTitle}
                        style={{
                          width: 40,
                          height: 60,
                          objectFit: "cover",
                          borderRadius: 4,
                          flexShrink: 0,
                        }}
                      />
                    ) : (
                      <div
                        style={{
                          width: 40,
                          height: 60,
                          background: "var(--color-surface-2)",
                          borderRadius: 4,
                          flexShrink: 0,
                        }}
                      />
                    )}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div
                        style={{
                          fontWeight: 500,
                          color: "var(--color-text)",
                          fontSize: 14,
                        }}
                      >
                        {displayTitle}
                      </div>
                      <div
                        style={{
                          fontSize: 12,
                          color: "var(--color-text-muted)",
                          marginTop: 2,
                        }}
                      >
                        {r.release_date?.slice(0, 4)}
                        {r.vote_average
                          ? ` · ★ ${r.vote_average.toFixed(1)}`
                          : ""}
                      </div>
                    </div>
                    {alreadyAdded && (
                      <span
                        style={{
                          fontSize: 11,
                          background: "var(--color-success)",
                          color: "#fff",
                          borderRadius: "var(--radius-full)",
                          padding: "2px 8px",
                          flexShrink: 0,
                        }}
                      >
                        {t(language, "watchlist.alreadyAdded")}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </>
        )}
      </div>
    </div>
  );

  return createPortal(overlay, document.body);
}

const ghostBtn: React.CSSProperties = {
  background: "transparent",
  border: "1px solid var(--color-border)",
  color: "var(--color-text-muted)",
  borderRadius: "var(--radius)",
  padding: "6px 12px",
  cursor: "pointer",
  fontSize: 13,
};

const closeBtn: React.CSSProperties = {
  background: "transparent",
  border: "none",
  color: "var(--color-text-muted)",
  fontSize: 20,
  cursor: "pointer",
  lineHeight: 1,
  padding: "0 4px",
  marginLeft: "auto",
};

const primaryBtn: React.CSSProperties = {
  background: "var(--color-primary)",
  border: "none",
  color: "#fff",
  borderRadius: "var(--radius)",
  padding: "6px 14px",
  cursor: "pointer",
  fontSize: 13,
  fontWeight: 500,
};

const chipBtn: React.CSSProperties = {
  border: "none",
  borderRadius: "var(--radius-full)",
  padding: "4px 12px",
  cursor: "pointer",
  fontSize: 12,
  fontWeight: 500,
  transition: "background 0.15s ease",
};

const searchInput: React.CSSProperties = {
  flex: 1,
  background: "var(--color-surface-2)",
  border: "1px solid var(--color-border)",
  borderRadius: "var(--radius)",
  color: "var(--color-text)",
  padding: "6px 12px",
  fontSize: 14,
  outline: "none",
};
