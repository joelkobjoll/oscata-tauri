import { useMemo, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { PlexIcon, EmbyIcon } from "./ServerIcons";
import type { MediaItem } from "../hooks/useIndexing";
import type { DownloadItem } from "../hooks/useDownloads";
import AppIcon from "./AppIcon";
import WatchlistButton from "../features/watchlist/WatchlistButton";
import type { AddWatchlistParams } from "../features/watchlist/types";
import {
  AppLanguage,
  getLocalizedOverview,
  getLocalizedPosterPath,
  getLocalizedTitle,
} from "../utils/mediaLanguage";
import { t } from "../utils/i18n";
import { GENRE_MAP } from "../utils/genres";

function getGroupFolder(ftpPath: string): string {
  return ftpPath.split("/").slice(-2, -1)[0] ?? "";
}

interface ParsedEpisodeTokens {
  season: number | null;
  episode: number | null;
  episodeEnd: number | null;
}

function parseSeasonEpisodeTokens(raw: string): ParsedEpisodeTokens {
  const text = raw.replace(/[._]/g, " ");
  const se = text.match(
    /\bS(\d{1,3})[\s-]*E(\d{1,3})(?:\s*[-~]\s*E?(\d{1,3})|[\s-]*E(\d{1,3}))?\b/i,
  );
  if (se) {
    let season = Number(se[1]);
    if (season > 0 && season % 100 === 0) season = season / 100;
    return {
      season,
      episode: Number(se[2]),
      episodeEnd:
        se[3] != null ? Number(se[3]) : se[4] != null ? Number(se[4]) : null,
    };
  }

  const x = text.match(/\b(\d{1,2})x(\d{1,3})(?:\s*[-~]\s*(\d{1,3}))?\b/i);
  if (x) {
    return {
      season: Number(x[1]),
      episode: Number(x[2]),
      episodeEnd: x[3] != null ? Number(x[3]) : null,
    };
  }

  const sOnly = text.match(/\b(?:S|SEASON[\s-]*|TEMPORADA[\s-]*)(\d{1,3})\b/i);
  if (sOnly) {
    let sOnlySeason = Number(sOnly[1]);
    if (sOnlySeason > 0 && sOnlySeason % 100 === 0)
      sOnlySeason = sOnlySeason / 100;
    const epOnly = text.match(
      /(?:^|\s)(?:E|EP|EPISODE|CAP(?:ITULO)?)[\s-]?(\d{1,3})(?:\s*[-~]\s*(?:E|EP|EPISODE|CAP(?:ITULO)?)?[\s-]?(\d{1,3}))?\b/i,
    );
    if (epOnly) {
      return {
        season: sOnlySeason,
        episode: Number(epOnly[1]),
        episodeEnd: epOnly[2] != null ? Number(epOnly[2]) : null,
      };
    }

    const leadingEp = text.match(/^\s*0*(\d{1,3})\b(?:\s*[-._]\s*|\s+)/i);
    return {
      season: sOnlySeason,
      episode: leadingEp ? Number(leadingEp[1]) : null,
      episodeEnd: null,
    };
  }

  const epOnly = text.match(
    /(?:^|\s)(?:E|EP|EPISODE|CAP(?:ITULO)?)[\s-]?(\d{1,3})(?:\s*[-~]\s*(?:E|EP|EPISODE|CAP(?:ITULO)?)?[\s-]?(\d{1,3}))?\b/i,
  );
  if (epOnly) {
    return {
      season: null,
      episode: Number(epOnly[1]),
      episodeEnd: epOnly[2] != null ? Number(epOnly[2]) : null,
    };
  }

  return { season: null, episode: null, episodeEnd: null };
}

function resolvedSeason(item: MediaItem): number | null {
  if (item.season != null) return item.season;
  const fromName = parseSeasonEpisodeTokens(item.filename).season;
  if (fromName != null) return fromName;
  return parseSeasonEpisodeTokens(item.ftp_path).season;
}

function resolvedEpisodeData(item: MediaItem): {
  episode: number | null;
  episodeEnd: number | null;
} {
  if (item.episode != null || item.episode_end != null) {
    return {
      episode: item.episode ?? null,
      episodeEnd: item.episode_end ?? null,
    };
  }
  const fromName = parseSeasonEpisodeTokens(item.filename);
  if (fromName.episode != null || fromName.episodeEnd != null) {
    return { episode: fromName.episode, episodeEnd: fromName.episodeEnd };
  }
  const fromPath = parseSeasonEpisodeTokens(item.ftp_path);
  return { episode: fromPath.episode, episodeEnd: fromPath.episodeEnd };
}

interface ReleaseGroup {
  folderName: string;
  resolution: string | null;
  release_type: string | null;
}

const RELEASE_ORDER = [
  "BDREMUX",
  "BluRay",
  "WEB-DL",
  "WEBRip",
  "HDTV",
  "BDRip",
  "DVDRip",
  "CAM",
];
const RES_ORDER = ["2160P", "1080P", "720P", "480P"];
const TMDB_IMG = "https://image.tmdb.org/t/p/w500";

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

function groupSortKey(group: ReleaseGroup): string {
  const res =
    RES_ORDER.indexOf(group.resolution ?? "") >= 0
      ? String(RES_ORDER.indexOf(group.resolution ?? "")).padStart(2, "0")
      : "99";
  const rel =
    RELEASE_ORDER.indexOf(group.release_type ?? "") >= 0
      ? String(RELEASE_ORDER.indexOf(group.release_type ?? "")).padStart(2, "0")
      : "99";
  return `${res}-${rel}-${group.folderName.toLowerCase()}`;
}

function miniBadge(bg: string, text: string, fg = "var(--color-text)") {
  return (
    <span
      key={`${bg}-${text}`}
      style={{
        background: bg,
        color: fg,
        borderRadius: 999,
        padding: "0.16rem 0.46rem",
        fontSize: 11,
        fontWeight: 600,
        border:
          "1px solid color-mix(in srgb, var(--color-border) 55%, transparent)",
      }}
    >
      {text}
    </span>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 4,
        padding: "0.8rem 0.9rem",
        minWidth: 110,
        borderRadius: "var(--radius-lg)",
        border:
          "1px solid color-mix(in srgb, var(--color-border) 75%, transparent)",
        background:
          "linear-gradient(155deg, color-mix(in srgb, var(--color-surface) 88%, var(--color-bg) 12%), color-mix(in srgb, var(--color-surface-2) 82%, var(--color-bg) 18%))",
        boxShadow:
          "0 16px 36px color-mix(in srgb, black 20%, transparent), inset 0 1px 0 color-mix(in srgb, white 4%, transparent)",
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
        {label}
      </span>
      <span
        style={{ fontSize: 15, fontWeight: 700, color: "var(--color-text)" }}
      >
        {value}
      </span>
    </div>
  );
}

function IconActionButton({
  title,
  icon,
  tone = "muted",
  onClick,
  disabled,
}: {
  title: string;
  icon: Parameters<typeof AppIcon>[0]["name"];
  tone?: "muted" | "primary" | "danger";
  onClick?: () => void;
  disabled?: boolean;
}) {
  const color =
    tone === "primary"
      ? "#fff"
      : tone === "danger"
        ? "var(--color-danger)"
        : "var(--color-text-muted)";
  const background =
    tone === "primary"
      ? "var(--color-primary)"
      : "color-mix(in srgb, var(--color-surface-2) 75%, transparent)";

  return (
    <button
      title={title}
      onClick={onClick}
      disabled={disabled}
      style={{
        width: 36,
        height: 36,
        borderRadius: 999,
        border:
          tone === "danger"
            ? "1px solid color-mix(in srgb, var(--color-danger) 45%, transparent)"
            : tone === "primary"
              ? "none"
              : "1px solid color-mix(in srgb, var(--color-border) 85%, transparent)",
        background,
        color,
        cursor: disabled ? "default" : "pointer",
        opacity: disabled ? 0.55 : 1,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <AppIcon name={icon} size={16} strokeWidth={2.3} />
    </button>
  );
}

function EpisodeRow({
  episode,
  language,
  onDownload,
  onFixMatch,
  downloadMap,
  isDownloadPending,
  downloadedBadgeMap,
}: {
  episode: MediaItem;
  language: AppLanguage;
  onDownload: (item: MediaItem) => void;
  onFixMatch: (items: MediaItem[]) => void;
  downloadMap: Map<string, DownloadItem>;
  isDownloadPending: (ftpPath: string) => boolean;
  downloadedBadgeMap: Record<
    number,
    {
      downloaded?: boolean;
      inEmby?: boolean;
      plexInLibrary?: boolean;
      embyInLibrary?: boolean;
      cache?: string;
      debug?: string;
    }
  >;
}) {
  const episodeData = resolvedEpisodeData(episode);
  const season = resolvedSeason(episode);
  const epLabel =
    episodeData.episode != null
      ? `E${String(episodeData.episode).padStart(2, "0")}${episodeData.episodeEnd != null ? `-E${String(episodeData.episodeEnd).padStart(2, "0")}` : ""}`
      : t(language, "tv.episodeUnknown");
  const langs =
    episode.languages
      ?.split(",")
      .map((l) => l.trim())
      .filter(Boolean) ?? [];

  const downloadItem = downloadMap.get(episode.ftp_path);
  const isDownloading =
    isDownloadPending(episode.ftp_path) ||
    downloadItem?.status === "queued" ||
    downloadItem?.status === "downloading";
  const isDownloaded =
    downloadItem?.status === "done" ||
    downloadedBadgeMap[episode.id]?.downloaded === true;
  const inPlex = downloadedBadgeMap[episode.id]?.plexInLibrary === true;
  const inEmby = downloadedBadgeMap[episode.id]?.embyInLibrary === true;
  const downloadTooltip = isDownloaded
    ? t(language, "detail.alreadyDownloadedHint")
    : isDownloading
      ? t(language, "downloads.downloading")
      : t(language, "tv.downloadEpisode");

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "84px minmax(0, 1fr) auto auto",
        gap: 12,
        alignItems: "center",
        padding: "0.9rem 1rem",
        borderBottom:
          "1px solid color-mix(in srgb, var(--color-border) 60%, transparent)",
        background: "transparent",
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        <span
          style={{
            fontSize: 13,
            fontWeight: 700,
            color: "var(--color-primary)",
          }}
        >
          {epLabel}
        </span>
        {season != null && (
          <span style={{ fontSize: 11, color: "var(--color-text-muted)" }}>
            {t(language, "tv.seasonLabel", { season })}
          </span>
        )}
      </div>

      <div style={{ minWidth: 0 }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 5,
            minWidth: 0,
          }}
        >
          {inPlex && <PlexIcon size={13} />}
          {inEmby && <EmbyIcon size={13} />}
          <div
            style={{
              fontSize: 14,
              fontWeight: 600,
              color: "var(--color-text)",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
              minWidth: 0,
            }}
          >
            {episode.title ?? episode.filename}
          </div>
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
          {episode.filename}
        </div>
        {import.meta.env.DEV && (
          <div
            style={{
              fontSize: 11,
              color: "var(--color-primary)",
              fontFamily: "monospace",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
              opacity: 0.7,
            }}
            title={episode.ftp_path}
          >
            {episode.ftp_path}
          </div>
        )}
      </div>

      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 6,
          justifyContent: "flex-end",
        }}
      >
        {episode.release_type &&
          miniBadge(
            RELEASE_TYPE_COLORS[episode.release_type] ?? "var(--color-surface)",
            episode.release_type,
            "#fff",
          )}
        {episode.resolution &&
          miniBadge("var(--color-surface-2)", episode.resolution)}
        {episode.codec && miniBadge("var(--color-surface-2)", episode.codec)}
        {episode.hdr &&
          miniBadge(
            "color-mix(in srgb, var(--color-primary) 20%, var(--color-surface-2))",
            episode.hdr,
            "var(--color-primary)",
          )}
        {langs
          .slice(0, 2)
          .map((lang) =>
            miniBadge(
              LANG_COLORS[lang] ?? "var(--color-surface-2)",
              lang,
              "#fff",
            ),
          )}
      </div>

      <div style={{ display: "flex", gap: 8 }}>
        <IconActionButton
          title={t(language, "library.fixMatch")}
          icon="edit"
          onClick={() => onFixMatch([episode])}
        />
        <IconActionButton
          title={downloadTooltip}
          icon="download"
          tone={isDownloaded ? "muted" : "primary"}
          onClick={() => onDownload(episode)}
          disabled={isDownloading || isDownloaded}
        />
      </div>
    </div>
  );
}

function GroupHeader({
  group,
  count,
  language,
  onDownloadGroup,
  disabled,
}: {
  group: ReleaseGroup;
  count: number;
  language: AppLanguage;
  onDownloadGroup: () => void;
  disabled: boolean;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "0.7rem 1rem",
        background:
          "color-mix(in srgb, var(--color-surface-2) 55%, transparent)",
        borderBottom:
          "1px solid color-mix(in srgb, var(--color-border) 60%, transparent)",
      }}
    >
      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 8,
          minWidth: 0,
          padding: "0.24rem 0.55rem",
          borderRadius: 999,
          border:
            "1px solid color-mix(in srgb, var(--color-border) 75%, transparent)",
          background: "var(--color-surface)",
          color: "var(--color-text)",
          fontFamily: "monospace",
          fontSize: 11,
          fontWeight: 600,
        }}
        title={group.folderName}
      >
        <AppIcon name="folder" size={13} strokeWidth={2.1} />
        <span
          style={{
            minWidth: 0,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            display: "inline-block",
            maxWidth: 380,
          }}
        >
          {group.folderName || t(language, "tv.unknownFolder")}
        </span>
      </span>
      <span style={{ fontSize: 12, color: "var(--color-text-muted)" }}>
        {t(language, "tv.filesCount", {
          count,
          suffix: count !== 1 ? "s" : "",
        })}
      </span>
      <button
        onClick={onDownloadGroup}
        disabled={disabled}
        style={{
          marginLeft: "auto",
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          padding: "0.38rem 0.7rem",
          borderRadius: 999,
          border: "none",
          background:
            "color-mix(in srgb, var(--color-primary) 18%, transparent)",
          color: "var(--color-primary)",
          cursor: disabled ? "default" : "pointer",
          fontSize: 12,
          fontWeight: 700,
          opacity: disabled ? 0.5 : 1,
        }}
      >
        <AppIcon name="download" size={13} strokeWidth={2.2} />
        {t(language, "tv.downloadFolder")}
      </button>
    </div>
  );
}

function SeasonGroup({
  season,
  episodes,
  language,
  onDownload,
  onDownloadSeason,
  onFixMatch,
  downloadMap,
  isDownloadPending,
  downloadedBadgeMap,
}: {
  season: number | null;
  episodes: MediaItem[];
  language: AppLanguage;
  onDownload: (item: MediaItem) => void;
  onDownloadSeason: (episodes: MediaItem[]) => void;
  onFixMatch: (items: MediaItem[]) => void;
  downloadMap: Map<string, DownloadItem>;
  isDownloadPending: (ftpPath: string) => boolean;
  downloadedBadgeMap: Record<
    number,
    {
      downloaded?: boolean;
      inEmby?: boolean;
      plexInLibrary?: boolean;
      embyInLibrary?: boolean;
      cache?: string;
      debug?: string;
    }
  >;
}) {
  const [open, setOpen] = useState(true);

  const grouped = useMemo(() => {
    const map = episodes.reduce<
      Record<string, { group: ReleaseGroup; eps: MediaItem[] }>
    >((acc, ep) => {
      const key = getGroupFolder(ep.ftp_path);
      if (!acc[key]) {
        acc[key] = {
          group: {
            folderName: key,
            resolution: ep.resolution ?? null,
            release_type: ep.release_type ?? null,
          },
          eps: [],
        };
      }
      acc[key].eps.push(ep);
      return acc;
    }, {});
    return Object.values(map).sort((a, b) =>
      groupSortKey(a.group).localeCompare(groupSortKey(b.group)),
    );
  }, [episodes]);

  const seasonLabel =
    season != null
      ? t(language, "tv.seasonLabel", {
          season: String(season).padStart(2, "0"),
        })
      : t(language, "tv.unknownSeason");
  const downloadableEpisodes = episodes.filter((episode) => {
    const downloadItem = downloadMap.get(episode.ftp_path);
    const isActive =
      isDownloadPending(episode.ftp_path) ||
      downloadItem?.status === "queued" ||
      downloadItem?.status === "downloading";
    const isDone =
      downloadItem?.status === "done" ||
      downloadedBadgeMap[episode.id]?.downloaded === true;
    return !isActive && !isDone;
  });

  return (
    <section
      style={{
        overflow: "hidden",
        borderRadius: "var(--radius-lg)",
        border:
          "1px solid color-mix(in srgb, var(--color-border) 78%, transparent)",
        background:
          "linear-gradient(155deg, color-mix(in srgb, var(--color-surface) 90%, var(--color-bg) 10%), color-mix(in srgb, var(--color-surface-2) 74%, var(--color-bg) 26%))",
        boxShadow:
          "0 12px 30px color-mix(in srgb, black 16%, transparent), inset 0 1px 0 color-mix(in srgb, white 4%, transparent)",
      }}
    >
      <div
        onClick={() => setOpen((value) => !value)}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          padding: "1rem 1rem 0.95rem",
          cursor: "pointer",
          userSelect: "none",
          borderBottom: open
            ? "1px solid color-mix(in srgb, var(--color-border) 65%, transparent)"
            : "none",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ color: "var(--color-text-muted)" }}>
            <AppIcon
              name={open ? "chevron-down" : "chevron-right"}
              size={16}
              strokeWidth={2.2}
            />
          </span>
          <div>
            <div
              style={{
                fontSize: 15,
                fontWeight: 700,
                color: "var(--color-text)",
              }}
            >
              {seasonLabel}
            </div>
            <div style={{ fontSize: 12, color: "var(--color-text-muted)" }}>
              {t(language, "tv.episodesAndGroups", {
                episodes: episodes.length,
                episodesSuffix: episodes.length !== 1 ? "s" : "",
                groups: grouped.length,
                groupsSuffix: grouped.length !== 1 ? "s" : "",
              })}
            </div>
          </div>
        </div>

        <button
          onClick={(event) => {
            event.stopPropagation();
            onDownloadSeason(downloadableEpisodes);
          }}
          disabled={downloadableEpisodes.length === 0}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            padding: "0.48rem 0.82rem",
            borderRadius: 999,
            border: "none",
            background: "var(--color-primary)",
            color: "#fff",
            cursor: downloadableEpisodes.length === 0 ? "default" : "pointer",
            fontSize: 12,
            fontWeight: 700,
            opacity: downloadableEpisodes.length === 0 ? 0.5 : 1,
          }}
        >
          <AppIcon name="download" size={13} strokeWidth={2.2} />
          {t(language, "tv.downloadSeason")}
        </button>
      </div>

      {open && (
        <div>
          {grouped.map(({ group, eps }) => (
            <div key={group.folderName}>
              {grouped.length > 1 &&
                (() => {
                  const downloadableGroupEpisodes = eps.filter((episode) => {
                    const downloadItem = downloadMap.get(episode.ftp_path);
                    const isActive =
                      isDownloadPending(episode.ftp_path) ||
                      downloadItem?.status === "queued" ||
                      downloadItem?.status === "downloading";
                    const isDone =
                      downloadItem?.status === "done" ||
                      downloadedBadgeMap[episode.id]?.downloaded === true;
                    return !isActive && !isDone;
                  });

                  return (
                    <GroupHeader
                      group={group}
                      count={eps.length}
                      language={language}
                      onDownloadGroup={() =>
                        onDownloadSeason(downloadableGroupEpisodes)
                      }
                      disabled={downloadableGroupEpisodes.length === 0}
                    />
                  );
                })()}
              {eps
                .slice()
                .sort(
                  (a, b) =>
                    (resolvedEpisodeData(a).episode ?? 0) -
                    (resolvedEpisodeData(b).episode ?? 0),
                )
                .map((episode) => (
                  <EpisodeRow
                    key={episode.id}
                    episode={episode}
                    language={language}
                    onDownload={onDownload}
                    onFixMatch={onFixMatch}
                    downloadMap={downloadMap}
                    isDownloadPending={isDownloadPending}
                    downloadedBadgeMap={downloadedBadgeMap}
                  />
                ))}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

export default function TVShowPanel({
  show,
  allEpisodes,
  language,
  onClose,
  onDownload,
  onDownloadSeason,
  onFixMatch,
  onDevCheckInLibrary,
  watchlistedTmdbIds,
  onAddToWatchlist,
  onOpenWatchlist,
  downloadMap,
  isDownloadPending,
  downloadedBadgeMap,
}: {
  show: MediaItem;
  allEpisodes: MediaItem[];
  language: AppLanguage;
  onClose: () => void;
  onDownload: (item: MediaItem) => void;
  onDownloadSeason: (episodes: MediaItem[]) => void;
  onFixMatch: (items: MediaItem[]) => void;
  onDevCheckInLibrary?: (item: MediaItem) => Promise<void>;
  watchlistedTmdbIds?: Set<number>;
  onAddToWatchlist?: (params: AddWatchlistParams) => Promise<void>;
  onOpenWatchlist?: () => void;
  downloadMap: Map<string, DownloadItem>;
  isDownloadPending: (ftpPath: string) => boolean;
  downloadedBadgeMap: Record<
    number,
    {
      downloaded?: boolean;
      inEmby?: boolean;
      plexInLibrary?: boolean;
      embyInLibrary?: boolean;
      cache?: string;
      debug?: string;
    }
  >;
}) {
  const [filterRelease, setFilterRelease] = useState("all");
  const [filterResolution, setFilterResolution] = useState("all");
  const [filterSeason, setFilterSeason] = useState("all");
  const [openingUrl, setOpeningUrl] = useState<string | null>(null);
  const [devChecking, setDevChecking] = useState(false);

  const handleOpenUrl = (url: string) => {
    setOpeningUrl(url);
    openUrl(url)
      .catch((e) => console.error("[openUrl] failed to open", url, e))
      .finally(() => setTimeout(() => setOpeningUrl(null), 2000));
  };
  const showTitle = getLocalizedTitle(show, language);
  const showOverview = getLocalizedOverview(show, language);
  const showGenres = (() => {
    const raw = show.tmdb_genres;
    if (!raw) return [];
    const ids: number[] = typeof raw === "string" ? JSON.parse(raw) : raw;
    return ids
      .map((id) => GENRE_MAP[id])
      .filter(Boolean)
      .map((key) => t(language, key as never));
  })();
  const searchTitle =
    show.tmdb_title_en ?? show.tmdb_title ?? show.title ?? showTitle;
  const searchQuery = [
    searchTitle,
    show.year ?? show.tmdb_release_date?.slice(0, 4),
  ]
    .filter(Boolean)
    .join(" ");
  const tmdbMediaType =
    show.tmdb_type ?? (show.media_type === "movie" ? "movie" : "tv");
  const tmdbUrl = show.tmdb_id
    ? `https://www.themoviedb.org/${tmdbMediaType}/${show.tmdb_id}`
    : `https://www.themoviedb.org/search?query=${encodeURIComponent(searchQuery)}`;
  const imdbUrl = show.imdb_id
    ? `https://www.imdb.com/title/${encodeURIComponent(show.imdb_id)}/`
    : `https://www.imdb.com/find/?q=${encodeURIComponent(searchQuery)}&s=tt`;
  const externalLinkBtn: React.CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    minWidth: 0,
    padding: "0.52rem 0.82rem",
    borderRadius: "var(--radius-full)",
    border:
      "1px solid color-mix(in srgb, var(--color-border) 78%, transparent)",
    background: "color-mix(in srgb, var(--color-surface-2) 76%, transparent)",
    color: "var(--color-text)",
    cursor: "pointer",
    fontSize: 12,
    fontWeight: 700,
  };
  const showDevMeta = import.meta.env.DEV;
  const showBadge = downloadedBadgeMap[show.id];

  const releaseTypes = [
    ...new Set(allEpisodes.map((ep) => ep.release_type).filter(Boolean)),
  ] as string[];
  const resolutions = [
    ...new Set(allEpisodes.map((ep) => ep.resolution).filter(Boolean)),
  ] as string[];
  const seasonsAvailable = [
    ...new Set(
      allEpisodes
        .map((ep) => resolvedSeason(ep))
        .filter((s): s is number => s != null),
    ),
  ].sort((a, b) => a - b);
  const actualSeasonCount = seasonsAvailable.length;
  resolutions.sort((a, b) => {
    const ai = RES_ORDER.indexOf(a);
    const bi = RES_ORDER.indexOf(b);
    return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
  });

  const filtered = allEpisodes.filter((ep) => {
    if (filterRelease !== "all" && ep.release_type !== filterRelease)
      return false;
    if (filterResolution !== "all" && ep.resolution !== filterResolution)
      return false;
    if (
      filterSeason !== "all" &&
      String(resolvedSeason(ep) ?? "") !== filterSeason
    )
      return false;
    return true;
  });
  const downloadableFiltered = filtered.filter((episode) => {
    const downloadItem = downloadMap.get(episode.ftp_path);
    const isActive =
      isDownloadPending(episode.ftp_path) ||
      downloadItem?.status === "queued" ||
      downloadItem?.status === "downloading";
    const isDone =
      downloadItem?.status === "done" ||
      downloadedBadgeMap[episode.id]?.downloaded === true;
    return !isActive && !isDone;
  });

  const filteredBySeason = filtered.reduce<Record<string, MediaItem[]>>(
    (acc, ep) => {
      const season = resolvedSeason(ep);
      const key = season != null ? String(season) : "null";
      (acc[key] ??= []).push(ep);
      return acc;
    },
    {},
  );

  const seasonKeys = Object.keys(filteredBySeason).sort((a, b) =>
    a === "null" ? 1 : b === "null" ? -1 : Number(a) - Number(b),
  );

  const showFiltersCard =
    releaseTypes.length > 1 ||
    resolutions.length > 1 ||
    seasonsAvailable.length > 1;

  const filterPillBase: React.CSSProperties = {
    padding: "0.34rem 0.72rem",
    borderRadius: 999,
    fontWeight: 700,
    fontSize: 12,
    cursor: "pointer",
    border:
      "1px solid color-mix(in srgb, var(--color-border) 80%, transparent)",
    background: "var(--color-surface)",
    color: "var(--color-text-muted)",
  };

  const heroPosterPath = getLocalizedPosterPath(show, language);
  const heroPoster = heroPosterPath ? `${TMDB_IMG}${heroPosterPath}` : null;

  return (
    <>
      <div
        onClick={onClose}
        style={{
          position: "fixed",
          inset: 0,
          background: "color-mix(in srgb, black 62%, transparent)",
          backdropFilter: "blur(4px)",
          zIndex: "var(--z-tv-backdrop)",
        }}
      />

      <aside
        className="panel-slide-right"
        style={{
          position: "fixed",
          top: 0,
          right: 0,
          bottom: 0,
          width: "min(920px, calc(100vw - 24px))",
          background: "var(--color-bg)",
          borderLeft:
            "1px solid color-mix(in srgb, var(--color-border) 78%, transparent)",
          boxShadow: "-4px 0 36px color-mix(in srgb, black 48%, transparent)",
          zIndex: "var(--z-tv-panel)",
          overflowY: "auto",
        }}
      >
        <div
          style={{
            position: "relative",
            overflow: "hidden",
            borderBottom:
              "1px solid color-mix(in srgb, var(--color-border) 65%, transparent)",
          }}
        >
          {heroPoster && (
            <div
              style={{
                position: "absolute",
                inset: "1.4rem auto auto -4rem",
                width: "min(42vw, 28rem)",
                height: "20rem",
                opacity: 0.16,
                backgroundImage: `url(${heroPoster})`,
                backgroundSize: "cover",
                backgroundPosition: "center",
                filter: "blur(42px) saturate(120%)",
                transform: "scale(1.08)",
                pointerEvents: "none",
              }}
            />
          )}

          <div
            style={{
              position: "absolute",
              inset: "1.6rem -10% auto 22%",
              height: "14rem",
              background:
                "radial-gradient(circle, color-mix(in srgb, var(--color-primary) 14%, transparent), transparent 72%)",
              filter: "blur(10px)",
              pointerEvents: "none",
            }}
          />

          <div
            style={{
              position: "relative",
              padding: "1.5rem 1.5rem 1.25rem",
              display: "grid",
              gridTemplateColumns: "minmax(180px, 220px) minmax(0, 1fr)",
              gap: "1.4rem",
              alignItems: "start",
            }}
          >
            <div>
              {heroPoster ? (
                <img
                  src={heroPoster}
                  alt={showTitle}
                  style={{
                    width: "100%",
                    aspectRatio: "2 / 3",
                    objectFit: "cover",
                    borderRadius: "calc(var(--radius-lg) + 0.15rem)",
                    boxShadow:
                      "0 20px 46px color-mix(in srgb, black 34%, transparent)",
                    border:
                      "1px solid color-mix(in srgb, var(--color-border) 70%, transparent)",
                  }}
                />
              ) : (
                <div
                  style={{
                    width: "100%",
                    aspectRatio: "2 / 3",
                    borderRadius: "calc(var(--radius-lg) + 0.15rem)",
                    background: "var(--color-surface-2)",
                    border:
                      "1px solid color-mix(in srgb, var(--color-border) 70%, transparent)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    color: "var(--color-text-muted)",
                  }}
                >
                  <AppIcon name="tv" size={38} strokeWidth={1.8} />
                </div>
              )}
            </div>

            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "1rem",
                minWidth: 0,
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  gap: 12,
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <div
                    style={{
                      fontSize: 12,
                      fontWeight: 700,
                      letterSpacing: "0.08em",
                      textTransform: "uppercase",
                      color: "var(--color-text-muted)",
                      marginBottom: 8,
                    }}
                  >
                    {t(language, "tv.show")}
                  </div>
                  <h2
                    style={{
                      margin: 0,
                      fontSize: "clamp(2rem, 4vw, 2.8rem)",
                      lineHeight: 0.98,
                      letterSpacing: "-0.045em",
                      color: "var(--color-text)",
                    }}
                  >
                    {showTitle}
                  </h2>
                </div>

                <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
                  {show.tmdb_id != null &&
                    watchlistedTmdbIds &&
                    onAddToWatchlist && (
                      <WatchlistButton
                        tmdbId={show.tmdb_id}
                        tmdbType="tv"
                        title={showTitle}
                        titleEn={
                          show.tmdb_title_en ??
                          show.tmdb_title ??
                          show.title ??
                          showTitle
                        }
                        poster={show.tmdb_poster}
                        year={
                          show.year ??
                          (show.tmdb_release_date
                            ? new Date(show.tmdb_release_date).getFullYear()
                            : undefined)
                        }
                        language={language}
                        watchlistedTmdbIds={watchlistedTmdbIds}
                        onAdd={onAddToWatchlist}
                        onNavigateToWatchlist={onOpenWatchlist}
                      />
                    )}
                  <IconActionButton
                    title={t(language, "tv.downloadAllVisible")}
                    icon="download"
                    tone="primary"
                    onClick={() => onDownloadSeason(downloadableFiltered)}
                    disabled={downloadableFiltered.length === 0}
                  />
                  <IconActionButton
                    title={t(language, "tv.close")}
                    icon="close"
                    onClick={onClose}
                  />
                </div>
              </div>

              <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
                <StatCard
                  label={t(language, "tv.seasons")}
                  value={String(actualSeasonCount || 0)}
                />
                <StatCard
                  label={t(language, "tv.episodes")}
                  value={String(allEpisodes.length)}
                />
                <StatCard
                  label={t(language, "tv.groups")}
                  value={String(
                    new Set(
                      allEpisodes.map(
                        (ep) =>
                          getGroupFolder(ep.ftp_path) ||
                          t(language, "tv.unknownFolder"),
                      ),
                    ).size,
                  )}
                />
                {show.tmdb_rating != null && (
                  <StatCard label="TMDB" value={show.tmdb_rating.toFixed(1)} />
                )}
              </div>

              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                {(show.tmdb_release_date || show.year) &&
                  miniBadge(
                    "color-mix(in srgb, var(--color-surface-2) 68%, transparent)",
                    String(
                      show.tmdb_release_date
                        ? new Date(show.tmdb_release_date).getFullYear()
                        : show.year,
                    ),
                  )}
                {show.tmdb_rating != null &&
                  miniBadge(
                    "color-mix(in srgb, var(--color-primary) 18%, transparent)",
                    `TMDB ${show.tmdb_rating.toFixed(1)}`,
                    "var(--color-primary)",
                  )}
                {show.media_type &&
                  miniBadge("var(--color-surface-2)", show.media_type)}
                {showGenres.map((g) =>
                  miniBadge(
                    "color-mix(in srgb, var(--color-teal) 14%, transparent)",
                    g,
                    "var(--color-teal)",
                  ),
                )}
                {showBadge?.plexInLibrary && (
                  <span
                    title="In Plex"
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      padding: "0.2rem",
                      borderRadius: 6,
                      background: "#282a2d",
                      border: "1px solid #282a2d",
                    }}
                  >
                    <PlexIcon size={14} />
                  </span>
                )}
                {showBadge?.embyInLibrary && (
                  <span
                    title="In Emby"
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      padding: "0.2rem",
                      borderRadius: 6,
                      background:
                        "color-mix(in srgb, var(--color-border) 55%, transparent)",
                      border:
                        "1px solid color-mix(in srgb, var(--color-border) 80%, transparent)",
                    }}
                  >
                    <EmbyIcon size={14} />
                  </span>
                )}
              </div>

              <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
                <button
                  onClick={() => onFixMatch(filtered)}
                  disabled={filtered.length === 0}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 8,
                    padding: "0.78rem 1rem",
                    borderRadius: "var(--radius-full)",
                    border:
                      "1px solid color-mix(in srgb, var(--color-primary) 38%, transparent)",
                    background:
                      "color-mix(in srgb, var(--color-primary) 14%, transparent)",
                    color:
                      filtered.length === 0
                        ? "var(--color-text-muted)"
                        : "var(--color-primary)",
                    cursor: filtered.length === 0 ? "default" : "pointer",
                    opacity: filtered.length === 0 ? 0.5 : 1,
                    fontSize: 13,
                    fontWeight: 700,
                  }}
                >
                  <AppIcon name="edit" size={15} strokeWidth={2.2} />
                  {filtered.length === allEpisodes.length
                    ? t(language, "tv.fixShow")
                    : t(language, "tv.fixVisible")}
                </button>
                <button
                  onClick={() => handleOpenUrl(tmdbUrl)}
                  style={{
                    ...externalLinkBtn,
                    ...(openingUrl === tmdbUrl && { opacity: 0.6 }),
                  }}
                  title={tmdbUrl}
                >
                  {openingUrl === tmdbUrl
                    ? "↗ …"
                    : t(language, "detail.openTmdb")}
                </button>
                <button
                  onClick={() => handleOpenUrl(imdbUrl)}
                  style={{
                    ...externalLinkBtn,
                    ...(openingUrl === imdbUrl && { opacity: 0.6 }),
                  }}
                  title={imdbUrl}
                >
                  {openingUrl === imdbUrl
                    ? "↗ …"
                    : t(language, "detail.openImdb")}
                </button>
              </div>

              {showDevMeta && (
                <div
                  style={{
                    marginTop: 2,
                    padding: "0.65rem 0.8rem",
                    borderRadius: "var(--radius)",
                    border:
                      "1px solid color-mix(in srgb, var(--color-border) 78%, transparent)",
                    background:
                      "color-mix(in srgb, var(--color-surface-2) 72%, transparent)",
                    fontFamily: "monospace",
                    fontSize: 11,
                    color: "var(--color-text-muted)",
                    display: "grid",
                    gap: 2,
                    maxWidth: "100%",
                  }}
                >
                  <div>debug.item_id: {show.id}</div>
                  <div>debug.ftp_path: {show.ftp_path}</div>
                  <div>debug.filename: {show.filename}</div>
                  <div>debug.imdb_id: {show.imdb_id ?? "-"}</div>
                  <div>debug.tmdb_id: {show.tmdb_id ?? "-"}</div>
                  <div>
                    debug.badge.in_library:{" "}
                    {showBadge?.inEmby ? "true" : "false"}
                  </div>
                  <div>
                    debug.badge.plex:{" "}
                    {showBadge?.plexInLibrary ? "true" : "false"}
                  </div>
                  <div>
                    debug.badge.emby:{" "}
                    {showBadge?.embyInLibrary ? "true" : "false"}
                  </div>
                  <div>debug.badge.cache: {showBadge?.cache ?? "-"}</div>
                  <div>debug.badge.reason: {showBadge?.debug ?? "-"}</div>
                  {onDevCheckInLibrary && (
                    <button
                      onClick={() => {
                        setDevChecking(true);
                        onDevCheckInLibrary(show)
                          .catch(() => {})
                          .finally(() => setDevChecking(false));
                      }}
                      disabled={devChecking}
                      style={{
                        marginTop: 6,
                        padding: "6px 9px",
                        borderRadius: "var(--radius)",
                        border:
                          "1px solid color-mix(in srgb, var(--color-primary) 50%, transparent)",
                        background:
                          "color-mix(in srgb, var(--color-primary) 14%, transparent)",
                        color: "var(--color-primary)",
                        cursor: devChecking ? "default" : "pointer",
                        fontSize: 11,
                        fontWeight: 700,
                        width: "fit-content",
                        opacity: devChecking ? 0.7 : 1,
                      }}
                    >
                      {devChecking ? "Checking…" : "Check In Library (dev)"}
                    </button>
                  )}
                </div>
              )}

              {showOverview && (
                <p
                  style={{
                    margin: 0,
                    maxWidth: "72ch",
                    fontSize: "0.96rem",
                    lineHeight: 1.7,
                    color:
                      "color-mix(in srgb, var(--color-text) 78%, var(--color-text-muted))",
                  }}
                >
                  {showOverview}
                </p>
              )}
            </div>
          </div>
        </div>

        <div
          style={{
            padding: "1rem 1.5rem 1.5rem",
            display: "flex",
            flexDirection: "column",
            gap: 16,
          }}
        >
          {showFiltersCard && (
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 10,
                padding: "1rem",
                borderRadius: "var(--radius-lg)",
                border:
                  "1px solid color-mix(in srgb, var(--color-border) 78%, transparent)",
                background:
                  "color-mix(in srgb, var(--color-surface) 90%, transparent)",
                boxShadow:
                  "0 12px 30px color-mix(in srgb, black 16%, transparent)",
              }}
            >
              {releaseTypes.length > 1 && (
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    flexWrap: "wrap",
                  }}
                >
                  <span
                    style={{
                      fontSize: 11,
                      fontWeight: 700,
                      letterSpacing: "0.06em",
                      textTransform: "uppercase",
                      color: "var(--color-text-muted)",
                      minWidth: 62,
                    }}
                  >
                    {t(language, "tv.source")}
                  </span>
                  {["all", ...releaseTypes].map((release) => (
                    <button
                      key={release}
                      onClick={() => setFilterRelease(release)}
                      style={{
                        ...filterPillBase,
                        background:
                          filterRelease === release
                            ? "var(--color-primary)"
                            : "var(--color-surface-2)",
                        color:
                          filterRelease === release
                            ? "#fff"
                            : "var(--color-text-muted)",
                        borderColor:
                          filterRelease === release
                            ? "var(--color-primary)"
                            : "color-mix(in srgb, var(--color-border) 80%, transparent)",
                      }}
                    >
                      {release === "all" ? t(language, "common.all") : release}
                    </button>
                  ))}
                </div>
              )}

              {resolutions.length > 1 && (
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    flexWrap: "wrap",
                  }}
                >
                  <span
                    style={{
                      fontSize: 11,
                      fontWeight: 700,
                      letterSpacing: "0.06em",
                      textTransform: "uppercase",
                      color: "var(--color-text-muted)",
                      minWidth: 62,
                    }}
                  >
                    {t(language, "tv.quality")}
                  </span>
                  {["all", ...resolutions].map((resolution) => (
                    <button
                      key={resolution}
                      onClick={() => setFilterResolution(resolution)}
                      style={{
                        ...filterPillBase,
                        background:
                          filterResolution === resolution
                            ? "var(--color-primary)"
                            : "var(--color-surface-2)",
                        color:
                          filterResolution === resolution
                            ? "#fff"
                            : "var(--color-text-muted)",
                        borderColor:
                          filterResolution === resolution
                            ? "var(--color-primary)"
                            : "color-mix(in srgb, var(--color-border) 80%, transparent)",
                      }}
                    >
                      {resolution === "all"
                        ? t(language, "common.all")
                        : resolution}
                    </button>
                  ))}
                </div>
              )}

              {seasonsAvailable.length > 1 && (
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    flexWrap: "wrap",
                  }}
                >
                  <span
                    style={{
                      fontSize: 11,
                      fontWeight: 700,
                      letterSpacing: "0.06em",
                      textTransform: "uppercase",
                      color: "var(--color-text-muted)",
                      minWidth: 62,
                    }}
                  >
                    {t(language, "tv.season")}
                  </span>
                  <button
                    onClick={() => setFilterSeason("all")}
                    style={{
                      ...filterPillBase,
                      background:
                        filterSeason === "all"
                          ? "var(--color-primary)"
                          : "var(--color-surface-2)",
                      color:
                        filterSeason === "all"
                          ? "#fff"
                          : "var(--color-text-muted)",
                      borderColor:
                        filterSeason === "all"
                          ? "var(--color-primary)"
                          : "color-mix(in srgb, var(--color-border) 80%, transparent)",
                    }}
                  >
                    {t(language, "common.all")}
                  </button>
                  {seasonsAvailable.map((season) => (
                    <button
                      key={season}
                      onClick={() => setFilterSeason(String(season))}
                      style={{
                        ...filterPillBase,
                        background:
                          filterSeason === String(season)
                            ? "var(--color-primary)"
                            : "var(--color-surface-2)",
                        color:
                          filterSeason === String(season)
                            ? "#fff"
                            : "var(--color-text-muted)",
                        borderColor:
                          filterSeason === String(season)
                            ? "var(--color-primary)"
                            : "color-mix(in srgb, var(--color-border) 80%, transparent)",
                      }}
                    >
                      S{String(season).padStart(2, "0")}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {seasonKeys.length === 0 ? (
            <div
              style={{
                textAlign: "center",
                padding: "3rem 1rem",
                color: "var(--color-text-muted)",
              }}
            >
              {t(language, "tv.noEpisodesFilters")}
            </div>
          ) : (
            seasonKeys.map((key) => (
              <SeasonGroup
                key={key}
                season={key === "null" ? null : Number(key)}
                episodes={filteredBySeason[key]}
                language={language}
                onDownload={onDownload}
                onDownloadSeason={onDownloadSeason}
                onFixMatch={onFixMatch}
                downloadMap={downloadMap}
                isDownloadPending={isDownloadPending}
                downloadedBadgeMap={downloadedBadgeMap}
              />
            ))
          )}
        </div>
      </aside>
    </>
  );
}
