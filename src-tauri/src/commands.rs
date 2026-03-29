use std::sync::Arc;
use std::sync::LazyLock;
use std::sync::Mutex;
use tauri::Emitter;
use tauri::Manager;
use tauri::WebviewWindow;

static TV_CONTENT_HINT_RE: LazyLock<regex::Regex> = LazyLock::new(|| {
    regex::Regex::new(
        r"(?ix)
        (?:\bS\d{1,3}[\s._-]*E\d{1,3}\b)
        |(?:\b\d{1,2}x\d{1,3}\b)
        |(?:\b(?:season|temporada|episode|episodio|capitulo)\b)
        ",
    )
    .expect("valid tv content hint regex")
});

static PLEX_IMDB_GUID_RE: LazyLock<regex::Regex> = LazyLock::new(|| {
    regex::Regex::new(r#"imdb://(tt\d+)"#).expect("valid plex imdb guid regex")
});

static PLEX_MEDIA_CONTAINER_SIZE_RE: LazyLock<regex::Regex> = LazyLock::new(|| {
    regex::Regex::new(r#"MediaContainer[^>]*\bsize=\"(\d+)\""#)
        .expect("valid plex size regex")
});

static PLEX_RATING_KEY_RE: LazyLock<regex::Regex> = LazyLock::new(|| {
    regex::Regex::new(r#"\bratingKey=\"(\d+)\""#).expect("valid plex rating key regex")
});

static PLEX_VIDEO_SEASON_EP_RE: LazyLock<regex::Regex> = LazyLock::new(|| {
    regex::Regex::new(
        r#"<Video[^>]*\bparentIndex=\"(\d+)\"[^>]*\bindex=\"(\d+)\"[^>]*>|<Video[^>]*\bindex=\"(\d+)\"[^>]*\bparentIndex=\"(\d+)\"[^>]*>"#,
    )
    .expect("valid plex season/episode regex")
});

const BADGE_CACHE_TTL_SECS: u64 = 300;

#[derive(Debug, Clone)]
struct BadgeCacheEntry {
    checked_at: std::time::Instant,
    check: MediaServerCheck,
}

static BADGE_RESULT_CACHE: LazyLock<Mutex<std::collections::HashMap<String, BadgeCacheEntry>>> =
    LazyLock::new(|| Mutex::new(std::collections::HashMap::new()));

fn persist_download_state(
    db: &crate::db::Db,
    queue: &crate::downloads::SharedQueue,
) {
    let snapshot = {
        let queue = queue.lock().unwrap();
        queue.items.clone()
    };
    db.save_download_state(&snapshot).ok();
}

pub(crate) fn spawn_download_job_pub(
    db: crate::db::Db,
    queue_state: crate::downloads::SharedQueue,
    window: Option<tauri::WebviewWindow>,
    config: crate::db::AppConfig,
    id: u64,
    ftp_path: String,
    local_path: String,
    semaphore: Arc<tokio::sync::Semaphore>,
    cancel_flag: Arc<std::sync::atomic::AtomicBool>,
) {
    tokio::spawn(async move {
        use std::sync::atomic::Ordering;

        let _permit = match semaphore.acquire().await {
            Ok(p) => p,
            Err(_) => return,
        };

        if cancel_flag.load(Ordering::SeqCst) {
            {
                let mut queue = queue_state.lock().unwrap();
                queue.mark_cancelled(id);
            }
            persist_download_state(&db, &queue_state);
            if let Some(ref w) = window {
                w.emit("download:update", serde_json::json!({
                    "id": id,
                    "status": "cancelled",
                })).ok();
            }
            return;
        }

        {
            let mut queue = queue_state.lock().unwrap();
            queue.mark_started(id);
        }
        persist_download_state(&db, &queue_state);
        let started_at_ms = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_millis() as u64;
        if let Some(ref w) = window {
            w.emit("download:update", serde_json::json!({
                "id": id,
                "status": "downloading",
                "started_at_ms": started_at_ms,
            })).ok();
        }

        let cancel_flag_clone = cancel_flag.clone();
        let queue_for_progress = queue_state.clone();
        let window_for_progress = window.clone();

        let result = crate::ftp::download_file(
            &config.ftp_host,
            config.ftp_port,
            &config.ftp_user,
            &config.ftp_pass,
            &ftp_path,
            &local_path,
            move |done, total| {
                {
                    let mut queue = queue_for_progress.lock().unwrap();
                    if let Some(item) = queue.items.iter_mut().find(|i| i.id == id) {
                        item.bytes_done = done;
                        item.bytes_total = total;
                    }
                }
                let now_ms = std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_millis() as u64;
                if let Some(ref w) = window_for_progress {
                    w.emit("download:progress", serde_json::json!({
                        "id": id,
                        "bytes_done": done,
                        "bytes_total": total,
                        "timestamp_ms": now_ms,
                    })).ok();
                }
                !cancel_flag_clone.load(Ordering::SeqCst)
            },
        ).await;

        let completed_ms = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_millis() as u64;
        match result {
            Ok(()) => {
                { queue_state.lock().unwrap().mark_done(id); }
                persist_download_state(&db, &queue_state);
                if let Some(ref w) = window {
                    w.emit("download:update", serde_json::json!({
                        "id": id,
                        "status": "done",
                        "local_path": local_path,
                        "completed_at_ms": completed_ms,
                    })).ok();
                }
            }
            Err(ref e) if e == "Cancelled" => {
                { queue_state.lock().unwrap().mark_cancelled(id); }
                persist_download_state(&db, &queue_state);
                if let Some(ref w) = window {
                    w.emit("download:update", serde_json::json!({
                        "id": id,
                        "status": "cancelled",
                        "completed_at_ms": completed_ms,
                    })).ok();
                }
            }
            Err(e) => {
                { queue_state.lock().unwrap().mark_error(id, e.clone()); }
                persist_download_state(&db, &queue_state);
                if let Some(ref w) = window {
                    w.emit("download:update", serde_json::json!({
                        "id": id,
                        "status": "error",
                        "error": e,
                        "completed_at_ms": completed_ms,
                    })).ok();
                }
            }
        }
    });
}

pub fn restore_download_queue(
    db: crate::db::Db,
    queue_state: crate::downloads::SharedQueue,
) {
    let restored = db.load_download_state().unwrap_or_default();
    if restored.is_empty() {
        return;
    }
    {
        let mut queue = queue_state.lock().unwrap();
        queue.restore(restored);
    }
    persist_download_state(&db, &queue_state);
}

pub async fn resume_pending_downloads(
    db: crate::db::Db,
    queue_state: crate::downloads::SharedQueue,
    window: WebviewWindow,
) -> Result<(), String> {
    let config = db.load_config()?;
    let pending = {
        let queue = queue_state.lock().unwrap();
        queue.items
            .iter()
            .filter(|item| matches!(item.status, crate::downloads::DownloadStatus::Queued))
            .cloned()
            .collect::<Vec<_>>()
    };

    for item in pending {
        let (semaphore, cancel_flag) = {
            let mut queue = queue_state.lock().unwrap();
            let (_, semaphore, cancel_flag) = queue.retry(item.id)?;
            (semaphore, cancel_flag)
        };
        let resumed_bytes = std::fs::metadata(&item.local_path).map(|meta| meta.len()).unwrap_or(0);
        window.emit("download:update", serde_json::json!({
            "id": item.id,
            "status": "queued",
            "bytes_done": resumed_bytes,
            "error": serde_json::Value::Null,
        })).ok();
        persist_download_state(&db, &queue_state);
        spawn_download_job_pub(
            db.clone(),
            queue_state.clone(),
            Some(window.clone()),
            config.clone(),
            item.id,
            item.ftp_path,
            item.local_path,
            semaphore,
            cancel_flag,
        );
    }
    Ok(())
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaBadgeQuery {
    pub id: i64,
    pub ftp_path: String,
    pub filename: String,
    pub title: Option<String>,
    pub title_en: Option<String>,
    pub year: Option<i64>,
    pub imdb_id: Option<String>,
    pub tmdb_id: Option<i64>,
    pub media_type: Option<String>,
}

#[derive(Debug, serde::Serialize)]
pub struct MediaBadgeResult {
    pub id: i64,
    pub downloaded: bool,
    pub in_emby: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub plex_in_library: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub emby_in_library: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cache: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub debug: Option<String>,
}

#[derive(Debug, Clone)]
struct MediaServerCheck {
    hit: bool,
    plex_hit: bool,
    emby_hit: bool,
    cache_state: String,
    debug: String,
}

fn detect_media_type(
    path: &str,
    root: &str,
    folder_types: &std::collections::HashMap<String, String>,
) -> Option<String> {
    if folder_types.is_empty() { return None; }
    let rel = path.strip_prefix(root.trim_end_matches('/')).unwrap_or(path);
    let first_seg = rel.trim_start_matches('/').split('/').next()?;
    folder_types.get(first_seg).cloned()
}

fn looks_like_tv_content(path: &str, filename: &str, parsed: &crate::parser::ParsedMedia) -> bool {
    if parsed.season.is_some() || parsed.episode.is_some() || parsed.episode_end.is_some() {
        return true;
    }

    let normalized = format!("{} {}", path, filename)
        .replace(['.', '_'], " ")
        .to_lowercase();
    TV_CONTENT_HINT_RE.is_match(&normalized)
}

fn normalize_title(value: &str) -> String {
    value
        .chars()
        .flat_map(|ch| ch.to_lowercase())
        .map(|ch| if ch.is_alphanumeric() { ch } else { ' ' })
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

fn desired_episode_target(query: &MediaBadgeQuery) -> Option<(u32, u32, u32)> {
    let media_type = query.media_type.as_deref().unwrap_or_default();
    if media_type != "tv" && media_type != "documentary" {
        return None;
    }

    let parsed = crate::parser::parse_media_path(&query.ftp_path, &query.filename);
    let season = parsed.season? as u32;
    let episode = parsed.episode? as u32;
    let episode_end = parsed
        .episode_end
        .map(|value| value as u32)
        .unwrap_or(episode)
        .max(episode);

    Some((season, episode, episode_end))
}

fn extract_plex_rating_keys(body: &str) -> Vec<String> {
    PLEX_RATING_KEY_RE
        .captures_iter(body)
        .filter_map(|caps| caps.get(1).map(|v| v.as_str().to_string()))
        .collect()
}

fn extract_plex_episode_set(body: &str) -> std::collections::HashSet<(u32, u32)> {
    let mut set = std::collections::HashSet::new();
    for caps in PLEX_VIDEO_SEASON_EP_RE.captures_iter(body) {
        let a = caps.get(1).and_then(|v| v.as_str().parse::<u32>().ok());
        let b = caps.get(2).and_then(|v| v.as_str().parse::<u32>().ok());
        let c = caps.get(3).and_then(|v| v.as_str().parse::<u32>().ok());
        let d = caps.get(4).and_then(|v| v.as_str().parse::<u32>().ok());
        if let Some((season, episode)) = a.zip(b).or_else(|| d.zip(c)) {
            set.insert((season, episode));
        }
    }
    set
}

async fn plex_rating_key_has_episode(
    client: &reqwest::Client,
    base: &str,
    token: &str,
    rating_key: &str,
    target: (u32, u32, u32),
) -> Result<bool, String> {
    let endpoint = format!(
        "{base}/library/metadata/{rating_key}/allLeaves?X-Plex-Token={}",
        urlencoding::encode(token),
    );

    let resp = client
        .get(&endpoint)
        .send()
        .await
        .map_err(|e| format!("Could not query Plex episodes: {e}"))?;

    if !resp.status().is_success() {
        return Err(format!("Plex returned HTTP {}", resp.status().as_u16()));
    }

    let body = resp
        .text()
        .await
        .map_err(|e| format!("Could not parse Plex episodes response: {e}"))?;

    let episodes = extract_plex_episode_set(&body);
    let (season, ep_start, ep_end) = target;
    if episodes.is_empty() {
        return Ok(false);
    }

    Ok((ep_start..=ep_end).all(|episode| episodes.contains(&(season, episode))))
}

pub(crate) fn plex_badge_cache_key(query: &MediaBadgeQuery) -> Option<String> {
    if let Some(imdb_id) = query.imdb_id.as_deref().map(str::trim).filter(|v| !v.is_empty()) {
        return Some(format!("imdb:{imdb_id}"));
    }
    if let Some(tmdb_id) = query.tmdb_id {
        return Some(format!("tmdb:{tmdb_id}"));
    }

    let title = query
        .title
        .as_deref()
        .or(query.title_en.as_deref())
        .map(normalize_title)
        .filter(|t| !t.is_empty())?;

    Some(format!("title:{title}:{}", query.year.unwrap_or_default()))
}

async fn exists_in_emby(
    config: &crate::db::AppConfig,
    query: &MediaBadgeQuery,
) -> Result<bool, String> {
    if config.emby_url.trim().is_empty() || config.emby_api_key.trim().is_empty() {
        return Ok(false);
    }

    let base = config.emby_url.trim_end_matches('/');
    let include_item_types = if matches!(query.media_type.as_deref(), Some("tv")) {
        "Series"
    } else {
        "Movie"
    };

    #[derive(serde::Deserialize)]
    struct EmbyItem {
        #[serde(rename = "Name")]
        name: Option<String>,
        #[serde(rename = "ProductionYear")]
        production_year: Option<i64>,
    }
    #[derive(serde::Deserialize)]
    struct EmbyResponse {
        #[serde(rename = "Items", default)]
        items: Vec<EmbyItem>,
    }

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(8))
        .build()
        .map_err(|e| e.to_string())?;

    let titles = [query.title.as_deref(), query.title_en.as_deref()]
        .into_iter()
        .flatten()
        .map(normalize_title)
        .filter(|title| !title.is_empty())
        .collect::<std::collections::BTreeSet<_>>();

    for candidate in titles {
        let endpoint = format!(
            "{base}/Items?Recursive=true&SearchTerm={}&IncludeItemTypes={include_item_types}&Fields=ProductionYear&Limit=8&api_key={}",
            urlencoding::encode(&candidate),
            config.emby_api_key
        );

        let response: EmbyResponse = client
            .get(&endpoint)
            .send()
            .await
            .map_err(|e| format!("Could not query Emby library: {e}"))?
            .json()
            .await
            .map_err(|e| format!("Could not parse Emby response: {e}"))?;

        for item in response.items {
            let Some(name) = item.name else { continue };
            let normalized_name = normalize_title(&name);
            let title_match =
                normalized_name == candidate || normalized_name.contains(&candidate) || candidate.contains(&normalized_name);
            let year_match = match (query.year, item.production_year) {
                (Some(expected), Some(found)) => expected == found || (expected - found).abs() <= 1,
                _ => true,
            };
            if title_match && year_match {
                return Ok(true);
            }
        }
    }

    Ok(false)
}

pub(crate) async fn exists_in_media_server(
    config: &crate::db::AppConfig,
    query: &MediaBadgeQuery,
) -> Result<bool, String> {
    Ok(check_media_server_presence(config, query).await?.hit)
}

async fn check_media_server_presence(
    config: &crate::db::AppConfig,
    query: &MediaBadgeQuery,
) -> Result<MediaServerCheck, String> {
    {
        let ttl = std::time::Duration::from_secs(BADGE_CACHE_TTL_SECS);
        let mut cache = BADGE_RESULT_CACHE.lock().unwrap();
        cache.retain(|_, entry| entry.checked_at.elapsed() < ttl);
    }

    if let Some(cache_key) = plex_badge_cache_key(query) {
        if let Some(entry) = BADGE_RESULT_CACHE.lock().unwrap().get(&cache_key).cloned() {
            let age = entry.checked_at.elapsed();
            if age < std::time::Duration::from_secs(BADGE_CACHE_TTL_SECS) {
                let mut cached = entry.check;
                cached.cache_state = format!("global-hit:{}ms", age.as_millis());
                return Ok(cached);
            }
        }
    }

    let mut traces: Vec<String> = Vec::new();
    let mut plex_hit = false;
    let mut emby_hit = false;

    let plex_configured = !config.plex_url.trim().is_empty() && !config.plex_token.trim().is_empty();
    if plex_configured {
        match exists_in_plex(config, query).await {
            Ok(true) => {
                plex_hit = true;
                traces.push("plex:match".to_string());
            }
            Ok(false) => traces.push("plex:no-match".to_string()),
            Err(err) => {
                traces.push(format!("plex:error:{err}"));
                eprintln!("[badges] Plex lookup failed: {err}");
            }
        }
    } else {
        traces.push("plex:not-configured".to_string());
    }

    let emby_configured = !config.emby_url.trim().is_empty() && !config.emby_api_key.trim().is_empty();
    if emby_configured {
        match exists_in_emby(config, query).await {
            Ok(true) => {
                emby_hit = true;
                traces.push("emby:match".to_string());
            }
            Ok(false) => traces.push("emby:no-match".to_string()),
            Err(err) => {
                traces.push(format!("emby:error:{err}"));
                eprintln!("[badges] Emby lookup failed: {err}");
            }
        }
    } else {
        traces.push("emby:not-configured".to_string());
    }

    let check = MediaServerCheck {
        hit: plex_hit || emby_hit,
        plex_hit,
        emby_hit,
        cache_state: "global-miss".to_string(),
        debug: traces.join(" | "),
    };

    if let Some(cache_key) = plex_badge_cache_key(query) {
        BADGE_RESULT_CACHE.lock().unwrap().insert(
            cache_key,
            BadgeCacheEntry {
                checked_at: std::time::Instant::now(),
                check: check.clone(),
            },
        );
    }

    Ok(check)
}

pub(crate) async fn exists_in_plex(
    config: &crate::db::AppConfig,
    query: &MediaBadgeQuery,
) -> Result<bool, String> {
    if config.plex_url.trim().is_empty() || config.plex_token.trim().is_empty() {
        return Ok(false);
    }
    let base = config.plex_url.trim_end_matches('/');
    let token = config.plex_token.trim();
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(8))
        .build()
        .map_err(|e| e.to_string())?;
    let episode_target = desired_episode_target(query);

    let mut guids = Vec::new();

    if let Some(imdb_id) = query.imdb_id.as_deref().map(str::trim).filter(|v| !v.is_empty()) {
        guids.push(format!("imdb://{imdb_id}"));
        guids.push(format!("com.plexapp.agents.imdb://{imdb_id}"));
    }
    if let Some(tmdb_id) = query.tmdb_id {
        guids.push(format!("tmdb://{tmdb_id}"));
        guids.push(format!("com.plexapp.agents.themoviedb://{tmdb_id}"));
    }

    for guid in guids {
        let endpoint = format!(
            "{base}/library/all?guid={}&X-Plex-Token={}",
            urlencoding::encode(&guid),
            urlencoding::encode(token),
        );

        let resp = client
            .get(&endpoint)
            .send()
            .await
            .map_err(|e| format!("Could not query Plex library: {e}"))?;

        if !resp.status().is_success() {
            return Err(format!("Plex returned HTTP {}", resp.status().as_u16()));
        }

        let body = resp
            .text()
            .await
            .map_err(|e| format!("Could not parse Plex response: {e}"))?;

        if PLEX_MEDIA_CONTAINER_SIZE_RE
            .captures(&body)
            .and_then(|caps| caps.get(1))
            .and_then(|m| m.as_str().parse::<usize>().ok())
            .unwrap_or(0)
            > 0
        {
            if let Some(target) = episode_target {
                for rating_key in extract_plex_rating_keys(&body) {
                    if plex_rating_key_has_episode(&client, base, token, &rating_key, target).await? {
                        return Ok(true);
                    }
                }
                continue;
            }
            return Ok(true);
        }
    }

    // Last fallback for libraries without stable external IDs in GUIDs.
    let title = query
        .title
        .as_deref()
        .or(query.title_en.as_deref())
        .map(str::trim)
        .filter(|v| !v.is_empty());

    if let Some(title) = title {
        let mut endpoints = Vec::new();
        let mut with_year = format!(
            "{base}/library/all?title={}&X-Plex-Token={}&includeGuids=1",
            urlencoding::encode(title),
            urlencoding::encode(token),
        );
        if let Some(year) = query.year {
            with_year.push_str(&format!("&year={year}"));
        }
        endpoints.push(with_year);

        endpoints.push(format!(
            "{base}/library/all?title={}&X-Plex-Token={}&includeGuids=1",
            urlencoding::encode(title),
            urlencoding::encode(token),
        ));

        let imdb_hint = query.imdb_id.as_deref().map(str::trim).filter(|v| !v.is_empty());
        let tmdb_hint = query.tmdb_id;

        for endpoint in endpoints {
            let resp = client
                .get(&endpoint)
                .send()
                .await
                .map_err(|e| format!("Could not query Plex library by title: {e}"))?;

            if !resp.status().is_success() {
                return Err(format!("Plex returned HTTP {}", resp.status().as_u16()));
            }

            let body = resp
                .text()
                .await
                .map_err(|e| format!("Could not parse Plex response: {e}"))?;

            let size = PLEX_MEDIA_CONTAINER_SIZE_RE
                .captures(&body)
                .and_then(|caps| caps.get(1))
                .and_then(|m| m.as_str().parse::<usize>().ok())
                .unwrap_or(0);

            if size == 0 {
                continue;
            }

            let mut id_match = false;
            if let Some(imdb_id) = imdb_hint {
                if body.contains(&format!("imdb://{imdb_id}")) {
                    id_match = true;
                }
            }
            if let Some(tmdb_id) = tmdb_hint {
                if body.contains(&format!("tmdb://{tmdb_id}")) {
                    id_match = true;
                }
            }

            let has_external_hints = imdb_hint.is_some() || tmdb_hint.is_some();
            if has_external_hints && !id_match {
                continue;
            }

            if let Some(target) = episode_target {
                let mut matched_episode = false;
                for rating_key in extract_plex_rating_keys(&body) {
                    if plex_rating_key_has_episode(&client, base, token, &rating_key, target).await? {
                        matched_episode = true;
                        break;
                    }
                }
                if matched_episode {
                    return Ok(true);
                }
                continue;
            }

            if has_external_hints {
                return Ok(true);
            }

            // If no external IDs are available, non-empty title result is still a useful fallback.
            if !has_external_hints {
                return Ok(true);
            }
        }
    }

    Ok(false)
}

async fn resolve_plex_imdb_id(
    config: &crate::db::AppConfig,
    title: &str,
    year: Option<u16>,
    media_type: &str,
) -> Result<Option<String>, String> {
    if config.plex_url.trim().is_empty() || config.plex_token.trim().is_empty() {
        return Ok(None);
    }

    let type_param = if media_type == "tv" { "2" } else { "1" };
    let base = config.plex_url.trim_end_matches('/');
    let mut endpoint = format!(
        "{base}/library/all?type={type_param}&title={}&X-Plex-Token={}",
        urlencoding::encode(title),
        urlencoding::encode(&config.plex_token),
    );
    if let Some(y) = year {
        endpoint.push_str(&format!("&year={y}"));
    }

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(8))
        .build()
        .map_err(|e| e.to_string())?;

    let resp = client
        .get(&endpoint)
        .send()
        .await
        .map_err(|e| format!("Could not query Plex for match: {e}"))?;

    if !resp.status().is_success() {
        return Err(format!("Plex returned HTTP {}", resp.status().as_u16()));
    }

    let body = resp
        .text()
        .await
        .map_err(|e| format!("Could not parse Plex response: {e}"))?;

    Ok(PLEX_IMDB_GUID_RE
        .captures(&body)
        .and_then(|caps| caps.get(1).map(|value| value.as_str().to_string())))
}

async fn resolve_tmdb_match_with_plex(
    config: &crate::db::AppConfig,
    api_key: &str,
    title: &str,
    year: Option<u16>,
    tmdb_search_type: &str,
) -> Result<Option<crate::tmdb::TmdbMovie>, String> {
    if let Some(imdb_id) = resolve_plex_imdb_id(config, title, year, tmdb_search_type).await? {
        if let Some(movie) = crate::tmdb::find_by_imdb_id(api_key, &imdb_id, tmdb_search_type).await? {
            return Ok(Some(movie));
        }
    }

    let result = if tmdb_search_type == "tv" {
        crate::tmdb::search_tmdb_multi(api_key, title, "tv")
            .await
            .ok()
            .and_then(|mut r| if r.is_empty() { None } else { Some(r.remove(0)) })
    } else {
        crate::tmdb::smart_search(api_key, title, year, tmdb_search_type)
            .await
            .ok()
            .flatten()
    };

    if let Some(movie) = result {
        let movie = match crate::tmdb::fetch_movie_by_id(api_key, movie.id, tmdb_search_type).await {
            Ok(full) => full,
            Err(_) => movie,
        };
        return Ok(Some(movie));
    }

    Ok(None)
}

#[tauri::command]
pub async fn get_config(
    state: tauri::State<'_, crate::db::Db>,
) -> Result<crate::db::AppConfig, String> {
    state.load_config()
}

#[tauri::command]
pub async fn ftp_list_raw(
    state: tauri::State<'_, crate::db::Db>,
) -> Result<Vec<String>, String> {
    use suppaftp::AsyncFtpStream;
    let config = state.load_config()?;
    let mut ftp = AsyncFtpStream::connect(format!("{}:{}", config.ftp_host, config.ftp_port))
        .await
        .map_err(|e| e.to_string())?;
    ftp.login(&config.ftp_user, &config.ftp_pass)
        .await
        .map_err(|e| e.to_string())?;
    ftp.cwd(&config.ftp_root).await.map_err(|e| format!("CWD {}: {e}", config.ftp_root))?;
    let entries = ftp.list(None).await.map_err(|e| e.to_string())?;
    ftp.quit().await.ok();
    Ok(entries)
}

#[tauri::command]
pub async fn test_ftp_connection(
    host: String,
    port: u16,
    user: String,
    pass: String,
) -> Result<(), String> {
    crate::ftp::test_connection(&host, port, &user, &pass).await
}

#[tauri::command]
pub async fn test_tmdb_key(api_key: String) -> Result<bool, String> {
    Ok(crate::tmdb::validate_api_key(&api_key).await)
}

#[tauri::command]
pub async fn test_emby_connection(url: String, api_key: String) -> Result<String, String> {
    let base = url.trim_end_matches('/');
    let endpoint = format!("{base}/System/Info?api_key={api_key}");
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(8))
        .build()
        .map_err(|e| e.to_string())?;
    let resp = client
        .get(&endpoint)
        .send()
        .await
        .map_err(|e| format!("Could not reach Emby server: {e}"))?;
    if resp.status().is_success() {
        let body: serde_json::Value = resp.json().await.unwrap_or_default();
        let server_name = body["ServerName"].as_str().unwrap_or("Emby Server");
        let version = body["Version"].as_str().unwrap_or("?");
        Ok(format!("{server_name} (v{version})"))
    } else if resp.status().as_u16() == 401 {
        Err("Invalid API key — check your Emby API key".to_string())
    } else {
        Err(format!("Emby returned HTTP {}", resp.status().as_u16()))
    }
}

#[tauri::command]
pub async fn test_plex_connection(url: String, token: String) -> Result<String, String> {
    let base = url.trim_end_matches('/');
    let endpoint = format!("{base}?X-Plex-Token={token}");
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(8))
        .build()
        .map_err(|e| e.to_string())?;
    let resp = client
        .get(&endpoint)
        .header("Accept", "application/json")
        .send()
        .await
        .map_err(|e| format!("Could not reach Plex server: {e}"))?;
    if resp.status().is_success() {
        let body: serde_json::Value = resp.json().await.unwrap_or_default();
        let name = body["MediaContainer"]["friendlyName"]
            .as_str()
            .unwrap_or("Plex Media Server");
        let version = body["MediaContainer"]["version"]
            .as_str()
            .unwrap_or("?");
        Ok(format!("{name} (v{version})"))
    } else if resp.status().as_u16() == 401 {
        Err("Invalid token — check your Plex token".to_string())
    } else {
        Err(format!("Plex returned HTTP {}", resp.status().as_u16()))
    }
}

#[tauri::command]
pub async fn save_config(
    state: tauri::State<'_, crate::db::Db>,
    config: crate::db::AppConfig,
) -> Result<(), String> {
    state.save_config(&config)
}

#[tauri::command]
pub async fn has_config(state: tauri::State<'_, crate::db::Db>) -> Result<bool, String> {
    state.has_config()
}

pub(crate) fn resolve_seed_db_path(app: &tauri::AppHandle) -> Option<std::path::PathBuf> {
    let mut candidates = Vec::new();

    if let Ok(path) = app
        .path()
        .resolve("library.seed.db", tauri::path::BaseDirectory::Resource)
    {
        candidates.push(path);
    }

    if let Ok(path) = app
        .path()
        .resolve("resources/library.seed.db", tauri::path::BaseDirectory::Resource)
    {
        candidates.push(path);
    }

    if let Ok(exe_path) = std::env::current_exe() {
        if let Some(exe_dir) = exe_path.parent() {
            candidates.push(exe_dir.join("resources").join("library.seed.db"));
        }
    }

    candidates.into_iter().find(|candidate| candidate.exists())
}

#[tauri::command]
pub async fn seed_starter_library(
    app: tauri::AppHandle,
    state: tauri::State<'_, crate::db::Db>,
) -> Result<bool, String> {
    if state.has_config()? {
        return Ok(false);
    }
    if state.count_media_items()? > 0 {
        return Ok(false);
    }

    let Some(seed_path) = resolve_seed_db_path(&app) else {
        return Ok(false);
    };

    state.import_database_from(&seed_path.to_string_lossy())?;
    state.clear_app_config()?;
    state.save_last_indexed_at(&chrono::Utc::now().to_rfc3339())?;
    Ok(true)
}

#[tauri::command]
pub async fn export_library_backup(
    state: tauri::State<'_, crate::db::Db>,
    destination_path: String,
) -> Result<(), String> {
    state.export_database_to(&destination_path)
}

#[tauri::command]
pub async fn import_library_backup(
    state: tauri::State<'_, crate::db::Db>,
    source_path: String,
) -> Result<(), String> {
    state.import_database_from(&source_path)
}

#[tauri::command]
pub async fn get_all_media(
    state: tauri::State<'_, crate::db::Db>,
) -> Result<Vec<crate::db::MediaItem>, String> {
    state.get_all_media()
}

#[tauri::command]
pub async fn start_indexing(
    state: tauri::State<'_, crate::db::Db>,
    window: WebviewWindow,
) -> Result<(), String> {
    start_indexing_internal(state.inner().clone(), Some(window)).await
}

#[tauri::command]
pub async fn rematch_all(
    state: tauri::State<'_, crate::db::Db>,
    window: WebviewWindow,
) -> Result<(), String> {
    rematch_all_internal(state.inner().clone(), Some(window)).await
}

pub async fn rematch_all_internal(
    db: crate::db::Db,
    window: Option<tauri::WebviewWindow>,
) -> Result<(), String> {
    let config = db.load_config()?;
    let items = db.get_all_media()?;
    let items: Vec<_> = items
        .into_iter()
        .filter(|item| item.manual_match.unwrap_or(0) == 0)
        .collect();
    let total = items.len();

    if let Some(ref w) = window {
        w.emit("index:log", serde_json::json!({ "msg": format!("🔄 Re-matching {} items with TMDB…", total) })).ok();
    }

    for (i, item) in items.into_iter().enumerate() {
        let title = item.tmdb_title.clone()
            .or_else(|| item.title.clone())
            .unwrap_or_else(|| item.filename.clone());

        // Determine media_type: prefer stored value, fallback to "movie"
        let mtype = item.media_type.clone()
            .or_else(|| item.tmdb_type.clone())
            .unwrap_or_else(|| "movie".to_string());

        // TMDB search type: documentary series search as TV, documentary films as movie
        let tmdb_search_type = match mtype.as_str() {
            "tv" => "tv",
            "documentary" => {
                // Infer from filename if it has a season marker
                let parsed = crate::parser::parse_media_path(&item.ftp_path, &item.filename);
                if parsed.season.is_some() { "tv" } else { "movie" }
            },
            _ => "movie",
        };
        let year = item.year.map(|y| y as u16);

        if let Some(ref w) = window {
            w.emit("index:log", serde_json::json!({
                "msg": format!("🌐 [{}/{}] Matching: {} ({})", i + 1, total, title, mtype)
            })).ok();
        }

        // Rate limit: 40 req/10s
        tokio::time::sleep(std::time::Duration::from_millis(260)).await;

        let api_key = &config.tmdb_api_key;
        let result = resolve_tmdb_match_with_plex(&config, api_key, &title, year, tmdb_search_type).await;

        if let Ok(Some(movie)) = result {
            if let Some(ref w) = window {
                w.emit("index:log", serde_json::json!({
                    "msg": format!("✓ Matched: {} → {} ({})", title, movie.title,
                        movie.release_date.as_deref().unwrap_or("?"))
                })).ok();
            }
            db.update_tmdb_auto(item.id, &movie, &mtype).ok();
            if let Some(ref w) = window {
                w.emit("index:update", serde_json::json!({
                    "id": item.id,
                    "tmdb_id": movie.id,
                    "imdb_id": movie.imdb_id,
                    "tmdb_title": movie.title,
                    "tmdb_title_en": movie.title_en,
                    "tmdb_poster": movie.poster_path,
                    "tmdb_poster_en": movie.poster_path_en,
                    "tmdb_rating": movie.vote_average,
                    "tmdb_overview": movie.overview,
                    "tmdb_overview_en": movie.overview_en,
                    "tmdb_genres": movie.genre_ids,
                    "tmdb_release_date": movie.release_date,
                    "tmdb_type": mtype,
                })).ok();
            }
        } else {
            if let Some(ref w) = window {
                w.emit("index:log", serde_json::json!({
                    "msg": format!("⚠ No match found for: {}", title)
                })).ok();
            }
        }
    }

    if let Some(ref w) = window {
        w.emit("index:log", serde_json::json!({ "msg": format!("✓ Re-match complete — {} items processed", total) })).ok();
    }
    Ok(())
}

pub async fn start_indexing_internal(
    db: crate::db::Db,
    window: Option<tauri::WebviewWindow>,
) -> Result<(), String> {
    let config = db.load_config()?;

    if let Some(ref w) = window { w.emit("index:start", serde_json::json!({})).ok(); }

    let window_log = window.clone();
    let on_log = Arc::new(move |msg: String| {
        if let Some(ref w) = window_log {
            w.emit("index:log", serde_json::json!({ "msg": msg })).ok();
        }
    });

    let folder_types: std::collections::HashMap<String, String> =
        serde_json::from_str(&config.folder_types).unwrap_or_default();
    let root = config.ftp_root.clone();

    const MAX_RETRIES: u32 = 3;
    const RETRY_DELAY_SECS: u64 = 5;

    let files = {
        let mut attempt = 0u32;
        loop {
            match crate::ftp::list_files(
                &config.ftp_host,
                config.ftp_port,
                &config.ftp_user,
                &config.ftp_pass,
                &root,
                on_log.clone(),
            )
            .await
            {
                Ok(files) => break files,
                Err(e) => {
                    attempt += 1;
                    if attempt >= MAX_RETRIES {
                        if let Some(ref w) = window { w.emit("index:error", serde_json::json!({ "message": e })).ok(); }
                        return Err(e);
                    }
                    on_log(format!("⚠ {e} — retrying in {RETRY_DELAY_SECS}s ({attempt}/{MAX_RETRIES})…"));
                    tokio::time::sleep(std::time::Duration::from_secs(RETRY_DELAY_SECS)).await;
                }
            }
        }
    };

    let total = files.len();
    let mut metadata_tasks = Vec::new();
    let mut metadata_queued = 0usize;

    if total == 0 {
        if let Some(ref w) = window { w.emit("index:error", serde_json::json!({ "message": "FTP crawl returned 0 media files. Check your Root Path setting." })).ok(); }
        return Ok(());
    }

    for (i, file) in files.into_iter().enumerate() {
        let parsed = crate::parser::parse_media_path(&file.path, &file.filename);

        // Detect media_type from folder_types mapping (first path segment after root)
        let media_type = detect_media_type(&file.path, &root, &folder_types);
        let looks_episode = looks_like_tv_content(&file.path, &file.filename, &parsed);
        let media_type = match media_type.as_deref() {
            Some("mixed") => if looks_episode { Some("tv".to_string()) } else { Some("movie".to_string()) },
            Some("movie") if looks_episode => Some("tv".to_string()),
            Some(t) => Some(t.to_string()),
            None => if looks_episode { Some("tv".to_string()) } else { None },
        };
        let media_type_str = media_type.as_deref();

        // TMDB search type: documentaries with seasons search as TV shows
        let tmdb_search_type = match media_type.as_deref() {
            Some("documentary") => if parsed.season.is_some() { "tv" } else { "movie" },
            Some("tv") => "tv",
            _ => "movie",
        }.to_string();

        let upsert = db.upsert_media(&file.path, &file.filename, Some(file.size), &parsed, media_type_str)?;
        let id = upsert.id;

        on_log(format!("⚙ Indexing [{}/{}]: {}", i + 1, total, parsed.title));

        if let Some(ref w) = window {
            w.emit(
                "index:progress",
                serde_json::json!({
                    "id": id,
                    "current": i + 1,
                    "total": total,
                    "filename": file.filename,
                    "ftp_path": file.path,
                    "title": parsed.title,
                    "year": parsed.year,
                    "season": parsed.season,
                    "episode": parsed.episode,
                    "episode_end": parsed.episode_end,
                    "resolution": parsed.resolution,
                    "codec": parsed.codec,
                    "audio_codec": parsed.audio_codec,
                    "hdr": parsed.hdr,
                    "languages": parsed.languages,
                    "release_type": parsed.release_type,
                    "release_group": parsed.release_group,
                    "media_type": media_type_str,
                    "tmdb_type": media_type_str,
                }),
            ).ok();
        }

        if upsert.needs_metadata {
            metadata_queued += 1;
            let api_key = config.tmdb_api_key.clone();
            let title = parsed.title.clone();
            let year = parsed.year;
            let mtype = media_type.clone().unwrap_or_else(|| "movie".to_string());
            let tmdb_stype = tmdb_search_type.clone();

            if upsert.is_new {
                on_log(format!("🚀 Priority metadata for new file: {}", title));
                let result = resolve_tmdb_match_with_plex(
                    &config,
                    &api_key,
                    &title,
                    year,
                    &tmdb_stype,
                )
                .await;
                if let Ok(Some(movie)) = result {
                    on_log(format!("🌐 TMDB: {} → {}", title, movie.title));
                    db.update_tmdb_auto(id, &movie, &mtype).ok();
                    if let Some(ref w) = window {
                        w.emit(
                            "index:update",
                            serde_json::json!({
                                "id": id,
                                "tmdb_id": movie.id,
                                "imdb_id": movie.imdb_id,
                                "tmdb_title": movie.title,
                                "tmdb_title_en": movie.title_en,
                                "tmdb_poster": movie.poster_path,
                                "tmdb_poster_en": movie.poster_path_en,
                                "tmdb_rating": movie.vote_average,
                                "tmdb_overview": movie.overview,
                                "tmdb_overview_en": movie.overview_en,
                                "tmdb_genres": movie.genre_ids,
                                "tmdb_release_date": movie.release_date,
                                "tmdb_type": mtype,
                            }),
                        ).ok();
                    }
                } else {
                    on_log(format!("⚠ TMDB: no match for \"{}\"", title));
                }
            } else {
                let window_clone = window.clone();
                let db_clone = db.clone();
                let config_clone = config.clone();
                let on_log_clone = on_log.clone();

                metadata_tasks.push(tokio::spawn(async move {
                    tokio::time::sleep(std::time::Duration::from_millis(250)).await;
                    let result = resolve_tmdb_match_with_plex(
                        &config_clone,
                        &api_key,
                        &title,
                        year,
                        &tmdb_stype,
                    )
                    .await;
                    if let Ok(Some(movie)) = result {
                        on_log_clone(format!("🌐 TMDB: {} → {}", title, movie.title));
                        db_clone.update_tmdb_auto(id, &movie, &mtype).ok();
                        if let Some(ref w) = window_clone {
                            w.emit(
                                "index:update",
                                serde_json::json!({
                                    "id": id,
                                    "tmdb_id": movie.id,
                                    "imdb_id": movie.imdb_id,
                                    "tmdb_title": movie.title,
                                    "tmdb_title_en": movie.title_en,
                                    "tmdb_poster": movie.poster_path,
                                    "tmdb_poster_en": movie.poster_path_en,
                                    "tmdb_rating": movie.vote_average,
                                    "tmdb_overview": movie.overview,
                                    "tmdb_overview_en": movie.overview_en,
                                    "tmdb_genres": movie.genre_ids,
                                    "tmdb_release_date": movie.release_date,
                                    "tmdb_type": mtype,
                                }),
                            ).ok();
                        }
                    } else {
                        on_log_clone(format!("⚠ TMDB: no match for \"{}\"", title));
                    }
                }));
            }
        }
    }

    for task in metadata_tasks {
        if task.await.is_err() {
            on_log("⚠ TMDB metadata task failed unexpectedly".to_string());
        }
    }

    on_log(format!(
        "✓ Indexing complete — {} files scanned, {} items sent to TMDB",
        total, metadata_queued
    ));

    if let Some(ref w) = window {
        w.emit(
            "index:complete",
            serde_json::json!({
                "total": total,
                "metadata_queued": metadata_queued,
            }),
        )
        .ok();
    }

    db.save_last_indexed_at(&chrono::Utc::now().to_rfc3339()).ok();
    Ok(())
}

pub fn compute_local_path(
    config: &crate::db::AppConfig,
    ftp_path: &str,
    filename: &str,
    db_media_type: Option<&str>,
) -> Result<std::path::PathBuf, String> {
    let base = std::path::PathBuf::from(&config.download_folder);
    if base.as_os_str().is_empty() {
        return Err("Download folder not configured. Open Settings to set it.".into());
    }
    let parsed = crate::parser::parse_media_path(ftp_path, filename);
    let local_path = if let Some(season) = parsed.season {
        let season_dir = format!("Season {:02}", season);
        if db_media_type == Some("documentary") {
            base.join("Documentaries").join(&parsed.title).join(season_dir).join(filename)
        } else {
            base.join("TV Shows").join(&parsed.title).join(season_dir).join(filename)
        }
    } else if db_media_type == Some("documentary") {
        let title = &parsed.title;
        let first = title.chars().find(|c| c.is_alphanumeric())
            .map(|c| if c.is_ascii_digit() { "0-9".to_string() } else { c.to_uppercase().to_string() })
            .unwrap_or_else(|| "#".to_string());
        let folder_name = if let Some(y) = parsed.year { format!("{} ({})", title, y) } else { title.clone() };
        base.join("Documentaries").join(first).join(folder_name).join(filename)
    } else {
        let title = &parsed.title;
        let first = title.chars().find(|c| c.is_alphanumeric())
            .map(|c| if c.is_ascii_digit() { "0-9".to_string() } else { c.to_uppercase().to_string() })
            .unwrap_or_else(|| "#".to_string());
        let folder_name = if let Some(y) = parsed.year { format!("{} ({})", title, y) } else { title.clone() };
        base.join("Movies").join(first).join(folder_name).join(filename)
    };
    // suppress unused variable warning for ftp_path
    let _ = ftp_path;
    Ok(local_path)
}

#[tauri::command]
pub async fn queue_download(
    db_state: tauri::State<'_, crate::db::Db>,
    queue_state: tauri::State<'_, crate::downloads::SharedQueue>,
    window: WebviewWindow,
    ftp_path: String,
    filename: String,
    media_title: Option<String>,
) -> Result<u64, String> {
    let db = db_state.inner().clone();
    let config = db.load_config()?;
    let db_media_type: Option<String> = db_state.get_media_type_by_path(&ftp_path).ok().flatten();
    let local_path = compute_local_path(&config, &ftp_path, &filename, db_media_type.as_deref())?;

    // Deduplicate: if this ftp_path is already Queued or Downloading, return the existing id.
    let existing_id = {
        let queue = queue_state.lock().unwrap();
        queue.find_active_by_ftp_path(&ftp_path)
    };
    if let Some(id) = existing_id {
        return Ok(id);
    }

    std::fs::create_dir_all(local_path.parent().unwrap())
        .map_err(|e| format!("Could not create directory: {e}"))?;

    let local_str = local_path.to_string_lossy().to_string();

    let (id, semaphore, cancel_flag) = {
        let mut queue = queue_state.lock().unwrap();
        queue.add(ftp_path.clone(), filename.clone(), local_str.clone(), media_title.clone())
    };
    persist_download_state(&db, queue_state.inner());

    let new_item = {
        let queue = queue_state.lock().unwrap();
        queue.items.iter().find(|i| i.id == id).cloned()
    };

    if let Some(item) = new_item {
        window.emit("download:added", &item).ok();
    }

    spawn_download_job_pub(
        db,
        queue_state.inner().clone(),
        Some(window.clone()),
        config,
        id,
        ftp_path,
        local_str,
        semaphore,
        cancel_flag,
    );

    Ok(id)
}

#[tauri::command]
pub async fn get_downloads(
    queue: tauri::State<'_, crate::downloads::SharedQueue>,
) -> Result<Vec<crate::downloads::DownloadItem>, String> {
    let queue = queue.lock().unwrap();
    Ok(queue.items.clone())
}

#[tauri::command]
pub async fn cancel_download(
    db: tauri::State<'_, crate::db::Db>,
    window: WebviewWindow,
    queue: tauri::State<'_, crate::downloads::SharedQueue>,
    id: u64,
) -> Result<(), String> {
    let mut queue = queue.lock().unwrap();
    queue.cancel(id);
    let snapshot = queue.items.clone();
    drop(queue);
    db.save_download_state(&snapshot).ok();
    window.emit("download:update", serde_json::json!({
        "id": id,
        "status": "cancelled",
        "error": serde_json::Value::Null,
        "completed_at_ms": std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_millis() as u64,
    })).ok();
    Ok(())
}

#[tauri::command]
pub async fn clear_completed(
    db: tauri::State<'_, crate::db::Db>,
    queue: tauri::State<'_, crate::downloads::SharedQueue>,
) -> Result<(), String> {
    let mut queue = queue.lock().unwrap();
    queue.clear_completed();
    let snapshot = queue.items.clone();
    drop(queue);
    db.save_download_state(&snapshot).ok();
    Ok(())
}

#[tauri::command]
pub async fn delete_download(
    db: tauri::State<'_, crate::db::Db>,
    queue: tauri::State<'_, crate::downloads::SharedQueue>,
    id: u64,
) -> Result<(), String> {
    let mut queue = queue.lock().unwrap();
    queue.delete(id);
    let snapshot = queue.items.clone();
    drop(queue);
    db.save_download_state(&snapshot).ok();
    Ok(())
}

#[tauri::command]
pub async fn set_max_concurrent(
    queue: tauri::State<'_, crate::downloads::SharedQueue>,
    max: usize,
) -> Result<(), String> {
    let mut queue = queue.lock().unwrap();
    queue.update_concurrent(max);
    Ok(())
}

#[tauri::command]
pub async fn retry_download(
    db_state: tauri::State<'_, crate::db::Db>,
    queue_state: tauri::State<'_, crate::downloads::SharedQueue>,
    window: WebviewWindow,
    id: u64,
) -> Result<u64, String> {
    let db = db_state.inner().clone();
    let config = db.load_config()?;
    let (item, semaphore, cancel_flag) = {
        let mut queue = queue_state.lock().unwrap();
        queue.retry(id)?
    };

    let local_path_buf = std::path::PathBuf::from(&item.local_path);
    if let Some(parent) = local_path_buf.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    persist_download_state(&db, queue_state.inner());
    window.emit("download:update", serde_json::json!({
        "id": item.id,
        "status": "queued",
        "bytes_done": item.bytes_done,
        "error": serde_json::Value::Null,
        "started_at_ms": serde_json::Value::Null,
        "completed_at_ms": serde_json::Value::Null,
    })).ok();

    spawn_download_job_pub(
        db,
        queue_state.inner().clone(),
        Some(window.clone()),
        config,
        item.id,
        item.ftp_path.clone(),
        item.local_path.clone(),
        semaphore,
        cancel_flag,
    );

    Ok(item.id)
}

#[tauri::command]
pub async fn open_download_folder(
    app: tauri::AppHandle,
    local_path: String,
) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    let path = std::path::PathBuf::from(&local_path);
    let folder = if path.is_dir() {
        path
    } else {
        path.parent().map(|p| p.to_path_buf()).unwrap_or_else(|| std::path::PathBuf::from("."))
    };
    app.opener().open_path(folder.to_string_lossy().as_ref(), None::<&str>)
        .map_err(|e| e.to_string())
}


#[tauri::command]
pub async fn clear_item_metadata(
    state: tauri::State<'_, crate::db::Db>,
    id: i64,
) -> Result<(), String> {
    state.clear_item_metadata(id)
}

#[tauri::command]
pub async fn clear_show_metadata(
    state: tauri::State<'_, crate::db::Db>,
    tmdb_id: i64,
) -> Result<usize, String> {
    state.clear_show_metadata(tmdb_id)
}

#[tauri::command]
pub async fn clear_all_metadata(
    state: tauri::State<'_, crate::db::Db>,
) -> Result<usize, String> {
    state.clear_all_metadata()
}

#[tauri::command]
pub async fn refresh_all_metadata(
    state: tauri::State<'_, crate::db::Db>,
    window: WebviewWindow,
) -> Result<(), String> {
    refresh_all_metadata_internal(state.inner().clone(), Some(window)).await
}

pub async fn refresh_all_metadata_internal(
    db: crate::db::Db,
    window: Option<tauri::WebviewWindow>,
) -> Result<(), String> {
    let config = db.load_config()?;
    let items = db.get_all_media()?;
    let mut items: Vec<_> = items
        .into_iter()
        .filter(|item| {
            item.tmdb_id.is_some()
                && (
                    item.tmdb_title.as_deref().unwrap_or("").is_empty()
                        || item.tmdb_title_en.as_deref().unwrap_or("").is_empty()
                        || item.tmdb_overview.as_deref().unwrap_or("").is_empty()
                        || item.tmdb_overview_en.as_deref().unwrap_or("").is_empty()
                        || item.tmdb_poster.as_deref().unwrap_or("").is_empty()
                        || item.tmdb_poster_en.as_deref().unwrap_or("").is_empty()
                        || item.tmdb_release_date.as_deref().unwrap_or("").is_empty()
                        || item.imdb_id.as_deref().unwrap_or("").is_empty()
                        || item.tmdb_rating.is_none()
                        || item.tmdb_genres.as_deref().unwrap_or("").is_empty()
                )
        })
        .collect();

    // Process newest entries first on boot/library refresh.
    items.sort_by(|a, b| {
        b.indexed_at
            .as_deref()
            .unwrap_or("")
            .cmp(a.indexed_at.as_deref().unwrap_or(""))
            .then_with(|| b.id.cmp(&a.id))
    });

    let total = items.len();
    if let Some(ref w) = window {
        w.emit("index:log", serde_json::json!({
            "msg": format!("🔄 Refreshing metadata for {} matched items…", total)
        })).ok();
    }

    if total == 0 {
        if let Some(ref w) = window {
            w.emit("index:log", serde_json::json!({
                "msg": "✓ Metadata refresh complete — nothing missing"
            })).ok();
        }
        return Ok(());
    }

    for (i, item) in items.into_iter().enumerate() {
        let tmdb_id = match item.tmdb_id {
            Some(value) => value,
            None => continue,
        };
        let media_type = item.tmdb_type
            .clone()
            .or_else(|| item.media_type.clone())
            .unwrap_or_else(|| "movie".to_string());
        let title = item.tmdb_title
            .clone()
            .or_else(|| item.title.clone())
            .unwrap_or_else(|| item.filename.clone());

        if let Some(ref w) = window {
            w.emit("index:log", serde_json::json!({
                "msg": format!("🌐 [{}/{}] Refreshing metadata: {}", i + 1, total, title)
            })).ok();
        }

        tokio::time::sleep(std::time::Duration::from_millis(260)).await;

        match crate::tmdb::fetch_movie_by_id(&config.tmdb_api_key, tmdb_id, &media_type).await {
            Ok(movie) => {
                db.refresh_tmdb_metadata(
                    item.id,
                    &movie,
                    &media_type,
                    item.manual_match.unwrap_or(0) != 0,
                )?;
                if let Some(ref w) = window {
                    w.emit("index:update", serde_json::json!({
                        "id": item.id,
                        "tmdb_id": movie.id,
                        "imdb_id": movie.imdb_id,
                        "tmdb_title": movie.title,
                        "tmdb_title_en": movie.title_en,
                        "tmdb_poster": movie.poster_path,
                        "tmdb_poster_en": movie.poster_path_en,
                        "tmdb_rating": movie.vote_average,
                        "tmdb_overview": movie.overview,
                        "tmdb_overview_en": movie.overview_en,
                        "tmdb_genres": movie.genre_ids,
                        "tmdb_release_date": movie.release_date,
                        "tmdb_type": media_type,
                    })).ok();
                }
            }
            Err(err) => {
                if let Some(ref w) = window {
                    w.emit("index:log", serde_json::json!({
                        "msg": format!("⚠ Metadata refresh failed for {}: {}", title, err)
                    })).ok();
                }
            }
        }
    }

    if let Some(ref w) = window {
        w.emit("index:log", serde_json::json!({
            "msg": format!("✓ Metadata refresh complete — {} items processed", total)
        })).ok();
    }
    Ok(())
}

#[tauri::command]
pub async fn check_media_badges(
    state: tauri::State<'_, crate::db::Db>,
    items: Vec<MediaBadgeQuery>,
) -> Result<Vec<MediaBadgeResult>, String> {
    let config = state.load_config()?;
    let mut results = Vec::with_capacity(items.len());
    let mut plex_badge_cache: std::collections::HashMap<String, MediaServerCheck> =
        std::collections::HashMap::new();

    for item in items {
        let downloaded = compute_local_path(&config, &item.ftp_path, &item.filename, item.media_type.as_deref())
            .map(|path| path.exists())
            .unwrap_or(false);

        let check = if let Some(cache_key) = plex_badge_cache_key(&item) {
            if let Some(hit) = plex_badge_cache.get(&cache_key).cloned() {
                MediaServerCheck {
                    cache_state: format!("request-hit:{cache_key}"),
                    ..hit
                }
            } else {
                let check = check_media_server_presence(&config, &item).await.unwrap_or(MediaServerCheck {
                    hit: false,
                    plex_hit: false,
                    emby_hit: false,
                    cache_state: "error".to_string(),
                    debug: "media-server-check:error".to_string(),
                });
                plex_badge_cache.insert(cache_key, check.clone());
                check
            }
        } else {
            MediaServerCheck {
                hit: false,
                plex_hit: false,
                emby_hit: false,
                cache_state: "no-cache-key".to_string(),
                debug: "no-cache-key".to_string(),
            }
        };

        results.push(MediaBadgeResult {
            id: item.id,
            downloaded,
            in_emby: check.hit,
            plex_in_library: Some(check.plex_hit),
            emby_in_library: Some(check.emby_hit),
            cache: Some(check.cache_state),
            debug: Some(check.debug),
        });
    }

    Ok(results)
}

#[tauri::command]
pub async fn search_tmdb(
    state: tauri::State<'_, crate::db::Db>,
    query: String,
    media_type: String,
) -> Result<Vec<crate::tmdb::TmdbMovie>, String> {
    let config = state.load_config()?;
    crate::tmdb::search_tmdb_multi(&config.tmdb_api_key, &query, &media_type).await
}

#[tauri::command]
pub async fn apply_tmdb_match(
    state: tauri::State<'_, crate::db::Db>,
    window: WebviewWindow,
    item_id: i64,
    tmdb_id: i64,
    media_type: String,
) -> Result<(), String> {
    let config = state.load_config()?;
    let movie = crate::tmdb::fetch_movie_by_id(&config.tmdb_api_key, tmdb_id, &media_type).await?;
    state.update_tmdb_manual(item_id, &movie, &media_type)?;
    window.emit(
        "index:update",
        serde_json::json!({
            "id": item_id,
            "tmdb_id": movie.id,
            "imdb_id": movie.imdb_id,
            "tmdb_title": movie.title,
            "tmdb_title_en": movie.title_en,
            "tmdb_poster": movie.poster_path,
            "tmdb_poster_en": movie.poster_path_en,
            "tmdb_rating": movie.vote_average,
            "tmdb_overview": movie.overview,
            "tmdb_overview_en": movie.overview_en,
            "tmdb_genres": movie.genre_ids,
            "tmdb_release_date": movie.release_date,
            "tmdb_type": media_type,
        }),
    ).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn ftp_list_root_dirs(
    state: tauri::State<'_, crate::db::Db>,
) -> Result<Vec<String>, String> {
    let config = state.load_config()?;
    let entries = crate::ftp::list_raw(
        &config.ftp_host,
        config.ftp_port,
        &config.ftp_user,
        &config.ftp_pass,
        &config.ftp_root,
    ).await?;
    // Parse directory entries (Unix: starts with 'd', Windows: contains '<DIR>')
    let dirs = entries.into_iter().filter_map(|line| {
        let is_dir = line.starts_with('d') || line.to_uppercase().contains("<DIR>");
        if !is_dir { return None; }
        let parts: Vec<&str> = line.split_whitespace().collect();
        let name_start = if line.starts_with('d') { 8 } else { 3 };
        if parts.len() > name_start {
            let name = parts[name_start..].join(" ");
            if name != "." && name != ".." { Some(name) } else { None }
        } else { None }
    }).collect();
    Ok(dirs)
}

#[tauri::command]
pub async fn ftp_list_root_dirs_preview(
    host: String,
    port: u16,
    user: String,
    pass: String,
    root: String,
) -> Result<Vec<String>, String> {
    let entries = crate::ftp::list_raw(&host, port, &user, &pass, &root).await?;
    let dirs = entries
        .into_iter()
        .filter_map(|line| {
            let is_dir = line.starts_with('d') || line.to_uppercase().contains("<DIR>");
            if !is_dir {
                return None;
            }
            let parts: Vec<&str> = line.split_whitespace().collect();
            let name_start = if line.starts_with('d') { 8 } else { 3 };
            if parts.len() > name_start {
                let name = parts[name_start..].join(" ");
                if name != "." && name != ".." {
                    Some(name)
                } else {
                    None
                }
            } else {
                None
            }
        })
        .collect();
    Ok(dirs)
}

#[tauri::command]
pub async fn get_webgui_config(
    state: tauri::State<'_, crate::db::Db>,
) -> Result<crate::db::WebGuiConfig, String> {
    state.load_webgui_config()
}

#[tauri::command]
pub async fn save_webgui_config(
    state: tauri::State<'_, crate::db::Db>,
    config: crate::db::WebGuiConfig,
) -> Result<(), String> {
    state.save_webgui_config(&config)
}

#[tauri::command]
pub async fn init_webgui_now(
    db: tauri::State<'_, crate::db::Db>,
    queue: tauri::State<'_, crate::downloads::SharedQueue>,
    app: tauri::AppHandle,
) -> Result<(), String> {
    crate::web::spawn_if_enabled(db.inner().clone(), queue.inner().clone(), app);
    Ok(())
}
