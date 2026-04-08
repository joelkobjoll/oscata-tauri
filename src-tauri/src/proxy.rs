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

use crate::tmdb::{TmdbEpisode, TmdbMovie, TmdbSeason};

fn build_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .map_err(|e| e.to_string())
}

/// `GET /v1/search?query=…&type=…&year=…`
pub async fn search_proxy(
    base_url: &str,
    api_key: &str,
    query: &str,
    media_type: &str,
    hint_year: Option<u16>,
) -> Result<Vec<TmdbMovie>, String> {
    let base = base_url.trim_end_matches('/');
    let encoded = urlencoding::encode(query);
    let type_param = if media_type == "tv" { "tv" } else { "movie" };
    let mut url = format!("{base}/v1/search?query={encoded}&type={type_param}");
    if let Some(y) = hint_year {
        url.push_str(&format!("&year={y}"));
    }

    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct SearchResult {
        tmdb_id: Option<i64>,
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
    let resp = client
        .get(&url)
        .header("x-api-key", api_key)
        .send()
        .await
        .map_err(|e| format!("proxy search request failed: {e}"))?;

    if !resp.status().is_success() {
        let status = resp.status().as_u16();
        let body = resp.text().await.unwrap_or_default();
        return Err(format!("proxy search returned HTTP {status}: {body}"));
    }

    let parsed: SearchResponse = resp
        .json()
        .await
        .map_err(|e| format!("proxy search parse error: {e}"))?;

    let movies = parsed
        .results
        .into_iter()
        .filter_map(|r| {
            let id = r.tmdb_id?;
            Some(TmdbMovie {
                id,
                imdb_id: None,
                title: r.title,
                title_en: r.title_en,
                release_date: r.release_date,
                overview: r.overview,
                overview_en: None,
                poster_path: r.poster_url,
                poster_path_en: None,
                vote_average: r.vote_average,
                genre_ids: vec![],
                genres: vec![],
                runtime_mins: None,
                origin_country: None,
            })
        })
        .collect();

    Ok(movies)
}

/// `GET /v1/title/tmdb/{mediaType}/{tmdbId}`
pub async fn fetch_by_proxy_tmdb_id(
    base_url: &str,
    api_key: &str,
    tmdb_id: i64,
    media_type: &str,
) -> Result<TmdbMovie, String> {
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

/// Iterate `GET /v1/title/imdb/{imdbId}/seasons/{n}` from 1 upwards using
/// IMDb-sourced data (cached by the proxy).  Stops on 404 / empty or the cap.
pub async fn fetch_proxy_seasons_by_imdb_id(
    base_url: &str,
    api_key: &str,
    imdb_id: &str,
) -> Result<Vec<TmdbSeason>, String> {
    const MAX_SEASONS: u32 = 30;
    let base = base_url.trim_end_matches('/');
    let encoded_id = urlencoding::encode(imdb_id);
    let client = build_client()?;
    let mut seasons = Vec::new();

    for n in 1..=MAX_SEASONS {
        let url = format!("{base}/v1/title/imdb/{encoded_id}/seasons/{n}");
        let resp = client
            .get(&url)
            .header("x-api-key", api_key)
            .send()
            .await
            .map_err(|e| format!("proxy imdb seasons request failed: {e}"))?;

        if resp.status().as_u16() == 404 {
            break;
        }
        if !resp.status().is_success() {
            break;
        }

        #[derive(Deserialize)]
        #[serde(rename_all = "camelCase")]
        struct ImdbSeasonEpisode {
            episode_number: i64,
            name: String,
            air_date: Option<String>,
            overview: Option<String>,
        }

        #[derive(Deserialize)]
        #[serde(rename_all = "camelCase")]
        struct ImdbSeason {
            season_number: i64,
            name: String,
            air_date: Option<String>,
            episodes: Vec<ImdbSeasonEpisode>,
        }

        let ps: ImdbSeason = resp
            .json()
            .await
            .map_err(|e| format!("proxy imdb season {n} parse error: {e}"))?;

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
        let resp = client
            .get(&url)
            .header("x-api-key", api_key)
            .send()
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
}

async fn fetch_title_document(url: &str, api_key: &str) -> Result<TitleDocument, String> {
    let client = build_client()?;
    let resp = client
        .get(url)
        .header("x-api-key", api_key)
        .send()
        .await
        .map_err(|e| format!("proxy request failed: {e}"))?;

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
        genre_ids: vec![],
        genres: doc.genres,
        runtime_mins: doc.runtime_mins,
        origin_country: doc.origin_country,
    }
}
