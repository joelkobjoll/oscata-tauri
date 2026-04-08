import type { MediaItem } from "../hooks/useIndexing";

export type AppLanguage = "es" | "en";

export function getLocalizedTitle(
  item: Pick<MediaItem, "tmdb_title" | "tmdb_title_en" | "title" | "filename">,
  language: AppLanguage,
) {
  if (language === "en")
    return item.tmdb_title_en ?? item.tmdb_title ?? item.title ?? item.filename;
  return item.tmdb_title ?? item.tmdb_title_en ?? item.title ?? item.filename;
}

export function getAlternateTitle(
  item: Pick<MediaItem, "tmdb_title" | "tmdb_title_en">,
  language: AppLanguage,
) {
  return language === "en"
    ? (item.tmdb_title ?? null)
    : (item.tmdb_title_en ?? null);
}

export function getLocalizedOverview(
  item: Pick<MediaItem, "tmdb_overview" | "tmdb_overview_en">,
  language: AppLanguage,
) {
  if (language === "en")
    return item.tmdb_overview_en ?? item.tmdb_overview ?? null;
  return item.tmdb_overview ?? item.tmdb_overview_en ?? null;
}

export function getLocalizedPosterPath(
  item: Pick<MediaItem, "tmdb_poster" | "tmdb_poster_en">,
  language: AppLanguage,
) {
  if (language === "en") return item.tmdb_poster_en ?? item.tmdb_poster ?? null;
  return item.tmdb_poster ?? item.tmdb_poster_en ?? null;
}

export function getMediaYear(
  item: Pick<MediaItem, "year" | "tmdb_release_date">,
): number | undefined {
  if (item.year != null) return item.year;

  const yearText = item.tmdb_release_date?.slice(0, 4);
  if (!yearText || !/^\d{4}$/.test(yearText)) return undefined;

  return Number(yearText);
}

/**
 * Resolve a poster path to a full URL.
 *
 * - If `path` is already a full URL (starts with "http"), returns it as-is.
 *   This handles poster URLs returned by metadata-proxy which are pre-qualified.
 * - Otherwise prepends the standard TMDB image base URL with `tmdbSize`.
 */
export function resolveImageUrl(
  path: string | null | undefined,
  tmdbSize: "w154" | "w185" | "w300" | "w342" | "w500",
): string | null {
  if (!path) return null;
  if (path.startsWith("http")) return path;
  return `https://image.tmdb.org/t/p/${tmdbSize}${path}`;
}
