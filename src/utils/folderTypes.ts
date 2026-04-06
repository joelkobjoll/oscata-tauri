export type FolderTypeValue = "movie" | "tv" | "documentary" | "mixed";

export const DEFAULT_FOLDER_TYPES: Record<string, FolderTypeValue> = {
  "Documentales 4K 2160p - HD 1080p": "documentary",
  "P-Peticiones": "mixed",
  "Peliculas BDRemux 1080p": "movie",
  "Peliculas BDrip 1080p X264": "movie",
  "Peliculas BDrip 1080p X265": "movie",
  "Peliculas UHDRemux 2160p": "movie",
  "Peliculas WEB DL Micro 1080p": "movie",
  "Peliculas WEB DL-UHDRip 2160p": "movie",
  "Peliculas y Series mas antiguas": "mixed",
  "Series 4K 2160p": "tv",
  "Series HD 1080p": "tv",
};

export const DEFAULT_FOLDER_TYPES_STRING = JSON.stringify(DEFAULT_FOLDER_TYPES);

const REMOVED_FOLDER_TYPE_KEYS = new Set([
  "Peliculas",
  "Series",
  "Documentales",
  "Movies",
  "Documentaries",
  "TV Shows",
  "Series HD 1080p X265",
]);

const LEGACY_DEFAULT_FOLDER_TYPES = JSON.stringify({
  Peliculas: "movie",
  Series: "tv",
  Documentales: "documentary",
  Movies: "movie",
  Documentaries: "documentary",
});

function sanitizeFolderTypes(
  value: Record<string, FolderTypeValue>,
): Record<string, FolderTypeValue> {
  return Object.fromEntries(
    Object.entries(value).filter(([key]) => !REMOVED_FOLDER_TYPE_KEYS.has(key)),
  ) as Record<string, FolderTypeValue>;
}

function normalizeFolderName(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

export function parseFolderTypes(
  raw: string | null | undefined,
): Record<string, FolderTypeValue> {
  const trimmed = raw?.trim() ?? "";
  if (!trimmed || trimmed === "{}" || trimmed === LEGACY_DEFAULT_FOLDER_TYPES) {
    return { ...DEFAULT_FOLDER_TYPES };
  }

  try {
    const parsed = JSON.parse(trimmed) as Record<string, FolderTypeValue>;
    return { ...DEFAULT_FOLDER_TYPES, ...sanitizeFolderTypes(parsed) };
  } catch {
    return { ...DEFAULT_FOLDER_TYPES };
  }
}

export function inferFolderType(dir: string): FolderTypeValue | "" {
  const normalized = normalizeFolderName(dir);

  const isDocumentary =
    /(documental|documentary|documentaries|docs?)(\b|$)/.test(normalized);
  const isTv = /(series|tv|shows?)(\b|$)/.test(normalized);
  const isMovie = /(peliculas|pelicula|movies?|films?)(\b|$)/.test(normalized);
  const isMixed =
    /(peticiones|peticion|request|requests|mixto|mixed|varios|older|antiguas|antiguos)/.test(
      normalized,
    ) ||
    (isMovie && isTv);

  if (isMixed) return "mixed";
  if (isDocumentary) return "documentary";
  if (isTv) return "tv";
  if (isMovie) return "movie";
  return "";
}

export function mergeInferredFolderTypes(
  existingRaw: string | null | undefined,
  dirs: string[],
): string {
  const existing = parseFolderTypes(existingRaw);
  const next: Record<string, FolderTypeValue> = { ...existing };

  for (const dir of dirs) {
    if (next[dir]) {
      continue;
    }
    const inferred = inferFolderType(dir);
    if (inferred) {
      next[dir] = inferred;
    }
  }

  return JSON.stringify(next);
}
