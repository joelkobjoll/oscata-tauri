export function formatBytes(b: number): string {
  if (b >= 1024 ** 3) return `${(b / 1024 ** 3).toFixed(2)} GB`;
  if (b >= 1024 ** 2) return `${(b / 1024 ** 2).toFixed(1)} MB`;
  if (b >= 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${b} B`;
}

export function formatDuration(secs: number): string {
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = Math.floor(secs % 60);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

const LANG_NAMES: Record<string, string> = {
  SPA: "Español",
  ESP: "Español",
  ENG: "Inglés",
  FRA: "Francés",
  GER: "Alemán",
  DEU: "Alemán",
  ITA: "Italiano",
  POR: "Portugués",
  JPN: "Japonés",
  KOR: "Coreano",
  CHI: "Chino",
  ZHO: "Chino",
  ARA: "Árabe",
  RUS: "Ruso",
  TUR: "Turco",
  POL: "Polaco",
  DUT: "Neerlandés",
  NLD: "Neerlandés",
  SWE: "Sueco",
  NOR: "Noruego",
  DAN: "Danés",
  FIN: "Finlandés",
  HEB: "Hebreo",
  HUN: "Húngaro",
  CZE: "Checo",
  SLO: "Eslovaco",
  ROM: "Rumano",
  GRE: "Griego",
  ELL: "Griego",
  THA: "Tailandés",
  VIE: "Vietnamita",
  IND: "Indonesio",
  MAY: "Malayo",
  HIN: "Hindi",
  CAT: "Catalán",
  LAT: "Latín",
  EUS: "Euskera",
  GLG: "Gallego",
};

/** Maps an ISO 639-2 language code (e.g. "SPA") to its Spanish display name. Falls back to the uppercased code. */
export function formatLanguage(code: string): string {
  return LANG_NAMES[code.toUpperCase()] ?? code.toUpperCase();
}

/** Maps an array of language codes to display names, joined by " · ". */
export function formatLanguages(codes: string[]): string {
  return codes.map(formatLanguage).join(" · ");
}
