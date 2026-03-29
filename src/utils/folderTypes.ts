export type FolderTypeValue = "movie" | "tv" | "documentary" | "mixed";

export const DEFAULT_FOLDER_TYPES: Record<string, FolderTypeValue> = {
  Peliculas: "movie",
  Series: "tv",
  Documentales: "documentary",
  Movies: "movie",
  "TV Shows": "tv",
  Documentaries: "documentary",
  "Documentales 4K 2160p - HD 1080p": "documentary",
  "P-Peticiones": "mixed",
  "Peliculas BDRemux 1080p": "movie",
  "Peliculas BDrip 1080p X264": "movie",
  "Peliculas BDrip 1080p X265": "movie",
  "Peliculas UHDRemux 2160p": "movie",
  "Peliculas WEB DL Micro 1080p": "movie",
  "Peliculas WEB DL-UHDRip 2160p": "movie",
  "Peliculas y Series mas antiguas": "movie",
  "Series 4K 2160p": "tv",
  "Series HD 1080p": "tv",
  "Series HD 1080p X265": "tv",
};

export const DEFAULT_FOLDER_TYPES_STRING = JSON.stringify(DEFAULT_FOLDER_TYPES);

const LEGACY_DEFAULT_FOLDER_TYPES = JSON.stringify({
  Peliculas: "movie",
  Series: "tv",
  Documentales: "documentary",
  Movies: "movie",
  "TV Shows": "tv",
  Documentaries: "documentary",
});

function normalizeFolderName(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

export function parseFolderTypes(raw: string | null | undefined): Record<string, FolderTypeValue> {
  const trimmed = raw?.trim() ?? "";
  if (!trimmed || trimmed === "{}" || trimmed === LEGACY_DEFAULT_FOLDER_TYPES) {
    return { ...DEFAULT_FOLDER_TYPES };
  }

  try {
    return JSON.parse(trimmed) as Record<string, FolderTypeValue>;
  } catch {
    return { ...DEFAULT_FOLDER_TYPES };
  }
}

export function inferFolderType(dir: string): FolderTypeValue | "" {
  const normalized = normalizeFolderName(dir);

  const isDocumentary = /(documental|documentary|documentaries|docs?)(\b|$)/.test(normalized);
  const isTv = /(series|tv|shows?)(\b|$)/.test(normalized);
  const isMovie = /(peliculas|pelicula|movies?|films?)(\b|$)/.test(normalized);
  const isMixed = /(peticiones|peticion|request|requests|mixto|mixed|varios|older|antiguas|antiguos)/.test(normalized)
    || (isMovie && isTv);

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
