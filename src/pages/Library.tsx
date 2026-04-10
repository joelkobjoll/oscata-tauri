import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  Activity,
  Bookmark,
  CheckSquare,
  ChevronRight,
  Clapperboard,
  Download,
  FileText,
  Filter,
  LayoutGrid,
  Menu,
  MoreHorizontal,
  Pencil,
  Settings as SettingsIcon,
  Tv2,
  Upload,
  type LucideIcon,
} from "lucide-react";
import { call, isTauri } from "../lib/transport";
import { prefetchConfig } from "../lib/configCache";
import { invoke } from "@tauri-apps/api/core";
import { useIsMobile } from "../hooks/useIsMobile";
import { useIndexing, MediaItem } from "../hooks/useIndexing";
import { useDownload } from "../hooks/useDownload";
import { useDownloads } from "../hooks/useDownloads";
import FilterBar, { type Filters } from "../components/FilterBar";
import {
  normalizeHdr,
  normalizeReleaseType,
  normalizeResolution,
  normalizeCodec,
} from "../utils/filterUtils";
import IndexStatus from "../components/IndexStatus";
import Settings from "./Settings";
import ActivityLog from "../components/ActivityLog";
import DetailPanel from "../components/DetailPanel";
import FixMatchModal from "../components/FixMatchModal";
import DownloadsTab from "../components/DownloadsTab";
import WatchlistTab from "../features/watchlist/WatchlistTab";
import { useWatchlist } from "../features/watchlist/useWatchlist";
import UploadsTab from "../features/uploads/UploadsTab";
import { useUploads } from "../features/uploads/useUploads";
import DownloadFeedbackToast from "../components/DownloadFeedbackToast";
import IndexErrorToast from "../components/IndexErrorToast";
import TVShowPanel from "../components/TVShowPanel";
import { useQuitHandler } from "../hooks/useQuitHandler";
import VirtualMediaGrid from "../components/VirtualMediaGrid";
import ThemeToggle from "../components/ThemeToggle";
import { AppLanguage, getLocalizedTitle } from "../utils/mediaLanguage";
import { t } from "../utils/i18n";
import { formatBytes } from "../lib/format";

type TabId =
  | "all"
  | "movie"
  | "tv"
  | "documentary"
  | "downloads"
  | "watchlist"
  | "uploads";

const TABS: { id: TabId; labelKey: string; icon: LucideIcon }[] = [
  { id: "all", labelKey: "nav.all", icon: LayoutGrid },
  { id: "movie", labelKey: "nav.movies", icon: Clapperboard },
  { id: "tv", labelKey: "nav.tv", icon: Tv2 },
  { id: "documentary", labelKey: "nav.docs", icon: FileText },
  { id: "watchlist", labelKey: "nav.watchlist", icon: Bookmark },
  { id: "downloads", labelKey: "nav.downloads", icon: Download },
  ...(isTauri()
    ? [{ id: "uploads" as const, labelKey: "nav.uploads", icon: Upload }]
    : []),
];

// ─── URL slug ↔ tab mapping (web mode only) ──────────────────────────────────
const TAB_SLUGS: Record<TabId, string> = {
  all: "/",
  movie: "/peliculas",
  tv: "/series",
  documentary: "/documentales",
  downloads: "/descargas",
  watchlist: "/watchlist",
  uploads: "/subidas",
};
const SLUG_TO_TAB: Record<string, TabId> = Object.fromEntries(
  Object.entries(TAB_SLUGS).map(([k, v]) => [v, k as TabId]),
) as Record<string, TabId>;
function tabFromPathname(): TabId {
  if (isTauri()) return "all";
  const path = window.location.pathname || "/";
  return SLUG_TO_TAB[path] ?? "all";
}

const defaultFilters = (): Filters => ({
  search: "",
  releaseType: "",
  resolution: "",
  hdr: "",
  codec: "",
  genre: "",
  sort: "added-desc",
});
const ITEMS_PER_PAGE = 48;

// ─── URL ↔ filter/page helpers (web mode only) ────────────────────────────────
function filtersFromSearchParams(): { filters: Filters; page: number } {
  const p = new URLSearchParams(window.location.search);
  const filters: Filters = {
    search: p.get("q") ?? "",
    releaseType: p.get("type") ?? "",
    resolution: p.get("res") ?? "",
    hdr: p.get("hdr") ?? "",
    codec: p.get("codec") ?? "",
    genre: p.get("genre") ?? "",
    sort: p.get("sort") ?? "added-desc",
  };
  const pageRaw = parseInt(p.get("page") ?? "1", 10);
  const page = isNaN(pageRaw) || pageRaw < 1 ? 1 : pageRaw;
  return { filters, page };
}
function filtersToSearchParams(filters: Filters, page: number): string {
  const p = new URLSearchParams();
  if (filters.search) p.set("q", filters.search);
  if (filters.releaseType) p.set("type", filters.releaseType);
  if (filters.resolution) p.set("res", filters.resolution);
  if (filters.hdr) p.set("hdr", filters.hdr);
  if (filters.codec) p.set("codec", filters.codec);
  if (filters.genre) p.set("genre", filters.genre);
  if (filters.sort && filters.sort !== "added-desc")
    p.set("sort", filters.sort);
  if (page > 1) p.set("page", String(page));
  const qs = p.toString();
  return qs ? "?" + qs : "";
}

function tabFilter(item: MediaItem, tab: TabId): boolean {
  if (tab === "all") return true;
  return item.media_type === tab;
}

function EpisodeListView({
  items,
  onSelect,
  resetKey,
  language,
}: {
  items: MediaItem[];
  onSelect: (item: MediaItem) => void;
  resetKey: string;
  language: AppLanguage;
}) {
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0, behavior: "smooth" });
  }, [resetKey]);

  return (
    <div
      ref={scrollRef}
      style={{
        height: "100%",
        overflowY: "auto",
        padding: "1.5rem 1.5rem 6.5rem",
      }}
    >
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 10,
        }}
      >
        {items.map((item) => {
          const title = getLocalizedTitle(item, language);
          const episodeLabel =
            item.season != null || item.episode != null
              ? `S${String(item.season ?? 0).padStart(2, "0")}E${String(item.episode ?? 0).padStart(2, "0")}${item.episode_end != null && item.episode_end !== item.episode ? `-E${String(item.episode_end).padStart(2, "0")}` : ""}`
              : t(language, "tv.episode");

          return (
            <button
              key={item.id}
              onClick={() => onSelect(item)}
              style={{
                display: "grid",
                gridTemplateColumns: "110px minmax(0, 1fr) auto",
                alignItems: "center",
                gap: 14,
                width: "100%",
                padding: "14px 16px",
                borderRadius: "var(--radius-lg)",
                border:
                  "1px solid color-mix(in srgb, var(--color-border) 78%, transparent)",
                background:
                  "color-mix(in srgb, var(--color-surface) 92%, transparent)",
                color: "var(--color-text)",
                textAlign: "left",
                cursor: "pointer",
                boxShadow:
                  "0 10px 24px color-mix(in srgb, black 16%, transparent)",
              }}
            >
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <span
                  style={{
                    fontSize: 12,
                    fontWeight: 700,
                    letterSpacing: "0.05em",
                    color: "var(--color-primary)",
                  }}
                >
                  {episodeLabel}
                </span>
                <span
                  style={{ fontSize: 12, color: "var(--color-text-muted)" }}
                >
                  {item.year ?? "—"}
                </span>
              </div>

              <div style={{ minWidth: 0 }}>
                <div
                  style={{
                    fontSize: 14,
                    fontWeight: 700,
                    color: "var(--color-text)",
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  {title}
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
                  {item.filename}
                </div>
              </div>

              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  color: "var(--color-text-muted)",
                  fontSize: 12,
                }}
              >
                {item.release_type && <span>{item.release_type}</span>}
                {item.resolution && <span>{item.resolution}</span>}
                {item.size_bytes != null && item.size_bytes > 0 && (
                  <span style={{ fontWeight: 600 }}>
                    {formatBytes(item.size_bytes)}
                  </span>
                )}
                <ChevronRight
                  size={16}
                  strokeWidth={2.2}
                  aria-hidden="true"
                  style={{ display: "block", flexShrink: 0 }}
                />
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ─── Module-level pure helpers (stable references — safe in useMemo dep arrays) ─
function getAddedTimestamp(item: MediaItem): number {
  const indexed = item.indexed_at ? Date.parse(item.indexed_at) : NaN;
  if (!Number.isNaN(indexed)) {
    // Guard against bad future timestamps in imported or external metadata.
    return Math.min(indexed, Date.now());
  }
  return item.id;
}

function deduplicateByTitle(entries: MediaItem[]): MediaItem[] {
  const seen = new Map<string, MediaItem>();
  for (const entry of entries) {
    const key =
      entry.tmdb_id != null
        ? `tmdb:${entry.tmdb_id}`
        : `title:${entry.title ?? entry.filename}`;
    const current = seen.get(key);
    if (!current) {
      seen.set(key, entry);
      continue;
    }
    // Prefer an entry that has a trailer URL
    if (entry.youtube_trailer_url && !current.youtube_trailer_url) {
      seen.set(key, entry);
      continue;
    }
    if (current.youtube_trailer_url && !entry.youtube_trailer_url) {
      continue;
    }
    const entryAddedAt = getAddedTimestamp(entry);
    const currentAddedAt = getAddedTimestamp(current);
    if (entryAddedAt > currentAddedAt) {
      seen.set(key, entry);
      continue;
    }
    if (
      entryAddedAt === currentAddedAt &&
      entry.tmdb_poster &&
      !current.tmdb_poster
    ) {
      seen.set(key, entry);
    }
  }
  return [...seen.values()];
}

function getEpisodesForShow(
  show: MediaItem,
  entries: MediaItem[],
): MediaItem[] {
  return entries.filter((ep) =>
    ep.tmdb_type === "tv" ||
    ep.media_type === "tv" ||
    ep.media_type === "documentary"
      ? show.tmdb_id
        ? ep.tmdb_id === show.tmdb_id
        : (ep.title ?? ep.filename) === (show.title ?? show.filename)
      : false,
  );
}

function getTrailerUrlFromItems(entries: MediaItem[]): string | null {
  return (
    entries.find((entry) => entry.youtube_trailer_url)?.youtube_trailer_url ??
    entries.find((entry) => entry.imdb_trailer_url)?.imdb_trailer_url ??
    null
  );
}

export default function Library({
  startIndexingOnMount = false,
  headerSlot,
}: {
  startIndexingOnMount?: boolean;
  headerSlot?: React.ReactNode;
}) {
  const showDevLog = import.meta.env.DEV;
  const {
    items,
    isIndexing,
    progress,
    tmdbProgress,
    metaRefreshProgress,
    completionSummary,
    dismissCompletion,
    forceClearIndexing,
    patchItem,
    indexError,
    clearIndexError,
    retryIndexing,
    log,
    appendLog,
    clearLog,
  } = useIndexing();
  const { quitDialogVisible, activeCount, confirmQuit, cancelQuit } =
    useQuitHandler();
  const { startDownload, isDownloadPending } = useDownload();
  const {
    downloads,
    cancelDownload,
    clearCompleted,
    retryDownload,
    openDownloadFolder,
    deleteDownload,
  } = useDownloads();
  const watchlist = useWatchlist();
  const {
    uploads,
    cancelUpload,
    retryUpload,
    deleteUpload,
    clearCompleted: clearCompletedUploads,
  } = useUploads();
  const [ftpWriteOk, setFtpWriteOk] = useState<boolean>(false);
  const downloadMap = useMemo(
    () => new Map(downloads.map((d) => [d.ftp_path, d])),
    [downloads],
  );
  const [activeTab, setActiveTab] = useState<TabId>(() => tabFromPathname());
  const [filterDrawerOpen, setFilterDrawerOpen] = useState(false);
  const isMobile = useIsMobile();
  const [filters, setFilters] = useState<Filters>(() =>
    isTauri() ? defaultFilters() : filtersFromSearchParams().filters,
  );
  const [showSettings, setShowSettings] = useState(false);
  const [showLog, setShowLog] = useState(false);
  const [selected, setSelected] = useState<MediaItem | null>(null);
  const [selectedGroupedView, setSelectedGroupedView] = useState(false);
  const [selecting, setSelecting] = useState(false);
  const [checkedIds, setCheckedIds] = useState<Set<number>>(new Set());
  const [showBulkFix, setShowBulkFix] = useState(false);
  const [rematching, setRematching] = useState(false);
  const [clearingAll, setClearingAll] = useState(false);
  const [refreshingLibrary, setRefreshingLibrary] = useState(false);
  const [refreshingMetadata, setRefreshingMetadata] = useState(false);
  const [forceRefreshingMetadata, setForceRefreshingMetadata] = useState(false);
  const [tvShow, setTvShow] = useState<MediaItem | null>(null);
  const [tvShowTrailerUrlOverride, setTvShowTrailerUrlOverride] = useState<
    string | null
  >(null);
  const [fixMatchRequest, setFixMatchRequest] = useState<{
    itemIds: number[];
    initialQuery: string;
    initialMediaType: "movie" | "tv" | "documentary";
  } | null>(null);
  const [page, setPage] = useState(() =>
    isTauri() ? 1 : filtersFromSearchParams().page,
  );
  const [movieView, setMovieView] = useState<"grouped" | "files">("grouped");
  const [tvView, setTvView] = useState<"shows" | "episodes">("shows");
  const [showActionsMenu, setShowActionsMenu] = useState(false);
  const [showMobileNavMenu, setShowMobileNavMenu] = useState(false);
  const mobileNavMenuRef = useRef<HTMLDivElement>(null);
  const [language, setLanguage] = useState<AppLanguage>("es");
  const [preferredRating, setPreferredRating] = useState<string>("tmdb");
  const [badgeMap, setBadgeMap] = useState<
    Record<
      number,
      {
        downloaded?: boolean;
        inEmby?: boolean;
        plexInLibrary?: boolean;
        embyInLibrary?: boolean;
        cache?: string;
        debug?: string;
      }
    >
  >({});
  const [badgeRefreshTick, setBadgeRefreshTick] = useState(0);
  const actionsMenuRef = useRef<HTMLDivElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const paginationInitRef = useRef(false);
  const hasStartedInitialIndexRef = useRef(false);
  const badgeRequestIdRef = useRef(0);

  // Pre-fetch config so Settings opens instantly when the user clicks the button.
  useEffect(() => {
    prefetchConfig();
  }, []);

  useEffect(() => {
    if (!isTauri()) return;
    invoke<boolean>("check_ftp_write_permission")
      .then((ok) => setFtpWriteOk(ok))
      .catch(() => setFtpWriteOk(false));
  }, []);

  useEffect(() => {
    if (activeTab === "uploads" && !ftpWriteOk) {
      switchTab("all");
    }
  }, [ftpWriteOk, activeTab]);

  // Sync activeTab with browser back/forward in web mode.
  useEffect(() => {
    if (isTauri()) return;
    const handlePop = () => {
      const tab = tabFromPathname();
      setActiveTab(tab);
      setSelected(null);
      setSelectedGroupedView(false);
      setTvShow(null);
      setSelecting(false);
      setCheckedIds(new Set());
      const { filters: urlFilters, page: urlPage } = filtersFromSearchParams();
      setFilters(urlFilters);
      setPage(urlPage);
      setMovieView("grouped");
      setTvView("shows");
      setFilterDrawerOpen(false);
    };
    window.addEventListener("popstate", handlePop);
    return () => window.removeEventListener("popstate", handlePop);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Sync filters + page into URL query string (web mode only, replaceState so
  // the tab pushState history is not polluted with every filter keystroke).
  useEffect(() => {
    if (isTauri()) return;
    const qs = filtersToSearchParams(filters, page);
    window.history.replaceState({}, "", window.location.pathname + qs);
  }, [filters, page]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!startIndexingOnMount || hasStartedInitialIndexRef.current) {
      return;
    }

    hasStartedInitialIndexRef.current = true;
    const timer = window.setTimeout(() => {
      call("start_indexing").catch(console.error);
    }, 0);

    return () => window.clearTimeout(timer);
  }, [startIndexingOnMount]);

  const getTvEpisodes = (show: MediaItem): MediaItem[] => {
    return getEpisodesForShow(show, items);
  };

  useEffect(() => {
    if (!tvShow) {
      setTvShowTrailerUrlOverride(null);
      return;
    }

    const liveShow = items.find((item) => item.id === tvShow.id) ?? tvShow;
    const liveEpisodes = getEpisodesForShow(liveShow, items);
    const inMemoryTrailerUrl = getTrailerUrlFromItems([
      liveShow,
      ...liveEpisodes,
    ]);

    if (inMemoryTrailerUrl) {
      setTvShowTrailerUrlOverride(null);
      return;
    }

    let cancelled = false;

    call<MediaItem[]>("get_all_media")
      .then((loaded) => {
        if (cancelled) return;
        const refreshedShow =
          loaded.find((item) => item.id === tvShow.id) ?? liveShow;
        const refreshedEpisodes = getEpisodesForShow(refreshedShow, loaded);
        setTvShowTrailerUrlOverride(
          getTrailerUrlFromItems([refreshedShow, ...refreshedEpisodes]),
        );
      })
      .catch((error) => {
        if (!cancelled) {
          setTvShowTrailerUrlOverride(null);
        }
        console.error("Failed to refresh trailer URL for TV sidebar:", error);
      });

    return () => {
      cancelled = true;
    };
  }, [tvShow, items]);

  const runRematchAll = async () => {
    setRematching(true);
    if (showDevLog) setShowLog(true);
    setShowActionsMenu(false);
    try {
      await call("rematch_all");
    } catch (error) {
      console.error("Failed to re-match metadata:", error);
    } finally {
      setRematching(false);
    }
  };

  const runRematchAllPlex = async () => {
    setRematching(true);
    if (showDevLog) setShowLog(true);
    setShowActionsMenu(false);
    try {
      // Uses the backend rematch flow, which now tries Plex->IMDb->TMDB fallback.
      await call("rematch_all");
    } catch (error) {
      console.error("Failed to run Plex-assisted rematch:", error);
    } finally {
      setRematching(false);
    }
  };

  const refreshLibrary = async () => {
    setRefreshingLibrary(true);
    setShowActionsMenu(false);
    try {
      await call("start_indexing");
    } catch (error) {
      console.error("Failed to refresh library:", error);
    } finally {
      setRefreshingLibrary(false);
    }
  };

  const clearAllMetadata = async () => {
    if (
      !confirm(
        "Clear ALL TMDB metadata for every item in your library? Metadata will be re-fetched on next rematch.",
      )
    )
      return;
    setClearingAll(true);
    if (showDevLog) setShowLog(true);
    setShowActionsMenu(false);
    try {
      await call("clear_all_metadata");
      await call("rematch_all");
    } catch (error) {
      console.error("Failed to clear/rematch metadata:", error);
    } finally {
      setClearingAll(false);
    }
  };

  const refreshAllMetadata = async () => {
    setRefreshingMetadata(true);
    if (showDevLog) setShowLog(true);
    setShowActionsMenu(false);
    try {
      await call("refresh_all_metadata");
    } catch (error) {
      console.error("Failed to refresh missing metadata:", error);
    } finally {
      setRefreshingMetadata(false);
    }
  };

  const forceRefreshAllMetadata = async () => {
    setForceRefreshingMetadata(true);
    if (showDevLog) setShowLog(true);
    setShowActionsMenu(false);
    try {
      await call("force_refresh_all_metadata");
    } catch (error) {
      console.error("Failed to force-refresh metadata:", error);
    } finally {
      setForceRefreshingMetadata(false);
    }
  };

  const switchTab = (tab: TabId) => {
    setActiveTab(tab);
    if (!isTauri()) {
      window.history.pushState({}, "", TAB_SLUGS[tab]);
    }
    setSelected(null);
    setSelectedGroupedView(false);
    setTvShow(null);
    setSelecting(false);
    setCheckedIds(new Set());
    setFilters(defaultFilters());
    setPage(1);
    setMovieView("grouped");
    setTvView("shows");
    setFilterDrawerOpen(false);
  };

  const handleCardSelect = (item: MediaItem) => {
    const isTV =
      item.tmdb_type === "tv" ||
      item.media_type === "tv" ||
      item.media_type === "documentary";
    if (isTV) {
      setTvShow(item);
    } else {
      setSelectedGroupedView(activeTab === "movie" && movieView === "grouped");
      setSelected(item);
    }
  };

  const handleNavigateFromWatchlist = (tmdbId: number, mediaType: string) => {
    const targetTab = mediaType === "movie" ? "movie" : "tv";
    setActiveTab(targetTab);
    const found = items.find((i) => i.tmdb_id === tmdbId);
    if (found) handleCardSelect(found);
  };

  const handleDownloadSeason = async (episodes: MediaItem[]) => {
    for (const ep of episodes) {
      const existingDownload = downloadMap.get(ep.ftp_path);
      const isActive =
        isDownloadPending(ep.ftp_path) ||
        existingDownload?.status === "queued" ||
        existingDownload?.status === "downloading";
      const isAlreadyDownloaded =
        existingDownload?.status === "done" ||
        badgeMap[ep.id]?.downloaded === true;

      if (isActive || isAlreadyDownloaded) {
        continue;
      }

      await startDownload(ep);
    }
  };

  const toggleCheck = (id: number) =>
    setCheckedIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const exitSelect = () => {
    setSelecting(false);
    setCheckedIds(new Set());
  };

  const recheckBadgeForItem = async (item: MediaItem) => {
    const startedAt = Date.now();
    try {
      const results = await call<
        Array<{
          id: number;
          downloaded: boolean;
          in_emby: boolean;
          plex_in_library?: boolean;
          emby_in_library?: boolean;
          cache?: string;
          debug?: string;
        }>
      >("check_media_badges", {
        items: [
          {
            id: item.id,
            ftpPath: item.ftp_path,
            filename: item.filename,
            title: item.tmdb_title ?? item.title ?? null,
            titleEn: item.tmdb_title_en ?? null,
            year: item.year ?? null,
            imdbId: item.imdb_id ?? null,
            tmdbId: item.tmdb_id ?? null,
            mediaType: item.media_type ?? item.tmdb_type ?? null,
          },
        ],
      });

      const [result] = results;
      if (!result) return;

      setBadgeMap((prev) => ({
        ...prev,
        [result.id]: {
          downloaded: result.downloaded,
          inEmby: result.in_emby,
          plexInLibrary: result.plex_in_library,
          embyInLibrary: result.emby_in_library,
          cache: result.cache,
          debug: result.debug,
        },
      }));

      appendLog(
        `🧪 Dev badge recheck: ${item.id} | in_library ${result.in_emby ? "true" : "false"} | plex ${result.plex_in_library ? "true" : "false"} | emby ${result.emby_in_library ? "true" : "false"} | cache ${result.cache ?? "-"} | ${Date.now() - startedAt}ms`,
      );
    } catch (error: unknown) {
      const message =
        error instanceof Error
          ? error.message
          : String(error ?? "unknown error");
      appendLog(`⚠ Dev badge recheck failed for ${item.id}: ${message}`);
    }
  };

  const isSeriesTab = activeTab === "tv" || activeTab === "documentary";
  const useGroupedMovies = activeTab === "movie" && movieView === "grouped";
  const useEpisodeList = activeTab === "tv" && tvView === "episodes";

  // Pre-parse tmdb_genres once per items change so filter() never calls JSON.parse.
  const parsedGenreMap = useMemo(() => {
    const map = new Map<number, number[]>();
    for (const item of items) {
      const gs = item.tmdb_genres;
      map.set(
        item.id,
        gs ? (typeof gs === "string" ? (JSON.parse(gs) as number[]) : gs) : [],
      );
    }
    return map;
  }, [items]);

  const getMovieVersions = (movie: MediaItem): MediaItem[] =>
    items.filter(
      (entry) =>
        entry.media_type === "movie" &&
        (movie.tmdb_id
          ? entry.tmdb_id === movie.tmdb_id
          : (entry.title ?? entry.filename) ===
            (movie.title ?? movie.filename)),
    );

  const visibleTabs = TABS.filter((tab) => tab.id !== "uploads" || ftpWriteOk);
  const mobileBottomTabs = visibleTabs.filter((tab) =>
    (["all", "movie", "tv", "downloads"] as TabId[]).includes(tab.id),
  );

  const tabCounts = useMemo(
    () =>
      visibleTabs.reduce(
        (acc, t) => {
          switch (t.id) {
            case "all":
              acc[t.id] = items.length;
              break;
            case "downloads":
              acc[t.id] = downloads.filter(
                (d) => d.status === "queued" || d.status === "downloading",
              ).length;
              break;
            case "uploads":
              acc[t.id] = uploads.filter(
                (u) => u.status === "queued" || u.status === "uploading",
              ).length;
              break;
            case "movie":
            case "tv":
            case "documentary":
              acc[t.id] = deduplicateByTitle(
                items.filter((i) => tabFilter(i, t.id)),
              ).length;
              break;
          }
          return acc;
        },
        {} as Record<TabId, number>,
      ),
    [downloads, items],
  );

  const tabItems = useMemo(
    () => items.filter((item) => tabFilter(item, activeTab)),
    [activeTab, items],
  );

  const tabItemsForDisplay = useMemo(() => {
    if (isSeriesTab && !useEpisodeList) return deduplicateByTitle(tabItems);
    if (useGroupedMovies) return deduplicateByTitle(tabItems);
    return tabItems;
  }, [isSeriesTab, tabItems, useEpisodeList, useGroupedMovies]);

  const filterableItems = useMemo(
    () => (useGroupedMovies ? tabItems : tabItemsForDisplay),
    [tabItems, tabItemsForDisplay, useGroupedMovies],
  );

  const filtered = useMemo(() => {
    const matchingItems = filterableItems.filter((item) => {
      const q = filters.search.toLowerCase();
      const matchesSearch =
        !q ||
        (item.tmdb_title ?? "").toLowerCase().includes(q) ||
        (item.tmdb_title_en ?? "").toLowerCase().includes(q) ||
        (item.title ?? "").toLowerCase().includes(q) ||
        (item.release_group ?? "").toLowerCase().includes(q) ||
        item.filename.toLowerCase().includes(q);
      const matchesGenre =
        !filters.genre ||
        (parsedGenreMap.get(item.id) ?? []).includes(Number(filters.genre));
      return (
        matchesSearch &&
        (!filters.releaseType ||
          normalizeReleaseType(item.release_type) === filters.releaseType) &&
        (!filters.resolution ||
          normalizeResolution(item.resolution) === filters.resolution) &&
        (!filters.hdr || normalizeHdr(item.hdr) === filters.hdr) &&
        (!filters.codec || normalizeCodec(item.codec) === filters.codec) &&
        matchesGenre
      );
    });

    // Schwartzian transform: compute sort keys once per item instead of O(N log N) times.
    const sort = filters.sort;
    const needsTitleKey =
      sort === "title-desc" ||
      sort === "added-desc" ||
      sort === "title-asc" ||
      !sort;
    const keyed = matchingItems.map((item) => ({
      item,
      titleKey: needsTitleKey
        ? getLocalizedTitle(item, language).toLowerCase()
        : "",
    }));
    keyed.sort((a, b) => {
      switch (sort) {
        case "title-desc":
          return b.titleKey.localeCompare(a.titleKey);
        case "release-desc": {
          const ra =
            a.item.tmdb_release_date ?? `${a.item.year ?? "0000"}-01-01`;
          const rb =
            b.item.tmdb_release_date ?? `${b.item.year ?? "0000"}-01-01`;
          return rb.localeCompare(ra);
        }
        case "release-asc": {
          const ra =
            a.item.tmdb_release_date ?? `${a.item.year ?? "0000"}-01-01`;
          const rb =
            b.item.tmdb_release_date ?? `${b.item.year ?? "0000"}-01-01`;
          return ra.localeCompare(rb);
        }
        case "year-desc":
          return (b.item.year ?? 0) - (a.item.year ?? 0);
        case "year-asc":
          return (a.item.year ?? 0) - (b.item.year ?? 0);
        case "rating-desc":
          return (b.item.tmdb_rating ?? 0) - (a.item.tmdb_rating ?? 0);
        case "added-desc": {
          const ta = getAddedTimestamp(a.item);
          const tb = getAddedTimestamp(b.item);
          return tb - ta || a.titleKey.localeCompare(b.titleKey);
        }
        default:
          return a.titleKey.localeCompare(b.titleKey);
      }
    });
    const sortedItems = keyed.map(({ item }) => item);

    return useGroupedMovies ? deduplicateByTitle(sortedItems) : sortedItems;
  }, [filterableItems, filters, language, parsedGenreMap, useGroupedMovies]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / ITEMS_PER_PAGE));
  const currentPage = Math.min(page, pageCount);
  const viewResetKey = `${activeTab}:${filters.search}:${filters.releaseType}:${filters.resolution}:${filters.hdr}:${filters.codec}:${filters.genre}:${filters.sort}:${tvView}:${movieView}`;
  const pageResetKey = `${viewResetKey}:${currentPage}`;
  const paginatedItems = useMemo(() => {
    const start = (currentPage - 1) * ITEMS_PER_PAGE;
    return filtered.slice(start, start + ITEMS_PER_PAGE);
  }, [currentPage, filtered]);
  const badgePayload = useMemo(
    () =>
      paginatedItems.map((item) => ({
        id: item.id,
        ftpPath: item.ftp_path,
        filename: item.filename,
        title: item.tmdb_title ?? item.title ?? null,
        titleEn: item.tmdb_title_en ?? null,
        year: item.year ?? null,
        imdbId: item.imdb_id ?? null,
        tmdbId: item.tmdb_id ?? null,
        mediaType: item.media_type ?? item.tmdb_type ?? null,
      })),
    [paginatedItems],
  );
  const badgePageIdsKey = useMemo(
    () => paginatedItems.map((item) => item.id).join(","),
    [paginatedItems],
  );

  const ghostBtn: React.CSSProperties = {
    padding: "7px 14px",
    borderRadius: "var(--radius-full)",
    border:
      "1px solid color-mix(in srgb, var(--color-border) 80%, transparent)",
    background: "color-mix(in srgb, var(--color-surface) 84%, transparent)",
    color: "var(--color-text-muted)",
    cursor: "pointer",
    fontSize: 13,
    fontWeight: 500,
    display: "flex",
    alignItems: "center",
    gap: 6,
    transition: "color 0.18s ease, background 0.18s ease",
  };

  const primaryBtn: React.CSSProperties = {
    padding: "7px 14px",
    borderRadius: "var(--radius-full)",
    border: "none",
    background: "var(--color-primary)",
    color: "#fff",
    cursor: "pointer",
    fontSize: 13,
    fontWeight: 600,
    display: "flex",
    alignItems: "center",
    gap: 6,
  };

  const iconButton: React.CSSProperties = {
    width: 40,
    height: 40,
    borderRadius: 999,
    border:
      "1px solid color-mix(in srgb, var(--color-border) 84%, transparent)",
    background: "color-mix(in srgb, var(--color-surface) 94%, transparent)",
    color: "var(--color-text-muted)",
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    boxShadow: "inset 0 1px 0 color-mix(in srgb, white 4%, transparent)",
  };

  const sectionTitle: Record<TabId, string> = {
    all: t(language, "nav.all"),
    movie: t(language, "nav.movies"),
    tv: t(language, "nav.tv"),
    documentary: t(language, "nav.docs"),
    downloads: t(language, "nav.downloads"),
    watchlist: t(language, "nav.watchlist"),
    uploads: t(language, "nav.uploads" as never),
  };

  useEffect(() => {
    if (page > pageCount) {
      setPage(pageCount);
    }
  }, [page, pageCount]);

  useEffect(() => {
    if (!paginationInitRef.current) {
      paginationInitRef.current = true;
      return;
    }
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, [currentPage]);

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, [viewResetKey]);

  useEffect(() => {
    const onPointerDown = (event: MouseEvent) => {
      if (!actionsMenuRef.current?.contains(event.target as Node)) {
        setShowActionsMenu(false);
      }
      if (!mobileNavMenuRef.current?.contains(event.target as Node)) {
        setShowMobileNavMenu(false);
      }
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, []);

  useEffect(() => {
    setPage(1);
  }, [
    filters.search,
    filters.releaseType,
    filters.resolution,
    filters.hdr,
    filters.sort,
  ]);

  useEffect(() => {
    let cancelled = false;
    call<{ default_language?: AppLanguage; preferred_rating?: string }>(
      "get_config",
    )
      .then((config) => {
        if (
          !cancelled &&
          (config.default_language === "es" || config.default_language === "en")
        ) {
          setLanguage(config.default_language);
        }
        if (!cancelled && config.preferred_rating) {
          setPreferredRating(config.preferred_rating);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const isEditableTarget = (target: EventTarget | null) => {
      if (!(target instanceof HTMLElement)) return false;
      const tagName = target.tagName;
      return (
        tagName === "INPUT" ||
        tagName === "TEXTAREA" ||
        tagName === "SELECT" ||
        target.isContentEditable
      );
    };

    const onKeyDown = (event: KeyboardEvent) => {
      const editableTarget = isEditableTarget(event.target);
      const hasOverlayOpen = !!(
        showSettings ||
        showLog ||
        selected ||
        tvShow ||
        fixMatchRequest
      );

      if (hasOverlayOpen && event.key !== "Escape") return;

      if (
        (event.metaKey || event.ctrlKey) &&
        !event.shiftKey &&
        !event.altKey
      ) {
        const tab = (
          {
            "1": "all",
            "2": "movie",
            "3": "tv",
            "4": "documentary",
            "5": "downloads",
          } as const
        )[event.key as "1" | "2" | "3" | "4" | "5"];
        if (tab) {
          event.preventDefault();
          switchTab(tab);
          return;
        }
      }

      if (event.key === "Escape") {
        if (fixMatchRequest) {
          event.preventDefault();
          setFixMatchRequest(null);
          return;
        }
        if (showSettings) {
          event.preventDefault();
          setShowSettings(false);
          return;
        }
        if (showLog) {
          event.preventDefault();
          setShowLog(false);
          return;
        }
        if (selected) {
          event.preventDefault();
          setSelected(null);
          return;
        }
        if (tvShow) {
          event.preventDefault();
          setTvShow(null);
          return;
        }
        if (showActionsMenu) {
          event.preventDefault();
          setShowActionsMenu(false);
          return;
        }
        if (selecting) {
          event.preventDefault();
          exitSelect();
          return;
        }
        if (editableTarget) {
          (event.target as HTMLElement).blur();
        }
        return;
      }

      if (editableTarget || hasOverlayOpen) return;

      if (event.key === "/") {
        event.preventDefault();
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
        return;
      }

      if (activeTab !== "downloads" && pageCount > 1) {
        if (event.key === "ArrowLeft" && currentPage > 1) {
          event.preventDefault();
          setPage((prev) => Math.max(1, prev - 1));
          return;
        }
        if (event.key === "ArrowRight" && currentPage < pageCount) {
          event.preventDefault();
          setPage((prev) => Math.min(pageCount, prev + 1));
          return;
        }
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    activeTab,
    currentPage,
    fixMatchRequest,
    pageCount,
    selected,
    selecting,
    showActionsMenu,
    showLog,
    showSettings,
    tvShow,
  ]);

  useEffect(() => {
    if (activeTab === "downloads" || activeTab === "watchlist") return;

    const triggerRefresh = () => setBadgeRefreshTick((prev) => prev + 1);
    const intervalId = window.setInterval(triggerRefresh, 30000);

    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        triggerRefresh();
      }
    };

    const onFocus = () => {
      triggerRefresh();
    };

    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("focus", onFocus);

    return () => {
      window.clearInterval(intervalId);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("focus", onFocus);
    };
  }, [activeTab]);

  useEffect(() => {
    if (
      activeTab === "downloads" ||
      activeTab === "watchlist" ||
      badgePayload.length === 0
    )
      return;
    const startedAt = Date.now();
    const requestId = ++badgeRequestIdRef.current;
    const run = async () => {
      const mergedResults: Array<{
        id: number;
        downloaded: boolean;
        in_emby: boolean;
        plex_in_library?: boolean;
        emby_in_library?: boolean;
        cache?: string;
        debug?: string;
      }> = [];

      let cursor = 0;
      const workers = Math.min(6, badgePayload.length);

      const worker = async () => {
        while (true) {
          if (requestId !== badgeRequestIdRef.current) return;
          const index = cursor;
          cursor += 1;
          if (index >= badgePayload.length) return;

          try {
            const single = await call<
              Array<{
                id: number;
                downloaded: boolean;
                in_emby: boolean;
                plex_in_library?: boolean;
                emby_in_library?: boolean;
                cache?: string;
                debug?: string;
              }>
            >("check_media_badges", {
              items: [badgePayload[index]],
            });
            if (single[0]) {
              const result = single[0];
              mergedResults.push(result);

              if (requestId !== badgeRequestIdRef.current) return;
              // Progressive UI update: paint badge as soon as each item resolves.
              setBadgeMap((prev) => ({
                ...prev,
                [result.id]: {
                  downloaded: result.downloaded,
                  inEmby: result.in_emby,
                  plexInLibrary: result.plex_in_library,
                  embyInLibrary: result.emby_in_library,
                  cache: result.cache,
                  debug: result.debug,
                },
              }));
            }
          } catch {
            // Keep worker alive; failures are reported in aggregate below.
          }
        }
      };

      await Promise.all(Array.from({ length: workers }, () => worker()));
      if (requestId !== badgeRequestIdRef.current) return;

      const downloadedCount = mergedResults.filter(
        (result) => result.downloaded,
      ).length;
      const inServerCount = mergedResults.filter(
        (result) => result.in_emby,
      ).length;
      const inPlexCount = mergedResults.filter(
        (result) => result.plex_in_library,
      ).length;
      const inEmbyCount = mergedResults.filter(
        (result) => result.emby_in_library,
      ).length;
      const withImdb = paginatedItems.filter(
        (item) => (item.imdb_id ?? "").trim().length > 0,
      ).length;
      const withTmdb = paginatedItems.filter(
        (item) => item.tmdb_id != null,
      ).length;
      const elapsedMs = Date.now() - startedAt;
      appendLog(
        `🏷 Badge auto-check (${activeTab}) — page ${currentPage}: ${mergedResults.length} items | local ${downloadedCount} | in_library ${inServerCount} | plex ${inPlexCount} | emby ${inEmbyCount} | imdb ${withImdb} | tmdb ${withTmdb} | ${elapsedMs}ms`,
      );
    };

    run().catch((error: unknown) => {
      if (requestId !== badgeRequestIdRef.current) return;
      const message =
        error instanceof Error
          ? error.message
          : String(error ?? "unknown error");
      appendLog(
        `⚠ Badge check failed (${activeTab}) — page ${currentPage}: ${message}`,
      );
    });
  }, [activeTab, appendLog, badgePageIdsKey, badgeRefreshTick, currentPage]);

  // When TVShowPanel is open, check badges for ALL its episodes (not just the
  // deduplicated show card that appears in paginatedItems).
  const tvShowEpisodesKey = useMemo(() => {
    if (!tvShow) return "";
    return getTvEpisodes(tvShow)
      .map((ep) => ep.id)
      .sort((a, b) => a - b)
      .join(",");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tvShow, items]);

  useEffect(() => {
    if (!tvShow || !tvShowEpisodesKey) return;
    const episodes = getTvEpisodes(tvShow);
    if (episodes.length === 0) return;

    const requestId = ++badgeRequestIdRef.current;

    const payload = episodes.map((ep) => ({
      id: ep.id,
      ftpPath: ep.ftp_path,
      filename: ep.filename,
      title: ep.tmdb_title ?? ep.title ?? null,
      titleEn: ep.tmdb_title_en ?? null,
      year: ep.year ?? null,
      imdbId: ep.imdb_id ?? null,
      tmdbId: ep.tmdb_id ?? null,
      mediaType: ep.media_type ?? ep.tmdb_type ?? null,
    }));

    const run = async () => {
      let cursor = 0;
      const workers = Math.min(6, payload.length);

      const worker = async () => {
        while (true) {
          if (requestId !== badgeRequestIdRef.current) return;
          const index = cursor;
          cursor += 1;
          if (index >= payload.length) return;

          try {
            const single = await call<
              Array<{
                id: number;
                downloaded: boolean;
                in_emby: boolean;
                plex_in_library?: boolean;
                emby_in_library?: boolean;
                cache?: string;
                debug?: string;
              }>
            >("check_media_badges", { items: [payload[index]] });

            if (single[0] && requestId === badgeRequestIdRef.current) {
              const result = single[0];
              setBadgeMap((prev) => ({
                ...prev,
                [result.id]: {
                  downloaded: result.downloaded,
                  inEmby: result.in_emby,
                  plexInLibrary: result.plex_in_library,
                  embyInLibrary: result.emby_in_library,
                  cache: result.cache,
                  debug: result.debug,
                },
              }));
            }
          } catch {
            // keep worker alive
          }
        }
      };

      await Promise.all(Array.from({ length: workers }, () => worker()));
    };

    run().catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tvShowEpisodesKey, badgeRefreshTick]);

  const mediaContent = useEpisodeList ? (
    <EpisodeListView
      key={viewResetKey}
      items={paginatedItems}
      onSelect={handleCardSelect}
      resetKey={pageResetKey}
      language={language}
    />
  ) : (
    <VirtualMediaGrid
      key={viewResetKey}
      items={paginatedItems}
      selecting={selecting}
      checkedIds={checkedIds}
      onToggleCheck={toggleCheck}
      onCardSelect={handleCardSelect}
      onDownload={startDownload}
      resetKey={pageResetKey}
      language={language}
      badgeMap={badgeMap}
      downloadMap={downloadMap}
      hideEpisodeBadge={isSeriesTab && !useEpisodeList}
      showFileSize={
        activeTab === "all" || (activeTab === "movie" && movieView === "files")
      }
      preferredRating={preferredRating}
    />
  );

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        position: "relative",
      }}
      className="app-shell-bg"
    >
      {/* Grid overlay */}
      <div className="grid-overlay" />

      {/* Settings modal */}
      {showSettings && (
        <Settings language={language} onClose={() => setShowSettings(false)} />
      )}

      {/* TOP NAVBAR */}
      <nav
        style={{
          display: "flex",
          position: "sticky",
          top: 0,
          zIndex: 50,
          height: 68,
          background:
            "linear-gradient(180deg, color-mix(in srgb, var(--color-bg) 98%, black), color-mix(in srgb, var(--color-bg) 96%, black))",
          backdropFilter: "blur(16px) saturate(150%)",
          WebkitBackdropFilter: "blur(16px) saturate(150%)",
          borderBottom: "1px solid color-mix(in srgb, white 10%, transparent)",
          boxShadow: "0 1px 24px color-mix(in srgb, black 28%, transparent)",
          alignItems: "center",
          padding: "0 1.5rem",
          gap: "1rem",
          flexShrink: 0,
          isolation: "isolate",
        }}
      >
        {/* Logo */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            marginRight: 8,
          }}
        >
          <span
            style={{
              color: "var(--color-text)",
              fontWeight: 700,
              fontSize: 17,
              letterSpacing: "0.06em",
            }}
          >
            OSCATA
          </span>
          <span
            style={{
              width: 7,
              height: 7,
              borderRadius: "50%",
              background: "var(--color-primary)",
              display: "inline-block",
              flexShrink: 0,
            }}
          />
        </div>

        {/* Nav pills — hidden on mobile (tabs move to bottom bar) */}
        {!isMobile && (
          <div
            style={{ display: "flex", alignItems: "center", gap: 4, flex: 1 }}
          >
            {visibleTabs.map((tab) => {
              const active = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => switchTab(tab.id)}
                  style={{
                    padding: "6px 14px",
                    borderRadius: 999,
                    cursor: "pointer",
                    fontSize: "0.875rem",
                    fontWeight: 600,
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    border: "none",
                    background: active
                      ? "color-mix(in srgb, var(--color-primary) 18%, transparent)"
                      : "transparent",
                    color: active
                      ? "var(--color-primary)"
                      : "var(--color-text-muted)",
                    minHeight: 36,
                    transition: "color 0.18s ease, background 0.18s ease",
                  }}
                >
                  <tab.icon
                    size={16}
                    strokeWidth={2.2}
                    aria-hidden="true"
                    style={{ display: "block", flexShrink: 0 }}
                  />
                  <span>{t(language, tab.labelKey as never)}</span>
                  {tabCounts[tab.id] > 0 && (
                    <span
                      style={{
                        fontSize: 11,
                        fontWeight: 600,
                        background: active
                          ? "color-mix(in srgb, var(--color-primary) 25%, transparent)"
                          : "var(--color-surface-2)",
                        color: active
                          ? "var(--color-primary)"
                          : "var(--color-text-muted)",
                        borderRadius: 999,
                        padding: "1px 7px",
                      }}
                    >
                      {tabCounts[tab.id]}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        )}
        {isMobile && <div style={{ flex: 1 }} />}

        {/* Right actions */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            marginLeft: "auto",
          }}
        >
          {/* Lang switcher — hidden on mobile */}
          {!isMobile && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 4,
                padding: "0.18rem",
                borderRadius: "var(--radius-full)",
                border:
                  "1px solid color-mix(in srgb, var(--color-border) 82%, transparent)",
                background:
                  "color-mix(in srgb, var(--color-surface) 94%, transparent)",
              }}
            >
              {(["es", "en"] as const).map((value) => {
                const active = language === value;
                return (
                  <button
                    key={value}
                    onClick={() => setLanguage(value)}
                    style={{
                      padding: "6px 10px",
                      borderRadius: "var(--radius-full)",
                      border: "none",
                      background: active
                        ? "color-mix(in srgb, var(--color-primary) 18%, transparent)"
                        : "transparent",
                      color: active
                        ? "var(--color-primary)"
                        : "var(--color-text-muted)",
                      cursor: "pointer",
                      fontSize: 12,
                      fontWeight: 700,
                    }}
                  >
                    {value.toUpperCase()}
                  </button>
                );
              })}
            </div>
          )}

          {showDevLog && (
            <button
              onClick={() => setShowLog((v) => !v)}
              title="Activity Log"
              style={{
                ...iconButton,
                background: showLog
                  ? "color-mix(in srgb, var(--color-surface-2) 96%, transparent)"
                  : iconButton.background,
                color: showLog
                  ? "var(--color-text)"
                  : "var(--color-text-muted)",
              }}
            >
              {log.length > 0 && !showLog ? (
                <span style={{ fontSize: 12, fontWeight: 700 }}>
                  {log.length}
                </span>
              ) : (
                <Activity
                  size={15}
                  strokeWidth={2.3}
                  aria-hidden="true"
                  style={{ display: "block", flexShrink: 0 }}
                />
              )}
            </button>
          )}
          {isTauri() && <ThemeToggle />}
          {headerSlot}
          {/* Mobile burger — shows hidden tabs (Docu, Watchlist, Uploads) */}
          {isMobile && (
            <div ref={mobileNavMenuRef} style={{ position: "relative" }}>
              <button
                onClick={() => setShowMobileNavMenu((v) => !v)}
                title="Más secciones"
                style={{
                  ...iconButton,
                  background: showMobileNavMenu
                    ? "color-mix(in srgb, var(--color-primary) 18%, transparent)"
                    : iconButton.background,
                  color: showMobileNavMenu
                    ? "var(--color-primary)"
                    : "var(--color-text-muted)",
                  border: showMobileNavMenu
                    ? "1px solid color-mix(in srgb, var(--color-primary) 40%, transparent)"
                    : "1px solid transparent",
                }}
              >
                <Menu
                  size={16}
                  strokeWidth={2.2}
                  aria-hidden="true"
                  style={{ display: "block" }}
                />
              </button>

              {showMobileNavMenu && (
                <div
                  style={{
                    position: "absolute",
                    right: 0,
                    top: "calc(100% + 8px)",
                    background: "var(--color-surface)",
                    border: "1px solid var(--color-border)",
                    borderRadius: "var(--radius-lg)",
                    boxShadow:
                      "0 12px 32px rgba(0,0,0,0.45), 0 2px 8px rgba(0,0,0,0.2)",
                    minWidth: 200,
                    overflow: "hidden",
                    zIndex: 80,
                    padding: "4px",
                  }}
                >
                  {visibleTabs
                    .filter(
                      (tab) =>
                        !(
                          ["all", "movie", "tv", "downloads"] as TabId[]
                        ).includes(tab.id),
                    )
                    .map((tab) => {
                      const active = activeTab === tab.id;
                      const count = tabCounts[tab.id];
                      return (
                        <button
                          key={tab.id}
                          onClick={() => {
                            switchTab(tab.id);
                            setShowMobileNavMenu(false);
                          }}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 10,
                            width: "100%",
                            textAlign: "left",
                            padding: "10px 12px",
                            background: active
                              ? "color-mix(in srgb, var(--color-primary) 14%, transparent)"
                              : "none",
                            border: "none",
                            borderRadius: "6px",
                            color: active
                              ? "var(--color-primary)"
                              : "var(--color-text)",
                            fontSize: 14,
                            fontWeight: active ? 700 : 500,
                            cursor: "pointer",
                            transition: "background 0.12s ease",
                          }}
                        >
                          <tab.icon
                            size={16}
                            strokeWidth={active ? 2.4 : 2.0}
                          />
                          <span style={{ flex: 1 }}>
                            {t(language, tab.labelKey as never)}
                          </span>
                          {count > 0 && (
                            <span
                              style={{
                                fontSize: 11,
                                fontWeight: 700,
                                background: active
                                  ? "color-mix(in srgb, var(--color-primary) 25%, transparent)"
                                  : "var(--color-surface-2)",
                                color: active
                                  ? "var(--color-primary)"
                                  : "var(--color-text-muted)",
                                borderRadius: 999,
                                padding: "1px 7px",
                                minWidth: 20,
                                textAlign: "center",
                              }}
                            >
                              {count}
                            </span>
                          )}
                        </button>
                      );
                    })}
                </div>
              )}
            </div>
          )}
          {/* Settings button */}
          <button
            onClick={() => setShowSettings(true)}
            title={t(language, "settings.title")}
            style={iconButton}
          >
            <SettingsIcon
              size={16}
              strokeWidth={2.1}
              aria-hidden="true"
              style={{ display: "block", flexShrink: 0 }}
            />
          </button>
        </div>
      </nav>

      {/* BOTTOM TAB BAR — mobile only */}
      {isMobile && (
        <nav
          className="bottom-tabs"
          style={{
            position: "fixed",
            bottom: 0,
            left: 0,
            right: 0,
            zIndex: "var(--z-bottom-tabs)" as never,
            display: "flex",
            background: "color-mix(in srgb, var(--color-bg) 96%, black)",
            borderTop:
              "1px solid color-mix(in srgb, var(--color-border) 70%, transparent)",
            backdropFilter: "blur(16px)",
            WebkitBackdropFilter: "blur(16px)",
            paddingBottom: "env(safe-area-inset-bottom, 0px)",
          }}
        >
          {mobileBottomTabs.map((tab) => {
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => switchTab(tab.id)}
                style={{
                  flex: 1,
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  padding: "10px 4px 10px",
                  gap: 3,
                  border: "none",
                  background: "transparent",
                  color: active
                    ? "var(--color-primary)"
                    : "var(--color-text-muted)",
                  cursor: "pointer",
                  position: "relative",
                  transition: "color 0.15s ease",
                }}
              >
                <tab.icon
                  size={22}
                  strokeWidth={active ? 2.4 : 2.0}
                  aria-hidden="true"
                  style={{ display: "block", flexShrink: 0 }}
                />
                <span style={{ fontSize: 10, fontWeight: active ? 700 : 500 }}>
                  {t(language, tab.labelKey as never)}
                </span>
                {tabCounts[tab.id] > 0 && (
                  <span
                    style={{
                      position: "absolute",
                      top: 6,
                      right: "calc(50% - 16px)",
                      fontSize: 9,
                      fontWeight: 700,
                      background: active
                        ? "var(--color-primary)"
                        : "var(--color-surface-2)",
                      color: active ? "#fff" : "var(--color-text-muted)",
                      borderRadius: 999,
                      padding: "1px 5px",
                      minWidth: 16,
                      textAlign: "center",
                    }}
                  >
                    {tabCounts[tab.id]}
                  </span>
                )}
              </button>
            );
          })}
        </nav>
      )}

      {/* FILTER DRAWER — mobile only */}
      {isMobile && filterDrawerOpen && (
        <>
          {/* Backdrop */}
          <div
            onClick={() => setFilterDrawerOpen(false)}
            style={{
              position: "fixed",
              inset: 0,
              background: "color-mix(in srgb, black 55%, transparent)",
              zIndex: "var(--z-filter-drawer-backdrop)" as never,
              backdropFilter: "blur(4px)",
            }}
          />
          {/* Drawer */}
          <div
            style={{
              position: "fixed",
              top: 0,
              left: 0,
              bottom: 0,
              width: "min(320px, 90vw)",
              background: "var(--color-bg)",
              zIndex: "var(--z-filter-drawer)" as never,
              overflowY: "auto",
              display: "flex",
              flexDirection: "column",
              borderRight:
                "1px solid color-mix(in srgb, var(--color-border) 70%, transparent)",
              boxShadow:
                "4px 0 32px color-mix(in srgb, black 40%, transparent)",
            }}
          >
            {/* Drawer header */}
            <div
              style={{
                padding: "1rem 1.25rem",
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
                  fontWeight: 700,
                  fontSize: 15,
                  color: "var(--color-text)",
                }}
              >
                {t(language, "filter.filters" as never)}
              </span>
              <button
                onClick={() => setFilterDrawerOpen(false)}
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: 8,
                  border: "none",
                  background: "transparent",
                  color: "var(--color-text-muted)",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 18,
                }}
              >
                ×
              </button>
            </div>
            {/* Drawer content */}
            <div
              style={{
                flex: 1,
                overflowY: "auto",
                padding: "1.25rem 1rem 1.25rem 1.25rem",
                display: "flex",
                flexDirection: "column",
                gap: 12,
              }}
            >
              <FilterBar
                filters={filters}
                items={filterableItems}
                language={language}
                searchInputRef={searchInputRef}
                onChange={setFilters}
              />
            </div>
          </div>
        </>
      )}

      {/* MAIN CONTENT */}
      <div
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          position: "relative",
          zIndex: 1,
        }}
      >
        {/* Toolbar row */}
        <div
          style={{
            padding: isMobile ? "10px 1.5rem" : "12px 1.5rem",
            display: "flex",
            flexDirection: "column",
            gap:
              isMobile && (activeTab === "tv" || activeTab === "movie") ? 8 : 0,
            borderBottom:
              "1px solid color-mix(in srgb, var(--color-border) 60%, transparent)",
            flexShrink: 0,
          }}
        >
          {/* Main row: title + action buttons */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 8,
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 14,
                minWidth: 0,
                overflow: "hidden",
              }}
            >
              <h1
                style={{
                  margin: 0,
                  fontSize: 18,
                  fontWeight: 700,
                  color: "var(--color-text)",
                  letterSpacing: "-0.01em",
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {sectionTitle[activeTab]}
                {activeTab !== "downloads" && (
                  <span
                    style={{
                      fontSize: 13,
                      fontWeight: 400,
                      color: "var(--color-text-muted)",
                      marginLeft: 10,
                    }}
                  >
                    {activeTab === "watchlist"
                      ? watchlist.items.length
                      : filtered.length}{" "}
                    titles
                  </span>
                )}
              </h1>

              {/* Desktop-only view toggles — mobile renders them in the sub-row below */}
              {!isMobile && activeTab === "tv" && (
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 4,
                    padding: "0.2rem",
                    borderRadius: "var(--radius-full)",
                    border:
                      "1px solid color-mix(in srgb, var(--color-border) 80%, transparent)",
                    background:
                      "color-mix(in srgb, var(--color-surface) 94%, transparent)",
                  }}
                >
                  {(["shows", "episodes"] as const).map((mode) => {
                    const active = tvView === mode;
                    return (
                      <button
                        key={mode}
                        onClick={() => {
                          setTvView(mode);
                          setPage(1);
                        }}
                        style={{
                          padding: "6px 12px",
                          borderRadius: "var(--radius-full)",
                          border: "none",
                          background: active
                            ? "color-mix(in srgb, var(--color-primary) 18%, transparent)"
                            : "transparent",
                          color: active
                            ? "var(--color-primary)"
                            : "var(--color-text-muted)",
                          fontSize: 12,
                          fontWeight: 700,
                          cursor: "pointer",
                        }}
                      >
                        {mode === "shows"
                          ? t(language, "library.shows")
                          : t(language, "library.episodes")}
                      </button>
                    );
                  })}
                </div>
              )}

              {!isMobile && activeTab === "movie" && (
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 4,
                    padding: "0.2rem",
                    borderRadius: "var(--radius-full)",
                    border:
                      "1px solid color-mix(in srgb, var(--color-border) 80%, transparent)",
                    background:
                      "color-mix(in srgb, var(--color-surface) 94%, transparent)",
                  }}
                >
                  {(["grouped", "files"] as const).map((mode) => {
                    const active = movieView === mode;
                    return (
                      <button
                        key={mode}
                        onClick={() => {
                          setMovieView(mode);
                          setPage(1);
                        }}
                        style={{
                          padding: "6px 12px",
                          borderRadius: "var(--radius-full)",
                          border: "none",
                          background: active
                            ? "color-mix(in srgb, var(--color-primary) 18%, transparent)"
                            : "transparent",
                          color: active
                            ? "var(--color-primary)"
                            : "var(--color-text-muted)",
                          fontSize: 12,
                          fontWeight: 700,
                          cursor: "pointer",
                        }}
                      >
                        {t(
                          language,
                          mode === "grouped"
                            ? "library.grouped"
                            : "library.files",
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              {/* Filter button — mobile only, opens the filter drawer */}
              {isMobile &&
                activeTab !== "downloads" &&
                activeTab !== "watchlist" && (
                  <button
                    onClick={() => setFilterDrawerOpen(true)}
                    title={t(language, "filter.filters" as never)}
                    style={ghostBtn}
                  >
                    <Filter
                      size={14}
                      strokeWidth={2.2}
                      aria-hidden="true"
                      style={{ display: "block", flexShrink: 0 }}
                    />
                  </button>
                )}
              {activeTab === "downloads" ||
              activeTab === "watchlist" ||
              activeTab === "uploads" ? null : selecting ? (
                <>
                  <span
                    style={{ color: "var(--color-text-muted)", fontSize: 13 }}
                  >
                    {t(language, "library.selectedCount", {
                      count: checkedIds.size,
                    })}
                  </span>
                  <button
                    onClick={() =>
                      setCheckedIds(new Set(filtered.map((item) => item.id)))
                    }
                    disabled={filtered.length === 0}
                    style={{
                      ...ghostBtn,
                      opacity: filtered.length === 0 ? 0.5 : 1,
                      cursor: filtered.length === 0 ? "default" : "pointer",
                    }}
                  >
                    {t(language, "library.selectAll")}
                  </button>
                  <button
                    onClick={() => setShowBulkFix(true)}
                    disabled={checkedIds.size === 0}
                    style={{
                      ...primaryBtn,
                      opacity: checkedIds.size === 0 ? 0.5 : 1,
                      cursor: checkedIds.size === 0 ? "default" : "pointer",
                    }}
                  >
                    <Pencil
                      size={14}
                      strokeWidth={2.2}
                      aria-hidden="true"
                      style={{ display: "block", flexShrink: 0 }}
                    />
                    {t(language, "library.fixMatch")} ({checkedIds.size})
                  </button>
                  <button onClick={exitSelect} style={ghostBtn}>
                    {t(language, "library.cancel")}
                  </button>
                </>
              ) : (
                <>
                  <button
                    onClick={() => setSelecting(true)}
                    title={t(language, "library.selectMultiple")}
                    style={ghostBtn}
                  >
                    <CheckSquare
                      size={14}
                      strokeWidth={2.2}
                      aria-hidden="true"
                      style={{ display: "block", flexShrink: 0 }}
                    />
                    {!isMobile && t(language, "library.select")}
                  </button>
                  <div ref={actionsMenuRef} style={{ position: "relative" }}>
                    <button
                      onClick={() => setShowActionsMenu((open) => !open)}
                      title={t(language, "library.actions")}
                      style={{ ...ghostBtn, padding: "7px 11px" }}
                    >
                      <MoreHorizontal
                        size={16}
                        strokeWidth={2.2}
                        aria-hidden="true"
                        style={{ display: "block", flexShrink: 0 }}
                      />
                    </button>

                    {showActionsMenu && (
                      <div
                        style={{
                          position: "absolute",
                          top: "calc(100% + 8px)",
                          right: 0,
                          minWidth: 220,
                          padding: 6,
                          borderRadius: "var(--radius-lg)",
                          border:
                            "1px solid color-mix(in srgb, var(--color-border) 80%, transparent)",
                          background:
                            "color-mix(in srgb, var(--color-surface) 96%, transparent)",
                          boxShadow:
                            "0 16px 34px color-mix(in srgb, black 26%, transparent)",
                          zIndex: 30,
                        }}
                      >
                        <button
                          onClick={refreshLibrary}
                          disabled={
                            isIndexing ||
                            refreshingLibrary ||
                            rematching ||
                            clearingAll ||
                            refreshingMetadata
                          }
                          style={{
                            width: "100%",
                            padding: "10px 12px",
                            borderRadius: "var(--radius)",
                            border: "none",
                            background: "transparent",
                            color: "var(--color-text)",
                            textAlign: "left",
                            cursor:
                              isIndexing ||
                              refreshingLibrary ||
                              rematching ||
                              clearingAll ||
                              refreshingMetadata
                                ? "default"
                                : "pointer",
                            opacity:
                              isIndexing ||
                              refreshingLibrary ||
                              rematching ||
                              clearingAll ||
                              refreshingMetadata
                                ? 0.5
                                : 1,
                            fontSize: 13,
                            fontWeight: 600,
                          }}
                        >
                          {isIndexing || refreshingLibrary
                            ? t(language, "library.refreshing")
                            : t(language, "library.refresh")}
                        </button>
                        <button
                          onClick={refreshAllMetadata}
                          disabled={
                            refreshingMetadata ||
                            rematching ||
                            clearingAll ||
                            refreshingLibrary ||
                            isIndexing
                          }
                          style={{
                            width: "100%",
                            padding: "10px 12px",
                            borderRadius: "var(--radius)",
                            border: "none",
                            background: "transparent",
                            color: "var(--color-text)",
                            textAlign: "left",
                            cursor:
                              refreshingMetadata ||
                              rematching ||
                              clearingAll ||
                              refreshingLibrary ||
                              isIndexing
                                ? "default"
                                : "pointer",
                            opacity:
                              refreshingMetadata ||
                              rematching ||
                              clearingAll ||
                              refreshingLibrary ||
                              isIndexing
                                ? 0.5
                                : 1,
                            fontSize: 13,
                            fontWeight: 600,
                          }}
                        >
                          {refreshingMetadata
                            ? t(language, "library.refreshingMetadata")
                            : t(language, "library.refreshAllMetadata")}
                        </button>
                        <button
                          onClick={forceRefreshAllMetadata}
                          disabled={
                            forceRefreshingMetadata ||
                            refreshingMetadata ||
                            rematching ||
                            clearingAll ||
                            refreshingLibrary ||
                            isIndexing
                          }
                          style={{
                            width: "100%",
                            padding: "10px 12px",
                            borderRadius: "var(--radius)",
                            border: "none",
                            background: "transparent",
                            color: "var(--color-text)",
                            textAlign: "left",
                            cursor:
                              forceRefreshingMetadata ||
                              refreshingMetadata ||
                              rematching ||
                              clearingAll ||
                              refreshingLibrary ||
                              isIndexing
                                ? "default"
                                : "pointer",
                            opacity:
                              forceRefreshingMetadata ||
                              refreshingMetadata ||
                              rematching ||
                              clearingAll ||
                              refreshingLibrary ||
                              isIndexing
                                ? 0.5
                                : 1,
                            fontSize: 13,
                            fontWeight: 600,
                          }}
                        >
                          {forceRefreshingMetadata
                            ? t(language, "library.forcingRefreshMetadata")
                            : t(language, "library.forceRefreshAllMetadata")}
                        </button>
                        <button
                          onClick={runRematchAll}
                          disabled={
                            rematching ||
                            clearingAll ||
                            refreshingLibrary ||
                            refreshingMetadata ||
                            forceRefreshingMetadata
                          }
                          style={{
                            width: "100%",
                            padding: "10px 12px",
                            borderRadius: "var(--radius)",
                            border: "none",
                            background: "transparent",
                            color: "var(--color-text)",
                            textAlign: "left",
                            cursor:
                              rematching ||
                              clearingAll ||
                              refreshingLibrary ||
                              refreshingMetadata ||
                              forceRefreshingMetadata
                                ? "default"
                                : "pointer",
                            opacity:
                              rematching ||
                              clearingAll ||
                              refreshingLibrary ||
                              refreshingMetadata ||
                              forceRefreshingMetadata
                                ? 0.5
                                : 1,
                            fontSize: 13,
                            fontWeight: 600,
                          }}
                        >
                          {rematching
                            ? t(language, "library.matching")
                            : t(language, "library.rematchAll")}
                        </button>
                        <button
                          onClick={runRematchAllPlex}
                          disabled={
                            rematching ||
                            clearingAll ||
                            refreshingLibrary ||
                            refreshingMetadata ||
                            forceRefreshingMetadata
                          }
                          style={{
                            width: "100%",
                            padding: "10px 12px",
                            borderRadius: "var(--radius)",
                            border: "none",
                            background: "transparent",
                            color: "var(--color-text)",
                            textAlign: "left",
                            cursor:
                              rematching ||
                              clearingAll ||
                              refreshingLibrary ||
                              refreshingMetadata ||
                              forceRefreshingMetadata
                                ? "default"
                                : "pointer",
                            opacity:
                              rematching ||
                              clearingAll ||
                              refreshingLibrary ||
                              refreshingMetadata ||
                              forceRefreshingMetadata
                                ? 0.5
                                : 1,
                            fontSize: 13,
                            fontWeight: 600,
                          }}
                        >
                          {rematching
                            ? t(language, "library.matching")
                            : t(language, "library.rematchAllPlex")}
                        </button>
                        <button
                          onClick={clearAllMetadata}
                          disabled={
                            clearingAll ||
                            rematching ||
                            refreshingLibrary ||
                            refreshingMetadata
                          }
                          style={{
                            width: "100%",
                            padding: "10px 12px",
                            borderRadius: "var(--radius)",
                            border: "none",
                            background: "transparent",
                            color: "var(--color-danger)",
                            textAlign: "left",
                            cursor:
                              clearingAll ||
                              rematching ||
                              refreshingLibrary ||
                              refreshingMetadata
                                ? "default"
                                : "pointer",
                            opacity:
                              clearingAll ||
                              rematching ||
                              refreshingLibrary ||
                              refreshingMetadata
                                ? 0.5
                                : 1,
                            fontSize: 13,
                            fontWeight: 600,
                          }}
                        >
                          {clearingAll
                            ? t(language, "library.clearing")
                            : t(language, "library.clearAllMetadata")}
                        </button>
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
          </div>
          {/* closes main row */}

          {/* Mobile-only view toggle sub-row */}
          {isMobile && activeTab === "tv" && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 4,
                padding: "0.2rem",
                borderRadius: "var(--radius-full)",
                border:
                  "1px solid color-mix(in srgb, var(--color-border) 80%, transparent)",
                background:
                  "color-mix(in srgb, var(--color-surface) 94%, transparent)",
                alignSelf: "flex-start",
              }}
            >
              {(["shows", "episodes"] as const).map((mode) => {
                const active = tvView === mode;
                return (
                  <button
                    key={mode}
                    onClick={() => {
                      setTvView(mode);
                      setPage(1);
                    }}
                    style={{
                      padding: "6px 12px",
                      borderRadius: "var(--radius-full)",
                      border: "none",
                      background: active
                        ? "color-mix(in srgb, var(--color-primary) 18%, transparent)"
                        : "transparent",
                      color: active
                        ? "var(--color-primary)"
                        : "var(--color-text-muted)",
                      fontSize: 12,
                      fontWeight: 700,
                      cursor: "pointer",
                    }}
                  >
                    {mode === "shows"
                      ? t(language, "library.shows")
                      : t(language, "library.episodes")}
                  </button>
                );
              })}
            </div>
          )}
          {isMobile && activeTab === "movie" && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 4,
                padding: "0.2rem",
                borderRadius: "var(--radius-full)",
                border:
                  "1px solid color-mix(in srgb, var(--color-border) 80%, transparent)",
                background:
                  "color-mix(in srgb, var(--color-surface) 94%, transparent)",
                alignSelf: "flex-start",
              }}
            >
              {(["grouped", "files"] as const).map((mode) => {
                const active = movieView === mode;
                return (
                  <button
                    key={mode}
                    onClick={() => {
                      setMovieView(mode);
                      setPage(1);
                    }}
                    style={{
                      padding: "6px 12px",
                      borderRadius: "var(--radius-full)",
                      border: "none",
                      background: active
                        ? "color-mix(in srgb, var(--color-primary) 18%, transparent)"
                        : "transparent",
                      color: active
                        ? "var(--color-primary)"
                        : "var(--color-text-muted)",
                      fontSize: 12,
                      fontWeight: 700,
                      cursor: "pointer",
                    }}
                  >
                    {t(
                      language,
                      mode === "grouped" ? "library.grouped" : "library.files",
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div
          className={isMobile ? "mobile-content-area" : undefined}
          style={{ flex: 1, display: "flex", minHeight: 0 }}
        >
          {activeTab !== "downloads" &&
            activeTab !== "uploads" &&
            !isMobile && (
              <div
                style={{
                  width: 320,
                  flexShrink: 0,
                  padding: "1.5rem 0 1.5rem 1.5rem",
                  borderRight:
                    "1px solid color-mix(in srgb, var(--color-border) 60%, transparent)",
                }}
              >
                <div
                  style={{
                    height: "100%",
                    overflowY: "auto",
                    paddingRight: "1rem",
                    display: "flex",
                    flexDirection: "column",
                    gap: 12,
                  }}
                >
                  <FilterBar
                    filters={filters}
                    items={filterableItems}
                    language={language}
                    searchInputRef={searchInputRef}
                    onChange={setFilters}
                  />
                </div>
              </div>
            )}

          {/* Scrollable content grid */}
          <div style={{ flex: 1, overflow: "hidden", position: "relative" }}>
            {activeTab === "uploads" ? (
              <div style={{ height: "100%", overflowY: "auto" }}>
                <UploadsTab
                  uploads={uploads}
                  language={language}
                  onCancel={cancelUpload}
                  onRetry={retryUpload}
                  onDelete={deleteUpload}
                  onClearCompleted={clearCompletedUploads}
                />
              </div>
            ) : activeTab === "downloads" ? (
              <div
                style={{ height: "100%", overflowY: "auto", padding: "1.5rem" }}
              >
                <DownloadsTab
                  language={language}
                  downloads={downloads}
                  cancelDownload={cancelDownload}
                  clearCompleted={clearCompleted}
                  retryDownload={retryDownload}
                  openDownloadFolder={openDownloadFolder}
                  deleteDownload={deleteDownload}
                />
              </div>
            ) : activeTab === "watchlist" ? (
              <WatchlistTab
                watchlist={watchlist}
                language={language}
                onNavigateToItem={handleNavigateFromWatchlist}
              />
            ) : (
              <>
                {mediaContent}

                {filtered.length === 0 && !progress && (
                  <div
                    style={{
                      textAlign: "center",
                      padding: "60px 0",
                      color: "var(--color-text-muted)",
                      position: "absolute",
                      inset: 0,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      pointerEvents: "none",
                    }}
                  >
                    {items.length === 0
                      ? t(language, "library.noMediaStarting")
                      : activeTab !== "all"
                        ? t(language, "library.noCategory", {
                            category: t(
                              language,
                              (TABS.find((tab) => tab.id === activeTab)
                                ?.labelKey ?? "nav.all") as never,
                            ).toLowerCase(),
                          })
                        : t(language, "library.noResultsFilters")}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>

      <IndexStatus
        progress={progress}
        isIndexing={isIndexing}
        completionSummary={completionSummary}
        onDismissCompletion={dismissCompletion}
        onCancelIndex={forceClearIndexing}
        activityLogOpen={showLog}
        language={language}
        tmdbProgress={tmdbProgress}
        isMobile={isMobile}
      />
      {metaRefreshProgress !== null && !isIndexing && (
        <div
          style={{
            position: "fixed",
            left: 18,
            bottom: isMobile
              ? "calc(64px + env(safe-area-inset-bottom, 0px) + 22px)"
              : 22,
            zIndex: 52,
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "0.6rem 0.85rem",
            borderRadius: 999,
            border: "1px solid var(--color-border)",
            background: "var(--color-surface)",
            boxShadow: "0 8px 24px rgba(0,0,0,0.25)",
            fontSize: 12,
            color: "var(--color-text-muted)",
            fontWeight: 600,
          }}
        >
          <div
            style={{
              width: 80,
              height: 4,
              borderRadius: 999,
              overflow: "hidden",
              background: "var(--color-surface-2)",
            }}
          >
            <div
              style={{
                width: `${Math.min(100, Math.round((metaRefreshProgress.done / metaRefreshProgress.total) * 100))}%`,
                height: "100%",
                background: "var(--color-primary)",
                transition: "width 0.3s ease",
              }}
            />
          </div>
          <span>
            {t(language, "metaRefresh.banner", {
              done: metaRefreshProgress.done,
              total: metaRefreshProgress.total,
            })}
          </span>
        </div>
      )}
      <DownloadFeedbackToast
        language={language}
        onGoToDownloads={() => switchTab("downloads")}
      />
      {indexError && (
        <IndexErrorToast
          message={indexError}
          language={language}
          onRetry={retryIndexing}
          onOpenSettings={() => setShowSettings(true)}
          onDismiss={clearIndexError}
        />
      )}

      {activeTab !== "downloads" && filtered.length > 0 && pageCount > 1 && (
        <div
          style={{
            position: "fixed",
            left: "50%",
            bottom: isMobile
              ? "calc(64px + env(safe-area-inset-bottom, 0px) + 12px)"
              : 18,
            transform: "translateX(-50%)",
            display: "flex",
            justifyContent: "center",
            padding: "0 16px",
            pointerEvents: "none",
            zIndex: 110,
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              minHeight: 50,
              padding: "0.25rem",
              borderRadius: "var(--radius-full)",
              border:
                "1px solid color-mix(in srgb, var(--color-border) 80%, transparent)",
              background:
                "color-mix(in srgb, var(--color-surface) 90%, transparent)",
              backdropFilter: "blur(18px) saturate(155%)",
              WebkitBackdropFilter: "blur(18px) saturate(155%)",
              boxShadow:
                "0 16px 38px color-mix(in srgb, black 32%, transparent)",
              pointerEvents: "auto",
            }}
          >
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={currentPage === 1}
              style={{
                ...ghostBtn,
                padding: "6px 12px",
                minHeight: 40,
                opacity: currentPage === 1 ? 0.5 : 1,
                cursor: currentPage === 1 ? "default" : "pointer",
              }}
            >
              {t(language, "library.prev")}
            </button>
            <span
              style={{
                fontSize: 13,
                color: "var(--color-text-muted)",
                minWidth: 132,
                textAlign: "center",
              }}
            >
              {t(language, "library.page")} {currentPage}{" "}
              {t(language, "library.of")} {pageCount}
            </span>
            <button
              onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
              disabled={currentPage === pageCount}
              style={{
                ...ghostBtn,
                padding: "6px 12px",
                minHeight: 40,
                opacity: currentPage === pageCount ? 0.5 : 1,
                cursor: currentPage === pageCount ? "default" : "pointer",
              }}
            >
              {t(language, "library.next")}
            </button>
          </div>
        </div>
      )}

      {selected && (
        <DetailPanel
          item={items.find((i) => i.id === selected.id) ?? selected}
          language={language}
          relatedItems={
            selected.media_type === "movie" ? getMovieVersions(selected) : []
          }
          groupedView={selectedGroupedView}
          onClose={() => setSelected(null)}
          onOpenItem={(item) => {
            setSelectedGroupedView(false);
            setSelected(item);
          }}
          onUpdated={(id, patch) => {
            patchItem(id, patch);
            setSelected((s) => (s && s.id === id ? { ...s, ...patch } : s));
          }}
          downloadItem={
            selected ? downloadMap.get(selected.ftp_path) : undefined
          }
          downloadMap={downloadMap}
          downloadedBadgeMap={badgeMap}
          isDownloaded={selected ? !!badgeMap[selected.id]?.downloaded : false}
          onDownload={startDownload}
          isDownloadPending={isDownloadPending}
          onRetry={retryDownload}
          onDevCheckInLibrary={recheckBadgeForItem}
          watchlistedTmdbIds={watchlist.watchlistedTmdbIds}
          onAddToWatchlist={watchlist.add}
          onOpenWatchlist={() => setActiveTab("watchlist")}
        />
      )}

      {tvShow &&
        (() => {
          const liveShow = items.find((i) => i.id === tvShow.id) ?? tvShow;
          return (
            <TVShowPanel
              show={liveShow}
              allEpisodes={getTvEpisodes(liveShow)}
              trailerUrlOverride={tvShowTrailerUrlOverride}
              language={language}
              onClose={() => setTvShow(null)}
              onDownload={startDownload}
              onDownloadSeason={handleDownloadSeason}
              downloadMap={downloadMap}
              isDownloadPending={isDownloadPending}
              downloadedBadgeMap={badgeMap}
              onDevCheckInLibrary={recheckBadgeForItem}
              watchlistedTmdbIds={watchlist.watchlistedTmdbIds}
              onAddToWatchlist={watchlist.add}
              onOpenWatchlist={() => setActiveTab("watchlist")}
              onFixMatch={(episodes) => {
                const [first] = episodes;
                setFixMatchRequest({
                  itemIds: episodes.map((episode) => episode.id),
                  initialQuery:
                    first?.title ??
                    first?.filename ??
                    tvShow?.title ??
                    tvShow?.filename ??
                    "",
                  initialMediaType:
                    tvShow.media_type === "documentary" ? "documentary" : "tv",
                });
              }}
            />
          );
        })()}

      {fixMatchRequest && (
        <FixMatchModal
          itemIds={fixMatchRequest.itemIds}
          initialQuery={fixMatchRequest.initialQuery}
          initialMediaType={fixMatchRequest.initialMediaType}
          language={language}
          onApply={(id, movie) => {
            patchItem(id, {
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
          onClose={() => setFixMatchRequest(null)}
        />
      )}

      {showBulkFix && (
        <FixMatchModal
          itemIds={Array.from(checkedIds)}
          initialQuery=""
          language={language}
          onApply={(id, movie) => {
            patchItem(id, {
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
          onClose={() => {
            setShowBulkFix(false);
            exitSelect();
          }}
        />
      )}

      {showDevLog && showLog && (
        <ActivityLog language={language} entries={log} onClear={clearLog} />
      )}

      {quitDialogVisible &&
        createPortal(
          <div
            style={{
              position: "fixed",
              inset: 0,
              zIndex: 9999,
              background: "rgba(0,0,0,0.7)",
              backdropFilter: "blur(4px)",
              WebkitBackdropFilter: "blur(4px)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: "1.5rem",
            }}
          >
            <div
              style={{
                width: "100%",
                maxWidth: 420,
                background: "var(--color-surface)",
                borderRadius: "var(--radius-lg)",
                border: "1px solid var(--color-border)",
                padding: "1.75rem",
                boxShadow: "0 24px 64px rgba(0,0,0,0.4)",
              }}
            >
              <div
                style={{
                  fontSize: 16,
                  fontWeight: 700,
                  color: "var(--color-text)",
                  marginBottom: 8,
                }}
              >
                {t(language, "quit.title")}
              </div>
              <div
                style={{
                  fontSize: 14,
                  color: "var(--color-text-muted)",
                  marginBottom: 24,
                }}
              >
                {t(language, "quit.body", { count: activeCount })}
              </div>
              <div
                style={{
                  display: "flex",
                  gap: 10,
                  justifyContent: "flex-end",
                }}
              >
                <button
                  onClick={cancelQuit}
                  style={{
                    padding: "0.5rem 1rem",
                    borderRadius: "var(--radius)",
                    border: "1px solid var(--color-border)",
                    background: "var(--color-surface-2)",
                    color: "var(--color-text)",
                    fontSize: 14,
                    cursor: "pointer",
                  }}
                >
                  {t(language, "quit.keep")}
                </button>
                <button
                  onClick={confirmQuit}
                  style={{
                    padding: "0.5rem 1rem",
                    borderRadius: "var(--radius)",
                    border: "none",
                    background: "var(--color-danger)",
                    color: "#fff",
                    fontSize: 14,
                    fontWeight: 600,
                    cursor: "pointer",
                  }}
                >
                  {t(language, "quit.confirm")}
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}
