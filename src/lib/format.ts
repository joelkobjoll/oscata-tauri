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
  // ── Español ──────────────────────────────────────────────────────────────
  ES: "Español",
  SPA: "Español",
  ESP: "Español",
  // ── Inglés ───────────────────────────────────────────────────────────────
  EN: "Inglés",
  ENG: "Inglés",
  // ── Francés (ISO 639-2/B = FRE, ISO 639-2/T = FRA, ISO 639-1 = FR) ─────
  FR: "Francés",
  FRE: "Francés",
  FRA: "Francés",
  // ── Alemán (ISO 639-2/B = GER, ISO 639-2/T = DEU) ───────────────────────
  DE: "Alemán",
  GER: "Alemán",
  DEU: "Alemán",
  // ── Italiano ─────────────────────────────────────────────────────────────
  IT: "Italiano",
  ITA: "Italiano",
  // ── Portugués ────────────────────────────────────────────────────────────
  PT: "Portugués",
  POR: "Portugués",
  // ── Japonés ──────────────────────────────────────────────────────────────
  JA: "Japonés",
  JPN: "Japonés",
  // ── Coreano ──────────────────────────────────────────────────────────────
  KO: "Coreano",
  KOR: "Coreano",
  // ── Chino (ISO 639-2/B = CHI, ISO 639-2/T = ZHO) ────────────────────────
  ZH: "Chino",
  CHI: "Chino",
  ZHO: "Chino",
  // ── Árabe ────────────────────────────────────────────────────────────────
  AR: "Árabe",
  ARA: "Árabe",
  // ── Ruso ─────────────────────────────────────────────────────────────────
  RU: "Ruso",
  RUS: "Ruso",
  // ── Turco ────────────────────────────────────────────────────────────────
  TR: "Turco",
  TUR: "Turco",
  // ── Polaco ───────────────────────────────────────────────────────────────
  PL: "Polaco",
  POL: "Polaco",
  // ── Neerlandés (ISO 639-2/B = DUT, ISO 639-2/T = NLD) ───────────────────
  NL: "Neerlandés",
  DUT: "Neerlandés",
  NLD: "Neerlandés",
  // ── Sueco ────────────────────────────────────────────────────────────────
  SV: "Sueco",
  SWE: "Sueco",
  // ── Noruego ──────────────────────────────────────────────────────────────
  NO: "Noruego",
  NOR: "Noruego",
  NOB: "Noruego",
  NNO: "Noruego",
  // ── Danés ────────────────────────────────────────────────────────────────
  DA: "Danés",
  DAN: "Danés",
  // ── Finlandés ────────────────────────────────────────────────────────────
  FI: "Finlandés",
  FIN: "Finlandés",
  // ── Hebreo ───────────────────────────────────────────────────────────────
  HE: "Hebreo",
  HEB: "Hebreo",
  // ── Húngaro ──────────────────────────────────────────────────────────────
  HU: "Húngaro",
  HUN: "Húngaro",
  // ── Checo (ISO 639-2/B = CZE, ISO 639-2/T = CES) ────────────────────────
  CS: "Checo",
  CZE: "Checo",
  CES: "Checo",
  // ── Eslovaco (ISO 639-2/B = SLO, ISO 639-2/T = SLK) ─────────────────────
  SK: "Eslovaco",
  SLO: "Eslovaco",
  SLK: "Eslovaco",
  // ── Rumano (ISO 639-2/B = RUM, ISO 639-2/T = RON) ────────────────────────
  RO: "Rumano",
  ROM: "Rumano",
  RUM: "Rumano",
  RON: "Rumano",
  // ── Griego (ISO 639-2/B = GRE, ISO 639-2/T = ELL) ───────────────────────
  EL: "Griego",
  GRE: "Griego",
  ELL: "Griego",
  // ── Tailandés ────────────────────────────────────────────────────────────
  TH: "Tailandés",
  THA: "Tailandés",
  // ── Vietnamita ───────────────────────────────────────────────────────────
  VI: "Vietnamita",
  VIE: "Vietnamita",
  // ── Indonesio ────────────────────────────────────────────────────────────
  ID: "Indonesio",
  IND: "Indonesio",
  // ── Malayo (ISO 639-2/B = MAY, ISO 639-2/T = MSA) ───────────────────────
  MS: "Malayo",
  MAY: "Malayo",
  MSA: "Malayo",
  // ── Hindi ────────────────────────────────────────────────────────────────
  HI: "Hindi",
  HIN: "Hindi",
  // ── Catalán ──────────────────────────────────────────────────────────────
  CA: "Catalán",
  CAT: "Catalán",
  // ── Latín ────────────────────────────────────────────────────────────────
  LA: "Latín",
  LAT: "Latín",
  // ── Euskera ──────────────────────────────────────────────────────────────
  EU: "Euskera",
  EUS: "Euskera",
  BAQ: "Euskera",
  // ── Gallego ──────────────────────────────────────────────────────────────
  GL: "Gallego",
  GLG: "Gallego",
  // ── Ucraniano ────────────────────────────────────────────────────────────
  UK: "Ucraniano",
  UKR: "Ucraniano",
  // ── Croata ───────────────────────────────────────────────────────────────
  HR: "Croata",
  HRV: "Croata",
  // ── Serbio ───────────────────────────────────────────────────────────────
  SR: "Serbio",
  SRP: "Serbio",
  SCR: "Serbio",
  // ── Búlgaro ──────────────────────────────────────────────────────────────
  BG: "Búlgaro",
  BUL: "Búlgaro",
  // ── Esloveno ─────────────────────────────────────────────────────────────
  SL: "Esloveno",
  SLV: "Esloveno",
  // ── Lituano ──────────────────────────────────────────────────────────────
  LT: "Lituano",
  LIT: "Lituano",
  // ── Letón ────────────────────────────────────────────────────────────────
  LV: "Letón",
  LAV: "Letón",
  // ── Estonio ──────────────────────────────────────────────────────────────
  ET: "Estonio",
  EST: "Estonio",
  // ── Albanés ──────────────────────────────────────────────────────────────
  SQ: "Albanés",
  ALB: "Albanés",
  SQI: "Albanés",
};

/** Maps an ISO 639-2 language code (e.g. "SPA") to its Spanish display name. Falls back to the uppercased code. */
export function formatLanguage(code: string): string {
  return LANG_NAMES[code.toUpperCase()] ?? code.toUpperCase();
}

/** Maps an array of language codes to display names, joined by " · ". */
export function formatLanguages(codes: string[]): string {
  return codes.map(formatLanguage).join(" · ");
}
