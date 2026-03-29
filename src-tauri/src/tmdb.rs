use serde::{Deserialize, Serialize};
use serde::de::DeserializeOwned;
use std::collections::HashMap;
use std::sync::LazyLock;
use std::time::{Duration, Instant};

static TMDB_LAST_REQUEST_AT: LazyLock<tokio::sync::Mutex<Instant>> =
    LazyLock::new(|| tokio::sync::Mutex::new(Instant::now() - Duration::from_secs(1)));
const TMDB_MIN_REQUEST_INTERVAL: Duration = Duration::from_millis(35);

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct TmdbMovie {
    pub id: i64,
    pub imdb_id: Option<String>,
    pub title: String,
    pub title_en: Option<String>,
    pub release_date: Option<String>,
    pub overview: Option<String>,
    pub overview_en: Option<String>,
    pub poster_path: Option<String>,
    pub poster_path_en: Option<String>,
    pub vote_average: Option<f64>,
    #[serde(default)]
    pub genre_ids: Vec<i64>,
}

#[derive(Debug, Clone)]
struct LocalizedTmdbResult {
    id: i64,
    title: String,
    release_date: Option<String>,
    overview: Option<String>,
    poster_path: Option<String>,
    vote_average: Option<f64>,
    genre_ids: Vec<i64>,
}

fn title_similarity_score(title: &str, query: &str) -> f64 {
    let title_lower = title.to_lowercase();
    let query_lower = query.to_lowercase();

    if title_lower.is_empty() || query_lower.is_empty() {
        return 0.0;
    }

    if title_lower == query_lower {
        return 100.0;
    }

    if title_lower.contains(&query_lower) || query_lower.contains(&title_lower) {
        return 50.0;
    }

    let query_words: std::collections::HashSet<&str> = query_lower.split_whitespace().collect();
    let title_words: std::collections::HashSet<&str> = title_lower.split_whitespace().collect();
    let overlap = query_words.intersection(&title_words).count() as f64;
    let total = query_words.len().max(title_words.len()).max(1) as f64;
    (overlap / total) * 40.0
}

fn score_result(result: &TmdbMovie, query: &str, year: Option<u16>) -> f64 {
    let mut score = title_similarity_score(&result.title, query).max(
        result.title_en
            .as_deref()
            .map(|title| title_similarity_score(title, query))
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
                score += 30.0;
            } else if diff == 1 {
                score += 15.0;
            }
        }
    }

    score + result.vote_average.unwrap_or(0.0) * 0.5
}

fn truncate_for_error(value: &str, max_chars: usize) -> String {
    let mut out = String::new();
    for (idx, ch) in value.chars().enumerate() {
        if idx >= max_chars {
            out.push_str("...");
            break;
        }
        out.push(ch);
    }
    if out.is_empty() {
        "<empty body>".to_string()
    } else {
        out
    }
}

async fn throttle_tmdb_request() {
    let mut last_request = TMDB_LAST_REQUEST_AT.lock().await;
    let elapsed = last_request.elapsed();
    if elapsed < TMDB_MIN_REQUEST_INTERVAL {
        tokio::time::sleep(TMDB_MIN_REQUEST_INTERVAL - elapsed).await;
    }
    *last_request = Instant::now();
}

async fn fetch_json_with_retry<T: DeserializeOwned>(url: &str, context: &str) -> Result<T, String> {
    const MAX_ATTEMPTS: u8 = 3;
    let client = reqwest::Client::new();
    let mut last_error = String::new();

    for attempt in 1..=MAX_ATTEMPTS {
        throttle_tmdb_request().await;
        match client.get(url).send().await {
            Ok(response) => {
                let status = response.status();
                match response.text().await {
                    Ok(body) => {
                        if !status.is_success() {
                            last_error = format!(
                                "TMDB {context} failed (HTTP {}): {}",
                                status.as_u16(),
                                truncate_for_error(&body, 220)
                            );
                        } else {
                            match serde_json::from_str::<T>(&body) {
                                Ok(parsed) => return Ok(parsed),
                                Err(err) => {
                                    last_error = format!(
                                        "TMDB {context} decode error: {err}. Body: {}",
                                        truncate_for_error(&body, 220)
                                    );
                                }
                            }
                        }
                    }
                    Err(err) => {
                        last_error = format!("TMDB {context} body read error: {err}");
                    }
                }
            }
            Err(err) => {
                last_error = format!("TMDB {context} request error: {err}");
            }
        }

        if attempt < MAX_ATTEMPTS {
            tokio::time::sleep(std::time::Duration::from_millis(250 * attempt as u64)).await;
        }
    }

    Err(last_error)
}

async fn fetch_search_results_lang(
    api_key: &str,
    query: &str,
    year: Option<u16>,
    endpoint: &str,
    language: &str,
) -> Result<Vec<LocalizedTmdbResult>, String> {
    let encoded = urlencoding::encode(query);
    let year_param = year.map(|y| format!("&year={y}")).unwrap_or_default();
    let url = format!(
        "https://api.themoviedb.org/3/search/{endpoint}?api_key={api_key}&query={encoded}{year_param}&language={language}&page=1"
    );

    #[derive(Deserialize)]
    struct AnyResult {
        id: i64,
        title: Option<String>,
        name: Option<String>,
        release_date: Option<String>,
        first_air_date: Option<String>,
        overview: Option<String>,
        poster_path: Option<String>,
        vote_average: Option<f64>,
        #[serde(default)]
        genre_ids: Vec<i64>,
    }
    #[derive(Deserialize)]
    struct AnyResponse {
        results: Vec<AnyResult>,
    }

    let resp: AnyResponse = fetch_json_with_retry(&url, "search request").await?;

    Ok(resp
        .results
        .into_iter()
        .map(|r| LocalizedTmdbResult {
            id: r.id,
            title: r.name.or(r.title).unwrap_or_default(),
            release_date: r.first_air_date.or(r.release_date),
            overview: r.overview,
            poster_path: r.poster_path,
            vote_average: r.vote_average,
            genre_ids: r.genre_ids,
        })
        .collect())
}

async fn search_endpoint_results(
    api_key: &str,
    query: &str,
    year: Option<u16>,
    endpoint: &str,
) -> Result<Vec<TmdbMovie>, String> {
    let mut spanish = fetch_search_results_lang(api_key, query, year, endpoint, "es-ES").await?;
    let mut english = fetch_search_results_lang(api_key, query, year, endpoint, "en-US").await?;

    if spanish.is_empty() && english.is_empty() {
        if let Some(_) = year {
            spanish = fetch_search_results_lang(api_key, query, None, endpoint, "es-ES").await?;
            english = fetch_search_results_lang(api_key, query, None, endpoint, "en-US").await?;
        }
    }

    let mut by_id: HashMap<i64, TmdbMovie> = HashMap::new();

    for result in spanish {
        by_id
            .entry(result.id)
            .and_modify(|movie| {
                movie.title = result.title.clone();
                movie.release_date = result.release_date.clone().or(movie.release_date.clone());
                movie.overview = result.overview.clone().or(movie.overview.clone());
                movie.poster_path = result.poster_path.clone().or(movie.poster_path.clone());
                movie.vote_average = result.vote_average.or(movie.vote_average);
                if movie.genre_ids.is_empty() {
                    movie.genre_ids = result.genre_ids.clone();
                }
            })
            .or_insert(TmdbMovie {
                id: result.id,
                imdb_id: None,
                title: result.title,
                title_en: None,
                release_date: result.release_date,
                overview: result.overview,
                overview_en: None,
                poster_path: result.poster_path,
                poster_path_en: None,
                vote_average: result.vote_average,
                genre_ids: result.genre_ids,
            });
    }

    for result in english {
        by_id
            .entry(result.id)
            .and_modify(|movie| {
                if movie.title.is_empty() {
                    movie.title = result.title.clone();
                }
                movie.title_en = Some(result.title.clone());
                if movie.release_date.is_none() {
                    movie.release_date = result.release_date.clone();
                }
                movie.overview_en = result.overview.clone();
                if movie.overview.is_none() {
                    movie.overview = result.overview.clone();
                }
                movie.poster_path_en = result.poster_path.clone();
                if movie.poster_path.is_none() {
                    movie.poster_path = result.poster_path.clone();
                }
                movie.vote_average = movie.vote_average.or(result.vote_average);
                if movie.genre_ids.is_empty() {
                    movie.genre_ids = result.genre_ids.clone();
                }
            })
            .or_insert(TmdbMovie {
                id: result.id,
                imdb_id: None,
                title: result.title.clone(),
                title_en: Some(result.title),
                release_date: result.release_date,
                overview: result.overview.clone(),
                overview_en: result.overview,
                poster_path: result.poster_path.clone(),
                poster_path_en: result.poster_path,
                vote_average: result.vote_average,
                genre_ids: result.genre_ids,
            });
    }

    let mut results: Vec<_> = by_id.into_values().collect();
    results.sort_by(|a, b| {
        score_result(b, query, year)
            .partial_cmp(&score_result(a, query, year))
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    Ok(results)
}

pub async fn smart_search(
    api_key: &str,
    title: &str,
    year: Option<u16>,
    preferred_type: &str,
) -> Result<Option<TmdbMovie>, String> {
    let primary = search_endpoint_results(api_key, title, year, preferred_type).await?;
    let primary_best = primary.first().cloned();

    if let Some(ref movie) = primary_best {
        if score_result(movie, title, year) >= 50.0 {
            return Ok(primary_best);
        }
    }

    let other = if preferred_type == "tv" { "movie" } else { "tv" };
    let secondary = search_endpoint_results(api_key, title, year, other).await?;
    let secondary_best = secondary.first().cloned();

    Ok(match (primary_best, secondary_best) {
        (Some(p), Some(s)) => {
            if score_result(&s, title, year) > score_result(&p, title, year) {
                Some(s)
            } else {
                Some(p)
            }
        }
        (Some(p), None) => Some(p),
        (None, Some(s)) => Some(s),
        (None, None) => None,
    })
}

pub async fn search_movie(
    api_key: &str,
    title: &str,
    year: Option<u16>,
) -> Result<Option<TmdbMovie>, String> {
    Ok(search_endpoint_results(api_key, title, year, "movie").await?.into_iter().next())
}

pub async fn search_tmdb_multi(api_key: &str, query: &str, media_type: &str) -> Result<Vec<TmdbMovie>, String> {
    let endpoint = if media_type == "tv" { "tv" } else { "movie" };
    let mut results = search_endpoint_results(api_key, query, None, endpoint).await?;
    results.truncate(10);
    Ok(results)
}

async fn fetch_detail_lang(
    api_key: &str,
    tmdb_id: i64,
    endpoint: &str,
    language: &str,
) -> Result<LocalizedTmdbResult, String> {
    let url = format!("https://api.themoviedb.org/3/{endpoint}/{tmdb_id}?api_key={api_key}&language={language}");

    #[derive(Deserialize)]
    struct Detail {
        id: i64,
        title: Option<String>,
        name: Option<String>,
        release_date: Option<String>,
        first_air_date: Option<String>,
        overview: Option<String>,
        poster_path: Option<String>,
        vote_average: Option<f64>,
        #[serde(default)]
        genres: Vec<Genre>,
    }
    #[derive(Deserialize)]
    struct Genre {
        id: i64,
    }

    let detail: Detail = fetch_json_with_retry(&url, "detail request").await?;

    Ok(LocalizedTmdbResult {
        id: detail.id,
        title: detail.name.or(detail.title).unwrap_or_default(),
        release_date: detail.first_air_date.or(detail.release_date),
        overview: detail.overview,
        poster_path: detail.poster_path,
        vote_average: detail.vote_average,
        genre_ids: detail.genres.into_iter().map(|g| g.id).collect(),
    })
}

async fn fetch_imdb_id(
    api_key: &str,
    tmdb_id: i64,
    endpoint: &str,
) -> Result<Option<String>, String> {
    let url = format!(
        "https://api.themoviedb.org/3/{endpoint}/{tmdb_id}/external_ids?api_key={api_key}"
    );

    #[derive(Deserialize)]
    struct ExternalIds {
        imdb_id: Option<String>,
    }

    let ids: ExternalIds = fetch_json_with_retry(&url, "external ids request").await?;

    Ok(ids.imdb_id.filter(|value| !value.trim().is_empty()))
}

pub async fn fetch_movie_by_id(api_key: &str, tmdb_id: i64, media_type: &str) -> Result<TmdbMovie, String> {
    let endpoint = if media_type == "tv" { "tv" } else { "movie" };
    let spanish = fetch_detail_lang(api_key, tmdb_id, endpoint, "es-ES").await?;
    let english = fetch_detail_lang(api_key, tmdb_id, endpoint, "en-US").await?;
    let imdb_id = fetch_imdb_id(api_key, tmdb_id, endpoint).await.ok().flatten();

    Ok(TmdbMovie {
        id: spanish.id,
        imdb_id,
        title: if spanish.title.is_empty() {
            english.title.clone()
        } else {
            spanish.title.clone()
        },
        title_en: if english.title.is_empty() {
            None
        } else {
            Some(english.title.clone())
        },
        release_date: spanish.release_date.or(english.release_date),
        overview: spanish.overview.clone().or(english.overview.clone()),
        overview_en: english.overview,
        poster_path: spanish.poster_path.clone().or(english.poster_path.clone()),
        poster_path_en: english.poster_path.or(spanish.poster_path),
        vote_average: spanish.vote_average.or(english.vote_average),
        genre_ids: if spanish.genre_ids.is_empty() {
            english.genre_ids
        } else {
            spanish.genre_ids
        },
    })
}

pub async fn validate_api_key(api_key: &str) -> bool {
    let url = format!("https://api.themoviedb.org/3/configuration?api_key={api_key}");
    reqwest::get(&url)
        .await
        .map(|r| r.status().is_success())
        .unwrap_or(false)
}
