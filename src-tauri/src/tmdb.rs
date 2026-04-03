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

/// Run the three sequential search requests (es-ES, en-US, and optionally a
/// year-less retry pair) concurrently where possible.
///
/// # Parallelisation strategy
///
/// The two primary language requests (`es-ES` and `en-US`) are independent:
/// they hit different TMDB endpoints and their responses can be merged after
/// both complete. Running them with `tokio::join!` halves the wall-clock time
/// for the common case where both requests are needed.
///
/// The TMDB rate-limit is enforced by `throttle_tmdb_request()` which is
/// called inside `fetch_json_with_retry`. With `tokio::join!`, both calls
/// enter the throttle concurrently — they each acquire the Mutex and sleep
/// if needed, so they will stagger naturally by at least
/// `TMDB_MIN_REQUEST_INTERVAL` (35 ms).
async fn search_endpoint_results(
    api_key: &str,
    query: &str,
    year: Option<u16>,
    endpoint: &str,
) -> Result<Vec<TmdbMovie>, String> {
    // Fire both language requests concurrently.
    let (spanish_result, english_result) = tokio::join!(
        fetch_search_results_lang(api_key, query, year, endpoint, "es-ES"),
        fetch_search_results_lang(api_key, query, year, endpoint, "en-US"),
    );
    let mut spanish = spanish_result?;
    let mut english = english_result?;

    if spanish.is_empty() && english.is_empty() {
        if year.is_some() {
            // Retry without year — again in parallel.
            let (es2, en2) = tokio::join!(
                fetch_search_results_lang(api_key, query, None, endpoint, "es-ES"),
                fetch_search_results_lang(api_key, query, None, endpoint, "en-US"),
            );
            spanish = es2?;
            english = en2?;
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

/// Returns the best match alongside the TMDB endpoint type ("tv" or "movie")
/// that actually found it. Callers must use the returned endpoint type when
/// calling `fetch_movie_by_id` to avoid fetching the wrong item (e.g. a TV
/// documentary matched via the tv endpoint must also be fetched via tv).
pub async fn smart_search(
    api_key: &str,
    title: &str,
    year: Option<u16>,
    preferred_type: &str,
) -> Result<Option<(TmdbMovie, &'static str)>, String> {
    let primary_endpoint: &'static str = if preferred_type == "tv" { "tv" } else { "movie" };
    let other_endpoint: &'static str = if preferred_type == "tv" { "movie" } else { "tv" };

    let primary = search_endpoint_results(api_key, title, year, primary_endpoint).await?;
    let primary_best = primary.first().cloned();

    if let Some(ref movie) = primary_best {
        if score_result(movie, title, year) >= 50.0 {
            return Ok(primary_best.map(|m| (m, primary_endpoint)));
        }
    }

    let secondary = search_endpoint_results(api_key, title, year, other_endpoint).await?;
    let secondary_best = secondary.first().cloned();

    Ok(match (primary_best, secondary_best) {
        (Some(p), Some(s)) => {
            if score_result(&s, title, year) > score_result(&p, title, year) {
                Some((s, other_endpoint))
            } else {
                Some((p, primary_endpoint))
            }
        }
        (Some(p), None) => Some((p, primary_endpoint)),
        (None, Some(s)) => Some((s, other_endpoint)),
        (None, None) => None,
    })
}

pub async fn search_tmdb_multi(api_key: &str, query: &str, media_type: &str) -> Result<Vec<TmdbMovie>, String> {
    let endpoint = if media_type == "tv" { "tv" } else { "movie" };
    let mut results = search_endpoint_results(api_key, query, None, endpoint).await?;
    results.truncate(10);
    Ok(results)
}

pub async fn find_by_imdb_id(
    api_key: &str,
    imdb_id: &str,
    preferred_type: &str,
) -> Result<Option<TmdbMovie>, String> {
    let imdb = imdb_id.trim();
    if imdb.is_empty() {
        return Ok(None);
    }

    let url = format!(
        "https://api.themoviedb.org/3/find/{}?api_key={api_key}&external_source=imdb_id&language=es-ES",
        urlencoding::encode(imdb),
    );

    #[derive(Deserialize)]
    struct FindItem {
        id: i64,
    }

    #[derive(Deserialize)]
    struct FindResponse {
        #[serde(default)]
        movie_results: Vec<FindItem>,
        #[serde(default)]
        tv_results: Vec<FindItem>,
    }

    let parsed: FindResponse = fetch_json_with_retry(&url, "find by imdb request").await?;

    let pick = match preferred_type {
        "tv" => parsed
            .tv_results
            .first()
            .map(|v| (v.id, "tv"))
            .or_else(|| parsed.movie_results.first().map(|v| (v.id, "movie"))),
        _ => parsed
            .movie_results
            .first()
            .map(|v| (v.id, "movie"))
            .or_else(|| parsed.tv_results.first().map(|v| (v.id, "tv"))),
    };

    match pick {
        Some((id, media_type)) => fetch_movie_by_id(api_key, id, media_type).await.map(Some),
        None => Ok(None),
    }
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

/// Fetch full movie/show details from TMDB by its internal ID.
///
/// # Parallelisation
///
/// Three HTTP requests are needed: Spanish detail, English detail, and
/// external IDs (for the IMDB ID). All three are independent — they are
/// fired concurrently with `tokio::join!`. The TMDB throttle mutex inside
/// `fetch_json_with_retry` serialises the rate-limit bookkeeping so the
/// three calls will stagger by at least `TMDB_MIN_REQUEST_INTERVAL` each
/// even when launched together, providing correct spacing without artificial
/// sequential delays.
pub async fn fetch_movie_by_id(api_key: &str, tmdb_id: i64, media_type: &str) -> Result<TmdbMovie, String> {
    let endpoint = if media_type == "tv" { "tv" } else { "movie" };

    let (spanish, english, imdb_id) = tokio::join!(
        fetch_detail_lang(api_key, tmdb_id, endpoint, "es-ES"),
        fetch_detail_lang(api_key, tmdb_id, endpoint, "en-US"),
        async { fetch_imdb_id(api_key, tmdb_id, endpoint).await.ok().flatten() },
    );
    let spanish = spanish?;
    let english = english?;

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

// ── Fix 3: unit tests for pure helper functions ──────────────────────────────
// TMDB HTTP functions call a live external service and are not unit-testable
// without mocking. The pure scoring and similarity helpers are self-contained
// and can be tested without any network I/O.
//
// What should be tested with a real TMDB API key (manual / CI integration):
//   - fetch_movie_by_id returns both Spanish and English fields
//   - search_endpoint_results parallelises correctly (verify via timing)
//   - The throttle mutex serialises concurrent callers within rate limits

#[cfg(test)]
mod tests {
    use super::*;

    fn make_movie(title: &str, title_en: Option<&str>, release_date: Option<&str>, vote_average: Option<f64>) -> TmdbMovie {
        TmdbMovie {
            id: 1,
            imdb_id: None,
            title: title.to_string(),
            title_en: title_en.map(str::to_string),
            release_date: release_date.map(str::to_string),
            overview: None,
            overview_en: None,
            poster_path: None,
            poster_path_en: None,
            vote_average,
            genre_ids: vec![],
        }
    }

    // ── title_similarity_score ─────────────────────────────────────────────

    #[test]
    fn exact_match_scores_100() {
        let score = title_similarity_score("inception", "inception");
        assert!((score - 100.0).abs() < f64::EPSILON);
    }

    #[test]
    fn case_insensitive_exact_match_scores_100() {
        let score = title_similarity_score("Inception", "inception");
        assert!((score - 100.0).abs() < f64::EPSILON);
    }

    #[test]
    fn substring_match_scores_50() {
        let score = title_similarity_score("The Dark Knight Rises", "Dark Knight");
        assert!((score - 50.0).abs() < f64::EPSILON);
    }

    #[test]
    fn no_overlap_scores_zero() {
        let score = title_similarity_score("Inception", "Avengers");
        assert!(score < 1.0, "Expected near-zero score, got {score}");
    }

    #[test]
    fn empty_title_scores_zero() {
        assert_eq!(title_similarity_score("", "query"), 0.0);
        assert_eq!(title_similarity_score("title", ""), 0.0);
    }

    #[test]
    fn partial_word_overlap_scores_proportionally() {
        // "The Batman" vs "Batman" — one of two words overlaps → 50% of 40 = 20
        let score = title_similarity_score("The Batman", "Batman");
        // Substring match trumps word overlap: "the batman" contains "batman" → 50
        assert!((score - 50.0).abs() < f64::EPSILON);
    }

    // ── score_result ───────────────────────────────────────────────────────

    #[test]
    fn exact_year_match_boosts_score_by_30() {
        let movie = make_movie("Inception", None, Some("2010-07-16"), Some(8.0));
        let score_with_year = score_result(&movie, "Inception", Some(2010));
        let score_no_year = score_result(&movie, "Inception", None);
        // Both have title score 100 + popularity 4; with year adds 30
        assert!(score_with_year > score_no_year + 25.0);
    }

    #[test]
    fn year_off_by_one_boosts_score_by_15() {
        let movie = make_movie("Film", None, Some("2011-01-01"), Some(0.0));
        let score = score_result(&movie, "Film", Some(2010));
        // title 100 + year_boost 15
        assert!(score >= 115.0 - 0.1);
    }

    #[test]
    fn year_off_by_two_gives_no_boost() {
        let movie = make_movie("Film", None, Some("2012-01-01"), Some(0.0));
        let score_close = score_result(&movie, "Film", Some(2010)); // diff=2 → no boost
        let score_far = score_result(&movie, "Film", Some(2000));   // diff=12 → no boost
        // Both should have no year bonus
        assert_eq!(score_close, score_far);
    }

    #[test]
    fn popularity_contributes_half_vote_average() {
        let movie_high = make_movie("X", None, None, Some(8.0));
        let movie_low  = make_movie("X", None, None, Some(2.0));
        let diff = score_result(&movie_high, "X", None) - score_result(&movie_low, "X", None);
        assert!((diff - 3.0).abs() < 0.01, "Expected 3.0 difference, got {diff}");
    }

    // ── English title fallback in score_result ─────────────────────────────

    #[test]
    fn english_title_is_used_as_fallback_in_scoring() {
        // Primary title is Spanish; query matches English title
        let movie = make_movie("El Origen", Some("Inception"), Some("2010-07-16"), Some(8.0));
        let score_es = score_result(&movie, "El Origen", None);
        let score_en = score_result(&movie, "Inception", None);
        // Both should score 100 for their respective exact-match title
        assert!(score_en >= 100.0, "score_en={score_en}");
        assert!(score_es >= 100.0, "score_es={score_es}");
    }
}
