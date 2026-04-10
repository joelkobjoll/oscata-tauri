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

/// Deserialize a year value that may arrive as either a JSON string ("2026") or a
/// JSON integer (2026). The FA search endpoint returns years as strings; all other
/// proxy endpoints use integers. Using `serde_json::Value` as the middle step avoids
/// a silent parse failure that would wipe out the entire FA results list.
fn deserialize_year_flexible<'de, D>(d: D) -> Result<Option<i32>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    use serde::de::{Unexpected, Visitor};
    struct Flex;
    impl<'de> Visitor<'de> for Flex {
        type Value = Option<i32>;
        fn expecting(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result {
            write!(f, "an integer or string year, or null")
        }
        fn visit_i64<E: serde::de::Error>(self, v: i64) -> Result<Self::Value, E> {
            Ok(Some(v as i32))
        }
        fn visit_u64<E: serde::de::Error>(self, v: u64) -> Result<Self::Value, E> {
            Ok(Some(v as i32))
        }
        fn visit_str<E: serde::de::Error>(self, v: &str) -> Result<Self::Value, E> {
            match v.trim().parse::<i32>() {
                Ok(n) => Ok(Some(n)),
                Err(_) => Err(E::invalid_value(Unexpected::Str(v), &self)),
            }
        }
        fn visit_none<E: serde::de::Error>(self) -> Result<Self::Value, E> { Ok(None) }
        fn visit_unit<E: serde::de::Error>(self) -> Result<Self::Value, E> { Ok(None) }
    }
    d.deserialize_any(Flex)
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


fn get_client() -> &'static reqwest::Client {
    static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
    CLIENT.get_or_init(|| {
        reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(15))
            .build()
            .expect("failed to build HTTP client")
    })
}

/// Rate-limit-aware GET helper.
///
/// Behaviour:
/// 1. Awaits the global backoff gate before sending the request.
/// 2. Reads `x-ratelimit-remaining` after a successful response; if it falls
///    below 5, proactively sleeps until the `x-ratelimit-reset` window.
/// 3. On HTTP 429, parses `retryAfterSeconds` from the response body, sets
///    the global backoff, sleeps, then retries **once**.
async fn proxy_get(url: &str, api_key: &str) -> Result<reqwest::Response, String> {
    let client = get_client();
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
    // For tmdb/imdb providers, request inline FilmAffinity alternative titles so we can
    // re-query with the canonical original title if the primary results are empty.
    let provider_param = match provider {
        "imdb"         => "&provider=imdb&includeAlternativeTitles=true",
        "filmaffinity" => "&provider=filmaffinity",
        _              => "&includeAlternativeTitles=true", // tmdb default
    };
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
        overview_en: Option<String>,
        poster_url: Option<String>,
        release_date: Option<String>,
        vote_average: Option<f64>,
    }

    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct SearchResponse {
        results: Vec<SearchResult>,
        /// Inline FA results returned when `includeAlternativeTitles=true` is set.
        #[serde(default)]
        alternative_titles: Vec<FaSearchResult>,
    }

    let resp = proxy_get(&url, api_key).await?;

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
                overview_en: r.overview_en,
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

    // Resolve items with an IMDb ID but no TMDB ID — run in parallel.
    // Capped at 3 per search to limit added latency.
    let imdb_futs = to_resolve.into_iter().take(3).map(|iid| {
        let url = format!("{base}/v1/title/imdb/{}", urlencoding::encode(&iid));
        let key = api_key.to_string();
        async move { fetch_title_document(&url, &key).await.ok() }
    });
    for doc_opt in futures::future::join_all(imdb_futs).await {
        if let Some(doc) = doc_opt {
            if doc.tmdb_id.is_some() {
                let tmdb_id = doc.tmdb_id;
                let imdb_stored = doc.imdb_id.clone();
                movies.push(title_document_to_movie(doc, tmdb_id, imdb_stored));
            }
        }
    }

    // If the direct search found nothing, use the inline FA alternative titles as a hint:
    // re-query with the best-scoring FA original title (the canonical international name).
    // Fire all candidate re-queries concurrently instead of sequentially.
    if movies.is_empty() && !parsed.alternative_titles.is_empty() {
        let norm_q = crate::tmdb::normalise(query);
        let mut hints = parsed.alternative_titles;
        hints.sort_by(|a, b| {
            let sa = score_fa_result(a, query, hint_year);
            let sb = score_fa_result(b, query, hint_year);
            sb.partial_cmp(&sa).unwrap_or(std::cmp::Ordering::Equal)
        });

        // Collect (url, local_title, orig_title) for top-3 hints (both title variants).
        let base_s = base.to_string();
        let key_s  = api_key.to_string();
        let type_s = type_param.to_string();
        let prov_s = provider_param.to_string();
        let candidates: Vec<(String, String, String)> = hints.iter().take(3).flat_map(|fa| {
            let mut v = Vec::new();
            for title in [fa.original_title.as_str(), fa.local_title.as_str()] {
                if title.is_empty() || crate::tmdb::normalise(title) == norm_q { continue; }
                let enc = urlencoding::encode(title);
                let mut url = format!("{base_s}/v1/search?query={enc}&type={type_s}{prov_s}");
                if let Some(y) = hint_year { url.push_str(&format!("&year={y}")); }
                v.push((url, fa.local_title.clone(), fa.original_title.clone()));
            }
            v
        }).collect();

        // Fire all candidate re-queries concurrently.
        let retry_futs = candidates.into_iter().map(|(url, local, orig)| {
            let key = key_s.clone();
            async move {
                let resp = proxy_get(&url, &key).await.ok()?;
                if !resp.status().is_success() { return None; }
                let parsed2: SearchResponse = resp.json().await.ok()?;
                if parsed2.results.is_empty() { return None; }
                Some((parsed2.results, local, orig))
            }
        });

        let mut seen_retry: std::collections::HashSet<i64> = std::collections::HashSet::new();
        for opt in futures::future::join_all(retry_futs).await {
            if let Some((results, local, orig)) = opt {
                let batch: Vec<TmdbMovie> = results.into_iter().filter_map(|r| {
                    r.tmdb_id.map(|id| TmdbMovie {
                        id,
                        imdb_id: r.imdb_id,
                        title: r.title,
                        title_en: r.title_en,
                        release_date: r.release_date,
                        overview: r.overview,
                        overview_en: r.overview_en,
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
                    })
                }).collect();
                for m in pick_best_by_fa_titles(batch, &local, &orig).into_iter().take(2) {
                    if seen_retry.insert(m.id) { movies.push(m); }
                }
            }
        }
    }

    Ok(movies)
}

/// FilmAffinity-specific result shape returned by `provider=filmaffinity`.
/// As of the current API version, FA results only carry basic metadata —
/// no embedded TMDB or IMDb objects. Only title-based re-querying is possible.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct FaSearchResult {
    local_title: String,
    original_title: String,
    /// The FA endpoint returns year as a JSON string ("2026"); other endpoints use integers.
    /// The flexible deserializer handles both to prevent a silent total-parse failure.
    #[serde(default, deserialize_with = "deserialize_year_flexible")]
    year: Option<i32>,
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

    let resp = match proxy_get(&url, api_key).await {
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

/// Score each `TmdbMovie` in `results` against both FA titles and return the list
/// sorted descending by the highest score across all three title signals.
/// Used by `search_proxy` (single-best) and `search_proxy_fa_multi` (full list).
fn pick_best_by_fa_titles(
    results: Vec<TmdbMovie>,
    local_title: &str,
    original_title: &str,
) -> Vec<TmdbMovie> {
    let mut scored: Vec<(TmdbMovie, f64)> = results
        .into_iter()
        .map(|m| {
            let m_title = if m.title.is_empty() {
                m.title_en.clone().unwrap_or_default()
            } else {
                m.title.clone()
            };
            let s1 = crate::tmdb::title_similarity_score(&m_title, local_title);
            let s2 = crate::tmdb::title_similarity_score(&m_title, original_title);
            let score = s1.max(s2);
            (m, score)
        })
        .collect();
    scored.sort_by(|(_, a), (_, b)| b.partial_cmp(a).unwrap_or(std::cmp::Ordering::Equal));
    scored.into_iter().map(|(m, _)| m).collect()
}

/// Run the full FilmAffinity search + score + resolution pipeline for a single media type.
/// Returns a deduplicated `Vec<TmdbMovie>`. Never fails — returns empty on any error.
async fn search_fa_resolved(
    base: &str,
    api_key: &str,
    query: &str,
    media_type: &str,
    hint_year: Option<u16>,
    provider: &str,
) -> Vec<TmdbMovie> {
    let fa_results = search_filmaffinity_results(base, api_key, query, media_type, hint_year).await;
    if fa_results.is_empty() {
        return vec![];
    }
    let mut scored: Vec<(FaSearchResult, f64)> = fa_results
        .into_iter()
        .map(|r| { let s = score_fa_result(&r, query, hint_year); (r, s) })
        .filter(|(_, s)| *s >= 20.0)
        .collect();
    scored.sort_by(|(_, a), (_, b)| b.partial_cmp(a).unwrap_or(std::cmp::Ordering::Equal));
    resolve_fa_scored(base, api_key, query, media_type, hint_year, provider, scored, 10).await
}

/// Fire TMDB, IMDb, and FilmAffinity searches simultaneously and merge results.
///
/// Order in the returned list:
///   1. `preferred_provider` (tmdb/imdb per settings) — highest priority / full data
///   2. The other direct provider
///   3. FilmAffinity-resolved results (BOTH movie + tv types)
///
/// The direct-provider searches respect the requested `media_type`. FA is searched
/// for **both** media types because FilmAffinity's internal classification often differs
/// from TMDB's — e.g. a mini-series that TMDB calls "tv" may be under "movie" on FA.
/// All searches run concurrently; results are deduplicated by TMDB ID.
async fn search_all_parallel(
    base: &str,
    api_key: &str,
    query: &str,
    media_type: &str,
    hint_year: Option<u16>,
    preferred_provider: &str,
) -> Vec<TmdbMovie> {
    let other_provider: &str = if preferred_provider == "imdb" { "tmdb" } else { "imdb" };

    // Step 1: fire both direct-provider searches concurrently — usually 1 RTT.
    let (preferred_res, other_res) = tokio::join!(
        async { search_proxy_direct(base, api_key, query, media_type, hint_year, preferred_provider).await.unwrap_or_default() },
        async { search_proxy_direct(base, api_key, query, media_type, hint_year, other_provider).await.unwrap_or_default() },
    );

    let mut movies: Vec<TmdbMovie> = Vec::new();
    let mut seen: std::collections::HashSet<i64> = std::collections::HashSet::new();
    for m in preferred_res { if seen.insert(m.id) { movies.push(m); } }
    for m in other_res     { if seen.insert(m.id) { movies.push(m); } }

    // Step 2: FA requires at least 2 serial round-trips (search → re-query each candidate),
    // so only run it when the direct providers returned nothing.
    if movies.is_empty() {
        let fa_other_type: &str = if media_type == "tv" { "movie" } else { "tv" };
        let (fa_res, fa_other_res) = tokio::join!(
            search_fa_resolved(base, api_key, query, media_type,    hint_year, preferred_provider),
            search_fa_resolved(base, api_key, query, fa_other_type, hint_year, preferred_provider),
        );
        for m in fa_res        { if seen.insert(m.id) { movies.push(m); } }
        for m in fa_other_res  { if seen.insert(m.id) { movies.push(m); } }
    }

    movies
}

/// Fire TMDB, IMDb, and FilmAffinity searches simultaneously
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
    Ok(search_all_parallel(base, api_key, query, media_type, hint_year, provider).await)
}

/// Shared FA resolution loop: takes pre-scored FA results and resolves each into a
/// `TmdbMovie` by re-querying the configured provider with the FA title.
/// FA results no longer carry embedded TMDB/IMDb data, so title re-query is the
/// only available resolution path.
async fn resolve_fa_scored(
    base: &str,
    api_key: &str,
    query: &str,
    media_type: &str,
    hint_year: Option<u16>,
    provider: &str,
    scored: Vec<(FaSearchResult, f64)>,
    limit: usize,
) -> Vec<TmdbMovie> {
    let norm_query = crate::tmdb::normalise(query);

    // Launch title re-queries for each FA result concurrently.
    let tasks = scored.into_iter().take(limit).map(|(fa, _)| {
        let base = base.to_string();
        let api_key = api_key.to_string();
        let media_type = media_type.to_string();
        let provider = provider.to_string();
        let norm_q = norm_query.clone();
        async move {
            let local_title = fa.local_title.clone();
            let original_title = fa.original_title.clone();
            // Try original (canonical international) title first, then localized.
            for title in [original_title.as_str(), local_title.as_str()] {
                if title.is_empty() || crate::tmdb::normalise(title) == norm_q { continue; }
                if let Ok(results) = search_proxy_direct(&base, &api_key, title, &media_type, hint_year, &provider).await {
                    if !results.is_empty() {
                        return pick_best_by_fa_titles(results, &local_title, &original_title)
                            .into_iter().take(2).collect::<Vec<_>>();
                    }
                }
            }
            vec![]
        }
    });
    let batches = futures::future::join_all(tasks).await;

    // Merge and deduplicate by TMDB ID, preserving FA-score order.
    let mut movies: Vec<TmdbMovie> = Vec::new();
    let mut seen: std::collections::HashSet<i64> = std::collections::HashSet::new();
    for batch in batches {
        for m in batch {
            if seen.insert(m.id) { movies.push(m); }
        }
    }
    movies
}

/// Fix-Match / UI search: identical to `search_proxy` but named separately for
/// semantic clarity — returns the full candidate list, not just the first hit.
///
/// All three providers (configured, the other direct provider, FilmAffinity) are
/// queried simultaneously. Results are deduplicated and ordered by provider priority.
pub async fn search_proxy_fa_multi(
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
    Ok(search_all_parallel(base, api_key, query, media_type, hint_year, provider).await)
}

/// Documentary search: FilmAffinity is queried first (better coverage for non-English
/// documentary titles). All providers and both media types (movie + tv) run in parallel
/// — 6 concurrent searches total — so the caller gets the broadest possible candidate set
/// without paying sequential latency penalties.
///
/// Result order: FA-movie, FA-tv, configured-movie, configured-tv, other-movie, other-tv.
/// Returns `(TmdbMovie, media_type)` tuples.
pub async fn search_proxy_documentary(
    base_url: &str,
    api_key: &str,
    query: &str,
    hint_year: Option<u16>,
    provider: &str,
) -> Result<Vec<(TmdbMovie, &'static str)>, String> {
    let api_key = api_key.trim();
    if api_key.is_empty() {
        return Err("proxy_api_key no está configurado — ve a Ajustes → Metadatos y guarda tu API key del proxy".to_string());
    }
    let base = base_url.trim_end_matches('/');
    let other_provider: &str = if provider == "imdb" { "tmdb" } else { "imdb" };

    // Step 1: fire all four direct-provider searches concurrently (movie + tv, both providers).
    let (pref_movie, pref_tv, other_movie, other_tv) = tokio::join!(
        async { search_proxy_direct(base, api_key, query, "movie", hint_year, provider).await.unwrap_or_default() },
        async { search_proxy_direct(base, api_key, query, "tv",    hint_year, provider).await.unwrap_or_default() },
        async { search_proxy_direct(base, api_key, query, "movie", hint_year, other_provider).await.unwrap_or_default() },
        async { search_proxy_direct(base, api_key, query, "tv",    hint_year, other_provider).await.unwrap_or_default() },
    );

    let mut all_movies: Vec<(TmdbMovie, &'static str)> = Vec::new();
    let mut seen: std::collections::HashSet<i64> = std::collections::HashSet::new();
    for m in pref_movie  { if seen.insert(m.id) { all_movies.push((m, "movie")); } }
    for m in pref_tv     { if seen.insert(m.id) { all_movies.push((m, "tv")); } }
    for m in other_movie { if seen.insert(m.id) { all_movies.push((m, "movie")); } }
    for m in other_tv    { if seen.insert(m.id) { all_movies.push((m, "tv")); } }

    // Step 2: FA only when direct providers found nothing.
    if all_movies.is_empty() {
        let (fa_movie, fa_tv) = tokio::join!(
            search_fa_resolved(base, api_key, query, "movie", hint_year, provider),
            search_fa_resolved(base, api_key, query, "tv",    hint_year, provider),
        );
        for m in fa_movie { if seen.insert(m.id) { all_movies.push((m, "movie")); } }
        for m in fa_tv    { if seen.insert(m.id) { all_movies.push((m, "tv")); } }
    }

    Ok(all_movies)
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

    // Documentaries may be classified as either "movie" or "tv" on TMDB.
    // Fetch both types in parallel and return whichever succeeds.
    if media_type == "documentary" {
        let url_tv = format!("{base}/v1/title/tmdb/tv/{tmdb_id}");
        let (movie_res, tv_res) = tokio::join!(
            fetch_title_document(&url, api_key),
            fetch_title_document(&url_tv, api_key),
        );
        return match (movie_res, tv_res) {
            (Ok(doc), _) => Ok(title_document_to_movie(doc, Some(tmdb_id), None)),
            (_, Ok(doc)) => Ok(title_document_to_movie(doc, Some(tmdb_id), None)),
            (Err(e), _)  => Err(e),
        };
    }

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
    proxy_get(&url, api_key)
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
    let mut seasons = Vec::new();

    for n in 1..=MAX_SEASONS {
        let url = format!("{base}/v1/title/tmdb/tv/{tmdb_id}/seasons/{n}");
        let resp = proxy_get(&url, api_key)
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
    let resp = proxy_get(url, api_key).await?;

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
