import { useEffect, useMemo, useRef, useState } from "react";
import { call } from "../lib/transport";
import { useIndexing, MediaItem } from "../hooks/useIndexing";
import { useDownload } from "../hooks/useDownload";
import { useDownloads } from "../hooks/useDownloads";
import AppIcon from "../components/AppIcon";
import FilterBar, {
  Filters,
  normalizeHdr,
  normalizeReleaseType,
  normalizeResolution,
} from "../components/FilterBar";
import IndexStatus from "../components/IndexStatus";
import Settings from "./Settings";
import ActivityLog from "../components/ActivityLog";
import DetailPanel from "../components/DetailPanel";
import FixMatchModal from "../components/FixMatchModal";
import DownloadsTab from "../components/DownloadsTab";
import DownloadFeedbackToast from "../components/DownloadFeedbackToast";
import IndexErrorToast from "../components/IndexErrorToast";
import TVShowPanel from "../components/TVShowPanel";
import VirtualMediaGrid from "../components/VirtualMediaGrid";
import { AppLanguage, getLocalizedTitle } from "../utils/mediaLanguage";
import { t } from "../utils/i18n";

type TabId = "all" | "movie" | "tv" | "documentary" | "downloads";
type TabIcon = "grid" | "movie" | "tv" | "docs" | "download";

const TABS: { id: TabId; labelKey: string; icon: TabIcon }[] = [
  { id: "all", labelKey: "nav.all", icon: "grid" },
  { id: "movie", labelKey: "nav.movies", icon: "movie" },
  { id: "tv", labelKey: "nav.tv", icon: "tv" },
  { id: "documentary", labelKey: "nav.docs", icon: "docs" },
  { id: "downloads", labelKey: "nav.downloads", icon: "download" },
];

const defaultFilters = (): Filters => ({
  search: "",
  releaseType: "",
  resolution: "",
  hdr: "",
  sort: "added-desc",
});
const ITEMS_PER_PAGE = 48;

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
                <AppIcon name="chevron-right" size={16} strokeWidth={2.2} />
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default function Library({
  startIndexingOnMount = false,
}: {
  startIndexingOnMount?: boolean;
}) {
  const showDevLog = import.meta.env.DEV;
  const {
    items,
    isIndexing,
    crawlStats,
    progress,
    indexError,
    clearIndexError,
    retryIndexing,
    log,
    appendLog,
    clearLog,
  } = useIndexing();
  const { startDownload, isDownloadPending } = useDownload();
  const {
    downloads,
    cancelDownload,
    clearCompleted,
    retryDownload,
    openDownloadFolder,
    deleteDownload,
  } = useDownloads();
  const downloadMap = useMemo(
    () => new Map(downloads.map((d) => [d.ftp_path, d])),
    [downloads],
  );
  const [activeTab, setActiveTab] = useState<TabId>("all");
  const [filters, setFilters] = useState<Filters>(defaultFilters());
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
  const [tvShow, setTvShow] = useState<MediaItem | null>(null);
  const [fixMatchRequest, setFixMatchRequest] = useState<{
    itemIds: number[];
    initialQuery: string;
    initialMediaType: "movie" | "tv" | "documentary";
  } | null>(null);
  const [page, setPage] = useState(1);
  const [movieView, setMovieView] = useState<"grouped" | "files">("grouped");
  const [tvView, setTvView] = useState<"shows" | "episodes">("shows");
  const [showActionsMenu, setShowActionsMenu] = useState(false);
  const [language, setLanguage] = useState<AppLanguage>("es");
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
    return items.filter((ep) =>
      ep.tmdb_type === "tv" ||
      ep.media_type === "tv" ||
      ep.media_type === "documentary"
        ? show.tmdb_id
          ? ep.tmdb_id === show.tmdb_id
          : (ep.title ?? ep.filename) === (show.title ?? show.filename)
        : false,
    );
  };

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

  const switchTab = (tab: TabId) => {
    setActiveTab(tab);
    setSelected(null);
    setSelectedGroupedView(false);
    setTvShow(null);
    setSelecting(false);
    setCheckedIds(new Set());
    setFilters(defaultFilters());
    setPage(1);
    setMovieView("grouped");
    setTvView("shows");
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

  const getAddedTimestamp = (item: MediaItem): number => {
    const indexed = item.indexed_at ? Date.parse(item.indexed_at) : NaN;
    if (!Number.isNaN(indexed)) {
      // Guard against bad future timestamps in imported or external metadata.
      return Math.min(indexed, Date.now());
    }
    return item.id;
  };

  const deduplicateByTitle = (entries: MediaItem[]): MediaItem[] => {
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
  };

  const getMovieVersions = (movie: MediaItem): MediaItem[] =>
    items.filter(
      (entry) =>
        entry.media_type === "movie" &&
        (movie.tmdb_id
          ? entry.tmdb_id === movie.tmdb_id
          : (entry.title ?? entry.filename) ===
            (movie.title ?? movie.filename)),
    );

  const tabCounts = useMemo(
    () =>
      TABS.reduce(
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
    const matchingItems = filterableItems
      .filter((item) => {
        const q = filters.search.toLowerCase();
        const matchesSearch =
          !q ||
          (item.tmdb_title ?? "").toLowerCase().includes(q) ||
          (item.tmdb_title_en ?? "").toLowerCase().includes(q) ||
          (item.title ?? "").toLowerCase().includes(q) ||
          (item.release_group ?? "").toLowerCase().includes(q) ||
          item.filename.toLowerCase().includes(q);
        return (
          matchesSearch &&
          (!filters.releaseType ||
            normalizeReleaseType(item.release_type) === filters.releaseType) &&
          (!filters.resolution ||
            normalizeResolution(item.resolution) === filters.resolution) &&
          (!filters.hdr || normalizeHdr(item.hdr) === filters.hdr)
        );
      })
      .sort((a, b) => {
        const titleA = getLocalizedTitle(a, language).toLowerCase();
        const titleB = getLocalizedTitle(b, language).toLowerCase();
        switch (filters.sort) {
          case "title-desc":
            return titleB.localeCompare(titleA);
          case "release-desc": {
            const ra = a.tmdb_release_date ?? `${a.year ?? "0000"}-01-01`;
            const rb = b.tmdb_release_date ?? `${b.year ?? "0000"}-01-01`;
            return rb.localeCompare(ra);
          }
          case "release-asc": {
            const ra = a.tmdb_release_date ?? `${a.year ?? "0000"}-01-01`;
            const rb = b.tmdb_release_date ?? `${b.year ?? "0000"}-01-01`;
            return ra.localeCompare(rb);
          }
          case "year-desc":
            return (b.year ?? 0) - (a.year ?? 0);
          case "year-asc":
            return (a.year ?? 0) - (b.year ?? 0);
          case "rating-desc":
            return (b.tmdb_rating ?? 0) - (a.tmdb_rating ?? 0);
          case "added-desc": {
            const ta = getAddedTimestamp(a);
            const tb = getAddedTimestamp(b);
            return tb - ta || titleA.localeCompare(titleB);
          }
          default:
            return titleA.localeCompare(titleB);
        }
      });

    return useGroupedMovies ? deduplicateByTitle(matchingItems) : matchingItems;
  }, [
    deduplicateByTitle,
    filterableItems,
    filters,
    language,
    useGroupedMovies,
  ]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / ITEMS_PER_PAGE));
  const currentPage = Math.min(page, pageCount);
  const viewResetKey = `${activeTab}:${filters.search}:${filters.releaseType}:${filters.resolution}:${filters.hdr}:${filters.sort}:${tvView}:${movieView}`;
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
    call<{ default_language?: AppLanguage }>("get_config")
      .then((config) => {
        if (
          !cancelled &&
          (config.default_language === "es" || config.default_language === "en")
        ) {
          setLanguage(config.default_language);
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
    if (activeTab === "downloads") return;

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
    if (activeTab === "downloads" || badgePayload.length === 0) return;
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
          display: "flex",
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

        {/* Nav pills */}
        <div style={{ display: "flex", alignItems: "center", gap: 4, flex: 1 }}>
          {TABS.map((tab) => {
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
                <AppIcon name={tab.icon} size={16} strokeWidth={2.2} />
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

        {/* Right actions */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            marginLeft: "auto",
          }}
        >
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
                <AppIcon name="activity" size={15} strokeWidth={2.3} />
              )}
            </button>
          )}
          {/* Settings button */}
          <button
            onClick={() => setShowSettings(true)}
            title={t(language, "settings.title")}
            style={iconButton}
          >
            <AppIcon name="settings" size={16} strokeWidth={2.1} />
          </button>
        </div>
      </nav>

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
            padding: "12px 1.5rem",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            borderBottom:
              "1px solid color-mix(in srgb, var(--color-border) 60%, transparent)",
            flexShrink: 0,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <h1
              style={{
                margin: 0,
                fontSize: 18,
                fontWeight: 700,
                color: "var(--color-text)",
                letterSpacing: "-0.01em",
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
                  {filtered.length} titles
                </span>
              )}
            </h1>

            {activeTab === "tv" && (
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

            {activeTab === "movie" && (
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
            {activeTab === "downloads" ? null : selecting ? (
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
                  <AppIcon name="edit" size={14} strokeWidth={2.2} />
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
                  <AppIcon name="check-square" size={14} strokeWidth={2.2} />
                  {t(language, "library.select")}
                </button>
                <div ref={actionsMenuRef} style={{ position: "relative" }}>
                  <button
                    onClick={() => setShowActionsMenu((open) => !open)}
                    title={t(language, "library.actions")}
                    style={{ ...ghostBtn, padding: "7px 11px" }}
                  >
                    <AppIcon
                      name="more-horizontal"
                      size={16}
                      strokeWidth={2.2}
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
                        onClick={runRematchAll}
                        disabled={
                          rematching ||
                          clearingAll ||
                          refreshingLibrary ||
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
                            rematching ||
                            clearingAll ||
                            refreshingLibrary ||
                            refreshingMetadata
                              ? "default"
                              : "pointer",
                          opacity:
                            rematching ||
                            clearingAll ||
                            refreshingLibrary ||
                            refreshingMetadata
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
                            rematching ||
                            clearingAll ||
                            refreshingLibrary ||
                            refreshingMetadata
                              ? "default"
                              : "pointer",
                          opacity:
                            rematching ||
                            clearingAll ||
                            refreshingLibrary ||
                            refreshingMetadata
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

        <div style={{ flex: 1, display: "flex", minHeight: 0 }}>
          {activeTab !== "downloads" && (
            <div
              style={{
                width: 320,
                flexShrink: 0,
                padding: "1rem 0 1rem 1.5rem",
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
            {activeTab === "downloads" ? (
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
        crawlStats={crawlStats}
        activityLogOpen={showLog}
        language={language}
      />
      <DownloadFeedbackToast language={language} />
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
            bottom: 18,
            transform: "translateX(-50%)",
            display: "flex",
            justifyContent: "center",
            padding: "0 16px",
            pointerEvents: "none",
            zIndex: 45,
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
          item={selected}
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
          onUpdated={(id, patch) =>
            setSelected((s) => (s && s.id === id ? { ...s, ...patch } : s))
          }
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
        />
      )}

      {tvShow && (
        <TVShowPanel
          show={tvShow}
          allEpisodes={getTvEpisodes(tvShow)}
          language={language}
          onClose={() => setTvShow(null)}
          onDownload={startDownload}
          onDownloadSeason={handleDownloadSeason}
          downloadMap={downloadMap}
          isDownloadPending={isDownloadPending}
          downloadedBadgeMap={badgeMap}
          onDevCheckInLibrary={recheckBadgeForItem}
          onFixMatch={(episodes) => {
            const [first] = episodes;
            setFixMatchRequest({
              itemIds: episodes.map((episode) => episode.id),
              initialQuery: getLocalizedTitle(first ?? tvShow, language),
              initialMediaType:
                tvShow.media_type === "documentary" ? "documentary" : "tv",
            });
          }}
        />
      )}

      {fixMatchRequest && (
        <FixMatchModal
          itemIds={fixMatchRequest.itemIds}
          initialQuery={fixMatchRequest.initialQuery}
          initialMediaType={fixMatchRequest.initialMediaType}
          language={language}
          onApply={() => {}}
          onClose={() => setFixMatchRequest(null)}
        />
      )}

      {showBulkFix && (
        <FixMatchModal
          itemIds={Array.from(checkedIds)}
          initialQuery=""
          language={language}
          onApply={() => {}}
          onClose={() => {
            setShowBulkFix(false);
            exitSelect();
          }}
        />
      )}

      {showDevLog && showLog && (
        <ActivityLog language={language} entries={log} onClear={clearLog} />
      )}
    </div>
  );
}
