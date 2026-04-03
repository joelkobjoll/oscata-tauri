// TMDB genre ID → i18n key mapping (shared across the app)
export const GENRE_MAP: Record<number, string> = {
  28: "detail.genre.action",
  12: "detail.genre.adventure",
  16: "detail.genre.animation",
  35: "detail.genre.comedy",
  80: "detail.genre.crime",
  99: "detail.genre.documentary",
  18: "detail.genre.drama",
  10751: "detail.genre.family",
  14: "detail.genre.fantasy",
  36: "detail.genre.history",
  27: "detail.genre.horror",
  10402: "detail.genre.music",
  9648: "detail.genre.mystery",
  10749: "detail.genre.romance",
  878: "detail.genre.scifi",
  10770: "detail.genre.tvmovie",
  53: "detail.genre.thriller",
  10752: "detail.genre.war",
  37: "detail.genre.western",
};

// Human-readable genre names for UI dropdowns — sorted by English name
export interface GenreEntry {
  id: number;
  i18nKey: string; // key into i18n messages (detail.genre.*)
}

export const GENRE_LIST: GenreEntry[] = [
  { id: 28, i18nKey: "detail.genre.action" },
  { id: 12, i18nKey: "detail.genre.adventure" },
  { id: 16, i18nKey: "detail.genre.animation" },
  { id: 35, i18nKey: "detail.genre.comedy" },
  { id: 80, i18nKey: "detail.genre.crime" },
  { id: 99, i18nKey: "detail.genre.documentary" },
  { id: 18, i18nKey: "detail.genre.drama" },
  { id: 10751, i18nKey: "detail.genre.family" },
  { id: 14, i18nKey: "detail.genre.fantasy" },
  { id: 36, i18nKey: "detail.genre.history" },
  { id: 27, i18nKey: "detail.genre.horror" },
  { id: 10402, i18nKey: "detail.genre.music" },
  { id: 9648, i18nKey: "detail.genre.mystery" },
  { id: 10749, i18nKey: "detail.genre.romance" },
  { id: 878, i18nKey: "detail.genre.scifi" },
  { id: 53, i18nKey: "detail.genre.thriller" },
  { id: 10770, i18nKey: "detail.genre.tvmovie" },
  { id: 10752, i18nKey: "detail.genre.war" },
  { id: 37, i18nKey: "detail.genre.western" },
];
