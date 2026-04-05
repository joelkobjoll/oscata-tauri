import { useEffect, useState } from "react";
import { Check } from "lucide-react";
import type { WatchlistCoverageItem, WatchlistItem } from "./types";
import type { AppLanguage } from "../../utils/mediaLanguage";
import { t } from "../../utils/i18n";
import { useQualityProfiles } from "./useQualityProfiles";
import Toggle from "../../components/Toggle";

const selectStyle: React.CSSProperties = {
  display: "block",
  width: "100%",
  boxSizing: "border-box",
  marginTop: 6,
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

interface WatchlistDetailPanelProps {
  item: WatchlistItem;
  language: AppLanguage;
  onClose: () => void;
  onRemove: (id: number) => void;
  onUpdate: (
    id: number,
    scope: "all" | "latest",
    autoDownload: boolean,
    profileId: number,
  ) => Promise<void>;
  getCoverage: (tmdbId: number) => Promise<WatchlistCoverageItem[]>;
}

const TMDB_IMG_W = "https://image.tmdb.org/t/p/w300";

export default function WatchlistDetailPanel({
  item,
  language,
  onClose,
  onRemove,
  onUpdate,
  getCoverage,
}: WatchlistDetailPanelProps) {
  const [scope, setScope] = useState<"all" | "latest">(
    (item.scope as "all" | "latest") ?? "all",
  );
  const [autoDownload, setAutoDownload] = useState(item.auto_download === 1);
  const [profileId, setProfileId] = useState<number>(item.profile_id ?? 1);
  const [saving, setSaving] = useState(false);
  const { profiles } = useQualityProfiles();
  const [coverage, setCoverage] = useState<WatchlistCoverageItem[]>([]);
  const [coverageOpen, setCoverageOpen] = useState(false);
  const [loadingCoverage, setLoadingCoverage] = useState(false);

  const poster = item.poster
    ? item.poster.startsWith("http")
      ? item.poster
      : `${TMDB_IMG_W}${item.poster}`
    : null;

  const displayTitle =
    language === "es" ? item.title : (item.title_en ?? item.title);
  const displayOverview =
    language === "es" ? item.overview : (item.overview_en ?? item.overview);

  const isDirty =
    scope !== item.scope ||
    autoDownload !== (item.auto_download === 1) ||
    profileId !== (item.profile_id ?? 1);

  const handleSave = async () => {
    setSaving(true);
    try {
      await onUpdate(item.id, scope, autoDownload, profileId);
    } finally {
      setSaving(false);
    }
  };

  const loadCoverage = async () => {
    if (coverage.length > 0) {
      setCoverageOpen((o) => !o);
      return;
    }
    setLoadingCoverage(true);
    setCoverageOpen(true);
    try {
      const c = await getCoverage(item.tmdb_id);
      setCoverage(c);
    } finally {
      setLoadingCoverage(false);
    }
  };

  // Group coverage by season
  const bySeason = coverage.reduce<Record<number, WatchlistCoverageItem[]>>(
    (acc, ep) => {
      if (ep.season == null) return acc;
      if (!acc[ep.season]) acc[ep.season] = [];
      acc[ep.season].push(ep);
      return acc;
    },
    {},
  );

  // Auto-load coverage when panel opens if items already in library
  useEffect(() => {
    if (item.library_count > 0) {
      setLoadingCoverage(true);
      setCoverageOpen(true);
      getCoverage(item.tmdb_id)
        .then(setCoverage)
        .finally(() => setLoadingCoverage(false));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.id]);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{
          position: "fixed",
          inset: 0,
          background: "rgba(0,0,0,0.4)",
          zIndex: 500,
        }}
      />

      {/* Side panel */}
      <div
        style={{
          position: "fixed",
          top: 68,
          right: 0,
          bottom: 0,
          width: 360,
          background: "var(--color-surface)",
          borderLeft: "1px solid var(--color-border)",
          zIndex: 501,
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: "14px 16px",
            borderBottom: "1px solid var(--color-border)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <span
            style={{
              fontWeight: 600,
              color: "var(--color-text)",
              fontSize: 15,
            }}
          >
            {t(language, "watchlist.detail")}
          </span>
          <button
            onClick={onClose}
            style={{
              background: "transparent",
              border: "none",
              color: "var(--color-text-muted)",
              fontSize: 20,
              cursor: "pointer",
              lineHeight: 1,
            }}
          >
            ×
          </button>
        </div>

        {/* Scrollable content */}
        <div
          style={{
            flex: 1,
            overflowY: "auto",
            padding: 16,
            display: "flex",
            flexDirection: "column",
            gap: 16,
          }}
        >
          {/* Poster + title */}
          <div style={{ display: "flex", gap: 14 }}>
            {poster ? (
              <img
                src={poster}
                alt={displayTitle}
                style={{
                  width: 90,
                  borderRadius: "var(--radius)",
                  flexShrink: 0,
                }}
              />
            ) : (
              <div
                style={{
                  width: 90,
                  height: 135,
                  background: "var(--color-surface-2)",
                  borderRadius: "var(--radius)",
                  flexShrink: 0,
                }}
              />
            )}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div
                style={{
                  fontWeight: 700,
                  color: "var(--color-text)",
                  fontSize: 15,
                  lineHeight: 1.3,
                }}
              >
                {displayTitle}
              </div>
              {item.year && (
                <div
                  style={{
                    color: "var(--color-text-muted)",
                    fontSize: 13,
                    marginTop: 4,
                  }}
                >
                  {item.year}
                </div>
              )}
              {/* Type */}
              <span
                style={{
                  display: "inline-block",
                  marginTop: 6,
                  background:
                    item.tmdb_type === "tv"
                      ? "var(--color-teal)"
                      : "var(--color-primary)",
                  color: "#fff",
                  fontSize: 10,
                  fontWeight: 600,
                  borderRadius: "var(--radius-full)",
                  padding: "2px 8px",
                  textTransform: "uppercase",
                }}
              >
                {item.tmdb_type === "tv" ? "TV" : "Película"}
              </span>
              {/* Status */}
              <span
                style={{
                  display: "inline-block",
                  marginTop: 6,
                  marginLeft: 6,
                  background:
                    item.library_status === "available"
                      ? "var(--color-success)"
                      : "var(--color-surface-2)",
                  color:
                    item.library_status === "available"
                      ? "#fff"
                      : "var(--color-text-muted)",
                  fontSize: 10,
                  fontWeight: 600,
                  borderRadius: "var(--radius-full)",
                  padding: "2px 8px",
                  textTransform: "uppercase",
                }}
              >
                {item.library_status === "available"
                  ? t(language, "watchlist.available")
                  : t(language, "watchlist.pending")}
              </span>
              {item.library_count > 0 && (
                <div
                  style={{
                    fontSize: 12,
                    color: "var(--color-text-muted)",
                    marginTop: 4,
                  }}
                >
                  {item.library_count} {t(language, "watchlist.filesInLibrary")}
                </div>
              )}
            </div>
          </div>

          {/* Overview */}
          {displayOverview && (
            <p
              style={{
                margin: 0,
                fontSize: 13,
                color: "var(--color-text-muted)",
                lineHeight: 1.6,
              }}
            >
              {displayOverview}
            </p>
          )}

          {/* TV scope */}
          {item.tmdb_type === "tv" && (
            <div>
              <label
                style={{
                  fontSize: 12,
                  color: "var(--color-text-muted)",
                  fontWeight: 500,
                }}
              >
                {t(language, "watchlist.coverage")}
              </label>
              <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
                {(["all", "latest"] as const).map((s) => (
                  <button
                    key={s}
                    onClick={() => setScope(s)}
                    style={{
                      border: "none",
                      borderRadius: "var(--radius-full)",
                      padding: "4px 12px",
                      cursor: "pointer",
                      fontSize: 12,
                      fontWeight: 500,
                      background:
                        scope === s
                          ? "var(--color-primary)"
                          : "var(--color-surface-2)",
                      color: scope === s ? "#fff" : "var(--color-text-muted)",
                      transition: "background 0.15s ease",
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

          {/* Auto-download */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 10,
            }}
          >
            <span style={{ fontSize: 13, color: "var(--color-text)" }}>
              {t(language, "watchlist.autoDownload")}
            </span>
            <Toggle checked={autoDownload} onChange={setAutoDownload} />
          </div>

          {/* Quality profile */}
          <div>
            <label
              style={{
                fontSize: 12,
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

          {/* Save button */}
          {isDirty && (
            <button
              onClick={() => void handleSave()}
              disabled={saving}
              style={{
                background: "var(--color-primary)",
                border: "none",
                color: "#fff",
                borderRadius: "var(--radius)",
                padding: "8px 16px",
                cursor: "pointer",
                fontSize: 13,
                fontWeight: 500,
              }}
            >
              {saving
                ? t(language, "watchlist.saving")
                : t(language, "watchlist.saveChanges")}
            </button>
          )}

          {/* Episode coverage accordion */}
          {item.tmdb_type === "tv" && (
            <div>
              <button
                onClick={() => void loadCoverage()}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  background: "transparent",
                  border: "1px solid var(--color-border)",
                  borderRadius: "var(--radius)",
                  color: "var(--color-text-muted)",
                  padding: "7px 12px",
                  cursor: "pointer",
                  fontSize: 13,
                  width: "100%",
                  justifyContent: "space-between",
                }}
              >
                <span>
                  {t(language, "watchlist.episodesInLibrary")}
                  {coverage.length > 0 && ` (${coverage.length})`}
                </span>
                <span style={{ fontSize: 10 }}>{coverageOpen ? "▲" : "▼"}</span>
              </button>

              {coverageOpen && (
                <div
                  style={{
                    marginTop: 4,
                    border: "1px solid var(--color-border)",
                    borderRadius: "var(--radius)",
                    overflow: "hidden",
                  }}
                >
                  {loadingCoverage ? (
                    <div
                      style={{
                        padding: "12px 16px",
                        color: "var(--color-text-muted)",
                        fontSize: 13,
                      }}
                    >
                      {t(language, "watchlist.loadingCoverage")}
                    </div>
                  ) : coverage.length === 0 ? (
                    <div
                      style={{
                        padding: "12px 16px",
                        color: "var(--color-text-muted)",
                        fontSize: 13,
                      }}
                    >
                      {t(language, "watchlist.noEpisodesInLibrary")}
                    </div>
                  ) : (
                    Object.entries(bySeason).map(([season, episodes]) => (
                      <div key={season}>
                        <div
                          style={{
                            padding: "6px 12px",
                            background: "var(--color-surface-2)",
                            fontSize: 12,
                            fontWeight: 600,
                            color: "var(--color-text-muted)",
                            borderBottom: "1px solid var(--color-border)",
                          }}
                        >
                          {t(language, "watchlist.season")} {season}
                        </div>
                        {episodes.map((ep, i) => (
                          <div
                            key={i}
                            style={{
                              padding: "6px 12px",
                              display: "flex",
                              justifyContent: "space-between",
                              alignItems: "center",
                              borderBottom:
                                i < episodes.length - 1
                                  ? "1px solid var(--color-border)"
                                  : "none",
                            }}
                          >
                            <span
                              style={{
                                fontSize: 12,
                                color: "var(--color-text)",
                                display: "flex",
                                alignItems: "center",
                                gap: 5,
                              }}
                            >
                              <Check
                                size={13}
                                strokeWidth={2.5}
                                style={{
                                  color: "var(--color-success)",
                                  flexShrink: 0,
                                }}
                                aria-hidden="true"
                              />
                              E{String(ep.episode).padStart(2, "0")}{" "}
                              <span
                                style={{ color: "var(--color-text-muted)" }}
                              >
                                {ep.filename}
                              </span>
                            </span>
                            {ep.resolution && (
                              <span
                                style={{
                                  fontSize: 10,
                                  background: "var(--color-surface-2)",
                                  color: "var(--color-text-muted)",
                                  borderRadius: "var(--radius-full)",
                                  padding: "2px 6px",
                                }}
                              >
                                {ep.resolution}
                              </span>
                            )}
                          </div>
                        ))}
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer: remove */}
        <div
          style={{
            padding: "12px 16px",
            borderTop: "1px solid var(--color-border)",
          }}
        >
          <button
            onClick={() => onRemove(item.id)}
            style={{
              background: "transparent",
              border: "1px solid var(--color-danger)",
              color: "var(--color-danger)",
              borderRadius: "var(--radius)",
              padding: "7px 14px",
              cursor: "pointer",
              fontSize: 13,
              width: "100%",
              fontWeight: 500,
            }}
          >
            {t(language, "watchlist.removeFromWatchlist")}
          </button>
        </div>
      </div>
    </>
  );
}
