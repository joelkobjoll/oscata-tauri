/// Client for the metadata-proxy service (https://metadata.kobjoll.es/docs).
///
/// Authentication: `x-api-key: <key>` header on every request.
///
/// Poster URLs returned by the proxy are already fully qualified (e.g.
/// `https://image.tmdb.org/t/p/w500/...`) and are stored as-is in
/// `TmdbMovie.poster_path`. The frontend helper `resolveImageUrl` in
/// `src/utils/mediaLanguage.ts` normalises both proxy full-URLs and plain
/// TMDB paths transparently.
use serde::Deserialize;
use std::sync::OnceLock;
use tokio::sync::Mutex;
use tokio::time::Instant;

use crate::tmdb::{TmdbEpisode, TmdbMovie, TmdbSeason};

// ── Global rate-limit gate ────────────────────────────────────────────────────
//
// Stores the earliest Instant at which the next proxy request may be sent.
// All proxy functions call `wait_for_rate_limit()` before making any HTTP
// request and call `record_rate_limit_headers()` after every response.

static BACKOFF_UNTIL: OnceLock<Mutex<Instant>> = OnceLock::new();

fn backoff_mutex() -> &'static Mutex<Instant> {
    BACKOFF_UNTIL.get_or_init(|| Mutex::new(Instant::now()))
}

/// Block until the global backoff clears.
async fn wait_for_rate_limit() {
    let until = {
        let guard = backoff_mutex().lock().await;
        *guard
    };
    let now = Instant::now();
    if until > now {
        tokio::time::sleep_until(until).await;
    }
}

/// After a successful response, read rate-limit headers and proactively set
/// the backoff if remaining calls are very low.
fn record_rate_limit_headers(resp: &reqwest::Response) {
    let remaining = resp
        .headers()
        .get("x-ratelimit-remaining")
        .and_then(|v| v.to_str().ok())
        .and_then(|s| s.parse::<u64>().ok());
    let reset_ts = resp
        .headers()
        .get("x-ratelimit-reset")
        .and_then(|v| v.to_str().ok())
        .and_then(|s| s.parse::<u64>().ok());

    // When fewer than 5 calls remain, calculate the sleep needed until reset
    // and apply it so the next request fires just after the window rolls over.
    if let (Some(rem), Some(reset)) = (remaining, reset_ts) {
        if rem < 5 {
            let now_unix = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_secs();
            let wait_secs = reset.saturating_sub(now_unix) + 1;
            if wait_secs > 0 && wait_secs < 120 {
                let until = Instant::now() + std::time::Duration::from_secs(wait_secs);
                if let Ok(mut guard) = backoff_mutex().try_lock() {
                    if until > *guard {
                        *guard = until;
                    }
                }
            }
        }
    }
}

/// Set a backoff from a `retryAfterSeconds` value in a 429 body.
fn set_backoff_secs(secs: u64) {
    let until = Instant::now() + std::time::Duration::from_secs(secs.max(1).min(120));
    // Use blocking lock via std — we're already in an async context but only
    // need a non-contested write, so try_lock is fine.
    if let Ok(mut guard) = backoff_mutex().try_lock() {
        if until > *guard {
            *guard = until;
        }
    }
}

/// Parse `{"error":"Rate limit exceeded","retryAfterSeconds":N}` from a body.
fn parse_retry_after(body: &str) -> Option<u64> {
    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct RateError {
        retry_after_seconds: u64,
    }
    serde_json::from_str::<RateError>(body).ok().map(|e| e.retry_after_seconds)
}


fn build_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .map_err(|e| e.to_string())
}

/// Rate-limit-aware GET helper.
///
/// Behaviour:
/// 1. Awaits the global backoff gate before sending the request.
/// 2. Reads `x-ratelimit-remaining` after a successful response; if it falls
///    below 5, proactively sleeps until the `x-ratelimit-reset` window.
/// 3. On HTTP 429, parses `retryAfterSeconds` from the response body, sets
///    the global backoff, sleeps, then retries **once**.
async fn proxy_get(client: &reqwest::Client, url: &str, api_key: &str) -> Result<reqwest::Response, String> {
    // ── First attempt ──────────────────────────────────────────────────────
    wait_for_rate_limit().await;
    let resp = client
        .get(url)
        .header("x-api-key", api_key)
        .send()
        .await
        .map_err(|e| format!("proxy request failed: {e}"))?;

    if resp.status().as_u16() == 429 {
        let body = resp.text().await.unwrap_or_default();
        let wait_secs = parse_retry_after(&body).unwrap_or(5);
        eprintln!("[proxy] 429 rate limit — waiting {wait_secs}s before retry");
        set_backoff_secs(wait_secs);
        // ── Retry once after backoff ───────────────────────────────────────
        wait_for_rate_limit().await;
        let retry = client
            .get(url)
            .header("x-api-key", api_key)
            .send()
            .await
            .map_err(|e| format!("proxy retry request failed: {e}"))?;
        record_rate_limit_headers(&retry);
        return Ok(retry);
    }

    record_rate_limit_headers(&resp);
    Ok(resp)
}

/// `GET /v1/search?query=…&type=…&year=…&provider=…`
/// `provider` is `"tmdb"` (default) or `"imdb"` — IMDb mode uses the free
/// IMDb suggestion API (no TMDB quota).
pub async fn search_proxy(
    base_url: &str,
    api_key: &str,
    query: &str,
    media_type: &str,
    hint_year: Option<u16>,
    provider: &str,
) -> Result<Vec<TmdbMovie>, String> {
    let api_key = api_key.trim();
    if api_key.is_empty() {
        return Err("proxy_api_key no está configurado — ve a Ajustes → Metadatos y guarda tu API key del proxy".to_string());
    }
    let base = base_url.trim_end_matches('/');
    let encoded = urlencoding::encode(query);
    let type_param = if media_type == "tv" { "tv" } else { "movie" };
    // Only pass provider when it's not the default ("tmdb") to stay backward-compat.
    let provider_param = if provider == "imdb" { "&provider=imdb" } else { "" };
    let mut url = format!("{base}/v1/search?query={encoded}&type={type_param}{provider_param}");
    if let Some(y) = hint_year {
        url.push_str(&format!("&year={y}"));
    }

    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct SearchResult {
        tmdb_id: Option<i64>,
        imdb_id: Option<String>,
        title: String,
        title_en: Option<String>,
        overview: Option<String>,
        poster_url: Option<String>,
        release_date: Option<String>,
        vote_average: Option<f64>,
    }

    #[derive(Deserialize)]
    struct SearchResponse {
        results: Vec<SearchResult>,
    }

    let client = build_client()?;
    let resp = proxy_get(&client, &url, api_key).await?;

    if !resp.status().is_success() {
        let status = resp.status().as_u16();
        let body = resp.text().await.unwrap_or_default();
        return Err(format!("proxy search returned HTTP {status}: {body}"));
    }

    let parsed: SearchResponse = resp
        .json()
        .await
        .map_err(|e| format!("proxy search parse error: {e}"))?;

    let mut movies: Vec<TmdbMovie> = Vec::new();
    // Items returned by the proxy without a tmdb_id need an extra resolve call.
    // This is common when provider=imdb, since IMDb search doesn't map to TMDB.
    let mut to_resolve: Vec<String> = Vec::new();

    for r in parsed.results {
        if let Some(id) = r.tmdb_id {
            movies.push(TmdbMovie {
                id,
                imdb_id: r.imdb_id,
                title: r.title,
                title_en: r.title_en,
                release_date: r.release_date,
                overview: r.overview,
                overview_en: None,
                poster_path: r.poster_url,
                poster_path_en: None,
                vote_average: r.vote_average,
                imdb_rating: None,
                genre_ids: vec![],
                genres: vec![],
                runtime_mins: None,
                origin_country: None,
            });
        } else if let Some(iid) = r.imdb_id {
            to_resolve.push(iid);
        }
    }

    // Resolve items with an IMDb ID but no TMDB ID.
    // Capped at 3 per search to limit added latency.
    for iid in to_resolve.into_iter().take(3) {
        let resolve_url = format!("{base}/v1/title/imdb/{}", urlencoding::encode(&iid));
        if let Ok(doc) = fetch_title_document(&resolve_url, api_key).await {
            // Only include the item if the proxy has a TMDB ID for it.
            if doc.tmdb_id.is_some() {
                let tmdb_id = doc.tmdb_id;
                let imdb_stored = doc.imdb_id.clone();
                movies.push(title_document_to_movie(doc, tmdb_id, imdb_stored));
            }
        }
    }

    Ok(movies)
}

/// `GET /v1/title/tmdb/{mediaType}/{tmdbId}`
pub async fn fetch_by_proxy_tmdb_id(
    base_url: &str,
    api_key: &str,
    tmdb_id: i64,
    media_type: &str,
) -> Result<TmdbMovie, String> {
    let api_key = api_key.trim();
    if api_key.is_empty() {
        return Err("proxy_api_key no está configurado".to_string());
    }
    let base = base_url.trim_end_matches('/');
    let mt = if media_type == "tv" { "tv" } else { "movie" };
    let url = format!("{base}/v1/title/tmdb/{mt}/{tmdb_id}");

    let doc = fetch_title_document(&url, api_key).await?;
    Ok(title_document_to_movie(doc, Some(tmdb_id), None))
}

/// `GET /v1/title/imdb/{imdbId}?type=…`
pub async fn find_proxy_by_imdb_id(
    base_url: &str,
    api_key: &str,
    imdb_id: &str,
    preferred_type: &str,
) -> Result<Option<TmdbMovie>, String> {
    let api_key = api_key.trim();
    if api_key.is_empty() {
        return Err("proxy_api_key no está configurado".to_string());
    }
    let imdb = imdb_id.trim();
    if imdb.is_empty() {
        return Ok(None);
    }
    let base = base_url.trim_end_matches('/');
    let mt = if preferred_type == "tv" { "tv" } else { "movie" };
    let url = format!(
        "{base}/v1/title/imdb/{}?type={mt}",
        urlencoding::encode(imdb)
    );

    let doc = fetch_title_document(&url, api_key).await?;
    let tmdb_id = doc.tmdb_id;
    let imdb_stored = doc.imdb_id.clone();
    Ok(Some(title_document_to_movie(doc, tmdb_id, imdb_stored)))
}

/// Test proxy connectivity.
/// Returns `true` if the server responds to a search request successfully.
pub async fn validate_proxy_config(base_url: &str, api_key: &str) -> bool {
    let base = base_url.trim_end_matches('/');
    let url = format!("{base}/v1/search?query=test&type=movie");
    let client = match build_client() {
        Ok(c) => c,
        Err(_) => return false,
    };
    client
        .get(&url)
        .header("x-api-key", api_key)
        .send()
        .await
        .map(|r| r.status().is_success())
        .unwrap_or(false)
}

/// Iterate `GET /v1/title/tmdb/tv/{tmdbId}/seasons/{n}` from 1 upwards
/// until a non-success response is received (or the cap is reached).
pub async fn fetch_proxy_seasons(
    base_url: &str,
    api_key: &str,
    tmdb_id: i64,
) -> Result<Vec<TmdbSeason>, String> {
    const MAX_SEASONS: u32 = 30;
    let base = base_url.trim_end_matches('/');
    let client = build_client()?;
    let mut seasons = Vec::new();

    for n in 1..=MAX_SEASONS {
        let url = format!("{base}/v1/title/tmdb/tv/{tmdb_id}/seasons/{n}");
        let resp = proxy_get(&client, &url, api_key)
            .await
            .map_err(|e| format!("proxy seasons request failed: {e}"))?;

        if resp.status().as_u16() == 404 {
            break;
        }
        if !resp.status().is_success() {
            break;
        }

        #[derive(Deserialize)]
        #[serde(rename_all = "camelCase")]
        struct ProxySeasonEpisode {
            episode_number: i64,
            name: String,
            air_date: Option<String>,
            overview: Option<String>,
        }

        #[derive(Deserialize)]
        #[serde(rename_all = "camelCase")]
        struct ProxySeason {
            season_number: i64,
            name: String,
            air_date: Option<String>,
            episodes: Vec<ProxySeasonEpisode>,
        }

        let ps: ProxySeason = resp
            .json()
            .await
            .map_err(|e| format!("proxy season {n} parse error: {e}"))?;

        if ps.episodes.is_empty() {
            break;
        }

        let episode_count = ps.episodes.len();
        let episodes = ps
            .episodes
            .into_iter()
            .map(|e| TmdbEpisode {
                episode_number: e.episode_number,
                name: e.name,
                air_date: e.air_date,
                overview: e.overview,
            })
            .collect();

        seasons.push(TmdbSeason {
            season_number: ps.season_number,
            name: ps.name,
            air_date: ps.air_date,
            episode_count,
            episodes,
        });
    }

    Ok(seasons)
}

// ── Helpers ───────────────────────────────────────────────────────────────────

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ResolveResponse {
    data: TitleDocument,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct TitleDocument {
    tmdb_id: Option<i64>,
    imdb_id: Option<String>,
    title: String,
    title_en: Option<String>,
    overview: Option<String>,
    overview_en: Option<String>,
    poster_url: Option<String>,
    poster_url_en: Option<String>,
    release_date: Option<String>,
    runtime_mins: Option<u32>,
    origin_country: Option<String>,
    #[serde(default)]
    genres: Vec<String>,
    vote_average: Option<f64>,
    imdb_rating: Option<f64>,
}

async fn fetch_title_document(url: &str, api_key: &str) -> Result<TitleDocument, String> {
    let api_key = api_key.trim();
    let client = build_client()?;
    let resp = proxy_get(&client, url, api_key).await?;

    if !resp.status().is_success() {
        let status = resp.status().as_u16();
        let body = resp.text().await.unwrap_or_default();
        return Err(format!("proxy returned HTTP {status}: {body}"));
    }

    let resolved: ResolveResponse = resp
        .json()
        .await
        .map_err(|e| format!("proxy response parse error: {e}"))?;

    Ok(resolved.data)
}

fn title_document_to_movie(
    doc: TitleDocument,
    tmdb_id_override: Option<i64>,
    imdb_id_override: Option<String>,
) -> TmdbMovie {
    let id = tmdb_id_override
        .or(doc.tmdb_id)
        .unwrap_or(-1);

    TmdbMovie {
        id,
        imdb_id: imdb_id_override.or(doc.imdb_id),
        title: doc.title,
        title_en: doc.title_en,
        release_date: doc.release_date,
        overview: doc.overview,
        overview_en: doc.overview_en,
        poster_path: doc.poster_url,
        poster_path_en: doc.poster_url_en,
        vote_average: doc.vote_average,
        imdb_rating: doc.imdb_rating,
        genre_ids: vec![],
        genres: doc.genres,
        runtime_mins: doc.runtime_mins,
        origin_country: doc.origin_country,
    }
}
