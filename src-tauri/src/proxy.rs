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

const MIN_PROXY_MATCH_SCORE: f64 = 35.0;
const STRONG_PROXY_MATCH_SCORE: f64 = 50.0;

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
/// Inner search: calls `/v1/search` with the configured provider (tmdb/imdb) and returns
/// TMDB-enriched `TmdbMovie` results. Does not perform a FilmAffinity fallback.
async fn search_proxy_direct(
    base: &str,
    api_key: &str,
    query: &str,
    media_type: &str,
    hint_year: Option<u16>,
    provider: &str,
) -> Result<Vec<TmdbMovie>, String> {
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
                youtube_trailer_url: None,
                imdb_trailer_url: None,
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

/// TMDB data embedded in a FilmAffinity search result (mirrors TitleDocument fields).
/// All fields are optional — the proxy may omit them when not yet populated.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct FaTmdbData {
    tmdb_id: Option<i64>,
    title: Option<String>,
    title_en: Option<String>,
    overview: Option<String>,
    overview_en: Option<String>,
    poster_url: Option<String>,
    poster_url_en: Option<String>,
    release_date: Option<String>,
    vote_average: Option<f64>,
    imdb_rating: Option<f64>,
    youtube_trailer_url: Option<String>,
    imdb_trailer_url: Option<String>,
    #[serde(default)]
    genres: Vec<String>,
    runtime_mins: Option<u32>,
    origin_country: Option<String>,
}

/// IMDb/OMDB data embedded in a FilmAffinity search result.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct FaOmdbData {
    imdb_id: Option<String>,
    imdb_rating: Option<f64>,
    imdb_trailer_url: Option<String>,
}

/// FilmAffinity-specific result shape returned by `provider=filmaffinity`.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct FaSearchResult {
    local_title: String,
    original_title: String,
    year: Option<i32>,
    /// TMDB data embedded by the proxy — present when the proxy has already matched this FA title.
    tmdb: Option<FaTmdbData>,
    /// IMDb/OMDB data embedded by the proxy.
    omdb: Option<FaOmdbData>,
}

/// Convert an embedded `FaTmdbData` (+ optional `FaOmdbData`) into a `TmdbMovie`.
/// Returns `None` when `FaTmdbData.tmdb_id` is absent (can't build a useful movie record).
fn fa_tmdb_to_movie(
    t: FaTmdbData,
    omdb: Option<FaOmdbData>,
    fa_local_title: &str,
    fa_original_title: &str,
) -> Option<TmdbMovie> {
    let id = t.tmdb_id?;
    // Prefer the imdb_id from omdb if available, fall back to tmdb's imdbRating-only approach.
    let imdb_id = omdb.as_ref().and_then(|o| o.imdb_id.clone());
    // Merge trailer/rating from omdb when the tmdb object is missing them.
    let imdb_rating = t.imdb_rating.or_else(|| omdb.as_ref().and_then(|o| o.imdb_rating));
    let imdb_trailer_url = t.imdb_trailer_url.or_else(|| omdb.as_ref().and_then(|o| o.imdb_trailer_url.clone()));

    let title = t
        .title
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| {
            if !fa_local_title.trim().is_empty() {
                fa_local_title.to_string()
            } else {
                fa_original_title.to_string()
            }
        });
    let title_en = t.title_en.or_else(|| {
        let original = fa_original_title.trim();
        if !original.is_empty() && !original.eq_ignore_ascii_case(&title) {
            Some(original.to_string())
        } else {
            None
        }
    });

    Some(TmdbMovie {
        id,
        imdb_id,
        title,
        title_en,
        release_date: t.release_date,
        overview: t.overview,
        overview_en: t.overview_en,
        poster_path: t.poster_url,
        poster_path_en: t.poster_url_en,
        vote_average: t.vote_average,
        imdb_rating,
        youtube_trailer_url: t.youtube_trailer_url,
        imdb_trailer_url,
        genre_ids: vec![],
        genres: t.genres,
        runtime_mins: t.runtime_mins,
        origin_country: t.origin_country,
    })
}

/// Call `/v1/search?provider=filmaffinity` and return raw FilmAffinity results.
/// Returns an empty vec on any error — this is a fallback and must never fail callers.
async fn search_filmaffinity_results(
    base: &str,
    api_key: &str,
    query: &str,
    media_type: &str,
    hint_year: Option<u16>,
) -> Vec<FaSearchResult> {
    let encoded = urlencoding::encode(query);
    let type_param = if media_type == "tv" { "tv" } else { "movie" };
    let mut url = format!("{base}/v1/search?query={encoded}&type={type_param}&provider=filmaffinity");
    if let Some(y) = hint_year {
        url.push_str(&format!("&year={y}"));
    }

    #[derive(Deserialize)]
    struct FaSearchResponse {
        results: Vec<FaSearchResult>,
    }

    let client = match build_client() {
        Ok(c) => c,
        Err(_) => return vec![],
    };
    let resp = match proxy_get(&client, &url, api_key).await {
        Ok(r) => r,
        Err(_) => return vec![],
    };
    if !resp.status().is_success() {
        return vec![];
    }
    resp.json::<FaSearchResponse>().await.map(|r| r.results).unwrap_or_default()
}

/// Score a single FilmAffinity result against `query`.
/// Takes the best score across `localTitle` / `originalTitle` and adds a year bonus.
fn score_fa_result(fa: &FaSearchResult, query: &str, hint_year: Option<u16>) -> f64 {
    let local_score = crate::tmdb::title_similarity_score(&fa.local_title, query);
    let orig_score = crate::tmdb::title_similarity_score(&fa.original_title, query);
    let mut score = local_score.max(orig_score);
    if let (Some(hy), Some(fy)) = (hint_year, fa.year) {
        let diff = (fy - hy as i32).abs();
        if diff == 0 {
            score += 30.0;
        } else if diff <= 1 {
            score += 10.0;
        } else if diff > 3 {
            score -= 20.0;
        }
    }
    score
}

/// Outcome of the FilmAffinity fallback search.
enum FaFallback {
    /// FA result contained embedded TMDB data — use it directly without another HTTP request.
    FullMovie(TmdbMovie),
    /// FA had no embedded TMDB data but provided an original title to re-query with.
    TitleHint(String),
}

/// Search FilmAffinity for `query` and return the best-scoring result as either a
/// ready `TmdbMovie` (when the proxy includes embedded TMDB data) or a plain title
/// hint to re-query the configured provider with.
/// Returns `None` when no confident match is found (score < 25) or FA is unavailable.
async fn filmaffinity_fallback(
    base: &str,
    api_key: &str,
    query: &str,
    media_type: &str,
    hint_year: Option<u16>,
) -> Option<FaFallback> {
    let fa_results = search_filmaffinity_results(base, api_key, query, media_type, hint_year).await;
    if fa_results.is_empty() {
        return None;
    }
    // Find the best-scored FA result above the confidence threshold.
    let (best, _score) = fa_results
        .into_iter()
        .map(|r| {
            let score = score_fa_result(&r, query, hint_year);
            (r, score)
        })
        .filter(|(_, score)| *score >= 25.0)
        .max_by(|(_, a), (_, b)| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal))?;

    // Path 1: FA result already has embedded TMDB data with a valid TMDB ID.
    // Convert it directly — no extra HTTP request needed.
    if let Some(tmdb_data) = best.tmdb {
        if tmdb_data.tmdb_id.is_some() {
            if let Some(movie) = fa_tmdb_to_movie(
                tmdb_data,
                best.omdb,
                &best.local_title,
                &best.original_title,
            ) {
                return Some(FaFallback::FullMovie(movie));
            }
        }
    }

    // Path 2: No embedded TMDB data but we have an original title to search with.
    let original = best.original_title;
    if !original.is_empty() {
        return Some(FaFallback::TitleHint(original));
    }

    None
}

/// `GET /v1/search?query=…&type=…&year=…&provider=…`
///
/// Returns TMDB-enriched results for the configured provider (tmdb/imdb).
/// When no results are found, a FilmAffinity fallback search is attempted: FA is
/// queried to discover the canonical original title (e.g. the International title
/// for a Spanish-language release), which is then used to re-query the configured
/// provider. This enables matching of titles that TMDB/IMDb can only find by their
/// original name.
fn proxy_match_score(result: &TmdbMovie, query: &str, year: Option<u16>) -> f64 {
    let mut score = crate::tmdb::title_similarity_score(&result.title, query).max(
        result
            .title_en
            .as_deref()
            .map(|title| crate::tmdb::title_similarity_score(title, query))
            .unwrap_or(0.0),
    );

    if let Some(y) = year {
        let result_year: Option<i32> = result
            .release_date
            .as_deref()
            .and_then(|d| d.get(..4))
            .and_then(|s| s.parse().ok());
        if let Some(ry) = result_year {
            let diff = (ry - y as i32).abs();
            if diff == 0 {
                score += 50.0;
            } else if diff == 1 {
                score += 20.0;
            } else if diff <= 3 {
                score -= 10.0;
            } else {
                score -= 25.0;
            }
        }
    }

    score + result.vote_average.unwrap_or(0.0) * 0.5
}

fn best_proxy_match_score(results: &[TmdbMovie], query: &str, year: Option<u16>) -> Option<f64> {
    results
        .iter()
        .map(|movie| proxy_match_score(movie, query, year))
        .max_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal))
}

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

    let mut movies = search_proxy_direct(base, api_key, query, media_type, hint_year, provider).await?;
    let needs_filmaffinity_fallback = movies.is_empty()
        || best_proxy_match_score(&movies, query, hint_year)
            .map(|score| score < MIN_PROXY_MATCH_SCORE)
            .unwrap_or(true);

    // FilmAffinity fallback: if the configured provider returned nothing or only
    // low-confidence matches, try FA to either obtain a ready TmdbMovie from
    // embedded TMDB data (no extra request), or discover the canonical original
    // title to re-query with.
    if needs_filmaffinity_fallback {
        match filmaffinity_fallback(base, api_key, query, media_type, hint_year).await {
            Some(FaFallback::FullMovie(movie)) => {
                // FA already had embedded TMDB data — use it directly as the
                // fallback candidate instead of keeping the weak initial hit.
                movies = vec![movie];
            }
            Some(FaFallback::TitleHint(original_title)) => {
                // Only retry when FA gave us something meaningfully different from the
                // query we just tried — avoids a redundant identical request.
                if crate::tmdb::normalise(&original_title) != crate::tmdb::normalise(query) {
                    movies = search_proxy_direct(
                        base,
                        api_key,
                        &original_title,
                        media_type,
                        hint_year,
                        provider,
                    )
                    .await
                    .unwrap_or_default();
                }
            }
            None => {}
        }
    }

    Ok(movies)
}

pub async fn smart_search_proxy(
    base_url: &str,
    api_key: &str,
    title: &str,
    year: Option<u16>,
    preferred_type: &str,
    provider: &str,
) -> Result<Option<(TmdbMovie, &'static str)>, String> {
    let primary: &'static str = if preferred_type == "tv" { "tv" } else { "movie" };
    let other: &'static str = if preferred_type == "tv" { "movie" } else { "tv" };

    let primary_results = search_proxy(base_url, api_key, title, primary, year, provider).await?;
    let primary_best = primary_results.first().cloned();

    if let Some(ref movie) = primary_best {
        if proxy_match_score(movie, title, year) >= STRONG_PROXY_MATCH_SCORE {
            return Ok(primary_best.map(|m| (m, primary)));
        }
    }

    let other_results = search_proxy(base_url, api_key, title, other, year, provider).await?;
    let other_best = other_results.first().cloned();

    let winner = match (primary_best, other_best) {
        (Some(p), Some(s)) => {
            if proxy_match_score(&s, title, year) > proxy_match_score(&p, title, year) {
                Some((s, other))
            } else {
                Some((p, primary))
            }
        }
        (Some(p), None) => Some((p, primary)),
        (None, Some(s)) => Some((s, other)),
        (None, None) => None,
    };

    Ok(winner.filter(|(movie, _)| proxy_match_score(movie, title, year) >= MIN_PROXY_MATCH_SCORE))
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
            runtime_mins: Option<u32>,
            vote_average: Option<f64>,
            still_url: Option<String>,
        }

        #[derive(Deserialize)]
        #[serde(rename_all = "camelCase")]
        struct ProxySeason {
            season_number: i64,
            name: String,
            air_date: Option<String>,
            overview: Option<String>,
            poster_url: Option<String>,
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
                runtime_mins: e.runtime_mins,
                vote_average: e.vote_average,
                still_url: e.still_url,
            })
            .collect();

        seasons.push(TmdbSeason {
            season_number: ps.season_number,
            name: ps.name,
            air_date: ps.air_date,
            episode_count,
            episodes,
            overview: ps.overview,
            poster_url: ps.poster_url,
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
    youtube_trailer_url: Option<String>,
    imdb_trailer_url: Option<String>,
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
        youtube_trailer_url: doc.youtube_trailer_url,
        imdb_trailer_url: doc.imdb_trailer_url,
        genre_ids: vec![],
        genres: doc.genres,
        runtime_mins: doc.runtime_mins,
        origin_country: doc.origin_country,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::{
        extract::{Query, State},
        routing::get,
        Json, Router,
    };
    use serde_json::json;
    use std::{collections::HashMap, sync::Arc};
    use tokio::{net::TcpListener, sync::Mutex};

    #[derive(Clone, Default)]
    struct TestState {
        hits: Arc<Mutex<Vec<String>>>,
    }

    async fn start_test_server(state: TestState) -> String {
        async fn search_handler(
            State(state): State<TestState>,
            Query(params): Query<HashMap<String, String>>,
        ) -> Json<serde_json::Value> {
            let provider = params
                .get("provider")
                .cloned()
                .unwrap_or_else(|| "tmdb".to_string());
            let query = params.get("query").cloned().unwrap_or_default();
            state
                .hits
                .lock()
                .await
                .push(format!("provider={provider};query={query}"));

            let body = if provider == "filmaffinity" {
                json!({
                    "results": [{
                        "localTitle": "La semilla del diablo",
                        "originalTitle": "Rosemary's Baby",
                        "year": 1968,
                        "tmdb": {
                            "tmdbId": 805,
                            "title": "La semilla del diablo",
                            "titleEn": "Rosemary's Baby",
                            "releaseDate": "1968-06-12",
                            "voteAverage": 7.8
                        },
                        "omdb": {
                            "imdbId": "tt0063522"
                        }
                    }]
                })
            } else {
                json!({
                    "results": [{
                        "tmdbId": 999,
                        "imdbId": "tt0118665",
                        "title": "Baby Geniuses",
                        "titleEn": "Baby Geniuses",
                        "releaseDate": "1999-03-10",
                        "voteAverage": 2.7
                    }]
                })
            };

            Json(body)
        }

        let app = Router::new()
            .route("/v1/search", get(search_handler))
            .with_state(state);
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        tokio::spawn(async move {
            axum::serve(listener, app).await.unwrap();
        });
        format!("http://{}", addr)
    }

    #[tokio::test]
    async fn weak_first_proxy_hit_triggers_filmaffinity_fallback() {
        let state = TestState::default();
        let base_url = start_test_server(state.clone()).await;

        let movies = search_proxy(
            &base_url,
            "test-key",
            "La semilla del diablo",
            "movie",
            Some(1968),
            "tmdb",
        )
        .await
        .unwrap();

        let hits = state.hits.lock().await.clone();
        assert_eq!(hits.len(), 2, "expected initial search + FA fallback, got {hits:?}");
        assert!(hits[0].contains("provider=tmdb"), "first hit should use default provider: {hits:?}");
        assert!(hits[1].contains("provider=filmaffinity"), "second hit should use FilmAffinity: {hits:?}");
        assert_eq!(movies.first().map(|m| m.id), Some(805));
        assert_eq!(movies.first().and_then(|m| m.title_en.as_deref()), Some("Rosemary's Baby"));
    }

    #[tokio::test]
    async fn strong_first_proxy_hit_skips_filmaffinity_fallback() {
        let movie = TmdbMovie {
            id: 1,
            imdb_id: None,
            title: "La semilla del diablo".to_string(),
            title_en: Some("Rosemary's Baby".to_string()),
            release_date: Some("1968-06-12".to_string()),
            overview: None,
            overview_en: None,
            poster_path: None,
            poster_path_en: None,
            vote_average: Some(7.8),
            imdb_rating: None,
            youtube_trailer_url: None,
            imdb_trailer_url: None,
            genre_ids: vec![],
            genres: vec![],
            runtime_mins: None,
            origin_country: None,
        };

        assert!(proxy_match_score(&movie, "La semilla del diablo", Some(1968)) >= MIN_PROXY_MATCH_SCORE);
        assert!(proxy_match_score(&movie, "La semilla del diablo", Some(1968)) >= STRONG_PROXY_MATCH_SCORE);
    }
}
