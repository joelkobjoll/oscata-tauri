/**
 * Transport layer: routes invoke() calls to Tauri commands in desktop mode,
 * or to the HTTP REST API in WEBGUI (browser) mode.
 */

export function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

/** Origin of the web API (same-origin in WEBGUI mode). */
export const apiBase = "/api";

/** Bearer token key in localStorage (web mode only). */
const TOKEN_KEY = "oscata_web_token";

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}

// Command-name → [HTTP method, URL path] mapping for web mode
const WEB_ROUTES: Record<
  string,
  | [string, string]
  | ((args: Record<string, unknown>) => [string, string, unknown?])
> = {
  has_config: ["GET", "/settings/has-config"],
  get_config: ["GET", "/settings"],
  save_config: ["PUT", "/settings"],
  get_all_media: ["GET", "/media"],
  get_downloads: ["GET", "/downloads"],
  clear_completed: ["POST", "/downloads/clear-completed"],
  get_webgui_config: ["GET", "/webgui/config"],
  save_webgui_config: ["PUT", "/webgui/config"],
  // Dynamic paths:
  queue_download: (a) => [
    "POST",
    "/downloads",
    {
      ftp_path: a.ftp_path ?? a.ftpPath,
      filename: a.filename,
      media_title: a.media_title ?? a.mediaTitle ?? null,
    },
  ],
  cancel_download: (a) => ["POST", `/downloads/${a.id}/cancel`],
  delete_download: (a) => ["DELETE", `/downloads/${a.id}`],
  retry_download: (a) => ["POST", `/downloads/${a.id}/retry`],
  set_max_concurrent: (a) => ["PUT", "/downloads/concurrency", { max: a.max }],
  start_indexing: ["POST", "/indexing/start"],
  get_indexing_status: ["GET", "/indexing/status"],
  rematch_all: ["POST", "/indexing/rematch"],
  refresh_all_metadata: ["POST", "/indexing/refresh-metadata"],
  clear_item_metadata: (a) => ["DELETE", `/media/${a.id}/metadata`],
  clear_all_metadata: ["POST", "/media/clear-all-metadata"],
  check_media_badges: (a) => ["POST", "/media/badges", { items: a.items }],
  apply_tmdb_match: (a) => [
    "PUT",
    `/media/${a.id}/match`,
    { tmdb_id: a.tmdbId, media_type: a.mediaType },
  ],
  search_tmdb: (a) => [
    "POST",
    "/tmdb/search",
    { query: a.query, media_type: a.mediaType, year: a.year },
  ],
  get_watchlist: ["GET", "/watchlist"],
  add_to_watchlist: (a) => [
    "POST",
    "/watchlist",
    {
      tmdb_id: a.tmdbId,
      tmdb_type: a.tmdbType,
      title: a.title,
      title_en: a.titleEn,
      poster: a.poster,
      overview: a.overview,
      overview_en: a.overviewEn,
      release_date: a.releaseDate,
      year: a.year,
      scope: a.scope,
      auto_download: a.autoDownload,
      profile_id: a.profileId,
    },
  ],
  remove_from_watchlist: (a) => ["DELETE", `/watchlist/${a.id}`],
  update_watchlist_item: (a) => [
    "PUT",
    `/watchlist/${a.id}`,
    { scope: a.scope, auto_download: a.autoDownload, profile_id: a.profileId },
  ],
  check_watchlist_item: (a) => ["GET", `/watchlist/check/${a.tmdbId}`],
  get_watchlist_coverage: (a) => ["GET", `/watchlist/${a.tmdbId}/coverage`],
  get_tv_seasons: (a) => ["GET", `/watchlist/${a.tmdbId}/seasons`],
  get_quality_profiles: ["GET", "/quality-profiles"],
  create_quality_profile: (a) => [
    "POST",
    "/quality-profiles",
    {
      name: a.name,
      min_resolution: a.minResolution,
      preferred_resolution: a.preferredResolution,
      prefer_hdr: a.preferHdr,
      preferred_codecs: a.preferredCodecs,
      preferred_audio_codecs: a.preferredAudioCodecs,
      preferred_release_types: a.preferredReleaseTypes,
      min_size_gb: a.minSizeGb,
      max_size_gb: a.maxSizeGb,
    },
  ],
  update_quality_profile: (a) => [
    "PUT",
    `/quality-profiles/${a.id}`,
    {
      name: a.name,
      min_resolution: a.minResolution,
      preferred_resolution: a.preferredResolution,
      prefer_hdr: a.preferHdr,
      preferred_codecs: a.preferredCodecs,
      preferred_audio_codecs: a.preferredAudioCodecs,
      preferred_release_types: a.preferredReleaseTypes,
      min_size_gb: a.minSizeGb,
      max_size_gb: a.maxSizeGb,
    },
  ],
  delete_quality_profile: (a) => ["DELETE", `/quality-profiles/${a.id}`],
  // Personal Telegram subscription
  get_telegram_sub: ["GET", "/notifications/subscription"],
  link_telegram_bot: (a) => [
    "POST",
    "/notifications/subscription/link",
    { bot_token: a.botToken },
  ],
  update_telegram_sub: (a) => [
    "PUT",
    "/notifications/subscription",
    { notify_new_content: a.notifyNewContent, notify_downloads: a.notifyDownloads },
  ],
  revoke_telegram_sub: ["DELETE", "/notifications/subscription"],
};

export async function call<T>(
  command: string,
  args: Record<string, unknown> = {},
): Promise<T> {
  if (isTauri()) {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<T>(command, args);
  }
  // Web mode: look up route
  const route = WEB_ROUTES[command];
  if (!route)
    throw new Error(`[transport] No web route for command "${command}"`);

  let method: string;
  let path: string;
  let body: unknown = undefined;

  if (typeof route === "function") {
    const result = route(args);
    [method, path, body] = result;
  } else {
    [method, path] = route;
    // For PUT/POST, pass the first VALUE in args as body (e.g., save_config passes {config: ...})
    const values = Object.values(args);
    if ((method === "PUT" || method === "POST") && values.length === 1) {
      body = values[0];
    }
  }

  const token = getToken();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const response = await fetch(`${apiBase}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (!response.ok) {
    const err = await response
      .json()
      .catch(() => ({ error: response.statusText }));
    throw new Error(err.error ?? `HTTP ${response.status}`);
  }

  const text = await response.text();
  return text ? (JSON.parse(text) as T) : (undefined as T);
}
