import { useEffect, useMemo, useState } from "react";
import { CalendarClock, Check, ExternalLink, Server } from "lucide-react";
import type { TmdbSeason, WatchlistCoverageItem, WatchlistItem } from "./types";
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
  getSeasons: (tmdbId: number) => Promise<TmdbSeason[]>;
  onNavigateToItem?: (tmdbId: number, mediaType: string) => void;
}

const TMDB_IMG_W = "https://image.tmdb.org/t/p/w300";

/** Numeric rank for sorting: lower number = lower resolution. */
function resolutionRank(res: string | null | undefined): number {
  const s = (res ?? "").toUpperCase();
  if (s.includes("2160") || s === "4K" || s === "UHD") return 4;
  if (s.includes("1080")) return 3;
  if (s.includes("720")) return 2;
  if (s.includes("480") || s.includes("576")) return 1;
  return 0; // SD / unknown
}

function sortByResolution(
  items: WatchlistCoverageItem[],
): WatchlistCoverageItem[] {
  return [...items].sort(
    (a, b) => resolutionRank(a.resolution) - resolutionRank(b.resolution),
  );
}

export default function WatchlistDetailPanel({
  item,
  language,
  onClose,
  onRemove,
  onUpdate,
  getCoverage,
  getSeasons,
  onNavigateToItem,
}: WatchlistDetailPanelProps) {
  const [scope, setScope] = useState<"all" | "latest">(
    (item.scope as "all" | "latest") ?? "all",
  );
  const [autoDownload, setAutoDownload] = useState(item.auto_download === 1);
  const [profileId, setProfileId] = useState<number>(item.profile_id ?? 1);
  const [saving, setSaving] = useState(false);
  const { profiles } = useQualityProfiles();
  const [coverage, setCoverage] = useState<WatchlistCoverageItem[]>([]);
  const [seasons, setSeasons] = useState<TmdbSeason[]>([]);
  const [loadingSeasons, setLoadingSeasons] = useState(false);
  // Build a map of "season,episode" → coverage items (all versions, downloaded or FTP-only)
  const coverageByEp = useMemo(() => {
    const map = new Map<string, WatchlistCoverageItem[]>();
    for (const c of coverage) {
      if (c.season != null && c.episode != null) {
        const key = `${c.season},${c.episode}`;
        const arr = map.get(key) ?? [];
        arr.push(c);
        map.set(key, arr);
      }
    }
    return map;
  }, [coverage]);

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

  // Auto-load coverage + TMDB seasons when panel opens
  useEffect(() => {
    // Always fetch coverage (in-library items)
    getCoverage(item.tmdb_id)
      .then(setCoverage)
      .catch(() => {});
    // For TV shows, also fetch full TMDB season/episode data
    if (item.tmdb_type === "tv") {
      setLoadingSeasons(true);
      getSeasons(item.tmdb_id)
        .then(setSeasons)
        .catch(() => {})
        .finally(() => setLoadingSeasons(false));
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

          {/* Movie: list of available versions with download actions */}
          {item.tmdb_type === "movie" && coverage.length > 0 && (
            <div>
              <label
                style={{
                  fontSize: 12,
                  color: "var(--color-text-muted)",
                  fontWeight: 500,
                }}
              >
                {language === "es" ? "Archivos disponibles" : "Available files"}
              </label>
              <div
                style={{
                  border: "1px solid var(--color-border)",
                  borderRadius: "var(--radius)",
                  overflow: "hidden",
                  marginTop: 6,
                }}
              >
                {sortByResolution(coverage).map((c, i) => {
                  return (
                    <div
                      key={c.ftp_path}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        padding: "7px 10px",
                        borderBottom:
                          i < coverage.length - 1
                            ? "1px solid var(--color-border)"
                            : "none",
                        background: c.downloaded
                          ? "color-mix(in srgb, var(--color-success) 6%, transparent)"
                          : "transparent",
                      }}
                    >
                      {/* Status icon */}
                      {c.downloaded ? (
                        <Check
                          size={13}
                          strokeWidth={2.5}
                          style={{
                            color: "var(--color-success)",
                            flexShrink: 0,
                          }}
                        />
                      ) : (
                        <Server
                          size={13}
                          strokeWidth={2}
                          style={{ color: "var(--color-teal)", flexShrink: 0 }}
                        />
                      )}
                      {/* Resolution badge */}
                      {c.resolution && (
                        <span
                          style={{
                            fontSize: 10,
                            fontWeight: 600,
                            background: "var(--color-surface-2)",
                            color: c.downloaded
                              ? "var(--color-success)"
                              : "var(--color-text-muted)",
                            borderRadius: "var(--radius-full)",
                            padding: "2px 6px",
                            flexShrink: 0,
                          }}
                        >
                          {c.resolution}
                        </span>
                      )}
                      {/* Filename */}
                      <span
                        style={{
                          fontSize: 11,
                          color: c.downloaded
                            ? "var(--color-text)"
                            : "var(--color-text-muted)",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                          flex: 1,
                          minWidth: 0,
                        }}
                        title={c.filename}
                      >
                        {c.filename}
                      </span>
                      {/* Navigate button (only for FTP-available, not yet downloaded) */}
                      {!c.downloaded && (
                        <button
                          onClick={() =>
                            onNavigateToItem?.(
                              item.tmdb_id,
                              item.tmdb_type ?? "movie",
                            )
                          }
                          title={
                            language === "es"
                              ? "Ver en biblioteca"
                              : "View in library"
                          }
                          style={{
                            flexShrink: 0,
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            width: 26,
                            height: 26,
                            border:
                              "1px solid color-mix(in srgb, var(--color-primary) 60%, transparent)",
                            borderRadius: "var(--radius-full)",
                            background:
                              "color-mix(in srgb, var(--color-primary) 15%, transparent)",
                            color: "var(--color-primary)",
                            cursor: "pointer",
                            transition: "background 0.15s ease",
                            padding: 0,
                          }}
                        >
                          <ExternalLink size={12} strokeWidth={2.2} />
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
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

          {/* Episode coverage — full TMDB season view */}
          {item.tmdb_type === "tv" && (
            <div>
              {loadingSeasons ? (
                <div
                  style={{
                    padding: "12px 0",
                    color: "var(--color-text-muted)",
                    fontSize: 13,
                  }}
                >
                  {language === "es"
                    ? "Cargando episodios…"
                    : "Loading episodes…"}
                </div>
              ) : seasons.length === 0 ? (
                <div
                  style={{
                    padding: "12px 0",
                    color: "var(--color-text-muted)",
                    fontSize: 13,
                  }}
                >
                  {language === "es"
                    ? "Sin datos de episodios"
                    : "No episode data"}
                </div>
              ) : (
                <div
                  style={{
                    border: "1px solid var(--color-border)",
                    borderRadius: "var(--radius)",
                    overflow: "hidden",
                  }}
                >
                  {seasons.map((season) => (
                    <SeasonSection
                      key={season.season_number}
                      season={season}
                      coverageByEp={coverageByEp}
                      onNavigateToItem={onNavigateToItem}
                      tmdbId={item.tmdb_id}
                      mediaType={item.tmdb_type ?? "tv"}
                      language={language}
                    />
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Movie in-library indicator — bottom fallback removed (shown above) */}
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

// ── SeasonSection helper ─────────────────────────────────────────────────────

interface SeasonSectionProps {
  season: TmdbSeason;
  coverageByEp: Map<string, WatchlistCoverageItem[]>;
  onNavigateToItem?: (tmdbId: number, mediaType: string) => void;
  tmdbId: number;
  mediaType: string;
  language: AppLanguage;
}

function SeasonSection({
  season,
  coverageByEp,
  onNavigateToItem,
  tmdbId,
  mediaType,
  language,
}: SeasonSectionProps) {
  const [open, setOpen] = useState(true);
  const today = new Date().toISOString().slice(0, 10);

  const downloadedCount = season.episodes.filter((ep) => {
    const files =
      coverageByEp.get(`${season.season_number},${ep.episode_number}`) ?? [];
    return files.some((c) => c.downloaded);
  }).length;

  return (
    <div>
      {/* Season header */}
      <button
        onClick={() => setOpen((o) => !o)}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          width: "100%",
          padding: "7px 12px",
          background: "var(--color-surface-2)",
          border: "none",
          borderBottom: open ? "1px solid var(--color-border)" : "none",
          color: "var(--color-text-muted)",
          cursor: "pointer",
          fontSize: 12,
          fontWeight: 600,
          textAlign: "left",
        }}
      >
        <span>
          {language === "es" ? "Temporada" : "Season"} {season.season_number}
          {season.name && season.name !== `Season ${season.season_number}` && (
            <span
              style={{
                fontWeight: 400,
                marginLeft: 6,
                color: "var(--color-text-muted)",
              }}
            >
              — {season.name}
            </span>
          )}
        </span>
        <span
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
          }}
        >
          {downloadedCount > 0 && (
            <span style={{ color: "var(--color-success)", fontSize: 11 }}>
              {downloadedCount}/{season.episodes.length}
            </span>
          )}
          <span style={{ fontSize: 10 }}>{open ? "▲" : "▼"}</span>
        </span>
      </button>

      {/* Episodes */}
      {open && (
        <div>
          {season.episodes.map((ep, i) => {
            const key = `${season.season_number},${ep.episode_number}`;
            const epFiles = coverageByEp.get(key) ?? [];
            const downloadedFiles = sortByResolution(
              epFiles.filter((c) => c.downloaded),
            );
            const ftpFiles = sortByResolution(
              epFiles.filter((c) => !c.downloaded),
            );
            const inLibrary = downloadedFiles.length > 0;
            const hasOnServer = ftpFiles.length > 0 && !inLibrary;
            const isFuture = ep.air_date != null && ep.air_date > today;

            return (
              <div
                key={ep.episode_number}
                style={{
                  padding: "5px 10px",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  borderBottom:
                    i < season.episodes.length - 1
                      ? "1px solid var(--color-border)"
                      : "none",
                  background: inLibrary
                    ? "color-mix(in srgb, var(--color-success) 6%, transparent)"
                    : hasOnServer
                      ? "color-mix(in srgb, var(--color-teal) 4%, transparent)"
                      : "transparent",
                }}
              >
                {/* Left: status icon + episode label */}
                <span
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    minWidth: 0,
                    flex: 1,
                  }}
                >
                  {inLibrary ? (
                    <Check
                      size={13}
                      strokeWidth={2.5}
                      style={{ color: "var(--color-success)", flexShrink: 0 }}
                      aria-hidden="true"
                    />
                  ) : hasOnServer ? (
                    <Server
                      size={13}
                      strokeWidth={2}
                      style={{ color: "var(--color-teal)", flexShrink: 0 }}
                      aria-hidden="true"
                    />
                  ) : isFuture ? (
                    <CalendarClock
                      size={13}
                      strokeWidth={2}
                      style={{ color: "var(--color-warning)", flexShrink: 0 }}
                      aria-hidden="true"
                    />
                  ) : (
                    <span
                      style={{
                        width: 13,
                        height: 13,
                        borderRadius: "50%",
                        border: "1.5px solid var(--color-border)",
                        flexShrink: 0,
                        display: "inline-block",
                      }}
                    />
                  )}
                  <span
                    style={{
                      fontSize: 12,
                      color: inLibrary
                        ? "var(--color-text)"
                        : hasOnServer
                          ? "var(--color-text)"
                          : isFuture
                            ? "var(--color-warning)"
                            : "var(--color-text-muted)",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    <span style={{ fontWeight: 600, marginRight: 4 }}>
                      E{String(ep.episode_number).padStart(2, "0")}
                    </span>
                    {ep.name}
                  </span>
                </span>

                {/* Right: per-version resolution pills (downloaded = green, FTP = clickable download) */}
                <span
                  style={{
                    flexShrink: 0,
                    marginLeft: 8,
                    display: "flex",
                    alignItems: "center",
                    flexWrap: "wrap",
                    gap: 3,
                    justifyContent: "flex-end",
                    maxWidth: 160,
                  }}
                >
                  {!inLibrary && !hasOnServer && ep.air_date && (
                    <span
                      style={{
                        fontSize: 10,
                        color: isFuture
                          ? "var(--color-warning)"
                          : "var(--color-text-muted)",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {new Date(ep.air_date + "T12:00:00").toLocaleDateString(
                        language === "es" ? "es-ES" : "en-US",
                        { day: "numeric", month: "short", year: "numeric" },
                      )}
                    </span>
                  )}
                  {/* Downloaded version badges (non-interactive) */}
                  {downloadedFiles.map((c) => (
                    <span
                      key={c.ftp_path}
                      title={c.filename}
                      style={{
                        fontSize: 10,
                        fontWeight: 600,
                        background:
                          "color-mix(in srgb, var(--color-success) 18%, transparent)",
                        color: "var(--color-success)",
                        borderRadius: "var(--radius-full)",
                        padding: "2px 7px",
                        whiteSpace: "nowrap",
                        border:
                          "1px solid color-mix(in srgb, var(--color-success) 35%, transparent)",
                      }}
                    >
                      ✓ {c.resolution ?? "SD"}
                    </span>
                  ))}
                  {/* FTP-available version pills — each navigates to library detail */}
                  {ftpFiles.map((c) => (
                    <button
                      key={c.ftp_path}
                      onClick={() => onNavigateToItem?.(tmdbId, mediaType)}
                      title={
                        language === "es"
                          ? "Ver en biblioteca"
                          : "View in library"
                      }
                      style={{
                        fontSize: 10,
                        fontWeight: 600,
                        background:
                          "color-mix(in srgb, var(--color-primary) 15%, transparent)",
                        color: "var(--color-primary)",
                        border:
                          "1px solid color-mix(in srgb, var(--color-primary) 55%, transparent)",
                        borderRadius: "var(--radius-full)",
                        padding: "2px 7px",
                        cursor: "pointer",
                        whiteSpace: "nowrap",
                        transition: "background 0.15s ease",
                        display: "flex",
                        alignItems: "center",
                        gap: 3,
                      }}
                    >
                      <ExternalLink size={9} strokeWidth={2.5} />
                      {c.resolution ?? "SD"}
                    </button>
                  ))}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
