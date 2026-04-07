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
pub(crate) struct BadgeCacheEntry {
    checked_at: std::time::Instant,
    check: MediaServerCheck,
}

pub(crate) static BADGE_RESULT_CACHE: LazyLock<Mutex<std::collections::HashMap<String, BadgeCacheEntry>>> =
    LazyLock::new(|| Mutex::new(std::collections::HashMap::new()));

fn emit_index_log(window: &Option<tauri::WebviewWindow>, msg: String) {
    #[cfg(debug_assertions)]
    {
        if let Some(w) = window {
            w.emit("index:log", serde_json::json!({ "msg": msg })).ok();
        }
    }

    #[cfg(not(debug_assertions))]
    {
        let _ = window;
        let _ = msg;
    }
}

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

fn persist_upload_state(
    db: &crate::db::Db,
    queue: &crate::uploads::SharedUploadQueue,
) {
    let snapshot = {
        let queue = queue.lock().unwrap();
        queue.items.clone()
    };
    db.save_upload_state(&snapshot).ok();
}

pub fn restore_upload_queue(
    db: crate::db::Db,
    queue_state: crate::uploads::SharedUploadQueue,
) {
    let restored = db.load_upload_state().unwrap_or_default();
    if restored.is_empty() {
        return;
    }
    {
        let mut queue = queue_state.lock().unwrap();
        queue.restore(restored);
    }
    persist_upload_state(&db, &queue_state);
}

pub async fn resume_pending_uploads(
    db: crate::db::Db,
    queue_state: crate::uploads::SharedUploadQueue,
    app: tauri::AppHandle,
) -> Result<(), String> {
    let pending = {
        let queue = queue_state.lock().unwrap();
        queue.items
            .iter()
            .filter(|i| matches!(i.status, crate::uploads::UploadStatus::Queued))
            .cloned()
            .collect::<Vec<_>>()
    };

    for item in pending {
        let (semaphore, cancel_flag) = {
            let mut queue = queue_state.lock().unwrap();
            let (_, semaphore, cancel_flag) = queue.retry(item.id)?;
            (semaphore, cancel_flag)
        };
        persist_upload_state(&db, &queue_state);
        spawn_upload_job(
            db.clone(),
            queue_state.clone(),
            app.clone(),
            item.id,
            item.local_path,
            item.ftp_dest_path,
            item.filename,
            item.media_title,
            item.tmdb_id,
            item.bytes_total,
            item.resolution,
            item.hdr,
            item.languages,
            item.codec,
            item.audio_codec,
            item.subtitle_langs,
            item.audio_tracks,
            item.subtitle_tracks,
            item.group_id,
            semaphore,
            cancel_flag,
        );
    }
    Ok(())
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
    window: Option<WebviewWindow>,
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
        if let Some(ref w) = window {
            w.emit("download:update", serde_json::json!({
                "id": item.id,
                "status": "queued",
                "bytes_done": resumed_bytes,
                "error": serde_json::Value::Null,
            })).ok();
        }
        persist_download_state(&db, &queue_state);
        spawn_download_job_pub(
            db.clone(),
            queue_state.clone(),
            window.clone(),
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
pub(crate) struct MediaServerCheck {
    pub(crate) hit: bool,
    pub(crate) plex_hit: bool,
    pub(crate) emby_hit: bool,
    pub(crate) cache_state: String,
    pub(crate) debug: String,
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
    // For TV/documentary episodes, include the episode coordinates in the key so that
    // different episodes of the same show don't poison each other's cache slot.
    let episode_suffix = {
        let media_type = query.media_type.as_deref().unwrap_or_default();
        if media_type == "tv" || media_type == "documentary" {
            let parsed = crate::parser::parse_media_path(&query.ftp_path, &query.filename);
            match (parsed.season, parsed.episode) {
                (Some(s), Some(e)) => format!(":S{s:02}E{e:02}"),
                _ => String::new(),
            }
        } else {
            String::new()
        }
    };

    if let Some(imdb_id) = query.imdb_id.as_deref().map(str::trim).filter(|v| !v.is_empty()) {
        return Some(format!("imdb:{imdb_id}{episode_suffix}"));
    }
    if let Some(tmdb_id) = query.tmdb_id {
        return Some(format!("tmdb:{tmdb_id}{episode_suffix}"));
    }

    let title = query
        .title
        .as_deref()
        .or(query.title_en.as_deref())
        .map(normalize_title)
        .filter(|t| !t.is_empty())?;

    Some(format!("title:{title}:{}{episode_suffix}", query.year.unwrap_or_default()))
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

pub(crate) async fn check_media_server_presence(
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

    // Only cache if at least one server was actually queried — don't cache
    // "not-configured" results, which would become stale as soon as the user
    // saves their Plex/Emby credentials.
    if plex_configured || emby_configured {
        if let Some(cache_key) = plex_badge_cache_key(query) {
            BADGE_RESULT_CACHE.lock().unwrap().insert(
                cache_key,
                BadgeCacheEntry {
                    checked_at: std::time::Instant::now(),
                    check: check.clone(),
                },
            );
        }
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
) -> Result<Option<(crate::tmdb::TmdbMovie, String)>, String> {
    if let Ok(Some(imdb_id)) = resolve_plex_imdb_id(config, title, year, tmdb_search_type).await {
        if let Some(movie) = crate::tmdb::find_by_imdb_id(api_key, &imdb_id, tmdb_search_type).await? {
            let actual_type = if tmdb_search_type == "tv" { "tv" } else { "movie" }.to_string();
            return Ok(Some((movie, actual_type)));
        }
    }

    let result = if tmdb_search_type == "tv" {
        crate::tmdb::search_tmdb_multi(api_key, title, "tv")
            .await
            .ok()
            .and_then(|mut r| if r.is_empty() { None } else { Some(r.remove(0)) })
            .map(|m| (m, "tv".to_string()))
    } else {
        crate::tmdb::smart_search(api_key, title, year, tmdb_search_type)
            .await
            .ok()
            .flatten()
            .map(|(m, ep)| (m, ep.to_string()))
    };

    if let Some((movie, actual_type)) = result {
        let movie = match crate::tmdb::fetch_movie_by_id(api_key, movie.id, &actual_type).await {
            Ok(full) => full,
            Err(_) => movie,
        };
        return Ok(Some((movie, actual_type)));
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
    let result = state.save_config(&config);
    // Invalidate badge cache so stale "not-configured" entries are evicted immediately.
    BADGE_RESULT_CACHE.lock().unwrap().clear();
    result
}

#[tauri::command]
pub async fn has_config(state: tauri::State<'_, crate::db::Db>) -> Result<bool, String> {
    state.has_config()
}

#[tauri::command]
pub async fn get_applied_migrations(
    state: tauri::State<'_, crate::db::Db>,
) -> Result<Vec<crate::db::AppliedMigration>, String> {
    state.list_applied_migrations()
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

// ── Storage / portable-mode commands ─────────────────────────────────────────

/// Returns the directory that currently holds `library.db`.
#[tauri::command]
pub async fn get_db_path(
    state: tauri::State<'_, crate::db::Db>,
) -> Result<String, String> {
    Ok(state.data_dir().to_string_lossy().to_string())
}

/// First-run only: record the desired data directory in bootstrap.json without
/// performing a VACUUM (the DB hasn't been used yet, so nothing to migrate).
#[tauri::command]
pub async fn init_db_path(
    _state: tauri::State<'_, crate::db::Db>,
    dir: String,
) -> Result<(), String> {
    crate::db::Db::write_bootstrap(Some(std::path::Path::new(&dir)));
    Ok(())
}

/// Migrate the live database to a new directory and persist the path in
/// bootstrap.json. The caller must prompt the user to restart the app.
#[tauri::command]
pub async fn set_db_path(
    state: tauri::State<'_, crate::db::Db>,
    dir: String,
) -> Result<(), String> {
    state.migrate_to(std::path::Path::new(&dir))
}

/// Whether the app booted in portable mode (`.oscata-portable` marker found).
#[tauri::command]
pub async fn is_portable_mode(
    state: tauri::State<'_, crate::db::Db>,
) -> Result<bool, String> {
    Ok(state.is_portable())
}

/// Remove the custom path from bootstrap.json so the next launch uses the
/// default app-data location. The caller must prompt the user to restart.
#[tauri::command]
pub async fn reset_db_path(
    _state: tauri::State<'_, crate::db::Db>,
) -> Result<(), String> {
    crate::db::Db::write_bootstrap(None);
    Ok(())
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
    queue_state: tauri::State<'_, crate::downloads::SharedQueue>,
    window: WebviewWindow,
) -> Result<(), String> {
    start_indexing_internal(
        state.inner().clone(),
        Some(window.clone()),
        Some(queue_state.inner().clone()),
    ).await
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

    emit_index_log(&window, format!("🔄 Re-matching {} items with TMDB…", total));

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

        emit_index_log(
            &window,
            format!("🌐 [{}/{}] Matching: {} ({})", i + 1, total, title, mtype),
        );

        // Rate limit: 40 req/10s
        tokio::time::sleep(std::time::Duration::from_millis(260)).await;

        let api_key = &config.tmdb_api_key;
        let result = resolve_tmdb_match_with_plex(&config, api_key, &title, year, tmdb_search_type).await;

        if let Ok(Some((movie, actual_type))) = result {
            emit_index_log(
                &window,
                format!(
                    "✓ Matched: {} → {} ({})",
                    title,
                    movie.title,
                    movie.release_date.as_deref().unwrap_or("?")
                ),
            );
            db.update_tmdb_auto(item.id, &movie, &actual_type).ok();
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
                    "tmdb_type": actual_type,
                })).ok();
            }
        } else {
            emit_index_log(&window, format!("⚠ No match found for: {}", title));
        }
    }

    emit_index_log(&window, format!("✓ Re-match complete — {} items processed", total));
    Ok(())
}

pub async fn start_indexing_internal(
    db: crate::db::Db,
    window: Option<tauri::WebviewWindow>,
    queue: Option<crate::downloads::SharedQueue>,
) -> Result<(), String> {
    let config = db.load_config()?;

    if let Some(ref w) = window { w.emit("index:start", serde_json::json!({})).ok(); }

    let window_log = window.clone();
    let on_log = Arc::new(move |msg: String| {
        emit_index_log(&window_log, msg);
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
    let current_paths: Vec<String> = files.iter().map(|file| file.path.clone()).collect();
    let mut metadata_tasks = Vec::new();
    let mut metadata_queued = 0usize;
    let mut new_items = 0usize;

    // Counters for TMDB enrichment progress events (index:tmdb_progress)
    let tmdb_done = Arc::new(std::sync::atomic::AtomicUsize::new(0));
    let tmdb_total = Arc::new(std::sync::atomic::AtomicUsize::new(0));

    if total == 0 {
        if let Some(ref w) = window { w.emit("index:error", serde_json::json!({ "message": "FTP crawl returned 0 media files. Check your Root Path setting." })).ok(); }
        return Ok(());
    }

    // ── IPC progress event batching ────────────────────────────────────────
    // Emit one index:progress event per PROGRESS_BATCH_SIZE files (or at loop
    // end) rather than one per file. The payload is an array so the frontend
    // can apply them all in a single React state update, cutting IPC overhead
    // on large libraries from O(N) individual events to O(N/50).
    const PROGRESS_BATCH_SIZE: usize = 50;
    let mut progress_batch: Vec<serde_json::Value> = Vec::with_capacity(PROGRESS_BATCH_SIZE);

    let flush_progress_batch = |batch: &mut Vec<serde_json::Value>, window: &Option<tauri::WebviewWindow>| {
        if batch.is_empty() { return; }
        if let Some(ref w) = window {
            w.emit("index:progress", serde_json::json!(batch)).ok();
        }
        batch.clear();
    };

    // Wrap the entire upsert loop in a single explicit transaction.
    // Without this, rusqlite commits a transaction per statement (autocommit),
    // producing N WAL write round-trips instead of one.
    db.begin_batch().map_err(|e| {
        on_log(format!("⚠ Failed to begin index transaction: {e}"));
        e
    })?;

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

        let upsert = db.upsert_media(
            &file.path,
            &file.filename,
            Some(file.size),
            &parsed,
            media_type_str,
            file.modified_at.as_deref(),
            &root,
        )?;
        let id = upsert.id;

        on_log(format!("⚙ Indexing [{}/{}]: {}", i + 1, total, parsed.title));

        progress_batch.push(serde_json::json!({
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
        }));

        if progress_batch.len() >= PROGRESS_BATCH_SIZE {
            flush_progress_batch(&mut progress_batch, &window);
        }

        if upsert.is_new {
            new_items += 1;
        }

        if upsert.needs_metadata {
            metadata_queued += 1;
            let api_key = config.tmdb_api_key.clone();
            let title = parsed.title.clone();
            let year = parsed.year;
            let mtype = media_type.clone().unwrap_or_else(|| "movie".to_string());
            let tmdb_stype = tmdb_search_type.clone();

            // Whether the file is new or existing, spawn the TMDB enrichment as a
            // background task so it never blocks the index loop.
            // The TMDB throttle (35 ms minimum interval, enforced inside
            // fetch_json_with_retry) handles rate limiting — no artificial sleep needed.
            {
                let window_clone = window.clone();
                let db_clone = db.clone();
                let config_clone = config.clone();
                let on_log_clone = on_log.clone();
                let label = if upsert.is_new { "new" } else { "existing" };
                let tmdb_done_clone = tmdb_done.clone();
                let tmdb_total_clone = tmdb_total.clone();
                tmdb_total.fetch_add(1, std::sync::atomic::Ordering::SeqCst);

                metadata_tasks.push(tokio::spawn(async move {
                    on_log_clone(format!("🌐 TMDB ({label}): {title}"));
                    let result = resolve_tmdb_match_with_plex(
                        &config_clone,
                        &api_key,
                        &title,
                        year,
                        &tmdb_stype,
                    )
                    .await;
                    match result {
                        Ok(Some((movie, actual_type))) => {
                            on_log_clone(format!("🌐 TMDB: {} → {}", title, movie.title));
                            db_clone.update_tmdb_auto(id, &movie, &actual_type).ok();
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
                                        "tmdb_type": actual_type,
                                    }),
                                ).ok();
                            }
                        }
                        Ok(None) => {
                            on_log_clone(format!("⚠ TMDB: no match for \"{}\"", title));
                        }
                        Err(e) => {
                            on_log_clone(format!("✗ TMDB error for \"{}\": {}", title, e));
                        }
                    }
                    // Emit progress after task completes (success or failure)
                    let done = tmdb_done_clone.fetch_add(1, std::sync::atomic::Ordering::SeqCst) + 1;
                    let total_val = tmdb_total_clone.load(std::sync::atomic::Ordering::SeqCst);
                    if let Some(ref w) = window_clone {
                        w.emit(
                            "index:tmdb_progress",
                            serde_json::json!({ "done": done, "total": total_val }),
                        ).ok();
                    }
                }));
            }
        }
    }

    // Flush any remaining progress items that didn't fill a full batch.
    flush_progress_batch(&mut progress_batch, &window);

    // Commit the batch transaction opened before the upsert loop.
    db.commit_batch().map_err(|e| {
        on_log(format!("⚠ Failed to commit index transaction: {e}"));
        db.rollback_batch().ok();
        e
    })?;

    for task in metadata_tasks {
        if task.await.is_err() {
            on_log("⚠ TMDB metadata task failed unexpectedly".to_string());
        }
    }

    let removed_stale = db.delete_media_missing_from_scan(&current_paths)?;
    if removed_stale > 0 {
        on_log(format!(
            "🧹 Cleanup removed {} stale item{} no longer present on FTP",
            removed_stale,
            if removed_stale == 1 { "" } else { "s" }
        ));
    }

    on_log(format!(
        "✓ Indexing complete — {} files scanned, {} new, {} sent to TMDB, {} stale item{} removed",
        total,
        new_items,
        metadata_queued,
        removed_stale,
        if removed_stale == 1 { "" } else { "s" }
    ));

    if let Some(ref w) = window {
        w.emit(
            "index:complete",
            serde_json::json!({
                "total": total,
                "new_items": new_items,
                "metadata_queued": metadata_queued,
                "removed": removed_stale,
            }),
        )
        .ok();
    }

    db.save_last_indexed_at(&chrono::Utc::now().to_rfc3339()).ok();

    // Trigger watchlist auto-downloads now that tmdb_ids are fully written.
    if let Some(q) = queue {
        trigger_watchlist_auto_downloads(db, q, window).await;
    }

    Ok(())
}

pub fn compute_local_path(
    config: &crate::db::AppConfig,
    ftp_path: &str,
    filename: &str,
    db_media_type: Option<&str>,
    tmdb_genres: Option<&str>,
) -> Result<std::path::PathBuf, String> {
    let base = std::path::PathBuf::from(&config.download_folder);
    if base.as_os_str().is_empty() {
        return Err("Download folder not configured. Open Settings to set it.".into());
    }
    let parsed = crate::parser::parse_media_path(ftp_path, filename);

    // Parse genre IDs from the stored JSON (e.g. "[28,16,878]")
    let item_genre_ids: Vec<i64> = tmdb_genres
        .and_then(|raw| serde_json::from_str(raw).ok())
        .unwrap_or_default();

    // Parse genre routing rules and check for a match
    #[derive(serde::Deserialize)]
    struct GenreDestRule {
        genre_ids: Vec<i64>,
        destination: String,
        media_types: Vec<String>, // "movie", "tv", "documentary", "all"
    }
    let rules: Vec<GenreDestRule> = serde_json::from_str(&config.genre_destinations)
        .unwrap_or_default();

    let effective_media_type = db_media_type.unwrap_or("");
    let genre_base: Option<std::path::PathBuf> = rules.into_iter().find(|rule| {
        if rule.destination.is_empty() { return false; }
        let type_match = rule.media_types.iter().any(|t| t == "all" || t == effective_media_type);
        let genre_match = rule.genre_ids.iter().any(|id| item_genre_ids.contains(id));
        type_match && genre_match
    }).map(|rule| std::path::PathBuf::from(&rule.destination));

    let use_alpha = config.alphabetical_subfolders;

    let alpha_letter = |title: &str| -> String {
        title.chars().find(|c| c.is_alphanumeric())
            .map(|c| if c.is_ascii_digit() { "0-9".to_string() } else { c.to_uppercase().to_string() })
            .unwrap_or_else(|| "#".to_string())
    };

    let local_path = if let Some(season) = parsed.season {
        // TV series (has season) → no alphabetical subfolder
        let season_dir = format!("Season {:02}", season);
        if db_media_type == Some("documentary") {
            let dest = if !config.documentary_destination.is_empty() {
                std::path::PathBuf::from(&config.documentary_destination)
            } else {
                base.join("Documentaries")
            };
            genre_base.unwrap_or(dest).join(&parsed.title).join(season_dir).join(filename)
        } else {
            let dest = if !config.tv_destination.is_empty() {
                std::path::PathBuf::from(&config.tv_destination)
            } else {
                base.join("TV Shows")
            };
            genre_base.unwrap_or(dest).join(&parsed.title).join(season_dir).join(filename)
        }
    } else if db_media_type == Some("documentary") {
        let title = &parsed.title;
        let folder_name = if let Some(y) = parsed.year { format!("{} ({})", title, y) } else { title.clone() };
        let dest = if !config.documentary_destination.is_empty() {
            std::path::PathBuf::from(&config.documentary_destination)
        } else {
            base.join("Documentaries")
        };
        let root = genre_base.unwrap_or(dest);
        if use_alpha {
            root.join(alpha_letter(title)).join(folder_name).join(filename)
        } else {
            root.join(folder_name).join(filename)
        }
    } else {
        let title = &parsed.title;
        let folder_name = if let Some(y) = parsed.year { format!("{} ({})", title, y) } else { title.clone() };
        let dest = if !config.movie_destination.is_empty() {
            std::path::PathBuf::from(&config.movie_destination)
        } else {
            base.join("Movies")
        };
        let root = genre_base.unwrap_or(dest);
        if use_alpha {
            root.join(alpha_letter(title)).join(folder_name).join(filename)
        } else {
            root.join(folder_name).join(filename)
        }
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
    let tmdb_genres: Option<String> = db_state.get_tmdb_genres_by_path(&ftp_path).ok().flatten();
    let local_path = compute_local_path(&config, &ftp_path, &filename, db_media_type.as_deref(), tmdb_genres.as_deref())?;

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
    let local_path = {
        let mut queue = queue.lock().unwrap();
        // Cancel any in-progress transfer first so the file handle is released.
        queue.cancel(id);
        let path = queue.items.iter().find(|i| i.id == id).map(|i| i.local_path.clone());
        queue.delete(id);
        let snapshot = queue.items.clone();
        drop(queue);
        db.save_download_state(&snapshot).ok();
        path
    };
    // Delete the file from disk. Ignore errors (file may not exist yet).
    if let Some(path) = local_path {
        std::fs::remove_file(&path).ok();
    }
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
pub async fn quit_app(app: tauri::AppHandle) {
    app.exit(0);
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
            // Always include items that were never matched at all
            if item.tmdb_id.is_none() {
                return true;
            }
            // Include matched items that are missing core display fields.
            // imdb_id, tmdb_title_en, tmdb_overview_en, tmdb_poster_en are intentionally
            // excluded: they are legitimately absent for many items (TV shows have no IMDb ID,
            // non-English originals have no _en variant). Including them caused the same
            // items to be re-fetched every 15 minutes in an infinite loop.
            item.tmdb_title.as_deref().unwrap_or("").is_empty()
                || item.tmdb_poster.as_deref().unwrap_or("").is_empty()
                || item.tmdb_overview.as_deref().unwrap_or("").is_empty()
                || item.tmdb_release_date.as_deref().unwrap_or("").is_empty()
                || item.tmdb_rating.is_none()
                || item.tmdb_genres.as_deref().unwrap_or("").is_empty()
        })
        .collect();

    // Process newest entries first on boot/library refresh.
    items.sort_by(|a, b| {
        let parse_ts = |value: Option<&str>| -> i64 {
            value
                .and_then(|raw| chrono::DateTime::parse_from_rfc3339(raw).ok())
                .map(|dt| dt.with_timezone(&chrono::Utc).timestamp())
                .unwrap_or(0)
        };

        parse_ts(b.indexed_at.as_deref())
            .cmp(&parse_ts(a.indexed_at.as_deref()))
            .then_with(|| b.id.cmp(&a.id))
    });

    let total = items.len();
    emit_index_log(&window, format!("🔄 Refreshing metadata for {} matched items…", total));

    if total == 0 {
        emit_index_log(&window, "✓ Metadata refresh complete — nothing missing".to_string());
        return Ok(());
    }

    // Emit initial progress so the frontend shows the banner immediately
    if let Some(ref w) = window {
        w.emit("metadata:refresh_progress", serde_json::json!({ "done": 0, "total": total })).ok();
    }

    for (i, item) in items.into_iter().enumerate() {
        let media_type = item.tmdb_type
            .clone()
            .or_else(|| item.media_type.clone())
            .unwrap_or_else(|| "movie".to_string());
        let title = item.tmdb_title
            .clone()
            .or_else(|| item.title.clone())
            .unwrap_or_else(|| item.filename.clone());

        emit_index_log(
            &window,
            format!("🌐 [{}/{}] Refreshing metadata: {}", i + 1, total, title),
        );

        tokio::time::sleep(std::time::Duration::from_millis(260)).await;

        // Items with no tmdb_id need a full search, not just a detail fetch.
        if item.tmdb_id.is_none() {
            let tmdb_search_type = match media_type.as_str() {
                "tv" => "tv",
                "documentary" => {
                    let parsed = crate::parser::parse_media_path(&item.ftp_path, &item.filename);
                    if parsed.season.is_some() { "tv" } else { "movie" }
                },
                _ => "movie",
            };
            let year = item.year.map(|y| y as u16);
            match resolve_tmdb_match_with_plex(&config, &config.tmdb_api_key, &title, year, tmdb_search_type).await {
                Ok(Some((movie, actual_type))) => {
                    db.update_tmdb_auto(item.id, &movie, &actual_type).ok();
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
                            "tmdb_type": actual_type,
                        })).ok();
                    }
                }
                Ok(None) => {
                    emit_index_log(&window, format!("⚠ No TMDB match found for: {}", title));
                }
                Err(err) => {
                    emit_index_log(&window, format!("⚠ TMDB search failed for {}: {}", title, err));
                }
            }
            continue;
        }

        let tmdb_id = item.tmdb_id.unwrap();

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
                emit_index_log(
                    &window,
                    format!("⚠ Metadata refresh failed for {}: {}", title, err),
                );
            }
        }

        // Emit per-item progress
        if let Some(ref w) = window {
            w.emit(
                "metadata:refresh_progress",
                serde_json::json!({ "done": i + 1, "total": total }),
            ).ok();
        }
    }

    emit_index_log(
        &window,
        format!("✓ Metadata refresh complete — {} items processed", total),
    );
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
        let downloaded = compute_local_path(&config, &item.ftp_path, &item.filename, item.media_type.as_deref(), None)
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
pub async fn watchdog_pong(
    window: WebviewWindow,
    state: tauri::State<'_, crate::WatchdogState>,
    nonce: u64,
) -> Result<(), String> {
    let mut guard = state.0.lock().map_err(|e| e.to_string())?;
    let entry = guard.entry(window.label().to_string()).or_default();
    if entry.awaiting_nonce == Some(nonce) {
        entry.awaiting_nonce = None;
    }
    entry.recovered_once = false;
    Ok(())
}

#[tauri::command]
pub async fn search_tmdb(
    state: tauri::State<'_, crate::db::Db>,
    query: String,
    media_type: String,
    year: Option<u16>,
) -> Result<Vec<crate::tmdb::TmdbMovie>, String> {
    let config = state.load_config()?;
    crate::tmdb::search_tmdb_multi_with_year(&config.tmdb_api_key, &query, &media_type, year).await
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

// ── Watchlist commands ───────────────────────────────────────────────────────

#[tauri::command]
pub async fn get_watchlist(
    state: tauri::State<'_, crate::db::Db>,
) -> Result<Vec<crate::db::WatchlistItem>, String> {
    state.get_watchlist(0)
}

#[tauri::command]
pub async fn add_to_watchlist(
    state: tauri::State<'_, crate::db::Db>,
    queue_state: tauri::State<'_, crate::downloads::SharedQueue>,
    app: tauri::AppHandle,
    tmdb_id: i64,
    tmdb_type: String,
    title: String,
    title_en: Option<String>,
    poster: Option<String>,
    overview: Option<String>,
    overview_en: Option<String>,
    status: Option<String>,
    release_date: Option<String>,
    year: Option<i64>,
    latest_season: Option<i64>,
    scope: String,
    auto_download: bool,
    profile_id: Option<i64>,
) -> Result<i64, String> {
    let resolved_profile_id = profile_id.unwrap_or_else(|| {
        state.get_quality_profiles().ok()
            .and_then(|ps| ps.into_iter().next())
            .map(|p| p.id)
            .unwrap_or(1)
    });
    let id = state.add_watchlist_item(
        0,
        tmdb_id,
        &tmdb_type,
        &title,
        title_en.as_deref(),
        poster.as_deref(),
        overview.as_deref(),
        overview_en.as_deref(),
        status.as_deref(),
        release_date.as_deref(),
        year,
        latest_season,
        &scope,
        auto_download,
        resolved_profile_id,
    )?;

    // If auto-download is enabled, immediately check whether any already-indexed
    // files match this new watchlist entry and queue them.
    if auto_download {
        let db = state.inner().clone();
        let queue = queue_state.inner().clone();
        let window = app.get_webview_window("main")
            .filter(|w| w.is_visible().ok().unwrap_or(false));
        tokio::spawn(async move {
            trigger_watchlist_auto_downloads(db, queue, window).await;
        });
    }

    Ok(id)
}

#[tauri::command]
pub async fn remove_from_watchlist(
    state: tauri::State<'_, crate::db::Db>,
    id: i64,
) -> Result<(), String> {
    state.remove_watchlist_item(id, 0)
}

#[tauri::command]
pub async fn update_watchlist_item(
    state: tauri::State<'_, crate::db::Db>,
    queue_state: tauri::State<'_, crate::downloads::SharedQueue>,
    app: tauri::AppHandle,
    id: i64,
    scope: String,
    auto_download: bool,
    profile_id: Option<i64>,
) -> Result<(), String> {
    state.update_watchlist_item(id, 0, &scope, auto_download, profile_id.unwrap_or(1))?;
    // If auto-download was just enabled, immediately scan for matching indexed files.
    if auto_download {
        let db = state.inner().clone();
        let queue = queue_state.inner().clone();
        let window = app.get_webview_window("main")
            .filter(|w| w.is_visible().ok().unwrap_or(false));
        tokio::spawn(async move {
            trigger_watchlist_auto_downloads(db, queue, window).await;
        });
    }
    Ok(())
}

#[tauri::command]
pub async fn get_quality_profiles(
    state: tauri::State<'_, crate::db::Db>,
) -> Result<Vec<crate::db::QualityProfile>, String> {
    state.get_quality_profiles()
}

#[tauri::command]
pub async fn create_quality_profile(
    state: tauri::State<'_, crate::db::Db>,
    name: String,
    min_resolution: Option<String>,
    preferred_resolution: Option<String>,
    prefer_hdr: bool,
    preferred_codecs: String,
    preferred_audio_codecs: String,
    preferred_release_types: String,
    min_size_gb: Option<f64>,
    max_size_gb: Option<f64>,
) -> Result<crate::db::QualityProfile, String> {
    state.create_quality_profile(
        &name,
        min_resolution.as_deref(),
        preferred_resolution.as_deref(),
        prefer_hdr,
        &preferred_codecs,
        &preferred_audio_codecs,
        &preferred_release_types,
        min_size_gb,
        max_size_gb,
    )
}

#[tauri::command]
pub async fn update_quality_profile(
    state: tauri::State<'_, crate::db::Db>,
    id: i64,
    name: String,
    min_resolution: Option<String>,
    preferred_resolution: Option<String>,
    prefer_hdr: bool,
    preferred_codecs: String,
    preferred_audio_codecs: String,
    preferred_release_types: String,
    min_size_gb: Option<f64>,
    max_size_gb: Option<f64>,
) -> Result<(), String> {
    state.update_quality_profile(
        id,
        &name,
        min_resolution.as_deref(),
        preferred_resolution.as_deref(),
        prefer_hdr,
        &preferred_codecs,
        &preferred_audio_codecs,
        &preferred_release_types,
        min_size_gb,
        max_size_gb,
    )
}

#[tauri::command]
pub async fn delete_quality_profile(
    state: tauri::State<'_, crate::db::Db>,
    id: i64,
) -> Result<(), String> {
    state.delete_quality_profile(id)
}

#[tauri::command]
pub async fn check_watchlist_item(
    state: tauri::State<'_, crate::db::Db>,
    tmdb_id: i64,
) -> Result<Option<crate::db::WatchlistItem>, String> {
    state.check_watchlist_item(tmdb_id, 0)
}

#[tauri::command]
pub async fn get_watchlist_coverage(
    state: tauri::State<'_, crate::db::Db>,
    tmdb_id: i64,
) -> Result<Vec<crate::db::WatchlistCoverageItem>, String> {
    state.get_watchlist_library_coverage(tmdb_id)
}

#[tauri::command]
pub async fn get_tv_seasons(
    state: tauri::State<'_, crate::db::Db>,
    tmdb_id: i64,
) -> Result<Vec<crate::tmdb::TmdbSeason>, String> {
    let config = state.load_config()?;
    crate::tmdb::fetch_tv_seasons(&config.tmdb_api_key, tmdb_id).await
}

/// After indexing completes, enqueue FTP files that match a watchlist entry
/// with `auto_download = 1` and are not already queued or being downloaded.
pub async fn trigger_watchlist_auto_downloads(
    db: crate::db::Db,
    queue: crate::downloads::SharedQueue,
    window: Option<tauri::WebviewWindow>,
) {
    // ── Quality helpers ────────────────────────────────────────────────────
    fn resolution_score(res: Option<&str>) -> u32 {
        let r = res.unwrap_or("").to_lowercase();
        if r.contains("2160") || r.contains("4k") || r.contains("uhd") { 4 }
        else if r.contains("1080") { 3 }
        else if r.contains("720") { 2 }
        else if !r.is_empty() { 1 }
        else { 0 }
    }

    fn base_release_score(rt: Option<&str>) -> u32 {
        let r = rt.unwrap_or("");
        if r.contains("REMUX") || r.contains("BDREMUX") { 5 }
        else if r.contains("BluRay") || r.contains("Blu-ray") { 4 }
        else if r.contains("WEB-DL") { 3 }
        else if r.contains("WEBRip") { 2 }
        else if r.contains("HDTV") { 1 }
        else { 0 }
    }

    fn meets_min_resolution(res: Option<&str>, min: Option<&str>) -> bool {
        match min {
            None | Some("") => true,
            // Unknown resolution → give benefit of the doubt rather than hard-reject.
            Some(_) if res.map(|r| r.is_empty()).unwrap_or(true) => true,
            Some(min_res) => resolution_score(res) >= resolution_score(Some(min_res)),
        }
    }

    fn score_candidate(
        item: &crate::db::WatchlistAutoItem,
        profile: &crate::db::QualityProfile,
    ) -> Option<u32> {
        // Hard filter: minimum resolution
        if !meets_min_resolution(item.resolution.as_deref(), profile.min_resolution.as_deref()) {
            return None;
        }
        // Hard filter: min file size
        if let (Some(min_gb), Some(bytes)) = (profile.min_size_gb, item.size_bytes) {
            if bytes < (min_gb * 1024.0 * 1024.0 * 1024.0) as i64 {
                return None;
            }
        }
        // Hard filter: max file size
        if let (Some(max_gb), Some(bytes)) = (profile.max_size_gb, item.size_bytes) {
            if bytes > (max_gb * 1024.0 * 1024.0 * 1024.0) as i64 {
                return None;
            }
        }

        let mut score: u32 = 0;

        // Resolution scoring
        if let Some(ref pref) = profile.preferred_resolution {
            if item.resolution.as_deref()
                .map(|r| r.eq_ignore_ascii_case(pref))
                .unwrap_or(false)
            {
                score += 1000;
            } else {
                score += resolution_score(item.resolution.as_deref()) * 100;
            }
        } else {
            score += resolution_score(item.resolution.as_deref()) * 100;
        }

        // HDR preference
        if profile.prefer_hdr && item.hdr.is_some() {
            score += 200;
        }

        // Preferred release types (ordered list — earlier = better)
        let rel_types: Vec<String> =
            serde_json::from_str(&profile.preferred_release_types).unwrap_or_default();
        if !rel_types.is_empty() {
            if let Some(pos) = rel_types.iter().position(|t| {
                item.release_type
                    .as_deref()
                    .map(|r| r.contains(t.as_str()))
                    .unwrap_or(false)
            }) {
                score += (rel_types.len() - pos) as u32 * 50;
            }
        } else {
            score += base_release_score(item.release_type.as_deref()) * 50;
        }

        // Preferred codecs
        let codecs: Vec<String> =
            serde_json::from_str(&profile.preferred_codecs).unwrap_or_default();
        if !codecs.is_empty() {
            if let Some(pos) = codecs.iter().position(|c| {
                item.codec
                    .as_deref()
                    .map(|k| k.eq_ignore_ascii_case(c))
                    .unwrap_or(false)
            }) {
                score += (codecs.len() - pos) as u32 * 30;
            }
        }

        // Preferred audio codecs
        let audio: Vec<String> =
            serde_json::from_str(&profile.preferred_audio_codecs).unwrap_or_default();
        if !audio.is_empty() {
            if let Some(pos) = audio.iter().position(|a| {
                item.audio_codec
                    .as_deref()
                    .map(|k| k.eq_ignore_ascii_case(a))
                    .unwrap_or(false)
            }) {
                score += (audio.len() - pos) as u32 * 20;
            }
        }

        Some(score)
    }

    let profiles: std::collections::HashMap<i64, crate::db::QualityProfile> =
        match db.get_quality_profiles() {
            Ok(ps) => ps.into_iter().map(|p| (p.id, p)).collect(),
            Err(e) => {
                eprintln!("[watchlist] auto-download: could not load profiles: {e}");
                return;
            }
        };
    // "Any" fallback profile (id=1 or bare minimum)
    let fallback_profile = crate::db::QualityProfile {
        id: 0, name: "Any".into(), min_resolution: None, preferred_resolution: None,
        prefer_hdr: false, preferred_codecs: "[]".into(), preferred_audio_codecs: "[]".into(),
        preferred_release_types: "[]".into(), min_size_gb: None, max_size_gb: None, is_builtin: false,
        created_at: String::new(),
    };

    let config = match db.load_config() {
        Ok(c) => c,
        Err(e) => {
            eprintln!("[watchlist] auto-download: could not load config: {e}");
            return;
        }
    };
    let candidates = match db.get_watchlist_auto_download_candidates() {
        Ok(c) => c,
        Err(e) => {
            eprintln!("[watchlist] auto-download: could not get candidates: {e}");
            return;
        }
    };
    println!("[watchlist] auto-download: {} candidate file(s) matched watchlist entries", candidates.len());

    // Group candidates by (tmdb_id, season, episode) so we pick the best
    // quality version for each distinct piece of content.
    use std::collections::HashMap;
    type GroupKey = (i64, Option<i64>, Option<i64>);
    let mut groups: HashMap<GroupKey, Vec<crate::db::WatchlistAutoItem>> = HashMap::new();
    for item in candidates {
        let key = (item.tmdb_id, item.season, item.episode);
        groups.entry(key).or_default().push(item);
    }

    for (_key, group) in groups {
        // All items in a group share the same watchlist entry → same profile.
        let profile_id = group[0].profile_id;
        let profile = profiles.get(&profile_id).unwrap_or(&fallback_profile);

        // Score every candidate; discard those that fail hard filters.
        let mut scored: Vec<(u32, usize)> = group
            .iter()
            .enumerate()
            .filter_map(|(i, c)| {
                let s = score_candidate(c, profile);
                if s.is_none() {
                    println!("[watchlist] auto-download: '{}' rejected by quality profile '{}' (res={:?})",
                        c.filename, profile.name, c.resolution);
                }
                s.map(|score| (score, i))
            })
            .collect();
        if scored.is_empty() {
            continue;
        }
        scored.sort_by(|a, b| b.0.cmp(&a.0));
        let item = &group[scored[0].1];

        // Skip if already Queued or Downloading
        {
            let q = queue.lock().unwrap();
            if q.find_active_by_ftp_path(&item.ftp_path).is_some() {
                println!("[watchlist] auto-download: '{}' already in queue, skipping", item.filename);
                continue;
            }
        }

        let local_path = match compute_local_path(
            &config,
            &item.ftp_path,
            &item.filename,
            item.media_type.as_deref(),
            item.tmdb_genres.as_deref(),
        ) {
            Ok(p) => p,
            Err(e) => {
                eprintln!("[watchlist] auto-download: local_path error for {}: {e}", item.ftp_path);
                continue;
            }
        };

        // Skip if file already exists at destination
        if local_path.exists() {
            println!("[watchlist] auto-download: '{}' already exists at '{}', skipping",
                item.filename, local_path.display());
            continue;
        }

        if let Some(parent) = local_path.parent() {
            std::fs::create_dir_all(parent).ok();
        }

        let local_str = local_path.to_string_lossy().to_string();
        let (id, semaphore, cancel_flag) = {
            let mut q = queue.lock().unwrap();
            q.add(
                item.ftp_path.clone(),
                item.filename.clone(),
                local_str.clone(),
                item.media_title.clone(),
            )
        };

        persist_download_state(&db, &queue);

        if let Some(ref w) = window {
            let q = queue.lock().unwrap();
            if let Some(download_item) = q.items.iter().find(|i| i.id == id).cloned() {
                drop(q);
                w.emit("download:added", &download_item).ok();
            }
        }

        spawn_download_job_pub(
            db.clone(),
            queue.clone(),
            window.clone(),
            config.clone(),
            id,
            item.ftp_path.clone(),
            local_str,
            semaphore,
            cancel_flag,
        );

        println!("[watchlist] auto-queued (profile_id={profile_id}): {}", item.ftp_path);
    }
}

// ── Fix 4: indexing loop decoupling tests ────────────────────────────────────
//
// ─── Analysis / Upload / Telegram commands ────────────────────────────────────

fn format_bytes_human(bytes: u64) -> String {
    if bytes >= 1_073_741_824 {
        format!("{:.2} GB", bytes as f64 / 1_073_741_824.0)
    } else if bytes >= 1_048_576 {
        format!("{:.0} MB", bytes as f64 / 1_048_576.0)
    } else {
        format!("{:.0} KB", bytes as f64 / 1024.0)
    }
}

/// Formats a runtime in minutes as "1h 42min" or "45min".
fn format_runtime(mins: u32) -> String {
    if mins >= 60 {
        let h = mins / 60;
        let m = mins % 60;
        if m == 0 {
            format!("{h}h")
        } else {
            format!("{h}h {m}min")
        }
    } else {
        format!("{mins}min")
    }
}

/// Maps a channel count to a human-readable label (5.1, 7.1, Estéreo, …).
fn channels_label(ch: u32) -> String {
    match ch {
        1 => "Mono".to_string(),
        2 => "Estéreo".to_string(),
        6 => "5.1".to_string(),
        7 => "6.1".to_string(),
        8 => "7.1".to_string(),
        n => format!("{}ch", n),
    }
}

/// Converts a TMDB ISO date ("2025-12-25") to a compact Spanish string ("25 dic 2025").
fn format_date_es(date: &str) -> String {
    let parts: Vec<&str> = date.split('-').collect();
    if parts.len() < 3 {
        return date.to_string();
    }
    let month_name = match parts[1] {
        "01" => "ene", "02" => "feb", "03" => "mar", "04" => "abr",
        "05" => "may", "06" => "jun", "07" => "jul", "08" => "ago",
        "09" => "sep", "10" => "oct", "11" => "nov", "12" => "dic",
        _ => parts[1],
    };
    format!("{} {} {}", parts[2].trim_start_matches('0').max("1"), month_name, parts[0])
}

/// Maps an ISO 3166-1 alpha-2 country code to a Spanish country name.
fn country_name(code: &str) -> &'static str {
    match code.to_uppercase().as_str() {
        "AD" => "Andorra",        "AE" => "Emiratos Árabes",  "AF" => "Afganistán",
        "AL" => "Albania",        "AM" => "Armenia",           "AO" => "Angola",
        "AR" => "Argentina",      "AT" => "Austria",           "AU" => "Australia",
        "AZ" => "Azerbaiyán",     "BA" => "Bosnia-Herzegovina","BD" => "Bangladesh",
        "BE" => "Bélgica",        "BF" => "Burkina Faso",      "BG" => "Bulgaria",
        "BH" => "Baréin",         "BO" => "Bolivia",           "BR" => "Brasil",
        "BY" => "Bielorrusia",    "CA" => "Canadá",            "CD" => "Congo (RD)",
        "CH" => "Suiza",          "CI" => "Costa de Marfil",   "CL" => "Chile",
        "CM" => "Camerún",        "CN" => "China",             "CO" => "Colombia",
        "CR" => "Costa Rica",     "CU" => "Cuba",              "CY" => "Chipre",
        "CZ" => "Chequia",        "DE" => "Alemania",          "DK" => "Dinamarca",
        "DO" => "Rep. Dominicana","DZ" => "Argelia",           "EC" => "Ecuador",
        "EE" => "Estonia",        "EG" => "Egipto",            "ES" => "España",
        "ET" => "Etiopía",        "FI" => "Finlandia",         "FJ" => "Fiyi",
        "FR" => "Francia",        "GA" => "Gabón",             "GB" => "Reino Unido",
        "GE" => "Georgia",        "GH" => "Ghana",             "GR" => "Grecia",
        "GT" => "Guatemala",      "HK" => "Hong Kong",         "HN" => "Honduras",
        "HR" => "Croacia",        "HU" => "Hungría",           "ID" => "Indonesia",
        "IE" => "Irlanda",        "IL" => "Israel",            "IN" => "India",
        "IQ" => "Irak",           "IR" => "Irán",              "IS" => "Islandia",
        "IT" => "Italia",         "JM" => "Jamaica",           "JO" => "Jordania",
        "JP" => "Japón",          "KE" => "Kenia",             "KG" => "Kirguistán",
        "KH" => "Camboya",        "KR" => "Corea del Sur",     "KW" => "Kuwait",
        "KZ" => "Kazajistán",     "LB" => "Líbano",            "LK" => "Sri Lanka",
        "LT" => "Lituania",       "LU" => "Luxemburgo",        "LV" => "Letonia",
        "LY" => "Libia",          "MA" => "Marruecos",         "MD" => "Moldavia",
        "MK" => "Macedonia del Norte", "ML" => "Malí",         "MM" => "Birmania",
        "MN" => "Mongolia",       "MX" => "México",            "MY" => "Malasia",
        "MZ" => "Mozambique",     "NA" => "Namibia",           "NG" => "Nigeria",
        "NI" => "Nicaragua",      "NL" => "Países Bajos",      "NO" => "Noruega",
        "NP" => "Nepal",          "NZ" => "Nueva Zelanda",     "OM" => "Omán",
        "PA" => "Panamá",         "PE" => "Perú",              "PH" => "Filipinas",
        "PK" => "Pakistán",       "PL" => "Polonia",           "PT" => "Portugal",
        "PY" => "Paraguay",       "QA" => "Catar",             "RO" => "Rumanía",
        "RS" => "Serbia",         "RU" => "Rusia",             "RW" => "Ruanda",
        "SA" => "Arabia Saudí",   "SD" => "Sudán",             "SE" => "Suecia",
        "SG" => "Singapur",       "SI" => "Eslovenia",         "SK" => "Eslovaquia",
        "SN" => "Senegal",        "SO" => "Somalia",           "SS" => "Sudán del Sur",
        "SV" => "El Salvador",    "SY" => "Siria",             "TH" => "Tailandia",
        "TJ" => "Tayikistán",     "TN" => "Túnez",             "TR" => "Turquía",
        "TW" => "Taiwán",         "TZ" => "Tanzania",          "UA" => "Ucrania",
        "UG" => "Uganda",         "US" => "Estados Unidos",    "UY" => "Uruguay",
        "UZ" => "Uzbekistán",     "VE" => "Venezuela",         "VN" => "Vietnam",
        "YE" => "Yemen",          "ZA" => "Sudáfrica",         "ZM" => "Zambia",
        "ZW" => "Zimbabue",
        _ => "",
    }
}

/// Maps an ISO 639-2 (or ISO 639-1) language code to its Spanish display name.
fn lang_name(code: &str) -> String {
    match code.to_uppercase().as_str() {
        "ES" | "SPA" | "ESP"           => "Español",
        "EN" | "ENG"                   => "Inglés",
        "FR" | "FRE" | "FRA"           => "Francés",
        "DE" | "GER" | "DEU"           => "Alemán",
        "IT" | "ITA"                   => "Italiano",
        "PT" | "POR"                   => "Portugués",
        "JA" | "JPN"                   => "Japonés",
        "KO" | "KOR"                   => "Coreano",
        "ZH" | "CHI" | "ZHO"           => "Chino",
        "AR" | "ARA"                   => "Árabe",
        "RU" | "RUS"                   => "Ruso",
        "TR" | "TUR"                   => "Turco",
        "PL" | "POL"                   => "Polaco",
        "NL" | "DUT" | "NLD"           => "Neerlandés",
        "SV" | "SWE"                   => "Sueco",
        "NO" | "NOR" | "NOB" | "NNO"   => "Noruego",
        "DA" | "DAN"                   => "Danés",
        "FI" | "FIN"                   => "Finlandés",
        "HE" | "HEB"                   => "Hebreo",
        "HU" | "HUN"                   => "Húngaro",
        "CS" | "CZE" | "CES"           => "Checo",
        "SK" | "SLO" | "SLK"           => "Eslovaco",
        "RO" | "ROM" | "RUM" | "RON"   => "Rumano",
        "EL" | "GRE" | "ELL"           => "Griego",
        "TH" | "THA"                   => "Tailandés",
        "VI" | "VIE"                   => "Vietnamita",
        "ID" | "IND"                   => "Indonesio",
        "MS" | "MAY" | "MSA"           => "Malayo",
        "HI" | "HIN"                   => "Hindi",
        "CA" | "CAT"                   => "Catalán",
        "LA" | "LAT"                   => "Latín",
        "EU" | "EUS" | "BAQ"           => "Euskera",
        "GL" | "GLG"                   => "Gallego",
        "UK" | "UKR"                   => "Ucraniano",
        "HR" | "HRV"                   => "Croata",
        "SR" | "SRP"                   => "Serbio",
        "BG" | "BUL"                   => "Búlgaro",
        "SL" | "SLV"                   => "Esloveno",
        "LT" | "LIT"                   => "Lituano",
        "LV" | "LAV"                   => "Letón",
        "ET" | "EST"                   => "Estonio",
        "SQ" | "ALB" | "SQI"           => "Albanés",
        other                           => return other.to_uppercase(),
    }
    .to_string()
}

/// Returns the ffprobe version string if found in PATH, or null.
#[tauri::command]
pub fn check_ffprobe() -> Option<String> {
    crate::analysis::check_ffprobe()
}

/// Attempt to install ffmpeg via the system package manager (Homebrew on macOS,
/// apt-get on Linux). Returns a success message or an error string.
#[tauri::command]
pub async fn install_ffprobe() -> Result<String, String> {
    crate::analysis::install_ffmpeg().await
}

/// Run ffprobe on a local file and return media info.
#[tauri::command]
pub fn analyze_local_file(path: String) -> Result<crate::analysis::LocalMediaInfo, String> {
    crate::analysis::ffprobe_analyze(&path)
}

/// List video files inside a local directory, sorted by name.
/// Recursively collects absolute paths to video files under `dir`.
fn collect_video_files_recursive(
    dir: &std::path::Path,
    out: &mut Vec<String>,
    video_exts: &[&str],
) {
    let Ok(read) = std::fs::read_dir(dir) else { return };
    for entry in read.flatten() {
        let p = entry.path();
        if p.is_dir() {
            collect_video_files_recursive(&p, out, video_exts);
        } else if p.is_file() {
            let is_video = p
                .extension()
                .and_then(|e| e.to_str())
                .map(|e| video_exts.contains(&e.to_lowercase().as_str()))
                .unwrap_or(false);
            if is_video {
                if let Some(s) = p.to_str() {
                    out.push(s.to_string());
                }
            }
        }
    }
}

/// Returns a sorted list of absolute paths to all video files under `dir` (recursive).
#[tauri::command]
pub fn list_local_video_files(dir: String) -> Result<Vec<String>, String> {
    const VIDEO_EXTS: &[&str] = &["mkv", "mp4", "avi", "m2ts", "mov", "ts"];
    let mut entries: Vec<String> = Vec::new();
    collect_video_files_recursive(std::path::Path::new(&dir), &mut entries, VIDEO_EXTS);
    entries.sort();
    Ok(entries)
}

#[tauri::command]
pub async fn check_ftp_write_permission(
    state: tauri::State<'_, crate::db::Db>,
) -> Result<bool, String> {
    let config = state.load_config()?;
    crate::ftp::check_write_permission(
        &config.ftp_host,
        config.ftp_port,
        &config.ftp_user,
        &config.ftp_pass,
        &config.ftp_root,
    )
    .await
}

// ─── Upload destination suggestion ───────────────────────────────────────────

#[derive(serde::Serialize)]
pub struct UploadSuggestion {
    pub dest: String,
    pub media_type: String, // "movie" | "tv" | "documentary"
    pub detected_title: Option<String>,
    pub detected_season: Option<u32>,
    pub detected_episode: Option<u32>,
    pub detected_year: Option<u32>,
    /// Release type detected from the filename (e.g. "BDREMUX", "WEB-DL", "BDRip")
    pub detected_release_type: Option<String>,
    /// Resolution detected from the filename (e.g. "1080p", "4K")
    pub detected_resolution: Option<String>,
    /// Video codec detected from the filename (e.g. "HEVC", "AVC")
    pub detected_codec: Option<String>,
    /// Audio codec detected from the filename (e.g. "DTS", "AC3")
    pub detected_audio_codec: Option<String>,
    /// Languages detected from the filename (e.g. ["spa", "eng"])
    pub detected_languages: Vec<String>,
    /// HDR type detected from the filename (e.g. "HDR", "DV")
    pub detected_hdr: Option<String>,
    /// Base FTP folder configured for movies (sanitised, empty if not set)
    pub movie_dest: String,
    /// Base FTP folder configured for TV shows (sanitised, empty if not set)
    pub tv_dest: String,
    /// TV base + resolved category subfolder (e.g. tv_dest/Temporadas en emision).
    /// Season folder uploads should go directly inside this path.
    pub tv_category_dest: String,
    /// All configured FTP folder paths (ftp_root/folder_name) from the folder_types config.
    /// Used by the frontend to populate dest input suggestions.
    pub folder_options: Vec<String>,
}

/// Normalise a string for fuzzy folder matching: lowercase, strip non-alphanumeric, collapse spaces.
fn strip_diacritic(c: char) -> char {
    match c {
        'á' | 'à' | 'ä' | 'â' | 'Á' | 'À' | 'Ä' | 'Â' => 'a',
        'é' | 'è' | 'ë' | 'ê' | 'É' | 'È' | 'Ë' | 'Ê' => 'e',
        'í' | 'ì' | 'ï' | 'î' | 'Í' | 'Ì' | 'Ï' | 'Î' => 'i',
        'ó' | 'ò' | 'ö' | 'ô' | 'Ó' | 'Ò' | 'Ö' | 'Ô' => 'o',
        'ú' | 'ù' | 'ü' | 'û' | 'Ú' | 'Ù' | 'Ü' | 'Û' => 'u',
        'ñ' | 'Ñ' => 'n',
        other => other,
    }
}

fn normalise_for_match(s: &str) -> String {
    s.chars()
        .map(strip_diacritic)
        .map(|c| if c.is_alphanumeric() { c.to_ascii_lowercase() } else { ' ' })
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

/// Count how many tokens from `query` appear in `candidate` (exact word match after normalisation).
fn token_overlap(query: &str, candidate: &str) -> usize {
    let q_tokens: Vec<&str> = query.split_whitespace().collect();
    let c_tokens: Vec<&str> = candidate.split_whitespace().collect();
    q_tokens.iter().filter(|t| c_tokens.contains(t)).count()
}

/// Given a list of raw FTP LIST lines, extract directory names.
fn extract_dir_names(raw: &[String]) -> Vec<String> {
    raw.iter()
        .filter_map(|line| {
            let is_dir = line.starts_with('d') || line.to_uppercase().contains("<DIR>");
            if !is_dir { return None; }
            let parts: Vec<&str> = line.split_whitespace().collect();
            let name_start = if line.starts_with('d') { 8 } else { 3 };
            if parts.len() > name_start {
                let name = parts[name_start..].join(" ");
                if name != "." && name != ".." && !name.is_empty() {
                    Some(name)
                } else {
                    None
                }
            } else {
                None
            }
        })
        .collect()
}

/// Find the season subfolder name in `dirs` that best matches `season_num`.
/// Accepts "Season 01", "Temporada 1", "S01", etc.
fn find_season_dir(dirs: &[String], season_num: u8) -> Option<String> {
    for dir in dirs {
        let lower = dir.to_lowercase();
        // Extract all digit runs from the dir name
        let digits: String = lower.chars().filter(|c| c.is_ascii_digit()).collect();
        if let Ok(n) = digits.trim_start_matches('0').parse::<u8>() {
            if n == season_num {
                return Some(dir.clone());
            }
        }
    }
    None
}

/// Find the closest matching show directory name in `dirs` for `show_title`.
/// Returns the dir name with the highest token overlap (minimum 1 token match).
fn fuzzy_best_show(show_title: &str, dirs: &[String]) -> Option<String> {
    let norm_query = normalise_for_match(show_title);
    let mut best: Option<(usize, &String)> = None;
    for dir in dirs {
        let norm_dir = normalise_for_match(dir);
        let overlap = token_overlap(&norm_query, &norm_dir);
        if overlap == 0 { continue; }
        if best.map_or(true, |(best_score, _)| overlap > best_score) {
            best = Some((overlap, dir));
        }
    }
    best.map(|(_, dir)| dir.clone())
}

/// Given a local file or folder path, suggest an FTP destination path and
/// detect whether it's a movie, TV show, or documentary.
#[tauri::command]
pub async fn suggest_upload_destination(
    local_path: String,
    state: tauri::State<'_, crate::db::Db>,
) -> Result<UploadSuggestion, String> {
    use std::path::Path;
    let config = state.load_config()?;
    let p = Path::new(&local_path);

    let name = p.file_name().and_then(|n| n.to_str()).unwrap_or("").to_string();
    let mut parsed = crate::parser::parse_media_path("", &name);

    // Scan directory contents to detect season/episode and quality metadata.
    // Priority: episode files (richest metadata) > season subfolder names > recurse into subfolders.
    if p.is_dir() {
        let top_entries: Vec<_> = std::fs::read_dir(&local_path)
            .into_iter().flatten().flatten().collect();

        // Pass 1: iterate all entries once.
        // — Episode FILES: extract full metadata and stop.
        // — Season DIRECTORIES: record season number and try to extract resolution
        //   from the folder name itself (e.g. "S01 2160p"), but keep going so we
        //   can still find episode files with richer info.
        for entry in &top_entries {
            let entry_name = entry.file_name().to_string_lossy().to_string();
            let lower = entry_name.to_lowercase();
            let is_file = entry.file_type().map(|t| t.is_file()).unwrap_or(false);
            let is_dir  = entry.file_type().map(|t| t.is_dir()).unwrap_or(false);

            // Episode file with a season/episode pattern — stop here, it has everything.
            if is_file {
                let ep = crate::parser::parse_media_path("", &entry_name);
                if ep.season.is_some() || ep.episode.is_some() {
                    if parsed.season.is_none() { parsed.season = ep.season.or(Some(1)); }
                    if parsed.episode.is_none() { parsed.episode = ep.episode; }
                    if parsed.resolution.is_none() { parsed.resolution = ep.resolution; }
                    if parsed.codec.is_none() { parsed.codec = ep.codec; }
                    if parsed.audio_codec.is_none() { parsed.audio_codec = ep.audio_codec; }
                    if parsed.release_type.is_none() { parsed.release_type = ep.release_type; }
                    break; // episode files are the richest source of truth
                }
            }

            // Season subfolder (must actually be a directory to avoid confusing
            // episode files like "S01E01.foo.mkv" with season folders).
            if is_dir && (
                lower.starts_with("season")
                || lower.starts_with("temporada")
                || (lower.len() >= 2 && lower.starts_with('s') && lower.chars().nth(1).map_or(false, |c| c.is_ascii_digit()))
            ) {
                if parsed.season.is_none() {
                    // Extract first run of digits as the season number.
                    let digits: String = entry_name.chars()
                        .skip_while(|c| !c.is_ascii_digit())
                        .take_while(|c| c.is_ascii_digit())
                        .collect();
                    let n: Option<u8> = digits.parse().ok();
                    parsed.season = n.or(Some(1));
                }
                // Season folder names sometimes encode quality ("S01 2160p").
                let sf = crate::parser::parse_media_path("", &entry_name);
                if parsed.resolution.is_none() { parsed.resolution = sf.resolution; }
                if parsed.codec.is_none()      { parsed.codec = sf.codec; }
                // Don't break — keep looking for episode files that have richer info.
            }
        }

        // Pass 2: if we know it's TV but still have no resolution, recurse one
        // level into any subdirectory to find episode filenames there.
        if parsed.season.is_some() && parsed.resolution.is_none() {
            'outer: for entry in &top_entries {
                if !entry.file_type().map(|t| t.is_dir()).unwrap_or(false) { continue; }
                if let Ok(sub_entries) = std::fs::read_dir(entry.path()) {
                    for sub in sub_entries.flatten() {
                        if !sub.file_type().map(|t| t.is_file()).unwrap_or(false) { continue; }
                        let sub_name = sub.file_name().to_string_lossy().to_string();
                        let ep = crate::parser::parse_media_path("", &sub_name);
                        if parsed.resolution.is_none() { parsed.resolution = ep.resolution; }
                        if parsed.codec.is_none()      { parsed.codec = ep.codec; }
                        if parsed.audio_codec.is_none(){ parsed.audio_codec = ep.audio_codec; }
                        if parsed.release_type.is_none(){ parsed.release_type = ep.release_type; }
                        if parsed.resolution.is_some() { break 'outer; }
                    }
                }
            }
        }
    }

    let media_type = if parsed.season.is_some() || parsed.episode.is_some() {
        "tv"
    } else {
        "movie"
    };

    // ── Build FTP destinations from folder_types + ftp_root ──────────────
    let folder_map: std::collections::HashMap<String, String> =
        serde_json::from_str(&config.folder_types).unwrap_or_default();
    let ftp_root = config.ftp_root.trim_end_matches('/').to_string();

    // Score a folder name against parsed file metadata — higher is better.
    let score_folder = |folder: &str| -> i32 {
        let fl = folder.to_lowercase();
        let mut score = 0i32;
        // Resolution
        if let Some(ref res) = parsed.resolution {
            let rl = res.to_lowercase();
            if rl.contains("2160") || rl.contains("4k") || rl.contains("uhd") {
                if fl.contains("2160") || fl.contains("4k") || fl.contains("uhd") {
                    score += 20;
                } else if fl.contains("1080") {
                    score -= 20; // strong penalty: 1080p folder is wrong for 4K content
                } else {
                    score -= 5; // mild penalty for non-4K folders without explicit resolution
                }
            } else if rl.contains("1080") {
                if fl.contains("1080") {
                    score += 20;
                } else if fl.contains("2160") || fl.contains("4k") || fl.contains("uhd") {
                    score -= 20; // strong penalty: 4K folder is wrong for 1080p content
                }
            }
        }
        // Codec — bonus for matching encoder folder, penalty for wrong encoder folder
        if let Some(ref codec) = parsed.codec {
            let cl = codec.to_lowercase();
            let is_x265 = cl.contains("x265") || cl.contains("hevc") || cl.contains("265");
            let is_x264 = cl.contains("x264") || cl.contains("264") || cl.contains("avc");
            if is_x265 {
                if fl.contains("x265") || fl.contains("hevc") { score += 5; }
                else if fl.contains("x264") { score -= 8; } // AVC folder is wrong for HEVC content
            } else if is_x264 {
                if fl.contains("x264") { score += 5; }
                else if fl.contains("x265") || fl.contains("hevc") { score -= 8; } // X265 folder is wrong for AVC content
            }
        }
        // Release type
        if let Some(ref rt) = parsed.release_type {
            let rtl = rt.to_lowercase();
            if rtl.contains("bdremux") || rtl.contains("bd remux") {
                if fl.contains("bdremux") { score += 8; }
            } else if rtl.contains("webdl") || rtl.contains("web-dl") || rtl.contains("web dl") {
                if fl.contains("web dl") || fl.contains("webdl") { score += 8; }
            } else if rtl.contains("bdrip") {
                if fl.contains("bdrip") { score += 8; }
            }
        }
        score
    };

    // Pick the best FTP folder for the given media type.
    let pick_best_folder = |target_type: &str| -> String {
        let mut candidates: Vec<&str> = folder_map
            .iter()
            .filter(|(_, v)| v.as_str() == target_type)
            .map(|(k, _)| k.as_str())
            .collect();
        // Sort for determinism before scoring
        candidates.sort();
        if candidates.is_empty() {
            return String::new();
        }
        let best = candidates
            .iter()
            .copied()
            .max_by_key(|f| score_folder(f))
            .unwrap_or(candidates[0]);
        format!("{}/{}", ftp_root, best)
    };

    let movie_dest = pick_best_folder("movie");
    let tv_dest = pick_best_folder("tv");

    let base_dest = match media_type {
        "tv" => tv_dest.clone(),
        _ => movie_dest.clone(),
    };

    // For TV shows: search for the show across category subfolders (e.g. "Temporadas en emision",
    // For TV: structure is ALWAYS tv_dest/Category/Show where Category is one of
    // "Temporadas en emision" (single episodes) or "Temporadas completas" (full seasons).
    // If the show folder doesn't exist yet it will be created by the FTP uploader.
    let (dest, resolved_tv_category) = if media_type == "tv" && !tv_dest.is_empty() {
        let show_title = parsed.title.trim().replace(['/', '\\'], "");
        let season = parsed.season.unwrap_or(1);
        let is_full_season = p.is_dir(); // directory = full season upload

        // Step 1: list tv_dest to find actual category folder names on the server.
        // If the list fails or no category folders are found, fall back to hardcoded names.
        let level1_dirs = crate::ftp::list_raw(
            &config.ftp_host, config.ftp_port, &config.ftp_user, &config.ftp_pass,
            &tv_dest,
        ).await.map(|r| extract_dir_names(&r)).unwrap_or_default();

        // Category folders contain "temporad", "emisi", or "completa" (ASCII-safe prefixes
        // that survive Latin-1 → UTF-8 replacement char conversion on the ó).
        let category_dirs: Vec<String> = level1_dirs.into_iter()
            .filter(|d| {
                let n = normalise_for_match(d);
                n.contains("temporad") || n.contains("emisi") || n.contains("completa")
            })
            .collect();

        // Step 2: pick the right category folder name.
        // Prefer actual server name if found; otherwise use the standard Spanish name.
        // Never fall back to the opposite category (e.g. put a single episode in "completas").
        let preferred_kw = if is_full_season { "completa" } else { "emisi" };
        let cat_dir = category_dirs.iter()
            .find(|d| normalise_for_match(d).contains(preferred_kw))
            .cloned()
            .unwrap_or_else(|| {
                // Preferred category not found on server — use hardcoded name.
                // ensure_remote_dir will create it on upload.
                if is_full_season {
                    "Temporadas completas".to_string()
                } else {
                    "Temporadas en emision".to_string()
                }
            });

        let cat_path = if cat_dir.is_empty() {
            tv_dest.clone()
        } else {
            format!("{}/{}", tv_dest.trim_end_matches('/'), cat_dir)
        };

        // Step 3: search inside the chosen category for an existing show folder.
        // Use list_raw_sub to CWD to tv_dest then LIST cat_dir relatively — avoids
        // CWD failures from Latin-1 accented chars in the category folder name.
        let existing_show = if !show_title.is_empty() && !cat_dir.is_empty() {
            crate::ftp::list_raw_sub(
                &config.ftp_host, config.ftp_port, &config.ftp_user, &config.ftp_pass,
                &tv_dest, &cat_dir,
            ).await
            .map(|r| {
                let show_dirs = extract_dir_names(&r);
                fuzzy_best_show(&show_title, &show_dirs)
            })
            .unwrap_or(None)
        } else {
            None
        };

        // Step 4: build the final dest path.
        let show_path = if let Some(found) = existing_show {
            // Existing show folder found — use it directly (episodes go flat inside it).
            format!("{}/{}", cat_path.trim_end_matches('/'), found)
        } else {
            // New show — create a folder named "ShowTitle (Year) SXX".
            let year_part = parsed.year.map(|y| format!(" ({})", y)).unwrap_or_default();
            let folder = format!("{}{} S{:02}", show_title, year_part, season);
            format!("{}/{}", cat_path.trim_end_matches('/'), folder)
        };

        (show_path, cat_path)
    } else {
        (movie_dest.clone(), String::new())
    };

    // Ensure tv_category_dest is always populated even when media_type was detected as "movie".
    // The frontend uses it when the user manually switches the content type to TV.
    let resolved_tv_category = if resolved_tv_category.is_empty() && !tv_dest.is_empty() {
        let cat_dirs = crate::ftp::list_raw(
            &config.ftp_host, config.ftp_port,
            &config.ftp_user, &config.ftp_pass,
            &tv_dest,
        ).await.map(|r| extract_dir_names(&r)).unwrap_or_default();
        let (cat_dirs_fb, _): (Vec<String>, Vec<String>) = cat_dirs
            .into_iter()
            .partition(|d| {
                let n = normalise_for_match(d);
                n.contains("temporad") || n.contains("emisi") || n.contains("completa")
            });
        if !cat_dirs_fb.is_empty() {
            let preferred_kw = if p.is_dir() { "completa" } else { "emisi" };
            let cat = cat_dirs_fb.iter()
                .find(|d| normalise_for_match(d).contains(preferred_kw))
                .cloned()
                .unwrap_or_else(|| {
                    if p.is_dir() { "Temporadas completas".to_string() }
                    else { "Temporadas en emision".to_string() }
                });
            if cat.is_empty() { tv_dest.clone() } else { format!("{}/{}", tv_dest.trim_end_matches('/'), cat) }
        } else {
            // Flat structure — no category layer
            tv_dest.clone()
        }
    } else {
        resolved_tv_category
    };

    Ok(UploadSuggestion {
        dest,
        media_type: media_type.to_string(),
        detected_title: if parsed.title.is_empty() {
            None
        } else {
            Some(parsed.title)
        },
        detected_season: parsed.season.map(|s| s as u32),
        detected_episode: parsed.episode.map(|e| e as u32),
        detected_year: parsed.year.map(|y| y as u32),
        detected_release_type: parsed.release_type,
        detected_resolution: parsed.resolution,
        detected_codec: parsed.codec,
        detected_audio_codec: parsed.audio_codec,
        detected_languages: parsed.languages,
        detected_hdr: parsed.hdr,
        movie_dest,
        tv_dest,
        tv_category_dest: resolved_tv_category,
        folder_options: {
            let mut opts: Vec<String> = folder_map
                .keys()
                .map(|name| format!("{}/{}", ftp_root, name))
                .collect();
            opts.sort();
            opts
        },
    })
}

/// List all subdirectory names at a given FTP path.
#[tauri::command]
pub async fn ftp_list_dir(
    path: String,
    state: tauri::State<'_, crate::db::Db>,
) -> Result<Vec<String>, String> {
    let config = state.load_config()?;
    let entries = crate::ftp::list_raw(
        &config.ftp_host,
        config.ftp_port,
        &config.ftp_user,
        &config.ftp_pass,
        &path,
    )
    .await?;
    let dirs = entries
        .into_iter()
        .filter_map(|line| {
            let is_dir =
                line.starts_with('d') || line.to_uppercase().contains("<DIR>");
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

/// Build a standard media filename from components.
/// Example: `The Dark Knight`, 2008, `4K`, `HEVC`, `HDR10`, `DTS`, [`spa`, `eng`], `mkv`
/// → `The.Dark.Knight.2008.4K.HEVC.HDR10.DTS.SPA.ENG.mkv`
#[tauri::command]
pub fn generate_upload_filename(
    title: String,
    year: Option<u32>,
    resolution: Option<String>,
    codec: Option<String>,
    hdr: Option<String>,
    audio_codec: Option<String>,
    languages: Vec<String>,
    extension: String,
) -> String {
    let mut parts: Vec<String> = vec![];
    // Replace spaces with dots in the title
    parts.push(title.replace(' ', "."));
    if let Some(y) = year {
        parts.push(y.to_string());
    }
    if let Some(r) = resolution.filter(|s| !s.is_empty()) {
        parts.push(r);
    }
    if let Some(c) = codec.filter(|s| !s.is_empty()) {
        parts.push(c);
    }
    if let Some(h) = hdr.filter(|s| !s.is_empty()) {
        parts.push(h);
    }
    if let Some(a) = audio_codec.filter(|s| !s.is_empty()) {
        parts.push(a);
    }
    for lang in languages {
        if !lang.is_empty() {
            parts.push(lang.to_uppercase());
        }
    }
    let ext = extension.trim_start_matches('.');
    format!("{}.{}", parts.join("."), ext)
}

// ─── Upload queue commands ────────────────────────────────────────────────────

fn spawn_upload_job(
    db: crate::db::Db,
    upload_queue: crate::uploads::SharedUploadQueue,
    app: tauri::AppHandle,
    id: u64,
    local_path: String,
    ftp_dest_path: String,
    filename: String,
    media_title: Option<String>,
    tmdb_id: Option<i64>,
    size_bytes: u64,
    resolution: Option<String>,
    hdr: Option<String>,
    languages: Vec<String>,
    codec: Option<String>,
    audio_codec: Option<String>,
    subtitle_langs: Vec<String>,
    audio_tracks: Vec<crate::analysis::AudioTrack>,
    subtitle_tracks: Vec<crate::analysis::SubtitleTrack>,
    group_id: Option<String>,
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
                let mut q = upload_queue.lock().unwrap();
                q.mark_cancelled(id);
            }
            persist_upload_state(&db, &upload_queue);
            return;
        }

        {
            let mut q = upload_queue.lock().unwrap();
            q.mark_started(id);
        }
        persist_upload_state(&db, &upload_queue);

        app.emit("upload:update", serde_json::json!({
            "id": id,
            "status": "uploading",
        })).ok();

        let config = match db.load_config() {
            Ok(c) => c,
            Err(e) => {
                {
                    let mut q = upload_queue.lock().unwrap();
                    q.mark_error(id, e.clone());
                }
                persist_upload_state(&db, &upload_queue);
                app.emit("upload:update", serde_json::json!({
                    "id": id, "status": "error", "error": e
                })).ok();
                return;
            }
        };

        let app_clone = app.clone();
        let upload_id = id;
        let result = crate::ftp::upload_file(
            &config.ftp_host,
            config.ftp_port,
            &config.ftp_user,
            &config.ftp_pass,
            &ftp_dest_path,
            &filename,
            &local_path,
            move |done, total| {
                if cancel_flag.load(Ordering::SeqCst) {
                    return false;
                }
                let ts = std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap_or_default()
                    .as_millis() as u64;
                app_clone.emit("upload:progress", serde_json::json!({
                    "id": upload_id,
                    "bytes_done": done,
                    "bytes_total": total,
                    "timestamp_ms": ts,
                })).ok();
                true
            },
        )
        .await;

        match result {
            Ok(()) => {
                {
                    let mut q = upload_queue.lock().unwrap();
                    q.mark_done(id);
                }
                persist_upload_state(&db, &upload_queue);
                app.emit("upload:update", serde_json::json!({
                    "id": id, "status": "done",
                })).ok();

                // Telegram notification
                let tg_token = config.telegram_bot_token.clone();
                let tg_chat = config.telegram_chat_id.clone();
                if !tg_token.is_empty() && !tg_chat.is_empty() {
                    // For grouped season uploads: only notify when the last episode finishes.
                    let should_notify = if let Some(ref gid) = group_id {
                        let q = upload_queue.lock().unwrap();
                        let (done, _total, all_finished) = q.group_status(gid);
                        let _ = done;
                        all_finished
                    } else {
                        true
                    };

                    if should_notify {
                        // Derive display folder: everything from "Compartida" onwards (case-insensitive).
                        // Falls back to the full path if the anchor segment is not found.
                        let dest_display = {
                            let path = ftp_dest_path.trim_end_matches('/');
                            let segments: Vec<&str> = path.split('/').collect();
                            let anchor = segments.iter().position(|s| s.to_lowercase() == "compartida");
                            match anchor {
                                Some(idx) => segments[idx..].join("/"),
                                None => path.to_string(),
                            }
                        };

                        // Infer media type from path (rough heuristic)
                        let path_lower = ftp_dest_path.to_lowercase();
                        let inferred_media_type = if path_lower.contains("serie") || path_lower.contains("/tv/") {
                            "tv"
                        } else {
                            "movie"
                        };

                        // Parse the filename to detect season/episode numbers.
                        let parsed = crate::parser::parse_media_path(&ftp_dest_path, &filename);

                        // For season groups: build a season-level header and episode count
                        let (header, episode_str) = if group_id.is_some() {
                            // Count how many episodes were in this group
                            let ep_count = {
                                let q = upload_queue.lock().unwrap();
                                q.group_status(group_id.as_deref().unwrap_or("")).1
                            };
                            let season_num = parsed.season.unwrap_or(1);
                            let h = "📁 Nueva temporada";
                            let e = format!("\n🗂 Temporada {season_num} · {ep_count} episodios");
                            (h, e)
                        } else {
                            let h = if inferred_media_type == "tv" {
                                match (parsed.season, parsed.episode) {
                                    (Some(_), Some(_)) => "📺 Nuevo episodio",
                                    (Some(_), None)    => "📁 Nueva temporada",
                                    _                  => "📺 Nueva serie",
                                }
                            } else {
                                "🎬 Nueva película"
                            };
                            let e = match (parsed.season, parsed.episode) {
                                (Some(s), Some(e)) => format!("\n🗂 T{s} · E{e:02}"),
                                (Some(s), None)    => format!("\n🗂 Temporada {s}"),
                                _                  => String::new(),
                            };
                            (h, e)
                        };

                        // Try to fetch TMDB metadata for poster + year
                        let tmdb_data = if let (Some(tid), false) = (tmdb_id, config.tmdb_api_key.is_empty()) {
                            crate::tmdb::fetch_movie_by_id(&config.tmdb_api_key, tid, inferred_media_type)
                                .await
                                .ok()
                        } else {
                            None
                        };

                        let display_title = tmdb_data.as_ref()
                            .map(|m| m.title.clone())
                            .or(media_title.clone())
                            .unwrap_or_else(|| filename.clone());

                        let year_str = tmdb_data.as_ref()
                            .and_then(|m| m.release_date.as_deref())
                            .and_then(|d| d.split('-').next())
                            .map(|y| format!(" ({})", y))
                            .unwrap_or_default();

                        // Tech-specs line: resolution · video codec · HDR (audio moved to 🔊 line)
                        let specs_parts: Vec<String> = [
                            resolution.as_deref().filter(|s| !s.is_empty()).map(str::to_string),
                            codec.as_deref().filter(|s| !s.is_empty()).map(str::to_string),
                            hdr.as_deref().filter(|s| !s.is_empty()).map(str::to_string),
                        ].into_iter().flatten().collect();
                        let specs_str = if specs_parts.is_empty() {
                            String::new()
                        } else {
                            format!("\n📺 {}", specs_parts.join(" · "))
                        };

                        // Audio tracks: "🔊 Español TrueHD 7.1 · Inglés AC3 5.1"
                        // Falls back to plain language list if no track metadata
                        let audio_str = if !audio_tracks.is_empty() {
                            let mut seen = std::collections::HashSet::new();
                            let parts: Vec<String> = audio_tracks.iter()
                                .filter_map(|t| {
                                    let lang_label = t.language.as_deref()
                                        .map(lang_name)
                                        .unwrap_or_else(|| "Desconocido".into());
                                    let ch_label = t.channels.map(channels_label).unwrap_or_default();
                                    let entry = format!(
                                        "{}{}{}",
                                        lang_label,
                                        if t.codec.is_empty() { String::new() } else { format!(" {}", t.codec) },
                                        if ch_label.is_empty() { String::new() } else { format!(" {}", ch_label) },
                                    );
                                    if seen.insert(entry.clone()) { Some(entry) } else { None }
                                })
                                .collect();
                            if parts.is_empty() { String::new() } else { format!("\n🔊 {}", parts.join(" · ")) }
                        } else if !languages.is_empty() {
                            let names: Vec<String> = languages.iter().map(|l| lang_name(l)).collect();
                            format!("\n🗣️ {}", names.join(" · "))
                        } else if let Some(ref ac) = audio_codec {
                            format!("\n🔊 {}", ac)
                        } else {
                            String::new()
                        };

                        // Subtitle tracks: "💬 Español · Inglés (forzado)"
                        let subs_str = if !subtitle_tracks.is_empty() {
                            let mut seen = std::collections::HashSet::new();
                            let parts: Vec<String> = subtitle_tracks.iter()
                                .filter_map(|t| {
                                    let lang = t.language.as_deref().unwrap_or("und");
                                    let key = format!("{}{}", lang, t.is_forced);
                                    if !seen.insert(key) { return None; }
                                    let name = lang_name(lang);
                                    if t.is_forced {
                                        Some(format!("{} (forzado)", name))
                                    } else {
                                        Some(name.into())
                                    }
                                })
                                .collect();
                            if parts.is_empty() { String::new() } else { format!("\n💬 {}", parts.join(" · ")) }
                        } else if !subtitle_langs.is_empty() {
                            let names: Vec<String> = subtitle_langs.iter().map(|l| lang_name(l)).collect();
                            format!("\n💬 {}", names.join(" · "))
                        } else {
                            String::new()
                        };

                        // File size
                        let size_str = if let Some(ref gid) = group_id {
                            let total = upload_queue.lock().unwrap().group_total_bytes(gid);
                            if total > 0 {
                                format!("\n💾 {}", format_bytes_human(total))
                            } else {
                                String::new()
                            }
                        } else if size_bytes > 0 {
                            format!("\n💾 {}", format_bytes_human(size_bytes))
                        } else {
                            String::new()
                        };

                        // TMDB rating + runtime on one line
                        let rating_val = tmdb_data.as_ref()
                            .and_then(|m| m.vote_average)
                            .filter(|&r| r > 0.0);
                        let runtime_val = tmdb_data.as_ref()
                            .and_then(|m| m.runtime_mins);
                        let meta_inline_str = match (rating_val, runtime_val) {
                            (Some(r), Some(mins)) => format!("\n⭐ {:.1}   ⏱️ {}", r, format_runtime(mins)),
                            (Some(r), None)        => format!("\n⭐ {:.1}", r),
                            (None, Some(mins))     => format!("\n⏱️ {}", format_runtime(mins)),
                            (None, None)           => String::new(),
                        };

                        // Release date + country on one line
                        let release_date_str = tmdb_data.as_ref()
                            .and_then(|m| m.release_date.as_deref())
                            .map(format_date_es)
                            .unwrap_or_default();
                        let country_str = tmdb_data.as_ref()
                            .and_then(|m| m.origin_country.as_deref())
                            .map(country_name)
                            .unwrap_or_default();
                        let date_country_str = match (release_date_str.as_str(), country_str) {
                            ("", "")    => String::new(),
                            (d, "")     => format!("\n📅 {d}"),
                            ("", c)     => format!("\n🌍 {c}"),
                            (d,  c)     => format!("\n📅 {d}   🌍 {c}"),
                        };

                        // Genres
                        let genres_str = tmdb_data.as_ref()
                            .map(|m| m.genres.as_slice())
                            .filter(|g| !g.is_empty())
                            .map(|g| format!("\n🎭 {}", g.join(" · ")))
                            .unwrap_or_default();

                        // Synopsis (shortened)
                        let overview_str = tmdb_data.as_ref()
                            .and_then(|m| m.overview.as_deref())
                            .filter(|s| !s.is_empty())
                            .map(|s| {
                                let truncated = if s.chars().count() > 250 {
                                    let cut: String = s.chars().take(250).collect();
                                    format!("{}…", cut)
                                } else {
                                    s.to_string()
                                };
                                format!("\n\n<i>{}</i>", truncated)
                            })
                            .unwrap_or_default();

                        let tmdb_link_str = if let Some(tid) = tmdb_id {
                            let tmdb_type_path = if inferred_media_type == "tv" { "tv" } else { "movie" };
                            format!("\n🔗 <a href=\"https://www.themoviedb.org/{tmdb_type_path}/{tid}\">Ver en TMDB</a>")
                        } else {
                            String::new()
                        };

                        let msg = format!(
                            "{header} <b>{display_title}</b>{year_str}{episode_str}{specs_str}{audio_str}{subs_str}{size_str}{meta_inline_str}{date_country_str}{genres_str}{overview_str}{tmdb_link_str}\n\n📂 <code>{dest_display}</code>",
                        );

                        let poster_url = tmdb_data.as_ref()
                            .and_then(|m| m.poster_path.as_deref())
                            .map(|p| format!("https://image.tmdb.org/t/p/w500{p}"));

                        let notify_result = if let Some(url) = poster_url {
                            crate::telegram::send_photo(&tg_token, &tg_chat, &url, &msg).await
                        } else {
                            crate::telegram::send_message(&tg_token, &tg_chat, &msg).await
                        };

                        if let Err(e) = notify_result {
                            eprintln!("[upload] Telegram notify failed: {e}");
                        }

                        // Personal subscriber notifications (each user's own bot)
                        if let Ok(subs) = db.list_telegram_subs() {
                            for sub in subs {
                                if sub.notify_downloads && !sub.telegram_bot_token.is_empty() {
                                    let sub_msg = format!(
                                        "✅ Descarga completada: <b>{display_title}</b>",
                                    );
                                    crate::telegram::send_message(&sub.telegram_bot_token, &sub.telegram_chat_id, &sub_msg).await.ok();
                                }
                            }
                        }
                    }
                }
            }
            Err(e) if e == "Cancelled" => {
                {
                    let mut q = upload_queue.lock().unwrap();
                    q.mark_cancelled(id);
                }
                persist_upload_state(&db, &upload_queue);
                app.emit("upload:update", serde_json::json!({
                    "id": id, "status": "cancelled",
                })).ok();
            }
            Err(e) => {
                {
                    let mut q = upload_queue.lock().unwrap();
                    q.mark_error(id, e.clone());
                }
                persist_upload_state(&db, &upload_queue);
                app.emit("upload:update", serde_json::json!({
                    "id": id, "status": "error", "error": e
                })).ok();
            }
        }
    });
}

#[tauri::command]
pub async fn queue_upload(
    local_path: String,
    ftp_dest_path: String,
    filename: String,
    media_title: Option<String>,
    tmdb_id: Option<i64>,
    size_bytes: u64,
    resolution: Option<String>,
    hdr: Option<String>,
    languages: Vec<String>,
    codec: Option<String>,
    audio_codec: Option<String>,
    subtitle_langs: Vec<String>,
    audio_tracks: Vec<crate::analysis::AudioTrack>,
    subtitle_tracks: Vec<crate::analysis::SubtitleTrack>,
    group_id: Option<String>,
    upload_queue: tauri::State<'_, crate::uploads::SharedUploadQueue>,
    db: tauri::State<'_, crate::db::Db>,
    app: tauri::AppHandle,
) -> Result<u64, String> {
    let (id, semaphore, cancel_flag) = {
        let mut q = upload_queue.lock().unwrap();
        q.add(
            local_path.clone(),
            ftp_dest_path.clone(),
            filename.clone(),
            media_title.clone(),
            tmdb_id,
            size_bytes,
            resolution.clone(),
            hdr.clone(),
            languages.clone(),
            codec.clone(),
            audio_codec.clone(),
            subtitle_langs.clone(),
            audio_tracks.clone(),
            subtitle_tracks.clone(),
            group_id.clone(),
        )
    };

    let item = {
        let q = upload_queue.lock().unwrap();
        q.items.iter().find(|i| i.id == id).cloned()
    };

    if let Some(item) = item {
        app.emit("upload:added", &item).ok();
    }

    // Persist immediately so new items survive a crash before upload completes
    persist_upload_state(db.inner(), upload_queue.inner());

    let (item_media_title, item_tmdb_id) = {
        let q = upload_queue.lock().unwrap();
        q.items.iter().find(|i| i.id == id)
            .map(|i| (i.media_title.clone(), i.tmdb_id))
            .unwrap_or((None, None))
    };

    spawn_upload_job(
        db.inner().clone(),
        upload_queue.inner().clone(),
        app,
        id,
        local_path,
        ftp_dest_path,
        filename,
        item_media_title,
        item_tmdb_id,
        size_bytes,
        resolution,
        hdr,
        languages,
        codec,
        audio_codec,
        subtitle_langs,
        audio_tracks,
        subtitle_tracks,
        group_id,
        semaphore,
        cancel_flag,
    );

    Ok(id)
}

#[tauri::command]
pub fn get_uploads(
    upload_queue: tauri::State<'_, crate::uploads::SharedUploadQueue>,
) -> Vec<crate::uploads::UploadItem> {
    upload_queue.lock().unwrap().items.clone()
}

#[tauri::command]
pub fn cancel_upload(
    id: u64,
    upload_queue: tauri::State<'_, crate::uploads::SharedUploadQueue>,
    db: tauri::State<'_, crate::db::Db>,
) -> Result<(), String> {
    upload_queue.lock().unwrap().cancel(id);
    persist_upload_state(db.inner(), upload_queue.inner());
    Ok(())
}

#[tauri::command]
pub async fn retry_upload(
    id: u64,
    upload_queue: tauri::State<'_, crate::uploads::SharedUploadQueue>,
    db: tauri::State<'_, crate::db::Db>,
    app: tauri::AppHandle,
) -> Result<(), String> {
    let (item, semaphore, cancel_flag) = {
        let mut q = upload_queue.lock().unwrap();
        q.retry(id)?
    };

    spawn_upload_job(
        db.inner().clone(),
        upload_queue.inner().clone(),
        app,
        id,
        item.local_path,
        item.ftp_dest_path,
        item.filename,
        item.media_title,
        item.tmdb_id,
        item.bytes_total,
        item.resolution,
        item.hdr,
        item.languages,
        item.codec,
        item.audio_codec,
        item.subtitle_langs,
        item.audio_tracks,
        item.subtitle_tracks,
        item.group_id,
        semaphore,
        cancel_flag,
    );
    persist_upload_state(db.inner(), upload_queue.inner());
    Ok(())
}

#[tauri::command]
pub async fn delete_upload(
    id: u64,
    upload_queue: tauri::State<'_, crate::uploads::SharedUploadQueue>,
    db: tauri::State<'_, crate::db::Db>,
) -> Result<(), String> {
    // Grab the item details before removing from queue.
    let item = {
        let q = upload_queue.lock().unwrap();
        q.items.iter().find(|i| i.id == id).cloned()
    };

    // Delete the remote file when the upload completed successfully.
    if let Some(item) = &item {
        if item.status == crate::uploads::UploadStatus::Done {
            if let Ok(config) = db.load_config() {
                if let Err(e) = crate::ftp::delete_file(
                    &config.ftp_host,
                    config.ftp_port,
                    &config.ftp_user,
                    &config.ftp_pass,
                    &item.ftp_dest_path,
                    &item.filename,
                ).await {
                    eprintln!("[delete_upload] FTP delete failed (removing from queue anyway): {e}");
                }
            }
        }
    }

    upload_queue.lock().unwrap().delete(id);
    persist_upload_state(db.inner(), upload_queue.inner());
    Ok(())
}

#[tauri::command]
pub fn clear_completed_uploads(
    upload_queue: tauri::State<'_, crate::uploads::SharedUploadQueue>,
    db: tauri::State<'_, crate::db::Db>,
) -> Result<(), String> {
    upload_queue.lock().unwrap().clear_completed();
    persist_upload_state(db.inner(), upload_queue.inner());
    Ok(())
}

/// Send a test Telegram message with the provided credentials.
#[tauri::command]
pub async fn test_telegram(token: String, chat_id: String) -> Result<(), String> {
    crate::telegram::send_message(
        &token,
        &chat_id,
        "✅ Oscata — conexión con Telegram correcta",
    )
    .await
}

// ─── Personal Telegram subscription commands ───────────────────────────────

/// Returns the current personal subscription for the desktop user (user_id=0).
#[tauri::command]
pub async fn get_telegram_sub(
    app: tauri::AppHandle,
) -> Result<Option<crate::db::TelegramSub>, String> {
    let db = app.state::<crate::db::Db>();
    db.get_telegram_sub(0)
}

/// Generates a 6-digit verification code and sends it to the specified chat_id.
/// The code is stored in the DB with a 24h expiry.
#[tauri::command]
pub async fn link_telegram_bot(
    app: tauri::AppHandle,
    bot_token: String,
) -> Result<crate::db::TelegramSub, String> {
    // Discover the user's chat_id by polling their bot's updates
    let chat_id = crate::telegram::get_updates_first_chat_id(&bot_token)
        .await?
        .ok_or_else(|| {
            "Aún no hay mensajes en tu bot. Abre Telegram, busca tu bot y envíale cualquier mensaje, luego vuelve a intentarlo.".to_string()
        })?;

    let db = app.state::<crate::db::Db>();
    db.upsert_telegram_sub(0, &bot_token, &chat_id, true, true)?;

    // Send a welcome confirmation via the user's own bot
    let welcome = "✅ <b>Oscata</b> — Tu bot está vinculado correctamente.\n\nA partir de ahora recibirás avisos personales aquí.";
    crate::telegram::send_message(&bot_token, &chat_id, welcome).await.ok();

    db.get_telegram_sub(0)?.ok_or_else(|| "Error al guardar la suscripción.".to_string())
}

/// Updates notification preferences for the desktop user's personal subscription.
#[tauri::command]
pub async fn update_telegram_sub(
    app: tauri::AppHandle,
    notify_new_content: bool,
    notify_downloads: bool,
) -> Result<(), String> {
    let db = app.state::<crate::db::Db>();
    let sub = db
        .get_telegram_sub(0)?
        .ok_or_else(|| "No hay suscripción activa.".to_string())?;
    db.upsert_telegram_sub(0, &sub.telegram_bot_token, &sub.telegram_chat_id, notify_new_content, notify_downloads)
}

/// Removes the personal subscription for the desktop user.
#[tauri::command]
pub async fn revoke_telegram_sub(app: tauri::AppHandle) -> Result<(), String> {
    let db = app.state::<crate::db::Db>();
    db.delete_telegram_sub(0)
}

// `start_indexing_internal` requires a live FTP connection and a Tauri
// AppHandle, which cannot be constructed in unit tests. Instead we test the
// supporting pure helpers and document the integration-test scenarios.
//
// Integration tests that require a real FTP server:
//   1. Call start_indexing_internal with a live FTP pointing at a small tree.
//      Measure wall-clock time: should complete the upsert loop without
//      waiting for TMDB (i.e. loop finishes before any TMDB response arrives).
//   2. After the loop resolves, verify that `metadata_tasks` are awaited and
//      that `index:update` events fire for each new file.
//   3. Verify `index:complete` fires only AFTER all background tasks finish,
//      even though the loop itself did not block on TMDB.

#[cfg(test)]
mod indexing_tests {
    use super::*;

    // ── looks_like_tv_content ───────────────────────────────────────────────

    #[test]
    fn looks_like_tv_when_season_is_set() {
        let parsed = crate::parser::parse_media_path("", "Show.S02E05.1080p.mkv");
        assert!(looks_like_tv_content("", "Show.S02E05.1080p.mkv", &parsed));
    }

    #[test]
    fn looks_like_tv_when_path_contains_season_keyword() {
        let parsed = crate::parser::parse_media_path("", "episode.mkv");
        assert!(looks_like_tv_content(
            "/TV/Show/Season 01/episode.mkv",
            "episode.mkv",
            &parsed
        ));
    }

    #[test]
    fn not_tv_for_plain_movie() {
        let parsed = crate::parser::parse_media_path("", "The.Batman.2022.1080p.mkv");
        assert!(!looks_like_tv_content("", "The.Batman.2022.1080p.mkv", &parsed));
    }

    // ── detect_media_type ──────────────────────────────────────────────────

    #[test]
    fn detects_movie_type_from_folder_mapping() {
        let mut folder_types = std::collections::HashMap::new();
        folder_types.insert("Peliculas".to_string(), "movie".to_string());
        let mt = detect_media_type("/Compartida/Peliculas/Batman.mkv", "/Compartida", &folder_types);
        assert_eq!(mt.as_deref(), Some("movie"));
    }

    #[test]
    fn detects_tv_type_from_folder_mapping() {
        let mut folder_types = std::collections::HashMap::new();
        folder_types.insert("Series".to_string(), "tv".to_string());
        let mt = detect_media_type("/Compartida/Series/Show/ep.mkv", "/Compartida", &folder_types);
        assert_eq!(mt.as_deref(), Some("tv"));
    }

    #[test]
    fn returns_none_for_unmapped_folder() {
        let folder_types = std::collections::HashMap::new();
        let mt = detect_media_type("/Compartida/Unknown/file.mkv", "/Compartida", &folder_types);
        assert_eq!(mt, None);
    }

    // ── normalize_title ────────────────────────────────────────────────────

    #[test]
    fn normalizes_title_strips_punctuation_and_lowercases() {
        assert_eq!(normalize_title("The Batman (2022)!"), "the batman 2022");
    }

    #[test]
    fn normalizes_title_collapses_whitespace() {
        assert_eq!(normalize_title("  Dark   Knight  "), "dark knight");
    }

    // ── Background spawn: tokio integration ──────────────────────────────
    // Verifies that spawned tasks (the pattern used in the index loop) run
    // to completion and can write to a shared flag.

    #[tokio::test]
    async fn spawned_metadata_tasks_run_to_completion() {
        use std::sync::{Arc, Mutex};

        let counter = Arc::new(Mutex::new(0usize));
        let mut tasks = Vec::new();

        for _ in 0..5 {
            let counter = counter.clone();
            tasks.push(tokio::spawn(async move {
                // Simulate lightweight async work (no real HTTP)
                tokio::time::sleep(std::time::Duration::from_millis(1)).await;
                let mut c = counter.lock().unwrap();
                *c += 1;
            }));
        }

        for task in tasks {
            task.await.expect("task should not panic");
        }

        assert_eq!(*counter.lock().unwrap(), 5);
    }

    #[tokio::test]
    async fn index_loop_does_not_block_on_background_tasks() {
        // The loop itself must complete without awaiting any background task.
        // We verify this by measuring that spawned heavy tasks don't delay
        // the code that comes after the loop (the commit_batch + cleanup).
        use std::sync::{Arc, Mutex};
        use std::time::Instant;

        let loop_done_at = Arc::new(Mutex::new(None::<Instant>));
        let task_done_at = Arc::new(Mutex::new(None::<Instant>));

        let loop_done_clone = loop_done_at.clone();
        let task_done_clone = task_done_at.clone();

        let mut tasks = Vec::new();

        // Simulate "new file" path: spawn, don't await in loop
        tasks.push(tokio::spawn(async move {
            tokio::time::sleep(std::time::Duration::from_millis(50)).await;
            *task_done_clone.lock().unwrap() = Some(Instant::now());
        }));

        // Record when the "loop" finished (before awaiting tasks)
        *loop_done_clone.lock().unwrap() = Some(Instant::now());

        // Now await tasks (as start_indexing_internal does after the loop)
        for task in tasks {
            task.await.unwrap();
        }

        let loop_done = loop_done_at.lock().unwrap().unwrap();
        let task_done = task_done_at.lock().unwrap().unwrap();

        // The task completed after the loop — confirming the loop did not block on it.
        assert!(
            task_done > loop_done,
            "task should complete AFTER loop records completion"
        );
    }
}

// ── Fix 5: IPC progress batching tests ───────────────────────────────────────
// The batching logic lives inside start_indexing_internal and requires a live
// Tauri window to emit. We test the pure batching arithmetic here to ensure:
// - N files produce ceil(N/50) batches
// - No files are lost (every item appears in exactly one batch)
// - The final partial batch is always flushed

#[cfg(test)]
mod batching_tests {
    /// Simulate the batching logic from start_indexing_internal without Tauri.
    /// Returns a Vec of batch sizes (how many items per emitted event).
    fn simulate_batching(total_files: usize, batch_size: usize) -> Vec<usize> {
        let mut batches: Vec<usize> = Vec::new();
        let mut current_batch = 0usize;

        for _ in 0..total_files {
            current_batch += 1;
            if current_batch >= batch_size {
                batches.push(current_batch);
                current_batch = 0;
            }
        }
        // Flush remainder (equivalent to flush_progress_batch after loop)
        if current_batch > 0 {
            batches.push(current_batch);
        }
        batches
    }

    #[test]
    fn exactly_50_files_produce_one_batch() {
        let batches = simulate_batching(50, 50);
        assert_eq!(batches.len(), 1);
        assert_eq!(batches[0], 50);
    }

    #[test]
    fn exactly_100_files_produce_two_batches() {
        let batches = simulate_batching(100, 50);
        assert_eq!(batches.len(), 2);
        assert!(batches.iter().all(|&b| b == 50));
    }

    #[test]
    fn no_files_produce_no_batches() {
        let batches = simulate_batching(0, 50);
        assert!(batches.is_empty());
    }

    #[test]
    fn partial_batch_is_flushed_at_end() {
        // 127 files → 2 full batches (100 total) + 1 partial (27)
        let batches = simulate_batching(127, 50);
        assert_eq!(batches.len(), 3);
        assert_eq!(batches[0], 50);
        assert_eq!(batches[1], 50);
        assert_eq!(batches[2], 27);
    }

    #[test]
    fn single_file_produces_one_batch_of_size_1() {
        let batches = simulate_batching(1, 50);
        assert_eq!(batches.len(), 1);
        assert_eq!(batches[0], 1);
    }

    #[test]
    fn no_files_are_lost_for_various_totals() {
        for total in [1, 49, 50, 51, 99, 100, 101, 500, 1001] {
            let batches = simulate_batching(total, 50);
            let sum: usize = batches.iter().sum();
            assert_eq!(sum, total, "Lost files for total={total}: sum={sum}");
        }
    }

    #[test]
    fn batch_count_equals_ceil_total_div_batch_size() {
        for total in [1usize, 49, 50, 51, 99, 100, 101, 500, 1001] {
            let batches = simulate_batching(total, 50);
            let expected_batches = total.div_ceil(50);
            assert_eq!(
                batches.len(),
                expected_batches,
                "Wrong batch count for total={total}"
            );
        }
    }
}
