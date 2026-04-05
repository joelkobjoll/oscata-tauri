import { useState, useEffect, useRef, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  Film,
  Tv,
  Video,
  ChevronDown,
  ChevronUp,
  Loader2,
  AlertTriangle,
  FolderSearch,
  Search,
  Star,
  CheckCircle,
} from "lucide-react";
import Toggle from "../../components/Toggle";
import FilenameBuilder from "./FilenameBuilder";
import FtpDirPicker from "./FtpDirPicker";
import { FolderOpen, FileVideo, Folder } from "lucide-react";
import type {
  AnalysisResult,
  LocalMediaInfo,
  MediaType,
  TmdbMatch,
  UploadSuggestion,
} from "./types";
import { formatBytes, formatDuration } from "../../lib/format";
import { formInputCompact, formSelectCompact } from "../../lib/formStyles";

const TMDB_IMG = "https://image.tmdb.org/t/p/w92";

// ─── Season upload helpers ─────────────────────────────────────────────────────

const SEASON_SOURCES = [
  "",
  "WEB-DL",
  "WEB-DL Micro",
  "WEBRip",
  "BDREMUX",
  "BDRip",
  "BluRay",
  "HDTV",
  "REMUX",
];
const SEASON_RESOLUTIONS = ["", "4K", "2160p", "1080p", "720p", "480p"];
const SEASON_CODECS = ["", "HEVC", "AVC", "AV1", "VP9", "MPEG2"];

/** Parse episode number from a filename, e.g. S01E05 → 5. */
function parseEpisodeNum(name: string): number | null {
  let m = name.match(/[Ss]\d+[Ee](\d+)/);
  if (m) return parseInt(m[1], 10);
  m = name.match(/(?:^|[\s._-])(?:E|Ep)(\d{1,3})(?:[\s._-]|$)/i);
  if (m) return parseInt(m[1], 10);
  return null;
}

/** Convert detected_release_type to a SEASON_SOURCES value. */
function mapDetectedReleaseType(rt: string | null | undefined): string {
  if (!rt) return "";
  const r = rt.toUpperCase();
  if (r === "BDREMUX" || r === "BD REMUX" || r === "REMUX") return "BDREMUX";
  if (r === "BDRIP" || r === "BRRIP") return "BDRip";
  if (r === "BLURAY") return "BluRay";
  if (r === "WEB-DL" || r === "WEBDL") return "WEB-DL";
  if (r === "WEBRIP") return "WEBRip";
  if (r === "HDTV") return "HDTV";
  return "";
}

/**
 * Build a renamed episode filename.
 * e.g. → "Show.Name.S01E05.WEB-DL.1080p.HEVC.SPA.ENG.mkv"
 */
function buildEpisodeFilename(
  showName: string,
  season: number,
  epNum: number,
  source: string,
  resolution: string,
  codec: string,
  langs: string,
  ext: string,
): string {
  const parts: string[] = [];
  const sn = showName.trim();
  if (sn) parts.push(sn.replace(/\s+/g, "."));
  parts.push(
    `S${String(season).padStart(2, "0")}E${String(epNum).padStart(2, "0")}`,
  );
  if (source.trim())
    parts.push(source.trim().replace(/\s+/g, ".").toUpperCase());
  if (resolution.trim()) parts.push(resolution.trim());
  if (codec.trim()) parts.push(codec.trim());
  const langList = langs
    .split(/[,\s]+/)
    .filter(Boolean)
    .map((l) => l.toUpperCase());
  parts.push(...langList);
  return parts.join(".") + (ext ? `.${ext}` : "");
}

/** Parse resolution, codec and source from a media filename or folder path. */
function parseQualityFromFilename(name: string): {
  source: string;
  resolution: string;
  codec: string;
} {
  const u = name.toUpperCase();
  const resolution =
    SEASON_RESOLUTIONS.find((r) => r && u.includes(r.toUpperCase())) ?? "";
  // Detect codec — handle x265/x264 aliases in addition to HEVC/AVC
  let codec = "";
  if (/\bHEVC\b|\bX265\b|\bH\.?265\b/.test(u)) codec = "HEVC";
  else if (/\bAVC\b|\bX264\b|\bH\.?264\b/.test(u)) codec = "AVC";
  else
    codec = SEASON_CODECS.find((c) => c && u.includes(c.toUpperCase())) ?? "";
  let source = "";
  if (/BDREMUX|BD[\s._-]?REMUX/.test(u)) source = "BDREMUX";
  else if (/BDRIP|BRRIP/.test(u)) source = "BDRip";
  else if (/BLURAY|BLU-RAY/.test(u)) source = "BluRay";
  else if (/WEB[\s._-]?DL/.test(u)) source = "WEB-DL";
  else if (/WEBRIP/.test(u)) source = "WEBRip";
  else if (/HDTV/.test(u)) source = "HDTV";
  else if (/REMUX/.test(u)) source = "REMUX";
  return { source, resolution, codec };
}

// Known 3-letter ISO 639-2 language codes commonly found in media filenames
const KNOWN_LANGS = new Set([
  "SPA",
  "ENG",
  "FRA",
  "GER",
  "DEU",
  "ITA",
  "POR",
  "JPN",
  "KOR",
  "CHI",
  "ZHO",
  "ARA",
  "RUS",
  "TUR",
  "POL",
  "DUT",
  "NLD",
  "SWE",
  "NOR",
  "DAN",
  "FIN",
  "HEB",
  "HUN",
  "CZE",
  "SLO",
  "ROM",
  "GRE",
  "ELL",
  "THA",
  "VIE",
  "IND",
  "MAY",
  "HIN",
  "CAT",
  "LAT",
  "EUS",
  "GLG",
]);

/** Extract language codes (e.g. SPA, ENG, FRA) from a media filename or folder path. */
function parseLanguagesFromPath(name: string): string[] {
  // Split on common separators and look for known 3-letter lang codes
  const tokens = name
    .toUpperCase()
    .replace(/\.[^.]+$/, "")
    .split(/[.\s_\-()[\]/\\]+/);
  const found: string[] = [];
  for (const t of tokens) {
    if (KNOWN_LANGS.has(t) && !found.includes(t)) found.push(t);
  }
  return found;
}

/**
 * Build the flat season folder name.
 * e.g. → "Atrapadas en Bolivia (2025) S01 WEB-DL 1080p"
 */
function buildSeasonFolderName(
  showName: string,
  year: string | undefined,
  season: number,
  source: string,
  resolution: string,
): string {
  let name = showName.trim() || "Serie";
  if (year) name += ` (${year})`;
  name += ` S${String(season).padStart(2, "0")}`;
  if (source.trim()) name += ` ${source.trim()}`;
  if (resolution.trim()) name += ` ${resolution.trim()}`;
  return name;
}

interface AnalysisRowProps {
  result: AnalysisResult;
  suggestion: UploadSuggestion | null;
  isDirectory: boolean;
  tmdbMatch: TmdbMatch | null;
  onDestChange: (path: string, dest: string) => void;
  onFilenameChange: (path: string, filename: string) => void;
  onTmdbChange: (path: string, match: TmdbMatch | null) => void;
  onEpisodePlanChange?: (
    path: string,
    plan: { localPath: string; filename: string }[],
  ) => void;
}

const MEDIA_TYPE_LABELS: Record<MediaType, string> = {
  movie: "Película",
  tv: "Serie",
  documentary: "Documental",
};

const MEDIA_TYPE_ICONS: Record<MediaType, React.ReactNode> = {
  movie: <Film size={12} />,
  tv: <Tv size={12} />,
  documentary: <Video size={12} />,
};

export default function AnalysisRow({
  result,
  suggestion,
  isDirectory,
  tmdbMatch,
  onDestChange,
  onFilenameChange,
  onTmdbChange,
  onEpisodePlanChange,
}: AnalysisRowProps) {
  const { path, filename, info, error } = result;

  const [mediaType, setMediaType] = useState<MediaType>(
    suggestion?.media_type ?? "movie",
  );
  const [dest, setDest] = useState(suggestion?.dest ?? "");
  const [showName, setShowName] = useState(
    suggestion?.detected_title ??
      filename.replace(/\.[^.]+$/, "").replace(/[._]/g, " "),
  );
  const [season, setSeason] = useState(suggestion?.detected_season ?? 1);
  const [episode, setEpisode] = useState(suggestion?.detected_episode ?? 1);
  // For TV: is this a full-season/show folder upload or a single episode?
  const [tvUploadMode, setTvUploadMode] = useState<"season" | "episode">(
    isDirectory || suggestion?.detected_episode == null ? "season" : "episode",
  );
  const [rename, setRename] = useState(true);
  const [expanded, setExpanded] = useState(true);
  const [showBrowser, setShowBrowser] = useState(false);

  // TV season dir quality fields — used to name the folder and episode files
  const [seasonSource, setSeasonSource] = useState(() =>
    mapDetectedReleaseType(suggestion?.detected_release_type),
  );
  const [seasonResolution, setSeasonResolution] = useState(
    info?.resolution ?? suggestion?.detected_resolution ?? "",
  );
  const [seasonCodec, setSeasonCodec] = useState(
    info?.codec ?? suggestion?.detected_codec ?? "",
  );
  const [seasonLangs, setSeasonLangs] = useState(() =>
    (info?.languages?.length
      ? info.languages
      : (suggestion?.detected_languages ?? [])
    )
      .map((l) => l.toUpperCase())
      .join(", "),
  );
  // Tracks whether the user has manually edited the FTP destination field
  const destTouchedRef = useRef(false);
  // tmdbSelected is declared here (before the effects that reference it)
  const [tmdbSelected, setTmdbSelected] = useState<TmdbMatch | null>(tmdbMatch);

  // For TV season directories: list the video files inside for preview.
  const [episodeFiles, setEpisodeFiles] = useState<string[]>([]);
  useEffect(() => {
    if (isDirectory && mediaType === "tv") {
      invoke<string[]>("list_local_video_files", { dir: path })
        .then(setEpisodeFiles)
        .catch(() => setEpisodeFiles([]));
    }
  }, [isDirectory, mediaType, path]);

  // When ffprobe data arrives, fill in quality fields that are still empty
  useEffect(() => {
    if (mediaType !== "tv" || !info) return;
    if (info.resolution && !seasonResolution)
      setSeasonResolution(info.resolution);
    if (info.codec && !seasonCodec) setSeasonCodec(info.codec);
    const l = info.languages
      .filter(Boolean)
      .map((x) => x.toUpperCase())
      .join(", ");
    if (l && !seasonLangs) setSeasonLangs(l);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [info]);

  // When episode files load, run ffprobe on the first episode to get real metadata.
  // Falls back to filename parsing when ffprobe is unavailable (info === null from parent).
  useEffect(() => {
    if (!isDirectory || mediaType !== "tv" || episodeFiles.length === 0) return;

    const firstEp = episodeFiles[0];

    // Try ffprobe on the first actual episode file
    invoke<LocalMediaInfo>("analyze_local_file", { path: firstEp })
      .then((epInfo) => {
        if (epInfo.resolution && !seasonResolution)
          setSeasonResolution(epInfo.resolution);
        if (epInfo.codec && !seasonCodec) setSeasonCodec(epInfo.codec);
        const langs = epInfo.languages
          .filter(Boolean)
          .map((l) => l.toUpperCase());
        if (langs.length > 0 && !seasonLangs) setSeasonLangs(langs.join(", "));
      })
      .catch(() => {
        // ffprobe not available — fall back to parsing filenames and folder name
        const folderName = path.split(/[\\/]/).pop() ?? path;
        const fromFolder = parseQualityFromFilename(folderName);
        const first = firstEp.split(/[\\/]/).pop() ?? "";
        const fromEp = parseQualityFromFilename(first);

        if (!seasonSource) setSeasonSource(fromFolder.source || fromEp.source);
        if (!seasonResolution)
          setSeasonResolution(fromFolder.resolution || fromEp.resolution);
        if (!seasonCodec) setSeasonCodec(fromFolder.codec || fromEp.codec);

        if (!seasonLangs) {
          let langs = parseLanguagesFromPath(first);
          if (langs.length === 0) {
            for (const fp of episodeFiles.slice(1, 4)) {
              langs = parseLanguagesFromPath(fp.split(/[\\/]/).pop() ?? "");
              if (langs.length > 0) break;
            }
          }
          if (langs.length === 0) langs = parseLanguagesFromPath(folderName);
          if (langs.length > 0) setSeasonLangs(langs.join(", "));
        }
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [episodeFiles]);

  // Auto-compute the flat season destination folder whenever naming fields change
  useEffect(() => {
    if (mediaType !== "tv" || destTouchedRef.current) return;
    const year =
      tmdbSelected?.release_date?.slice(0, 4) ??
      (suggestion?.detected_year
        ? String(suggestion.detected_year)
        : undefined);
    // Prefer tv_category_dest (includes the category subfolder like "Temporadas en emision")
    const tvBase = (
      suggestion?.tv_category_dest ||
      suggestion?.tv_dest ||
      ""
    ).replace(/\/$/, "");
    const folderName = buildSeasonFolderName(
      showName,
      year,
      season,
      seasonSource,
      seasonResolution,
    );
    const newDest = tvBase ? `${tvBase}/${folderName}` : folderName;
    setDest(newDest);
    onDestChange(path, newDest);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    isDirectory,
    mediaType,
    showName,
    season,
    seasonSource,
    seasonResolution,
    tmdbSelected,
    suggestion,
  ]);

  // For single TV episode files: auto-build and propagate the renamed filename.
  useEffect(() => {
    if (isDirectory || mediaType !== "tv") return;
    if (rename) {
      onFilenameChange(
        path,
        buildEpisodeFilename(
          showName,
          season,
          episode,
          seasonSource,
          seasonResolution,
          seasonCodec,
          seasonLangs,
          ext,
        ),
      );
    } else {
      onFilenameChange(path, filename);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    isDirectory,
    mediaType,
    showName,
    season,
    episode,
    seasonSource,
    seasonResolution,
    seasonCodec,
    seasonLangs,
    rename,
  ]);

  // Episode plan: for each video file in the folder, build its renamed filename
  const episodePlan = useMemo(() => {
    if (!isDirectory || mediaType !== "tv") return [];
    return episodeFiles.map((fp) => {
      const basename = fp.split(/[\\/]/).pop() ?? fp;
      if (!rename) return { localPath: fp, filename: basename };
      const epExt = basename.includes(".") ? basename.split(".").pop()! : "mkv";
      const epNum = parseEpisodeNum(basename) ?? 1;
      return {
        localPath: fp,
        filename: buildEpisodeFilename(
          showName,
          season,
          epNum,
          seasonSource,
          seasonResolution,
          seasonCodec,
          seasonLangs,
          epExt,
        ),
      };
    });
  }, [
    isDirectory,
    mediaType,
    episodeFiles,
    showName,
    season,
    seasonSource,
    seasonResolution,
    seasonCodec,
    seasonLangs,
    rename,
  ]);

  // Propagate episode plan to parent whenever it changes
  useEffect(() => {
    if (isDirectory && mediaType === "tv") {
      onEpisodePlanChange?.(path, episodePlan);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [episodePlan]);

  // TMDB search state
  const [tmdbQuery, setTmdbQuery] = useState(() => {
    const raw =
      suggestion?.detected_title ??
      filename.replace(/\.[^.]+$/, "").replace(/[._]/g, " ");
    return raw
      .normalize("NFC") // macOS stores filenames as NFD; normalise to NFC for TMDB
      .replace(/\s+-\s+/g, " ") // replace " - " with space (keep full title incl. subtitle)
      .replace(/-/g, " ") // remove remaining hyphens
      .replace(/\s{2,}/g, " ") // collapse spaces
      .trim()
      .toLowerCase();
  });
  const [tmdbResults, setTmdbResults] = useState<TmdbMatch[]>([]);
  const [tmdbSearching, setTmdbSearching] = useState(false);
  const [tmdbSearched, setTmdbSearched] = useState(false);
  const [showFixSearch, setShowFixSearch] = useState(false);

  const ext = isDirectory ? "" : (filename.split(".").pop() ?? "mkv");

  const searchTmdb = async () => {
    if (!tmdbQuery.trim()) return;
    setTmdbSearching(true);
    setTmdbSearched(false);
    try {
      const results = await invoke<TmdbMatch[]>("search_tmdb", {
        query: tmdbQuery.trim(),
        mediaType: mediaType === "tv" ? "tv" : "movie",
      });
      setTmdbResults(results.slice(0, 6));
      setTmdbSearched(true);
    } catch {
      setTmdbResults([]);
      setTmdbSearched(true);
    } finally {
      setTmdbSearching(false);
    }
  };

  const selectTmdb = (match: TmdbMatch) => {
    setTmdbSelected(match);
    setTmdbResults([]);
    setShowFixSearch(false);
    onTmdbChange(path, match);
  };

  const clearTmdb = () => {
    setTmdbSelected(null);
    setTmdbResults([]);
    setTmdbSearched(false);
    setShowFixSearch(false);
    onTmdbChange(path, null);
  };

  const handleDestChange = (val: string) => {
    destTouchedRef.current = true;
    setDest(val);
    onDestChange(path, val);
  };

  const handleMediaTypeChange = (t: MediaType) => {
    setMediaType(t);
    destTouchedRef.current = false; // allow auto-dest to recalculate for new type
    const baseDest =
      t === "tv" ? (suggestion?.tv_dest ?? "") : (suggestion?.movie_dest ?? "");
    let newDest: string;
    if (t === "tv") {
      const year =
        tmdbSelected?.release_date?.slice(0, 4) ??
        (suggestion?.detected_year
          ? String(suggestion.detected_year)
          : undefined);
      const folderName = buildSeasonFolderName(
        showName,
        year,
        season,
        seasonSource,
        seasonResolution,
      );
      // Prefer tv_category_dest (includes the category subfolder like "Temporadas en emision")
      const tvBase = (suggestion?.tv_category_dest || baseDest || "").replace(
        /\/$/,
        "",
      );
      newDest = tvBase ? `${tvBase}/${folderName}` : folderName;
    } else {
      newDest = baseDest;
    }
    setDest(newDest);
    onDestChange(path, newDest);
  };

  return (
    <div
      style={{
        background: "var(--color-surface)",
        border: "1px solid var(--color-border)",
        borderRadius: "var(--radius)",
        overflow: "visible",
        position: "relative",
      }}
    >
      {/* Header row */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "10px 14px",
          cursor: "pointer",
          userSelect: "none",
        }}
        onClick={() => setExpanded((v) => !v)}
      >
        {mediaType === "tv" ? (
          <Tv size={14} color="var(--color-teal)" />
        ) : mediaType === "documentary" ? (
          <Video size={14} color="var(--color-warning)" />
        ) : (
          <Film size={14} color="var(--color-primary)" />
        )}
        <span
          style={{
            flex: 1,
            fontSize: 12,
            color: "var(--color-text)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
          title={filename}
        >
          {filename}
        </span>

        {!info && !error && (
          <Loader2
            size={13}
            color="var(--color-primary)"
            style={{ animation: "spin 1s linear infinite" }}
          />
        )}
        {error && <AlertTriangle size={13} color="var(--color-danger)" />}

        {expanded ? (
          <ChevronUp size={14} color="var(--color-text-muted)" />
        ) : (
          <ChevronDown size={14} color="var(--color-text-muted)" />
        )}
      </div>

      {expanded && (
        <div
          style={{
            padding: "0 14px 14px",
            display: "flex",
            flexDirection: "column",
            gap: 12,
          }}
        >
          {/* Error */}
          {error && (
            <div
              style={{
                background: "rgba(224,85,85,0.1)",
                border: "1px solid rgba(224,85,85,0.3)",
                borderRadius: "var(--radius)",
                padding: "8px 12px",
                fontSize: 12,
                color: "var(--color-danger)",
              }}
            >
              {error}
            </div>
          )}

          {/* TMDB match */}
          <div>
            <div
              style={{
                fontSize: 10,
                fontWeight: 600,
                color: "var(--color-text-muted)",
                letterSpacing: "0.04em",
                marginBottom: 6,
              }}
            >
              ENLACE TMDB
            </div>

            {/* Auto-matched result (or cleared) */}
            {tmdbSelected ? (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  background: "rgba(61,176,126,0.08)",
                  border: "1px solid rgba(61,176,126,0.35)",
                  borderRadius: "var(--radius)",
                  padding: "8px 10px",
                }}
              >
                {tmdbSelected.poster_path && (
                  <img
                    src={`${TMDB_IMG}${tmdbSelected.poster_path}`}
                    alt=""
                    style={{
                      width: 28,
                      height: 42,
                      borderRadius: 3,
                      objectFit: "cover",
                      flexShrink: 0,
                    }}
                  />
                )}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      fontSize: 12,
                      fontWeight: 600,
                      color: "var(--color-text)",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {tmdbSelected.title}
                  </div>
                  <div
                    style={{ fontSize: 11, color: "var(--color-text-muted)" }}
                  >
                    {tmdbSelected.release_date?.slice(0, 4) ?? "—"}
                    {tmdbSelected.vote_average != null && (
                      <span
                        style={{
                          marginLeft: 8,
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 3,
                        }}
                      >
                        <Star size={10} color="var(--color-warning)" />
                        {tmdbSelected.vote_average.toFixed(1)}
                      </span>
                    )}
                    <span style={{ marginLeft: 8, opacity: 0.6 }}>
                      ID: {tmdbSelected.id}
                    </span>
                  </div>
                </div>
                <CheckCircle
                  size={15}
                  color="var(--color-success)"
                  style={{ flexShrink: 0 }}
                />
                {/* Fix match button */}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setShowFixSearch((v) => !v);
                  }}
                  style={{
                    background: showFixSearch
                      ? "rgba(124,110,247,0.15)"
                      : "var(--color-surface-2)",
                    border: `1px solid ${showFixSearch ? "var(--color-primary)" : "var(--color-border)"}`,
                    borderRadius: "var(--radius)",
                    cursor: "pointer",
                    color: showFixSearch
                      ? "var(--color-primary)"
                      : "var(--color-text-muted)",
                    fontSize: 11,
                    padding: "3px 8px",
                    flexShrink: 0,
                    transition: "all 0.15s ease",
                  }}
                  title="Buscar coincidencia diferente"
                >
                  Cambiar
                </button>
                <button
                  onClick={clearTmdb}
                  style={{
                    background: "none",
                    border: "none",
                    cursor: "pointer",
                    color: "var(--color-text-muted)",
                    fontSize: 16,
                    lineHeight: 1,
                    padding: "0 2px",
                    flexShrink: 0,
                  }}
                  title="Quitar enlace"
                >
                  ×
                </button>
              </div>
            ) : (
              /* No match state */
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  background: "rgba(200,147,42,0.08)",
                  border: "1px solid rgba(200,147,42,0.3)",
                  borderRadius: "var(--radius)",
                  padding: "8px 10px",
                }}
              >
                <AlertTriangle
                  size={13}
                  color="var(--color-warning)"
                  style={{ flexShrink: 0 }}
                />
                <span
                  style={{
                    fontSize: 12,
                    color: "var(--color-warning)",
                    flex: 1,
                  }}
                >
                  Sin coincidencia automática en TMDB
                </span>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setShowFixSearch((v) => !v);
                  }}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 5,
                    background: showFixSearch
                      ? "rgba(124,110,247,0.15)"
                      : "var(--color-surface-2)",
                    border: `1px solid ${showFixSearch ? "var(--color-primary)" : "var(--color-border)"}`,
                    borderRadius: "var(--radius)",
                    cursor: "pointer",
                    color: showFixSearch
                      ? "var(--color-primary)"
                      : "var(--color-text-muted)",
                    fontSize: 11,
                    padding: "3px 8px",
                    flexShrink: 0,
                    transition: "all 0.15s ease",
                  }}
                >
                  <Search size={11} />
                  Buscar manualmente
                </button>
              </div>
            )}

            {/* Fix-match search panel — shown when Cambiar / Buscar manualmente is active */}
            {showFixSearch && (
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 6,
                  marginTop: 6,
                }}
              >
                <div style={{ display: "flex", gap: 6 }}>
                  <input
                    value={tmdbQuery}
                    onChange={(e) => setTmdbQuery(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && searchTmdb()}
                    placeholder="Buscar en TMDB..."
                    style={{ ...inputStyle, flex: 1 }}
                  />
                  <button
                    onClick={searchTmdb}
                    disabled={tmdbSearching}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 5,
                      background: "var(--color-primary)",
                      border: "none",
                      borderRadius: "var(--radius)",
                      color: "#fff",
                      fontSize: 12,
                      padding: "5px 12px",
                      cursor: tmdbSearching ? "not-allowed" : "pointer",
                      opacity: tmdbSearching ? 0.6 : 1,
                      flexShrink: 0,
                      transition: "opacity 0.15s ease",
                    }}
                  >
                    {tmdbSearching ? (
                      <Loader2
                        size={12}
                        style={{ animation: "spin 1s linear infinite" }}
                      />
                    ) : (
                      <Search size={12} />
                    )}
                    Buscar
                  </button>
                </div>

                {tmdbSearched && tmdbResults.length === 0 && (
                  <div
                    style={{
                      fontSize: 12,
                      color: "var(--color-text-muted)",
                      padding: "4px 0",
                    }}
                  >
                    Sin resultados.
                  </div>
                )}

                {tmdbResults.length > 0 && (
                  <div
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: 4,
                      maxHeight: 240,
                      overflowY: "auto",
                      border: "1px solid var(--color-border)",
                      borderRadius: "var(--radius)",
                      background: "var(--color-surface-2)",
                    }}
                  >
                    {tmdbResults.map((r) => (
                      <TmdbResultRow
                        key={r.id}
                        match={r}
                        onSelect={selectTmdb}
                      />
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Media type selector */}
          <div>
            <div
              style={{
                fontSize: 10,
                fontWeight: 600,
                color: "var(--color-text-muted)",
                letterSpacing: "0.04em",
                marginBottom: 6,
              }}
            >
              TIPO DE CONTENIDO
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              {(["movie", "tv", "documentary"] as MediaType[]).map((t) => {
                const active = mediaType === t;
                return (
                  <button
                    key={t}
                    onClick={(e) => {
                      e.stopPropagation();
                      handleMediaTypeChange(t);
                    }}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 5,
                      padding: "5px 10px",
                      borderRadius: "var(--radius-full)",
                      border: `1px solid ${active ? "var(--color-primary)" : "var(--color-border)"}`,
                      background: active
                        ? "rgba(124,110,247,0.15)"
                        : "var(--color-surface-2)",
                      color: active
                        ? "var(--color-primary)"
                        : "var(--color-text-muted)",
                      fontSize: 11,
                      fontWeight: active ? 600 : 400,
                      cursor: "pointer",
                      transition: "all 0.15s ease",
                    }}
                  >
                    {MEDIA_TYPE_ICONS[t]}
                    {MEDIA_TYPE_LABELS[t]}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Analysis badges */}
          {info && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {info.resolution && <Badge label={info.resolution} />}
              {info.codec && <Badge label={info.codec} />}
              {info.hdr && (
                <Badge label={info.hdr} color="var(--color-warning)" />
              )}
              {info.audio_tracks.length > 0 && (
                <Badge label={info.audio_tracks[0].codec} />
              )}
              {info.languages.length > 0 && (
                <Badge
                  label={info.languages.map((l) => l.toUpperCase()).join(", ")}
                />
              )}
              {info.duration_secs != null && (
                <Badge label={formatDuration(info.duration_secs)} />
              )}
              {info.size_bytes > 0 && (
                <Badge label={formatBytes(info.size_bytes)} />
              )}
            </div>
          )}

          {/* TV-specific fields */}
          {mediaType === "tv" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <div
                style={{
                  fontSize: 10,
                  fontWeight: 600,
                  color: "var(--color-text-muted)",
                  letterSpacing: "0.04em",
                }}
              >
                DATOS DE SERIE
              </div>

              {/* Upload mode pills — only for single-file uploads, not season dirs */}
              {!isDirectory && (
                <div style={{ display: "flex", gap: 6 }}>
                  {(["season", "episode"] as const).map((mode) => {
                    const active = tvUploadMode === mode;
                    const label =
                      mode === "season"
                        ? "Temporada completa"
                        : "Episodio individual";
                    return (
                      <button
                        key={mode}
                        onClick={(e) => {
                          e.stopPropagation();
                          setTvUploadMode(mode);
                        }}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 5,
                          padding: "4px 10px",
                          borderRadius: "var(--radius-full)",
                          border: `1px solid ${active ? "var(--color-teal)" : "var(--color-border)"}`,
                          background: active
                            ? "rgba(20,184,166,0.12)"
                            : "var(--color-surface-2)",
                          color: active
                            ? "var(--color-teal)"
                            : "var(--color-text-muted)",
                          fontSize: 11,
                          fontWeight: active ? 600 : 400,
                          cursor: "pointer",
                          transition: "all 0.15s ease",
                        }}
                      >
                        {mode === "season" ? (
                          <Tv size={11} />
                        ) : (
                          <Film size={11} />
                        )}
                        {label}
                      </button>
                    );
                  })}
                </div>
              )}

              {/* Rename toggle — inside TV section, before show name */}
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 10,
                }}
              >
                <span style={{ fontSize: 13, color: "var(--color-text)" }}>
                  Renombrar {isDirectory ? "archivos" : "archivo"}
                </span>
                <Toggle checked={rename} onChange={setRename} />
              </div>

              {/* Show name + season */}
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns:
                    !isDirectory && tvUploadMode === "episode"
                      ? "1fr 70px 70px"
                      : "1fr 70px",
                  gap: "8px 10px",
                }}
              >
                <div
                  style={{ display: "flex", flexDirection: "column", gap: 3 }}
                >
                  <label
                    style={{
                      fontSize: 10,
                      color: "var(--color-text-muted)",
                      fontWeight: 600,
                      letterSpacing: "0.04em",
                    }}
                  >
                    NOMBRE DE LA SERIE
                  </label>
                  <input
                    value={showName}
                    onChange={(e) => setShowName(e.target.value)}
                    placeholder="Breaking Bad"
                    style={inputStyle}
                  />
                </div>
                <div
                  style={{ display: "flex", flexDirection: "column", gap: 3 }}
                >
                  <label
                    style={{
                      fontSize: 10,
                      color: "var(--color-text-muted)",
                      fontWeight: 600,
                      letterSpacing: "0.04em",
                    }}
                  >
                    TEMPORADA
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={99}
                    value={season}
                    onChange={(e) => setSeason(Number(e.target.value))}
                    style={inputStyle}
                  />
                </div>
                {!isDirectory && tvUploadMode === "episode" && (
                  <div
                    style={{ display: "flex", flexDirection: "column", gap: 3 }}
                  >
                    <label
                      style={{
                        fontSize: 10,
                        color: "var(--color-text-muted)",
                        fontWeight: 600,
                        letterSpacing: "0.04em",
                      }}
                    >
                      EPISODIO
                    </label>
                    <input
                      type="number"
                      min={1}
                      max={999}
                      value={episode}
                      onChange={(e) => setEpisode(Number(e.target.value))}
                      style={inputStyle}
                    />
                  </div>
                )}
              </div>

              {/* Quality selects — used to build flat folder name + renamed filenames for all TV content */}
              {mediaType === "tv" && (
                <>
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "1fr 1fr 1fr",
                      gap: "8px 10px",
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: 3,
                      }}
                    >
                      <label
                        style={{
                          fontSize: 10,
                          color: "var(--color-text-muted)",
                          fontWeight: 600,
                          letterSpacing: "0.04em",
                        }}
                      >
                        FUENTE
                      </label>
                      <select
                        value={seasonSource}
                        onChange={(e) => setSeasonSource(e.target.value)}
                        style={formSelectCompact}
                      >
                        {SEASON_SOURCES.map((s) => (
                          <option key={s} value={s}>
                            {s || "—"}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: 3,
                      }}
                    >
                      <label
                        style={{
                          fontSize: 10,
                          color: "var(--color-text-muted)",
                          fontWeight: 600,
                          letterSpacing: "0.04em",
                        }}
                      >
                        RESOLUCIÓN
                      </label>
                      <select
                        value={seasonResolution}
                        onChange={(e) => setSeasonResolution(e.target.value)}
                        style={formSelectCompact}
                      >
                        {SEASON_RESOLUTIONS.map((r) => (
                          <option key={r} value={r}>
                            {r || "—"}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: 3,
                      }}
                    >
                      <label
                        style={{
                          fontSize: 10,
                          color: "var(--color-text-muted)",
                          fontWeight: 600,
                          letterSpacing: "0.04em",
                        }}
                      >
                        CÓDEC
                      </label>
                      <select
                        value={seasonCodec}
                        onChange={(e) => setSeasonCodec(e.target.value)}
                        style={formSelectCompact}
                      >
                        {SEASON_CODECS.map((c) => (
                          <option key={c} value={c}>
                            {c || "—"}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                  <div
                    style={{ display: "flex", flexDirection: "column", gap: 3 }}
                  >
                    <label
                      style={{
                        fontSize: 10,
                        color: "var(--color-text-muted)",
                        fontWeight: 600,
                        letterSpacing: "0.04em",
                      }}
                    >
                      IDIOMAS (ej: SPA, ENG)
                    </label>
                    <input
                      value={seasonLangs}
                      onChange={(e) => setSeasonLangs(e.target.value)}
                      placeholder="SPA, ENG"
                      style={formInputCompact}
                    />
                  </div>
                </>
              )}
            </div>
          )}

          {/* FTP destination */}
          <div>
            <div
              style={{
                fontSize: 10,
                fontWeight: 600,
                color: "var(--color-text-muted)",
                letterSpacing: "0.04em",
                marginBottom: 4,
              }}
            >
              DESTINO FTP
            </div>
            <div style={{ display: "flex", gap: 6, position: "relative" }}>
              <input
                value={dest}
                onChange={(e) => handleDestChange(e.target.value)}
                placeholder="/Compartida/Series HD 1080p"
                style={{ ...inputStyle, flex: 1, fontFamily: "monospace" }}
              />
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setShowBrowser((v) => !v);
                }}
                title="Explorar carpetas FTP"
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 5,
                  background: showBrowser
                    ? "rgba(124,110,247,0.15)"
                    : "var(--color-surface-2)",
                  border: `1px solid ${showBrowser ? "var(--color-primary)" : "var(--color-border)"}`,
                  borderRadius: "var(--radius)",
                  color: showBrowser
                    ? "var(--color-primary)"
                    : "var(--color-text-muted)",
                  fontSize: 12,
                  padding: "5px 10px",
                  cursor: "pointer",
                  transition: "all 0.15s ease",
                  flexShrink: 0,
                  whiteSpace: "nowrap",
                }}
              >
                <FolderSearch size={13} />
                Explorar
              </button>

              {showBrowser && (
                <FtpDirPicker
                  initialPath={dest || "/"}
                  onSelect={(p) => {
                    handleDestChange(p);
                    setShowBrowser(false);
                  }}
                  onClose={() => setShowBrowser(false)}
                />
              )}
            </div>
          </div>

          {/* TV season episode plan — shows the flat upload structure with renamed filenames */}
          {mediaType === "tv" && (
            <div
              style={{
                background: "var(--color-surface-2)",
                border: "1px solid var(--color-border)",
                borderRadius: "var(--radius)",
                padding: "8px 12px",
              }}
            >
              <div
                style={{
                  fontSize: 10,
                  color: "var(--color-text-muted)",
                  fontWeight: 600,
                  letterSpacing: "0.04em",
                  marginBottom: 6,
                }}
              >
                {isDirectory
                  ? `PLAN DE SUBIDA — ${episodePlan.length} EPISODIO${episodePlan.length !== 1 ? "S" : ""} · CARPETA PLANA`
                  : "PLAN DE SUBIDA — 1 EPISODIO"}
              </div>
              <div style={{ fontFamily: "monospace", fontSize: 11 }}>
                {dest && (
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 5,
                      color: "var(--color-text-muted)",
                      marginBottom: 4,
                      wordBreak: "break-all",
                    }}
                  >
                    <FolderOpen
                      size={12}
                      color="var(--color-warning)"
                      style={{ flexShrink: 0 }}
                    />
                    <span>{dest.endsWith("/") ? dest : dest + "/"}</span>
                  </div>
                )}
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 2,
                    maxHeight: 180,
                    overflowY: "auto",
                    paddingLeft: 4,
                  }}
                >
                  {isDirectory ? (
                    <>
                      {episodePlan.length === 0 &&
                        episodeFiles.length === 0 && (
                          <span style={{ color: "var(--color-text-muted)" }}>
                            Cargando archivos…
                          </span>
                        )}
                      {episodePlan.length === 0 && episodeFiles.length > 0 && (
                        <span style={{ color: "var(--color-text-muted)" }}>
                          Sin archivos de vídeo encontrados.
                        </span>
                      )}
                      {episodePlan.map((ep, idx) => (
                        <div
                          key={ep.localPath}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 6,
                            color: "var(--color-text)",
                          }}
                        >
                          <span
                            style={{
                              color: "var(--color-border)",
                              flexShrink: 0,
                            }}
                          >
                            {idx === episodePlan.length - 1 ? "└──" : "├──"}
                          </span>
                          <FileVideo
                            size={11}
                            color="var(--color-primary)"
                            style={{ flexShrink: 0 }}
                          />
                          <span style={{ wordBreak: "break-all" }}>
                            {ep.filename}
                          </span>
                        </div>
                      ))}
                    </>
                  ) : (
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 6,
                        color: "var(--color-text)",
                      }}
                    >
                      <span
                        style={{ color: "var(--color-border)", flexShrink: 0 }}
                      >
                        └──
                      </span>
                      <FileVideo
                        size={11}
                        color="var(--color-primary)"
                        style={{ flexShrink: 0 }}
                      />
                      <span style={{ wordBreak: "break-all" }}>
                        {rename
                          ? buildEpisodeFilename(
                              showName,
                              season,
                              episode,
                              seasonSource,
                              seasonResolution,
                              seasonCodec,
                              seasonLangs,
                              ext,
                            )
                          : filename}
                      </span>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Rename toggle — for non-TV single files only; TV has it inside the TV section */}
          {!isDirectory && mediaType !== "tv" && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 10,
              }}
            >
              <span style={{ fontSize: 13, color: "var(--color-text)" }}>
                Renombrar archivo
              </span>
              <Toggle checked={rename} onChange={setRename} />
            </div>
          )}

          {/* Full path preview — for non-TV content only (TV uses the plan panel above) */}
          {dest &&
            mediaType !== "tv" &&
            ((!rename && !isDirectory) || isDirectory) && (
              <div
                style={{
                  background: "var(--color-surface-2)",
                  border: "1px solid var(--color-border)",
                  borderRadius: "var(--radius)",
                  padding: "8px 12px",
                  fontFamily: "monospace",
                  fontSize: 11,
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 5,
                    color: "var(--color-text-muted)",
                  }}
                >
                  <FolderOpen size={12} color="var(--color-warning)" />
                  <span>{dest.endsWith("/") ? dest : dest + "/"}</span>
                </div>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 5,
                    color: "var(--color-text)",
                    marginTop: 3,
                    paddingLeft: 4,
                  }}
                >
                  <span style={{ color: "var(--color-border)" }}>└──</span>
                  {isDirectory ? (
                    <Folder size={12} color="var(--color-teal)" />
                  ) : (
                    <FileVideo size={12} color="var(--color-primary)" />
                  )}
                  <span style={{ wordBreak: "break-all" }}>{filename}</span>
                </div>
              </div>
            )}

          {/* FilenameBuilder — only for non-TV files (TV files are auto-renamed via quality fields) */}
          {rename && !isDirectory && mediaType !== "tv" && (
            <FilenameBuilder
              info={info ?? null}
              mediaType={mediaType}
              defaultTitle={
                suggestion?.detected_title ??
                filename.replace(/\.[^.]+$/, "").replace(/[._]/g, " ")
              }
              defaultYear={suggestion?.detected_year ?? undefined}
              defaultReleaseType={
                suggestion?.detected_release_type ?? undefined
              }
              extension={ext}
              dest={dest || undefined}
              onChange={(newName) => onFilenameChange(path, newName)}
            />
          )}
        </div>
      )}
    </div>
  );
}

// ─── Badge ────────────────────────────────────────────────────────────────────
function Badge({ label, color }: { label: string; color?: string }) {
  return (
    <span
      style={{
        background: "var(--color-surface-2)",
        border: "1px solid var(--color-border)",
        borderRadius: "var(--radius-full)",
        padding: "2px 8px",
        fontSize: 11,
        color: color ?? "var(--color-text)",
        fontWeight: 500,
      }}
    >
      {label}
    </span>
  );
}

const inputStyle: React.CSSProperties = {
  background: "var(--color-surface-2)",
  border: "1px solid var(--color-border)",
  borderRadius: "var(--radius)",
  color: "var(--color-text)",
  fontSize: 12,
  padding: "6px 10px",
  width: "100%",
  boxSizing: "border-box",
  outline: "none",
};

// ─── TmdbResultRow ────────────────────────────────────────────────────────────
function TmdbResultRow({
  match,
  onSelect,
}: {
  match: TmdbMatch;
  onSelect: (m: TmdbMatch) => void;
}) {
  const [hovered, setHovered] = useState(false);
  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={() => onSelect(match)}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "8px 10px",
        cursor: "pointer",
        background: hovered ? "var(--color-surface)" : "transparent",
        transition: "background 0.15s ease",
      }}
    >
      {match.poster_path ? (
        <img
          src={`${TMDB_IMG}${match.poster_path}`}
          alt=""
          style={{
            width: 28,
            height: 42,
            borderRadius: 3,
            objectFit: "cover",
            flexShrink: 0,
          }}
        />
      ) : (
        <div
          style={{
            width: 28,
            height: 42,
            borderRadius: 3,
            background: "var(--color-border)",
            flexShrink: 0,
          }}
        />
      )}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: 12,
            fontWeight: 600,
            color: "var(--color-text)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {match.title}
        </div>
        <div
          style={{
            fontSize: 11,
            color: "var(--color-text-muted)",
            display: "flex",
            alignItems: "center",
            gap: 8,
          }}
        >
          <span>{match.release_date?.slice(0, 4) ?? "—"}</span>
          {match.vote_average != null && (
            <span
              style={{ display: "inline-flex", alignItems: "center", gap: 3 }}
            >
              <Star size={10} color="var(--color-warning)" />
              {match.vote_average.toFixed(1)}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
