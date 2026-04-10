/// Unified metadata service that dispatches to either the TMDB client
/// (`crate::tmdb`) or the metadata-proxy client (`crate::proxy`) based on
/// `AppConfig.metadata_provider`.
///
/// All public functions mirror the signatures of the underlying `tmdb` module
/// so call sites only need to change their import.
use crate::db::AppConfig;
use crate::tmdb::{TmdbMovie, TmdbSeason};

// ── Config helpers ────────────────────────────────────────────────────────────

fn is_proxy(cfg: &AppConfig) -> bool {
    cfg.metadata_provider.as_str() == "proxy"
}

// ── Public API ────────────────────────────────────────────────────────────────

/// Validate the active metadata configuration.
/// Returns `true` when the credentials are accepted by the upstream service.
pub async fn validate_config(cfg: &AppConfig) -> bool {
    if is_proxy(cfg) {
        crate::proxy::validate_proxy_config(&cfg.proxy_url, &cfg.proxy_api_key).await
    } else {
        crate::tmdb::validate_api_key(&cfg.tmdb_api_key).await
    }
}

/// Search for the best single match for `title` (with optional `year`).
/// Returns the winner alongside the effective media type ("movie" or "tv").
pub async fn smart_search(
    cfg: &AppConfig,
    title: &str,
    year: Option<u16>,
    preferred_type: &str,
) -> Result<Option<(TmdbMovie, &'static str)>, String> {
    if is_proxy(cfg) {
        // Documentaries: FilmAffinity is the primary source — it has far better coverage
        // for non-English documentary titles than TMDB/IMDb search.
        if preferred_type == "documentary" {
            let results = crate::proxy::search_proxy_documentary(
                &cfg.proxy_url, &cfg.proxy_api_key, title, year, &cfg.proxy_search_provider,
            ).await?;
            if let Some((movie, mt)) = results.into_iter().next() {
                return Ok(Some((movie, mt)));
            }
            return Ok(None);
        }

        // Proxy search: try preferred type, accept opposite if score is low.
        let primary: &'static str = if preferred_type == "tv" { "tv" } else { "movie" };
        let other: &'static str = if preferred_type == "tv" { "movie" } else { "tv" };

        // Run both type searches concurrently — each call already searches all 3 providers
        // (configured, other direct provider, FilmAffinity) in parallel internally.
        let (primary_res, other_res) = tokio::join!(
            crate::proxy::search_proxy(&cfg.proxy_url, &cfg.proxy_api_key, title, primary, year, &cfg.proxy_search_provider),
            crate::proxy::search_proxy(&cfg.proxy_url, &cfg.proxy_api_key, title, other,   year, &cfg.proxy_search_provider),
        );

        if let Ok(mut r) = primary_res {
            if let Some(best) = r.drain(..).next() {
                return Ok(Some((best, primary)));
            }
        }
        if let Ok(mut r) = other_res {
            if let Some(best) = r.drain(..).next() {
                return Ok(Some((best, other)));
            }
        }

        Ok(None)
    } else {
        crate::tmdb::smart_search(&cfg.tmdb_api_key, title, year, preferred_type).await
    }
}

/// Return up to 10 candidate results for the Fix-Match / manual search UI.
pub async fn search_multi_with_year(
    cfg: &AppConfig,
    query: &str,
    media_type: &str,
    hint_year: Option<u16>,
) -> Result<Vec<TmdbMovie>, String> {
    if is_proxy(cfg) {
        // For documentaries, FA is queried first (better coverage for non-English docs).
        if media_type == "documentary" {
            let results = crate::proxy::search_proxy_documentary(
                &cfg.proxy_url, &cfg.proxy_api_key, query, hint_year, &cfg.proxy_search_provider,
            ).await?;
            return Ok(results.into_iter().map(|(m, _)| m).collect());
        }
        crate::proxy::search_proxy_fa_multi(&cfg.proxy_url, &cfg.proxy_api_key, query, media_type, hint_year, &cfg.proxy_search_provider)
            .await
    } else {
        crate::tmdb::search_tmdb_multi_with_year(
            &cfg.tmdb_api_key,
            query,
            media_type,
            hint_year,
        )
        .await
    }
}

/// Fetch full movie/show details by TMDB numeric ID.
pub async fn fetch_by_id(
    cfg: &AppConfig,
    tmdb_id: i64,
    media_type: &str,
) -> Result<TmdbMovie, String> {
    if is_proxy(cfg) {
        crate::proxy::fetch_by_proxy_tmdb_id(
            &cfg.proxy_url,
            &cfg.proxy_api_key,
            tmdb_id,
            media_type,
        )
        .await
    } else {
        crate::tmdb::fetch_movie_by_id(&cfg.tmdb_api_key, tmdb_id, media_type).await
    }
}

/// Fetch all seasons (excluding specials) for a TV show.
pub async fn fetch_tv_seasons(
    cfg: &AppConfig,
    tmdb_id: i64,
    _imdb_id: Option<&str>,
) -> Result<Vec<TmdbSeason>, String> {
    if is_proxy(cfg) {
        crate::proxy::fetch_proxy_seasons(&cfg.proxy_url, &cfg.proxy_api_key, tmdb_id).await
    } else {
        crate::tmdb::fetch_tv_seasons(&cfg.tmdb_api_key, tmdb_id).await
    }
}

/// Resolve metadata by IMDb ID.
pub async fn find_by_imdb_id(
    cfg: &AppConfig,
    imdb_id: &str,
    preferred_type: &str,
) -> Result<Option<TmdbMovie>, String> {
    if is_proxy(cfg) {
        crate::proxy::find_proxy_by_imdb_id(
            &cfg.proxy_url,
            &cfg.proxy_api_key,
            imdb_id,
            preferred_type,
        )
        .await
    } else {
        crate::tmdb::find_by_imdb_id(&cfg.tmdb_api_key, imdb_id, preferred_type).await
    }
}
