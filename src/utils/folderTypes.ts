export type FolderTypeValue = "movie" | "tv" | "documentary" | "mixed";

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
    return {};
  }

  try {
    return JSON.parse(trimmed) as Record<string, FolderTypeValue>;
  } catch {
    return {};
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
