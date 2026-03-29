import type { MediaItem } from "../hooks/useIndexing";

export type AppLanguage = "es" | "en";

export function getLocalizedTitle(item: Pick<MediaItem, "tmdb_title" | "tmdb_title_en" | "title" | "filename">, language: AppLanguage) {
  if (language === "en") return item.tmdb_title_en ?? item.tmdb_title ?? item.title ?? item.filename;
  return item.tmdb_title ?? item.tmdb_title_en ?? item.title ?? item.filename;
}

export function getAlternateTitle(item: Pick<MediaItem, "tmdb_title" | "tmdb_title_en">, language: AppLanguage) {
  return language === "en" ? item.tmdb_title ?? null : item.tmdb_title_en ?? null;
}

export function getLocalizedOverview(item: Pick<MediaItem, "tmdb_overview" | "tmdb_overview_en">, language: AppLanguage) {
  if (language === "en") return item.tmdb_overview_en ?? item.tmdb_overview ?? null;
  return item.tmdb_overview ?? item.tmdb_overview_en ?? null;
}

export function getLocalizedPosterPath(item: Pick<MediaItem, "tmdb_poster" | "tmdb_poster_en">, language: AppLanguage) {
  if (language === "en") return item.tmdb_poster_en ?? item.tmdb_poster ?? null;
  return item.tmdb_poster ?? item.tmdb_poster_en ?? null;
}
