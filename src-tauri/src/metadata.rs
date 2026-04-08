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
        // Proxy search: try preferred type, accept opposite if score is low.
        let primary: &'static str = if preferred_type == "tv" { "tv" } else { "movie" };
        let other: &'static str = if preferred_type == "tv" { "movie" } else { "tv" };

        let primary_results =
            crate::proxy::search_proxy(&cfg.proxy_url, &cfg.proxy_api_key, title, primary, year, &cfg.proxy_search_provider)
                .await?;

        if let Some(best) = primary_results.into_iter().next() {
            return Ok(Some((best, primary)));
        }

        let other_results =
            crate::proxy::search_proxy(&cfg.proxy_url, &cfg.proxy_api_key, title, other, year, &cfg.proxy_search_provider)
                .await?;

        if let Some(best) = other_results.into_iter().next() {
            return Ok(Some((best, other)));
        }

        // Neither type returned a result with the configured provider.
        // Fall back to the IMDb search provider if we weren't already using it —
        // IMDb has broader coverage for non-English / obscure titles.
        if cfg.proxy_search_provider != "imdb" {
            let imdb_primary =
                crate::proxy::search_proxy(&cfg.proxy_url, &cfg.proxy_api_key, title, primary, year, "imdb")
                    .await?;
            if let Some(best) = imdb_primary.into_iter().next() {
                return Ok(Some((best, primary)));
            }

            let imdb_other =
                crate::proxy::search_proxy(&cfg.proxy_url, &cfg.proxy_api_key, title, other, year, "imdb")
                    .await?;
            if let Some(best) = imdb_other.into_iter().next() {
                return Ok(Some((best, other)));
            }
        }

        Ok(None)
    } else {
        crate::tmdb::smart_search(&cfg.tmdb_api_key, title, year, preferred_type).await
    }
}

/// Return up to 10 candidate results for the Fix-Match / manual search UI.
pub async fn search_multi(
    cfg: &AppConfig,
    query: &str,
    media_type: &str,
) -> Result<Vec<TmdbMovie>, String> {
    search_multi_with_year(cfg, query, media_type, None).await
}

/// Same as `search_multi` but accepts an explicit year hint for scoring.
pub async fn search_multi_with_year(
    cfg: &AppConfig,
    query: &str,
    media_type: &str,
    hint_year: Option<u16>,
) -> Result<Vec<TmdbMovie>, String> {
    if is_proxy(cfg) {
        crate::proxy::search_proxy(&cfg.proxy_url, &cfg.proxy_api_key, query, media_type, hint_year, &cfg.proxy_search_provider)
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
