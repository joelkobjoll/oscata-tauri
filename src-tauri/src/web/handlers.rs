use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    Json,
};
use serde_json::Value;
use tauri::Manager;

use crate::web::{
    auth::{AdminUser, ApiError, ApiResult, AuthUser, generate_otp, hash_password,
           new_session_token, verify_password},
    dto::*,
    AppState,
};

#[derive(Debug, serde::Deserialize)]
pub(crate) struct CheckMediaBadgesRequest {
    items: Vec<crate::commands::MediaBadgeQuery>,
}

// ── Public endpoints ─────────────────────────────────────────────────────────

pub async fn health() -> &'static str {
    "ok"
}

pub async fn pwa_manifest(State(state): State<AppState>) -> impl axum::response::IntoResponse {
    let cfg = state.db.load_webgui_config().unwrap_or_default();
    let start_url = if cfg.app_url.is_empty() { "/".to_string() } else { cfg.app_url.clone() };
    let manifest = serde_json::json!({
        "name": cfg.pwa_name,
        "short_name": cfg.pwa_short_name,
        "description": "Gestiona tu biblioteca de medios FTP con enriquecimiento TMDB y cola de descargas.",
        "start_url": start_url,
        "scope": "/",
        "display": "standalone",
        "orientation": "natural",
        "background_color": "#0d0d0f",
        "theme_color": "#7c6ef7",
        "categories": ["entertainment"],
        "icons": [
            { "src": "/icons/icon-128.png", "sizes": "128x128", "type": "image/png" },
            { "src": "/icons/icon-256.png", "sizes": "256x256", "type": "image/png" },
            { "src": "/icons/icon-512.png", "sizes": "512x512", "type": "image/png", "purpose": "any maskable" }
        ]
    });
    (
        [(axum::http::header::CONTENT_TYPE, "application/manifest+json")],
        manifest.to_string(),
    )
}

pub async fn server_info(State(state): State<AppState>) -> ApiResult<Json<ServerInfoResponse>> {
    let cfg = state.db.load_webgui_config().map_err(ApiError::from)?;
    let has_config = state.db.has_config().unwrap_or(false);
    let bootstrap_required = state.db.web_user_count().map_err(ApiError::from)? == 0;
    Ok(Json(ServerInfoResponse {
        bind_host: cfg.host,
        bind_port: cfg.port,
        exposed_port: state.exposed_port_override.or(cfg.exposed_port),
        app_url: cfg.app_url,
        otp_enabled: cfg.otp_enabled,
        has_config,
        bootstrap_required,
        version: env!("CARGO_PKG_VERSION").to_string(),
    }))
}

// ── Auth ─────────────────────────────────────────────────────────────────────

fn normalize_role(role: Option<&str>) -> Result<String, ApiError> {
    let raw = role.unwrap_or("user").trim().to_lowercase();
    match raw.as_str() {
        "admin" | "editor" | "user" => Ok(raw),
        // Backward compatibility with previously used role label.
        "viewer" => Ok("user".to_string()),
        _ => Err(ApiError::bad_request("Role must be one of: user, editor, admin")),
    }
}

pub async fn auth_bootstrap(
    State(state): State<AppState>,
    Json(body): Json<BootstrapRequest>,
) -> ApiResult<Json<Value>> {
    if state.db.web_user_count().map_err(ApiError::from)? > 0 {
        return Err(ApiError::bad_request("Admin user already exists"));
    }
    if body.email.trim().is_empty() || body.password.len() < 8 {
        return Err(ApiError::bad_request("Email required and password must be at least 8 characters"));
    }
    let hash = hash_password(&body.password)?;
    state.db.create_web_user(&body.email, &hash, "admin").map_err(ApiError::from)?;
    Ok(Json(serde_json::json!({"ok": true})))
}

pub async fn auth_login(
    State(state): State<AppState>,
    Json(body): Json<LoginRequest>,
) -> ApiResult<Json<LoginResponse>> {
    let row = state.db.get_web_user_by_email(&body.email)
        .map_err(ApiError::from)?
        .ok_or_else(ApiError::unauthorized)?;

    let (user, hash) = row;
    if !user.is_active {
        return Err(ApiError::unauthorized());
    }
    if !verify_password(&body.password, &hash)? {
        return Err(ApiError::unauthorized());
    }

    let cfg = state.db.load_webgui_config().map_err(ApiError::from)?;

    if cfg.otp_enabled && !cfg.smtp_host.is_empty() {
        let code = generate_otp();
        let challenge_id = state.db.create_otp_challenge(user.id, &code).map_err(ApiError::from)?;
        // Fire-and-forget email send
        let smtp_cfg = cfg.clone();
        let email = user.email.clone();
        let otp = code.clone();
        tauri::async_runtime::spawn(async move {
            if let Err(e) = send_otp_email(&smtp_cfg, &email, &otp).await {
                eprintln!("[webgui] OTP email send failed: {e}");
            }
        });
        return Ok(Json(LoginResponse::OtpRequired { challenge_id }));
    }

    let token = new_session_token();
    state.db.create_web_session(user.id, &token).map_err(ApiError::from)?;
    Ok(Json(LoginResponse::Ok { token, user: user.into() }))
}

pub async fn auth_otp_verify(
    State(state): State<AppState>,
    Json(body): Json<OtpVerifyRequest>,
) -> ApiResult<Json<LoginResponse>> {
    let user_id = state.db.verify_otp_challenge(&body.challenge_id, &body.code)
        .map_err(ApiError::from)?
        .ok_or_else(|| ApiError::bad_request("Invalid or expired code"))?;

    let users = state.db.list_web_users().map_err(ApiError::from)?;
    let user = users.into_iter().find(|u| u.id == user_id)
        .ok_or_else(ApiError::unauthorized)?;

    let token = new_session_token();
    state.db.create_web_session(user_id, &token).map_err(ApiError::from)?;
    Ok(Json(LoginResponse::Ok { token, user: user.into() }))
}

pub async fn auth_invite_accept(
    State(state): State<AppState>,
    Json(body): Json<InviteAcceptRequest>,
) -> ApiResult<Json<LoginResponse>> {
    if body.email.trim().is_empty() || body.password.len() < 8 {
        return Err(ApiError::bad_request("Email required and password must be at least 8 characters"));
    }

    let hash = hash_password(&body.password)?;
    let user = match state.db.consume_web_invite(&body.token, &body.email, &hash) {
        Ok(user) => user,
        Err(err)
            if err.contains("Invalid or expired invite")
                || err.contains("Invite email does not match")
                || err.contains("UNIQUE constraint failed: web_users.email") =>
        {
            return Err(ApiError::bad_request(err));
        }
        Err(err) => return Err(ApiError::from(err)),
    };

    let token = new_session_token();
    state.db.create_web_session(user.id, &token).map_err(ApiError::from)?;
    Ok(Json(LoginResponse::Ok { token, user: user.into() }))
}

pub async fn auth_me(AuthUser(user): AuthUser) -> Json<UserResponse> {
    Json(user.into())
}

pub async fn auth_logout(
    AuthUser(_user): AuthUser,
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
) -> ApiResult<Json<Value>> {
    if let Some(tok) = headers.get("authorization")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "))
        .map(|s| s.trim())
    {
        state.db.revoke_web_session(tok).ok();
    }
    Ok(Json(serde_json::json!({"ok": true})))
}

// ── User management ───────────────────────────────────────────────────────────

pub async fn list_users(
    AdminUser(_admin): AdminUser,
    State(state): State<AppState>,
) -> ApiResult<Json<Vec<UserResponse>>> {
    let users = state.db.list_web_users().map_err(ApiError::from)?
        .into_iter().map(UserResponse::from).collect();
    Ok(Json(users))
}

pub async fn create_user(
    AdminUser(_admin): AdminUser,
    State(state): State<AppState>,
    Json(body): Json<CreateUserRequest>,
) -> ApiResult<(StatusCode, Json<UserResponse>)> {
    if body.email.trim().is_empty() || body.password.len() < 8 {
        return Err(ApiError::bad_request("Email required and password must be at least 8 characters"));
    }
    let hash = hash_password(&body.password)?;
    let role = normalize_role(body.role.as_deref())?;
    let user = state.db.create_web_user(&body.email, &hash, &role).map_err(ApiError::from)?;
    Ok((StatusCode::CREATED, Json(user.into())))
}

pub async fn invite_user(
    AdminUser(_admin): AdminUser,
    State(state): State<AppState>,
    Json(body): Json<InviteUserRequest>,
) -> ApiResult<(StatusCode, Json<InviteUserResponse>)> {
    let role = normalize_role(body.role.as_deref())?;
    let email = body
        .email
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_lowercase);

    let (invite_token, expires_at) = state
        .db
        .create_web_invite(email.as_deref(), &role)
        .map_err(ApiError::from)?;

    let cfg = state.db.load_webgui_config().map_err(ApiError::from)?;
    let base_url = if !cfg.app_url.trim().is_empty() {
        cfg.app_url.trim().trim_end_matches('/').to_string()
    } else {
        let port = state.exposed_port_override.or(cfg.exposed_port).unwrap_or(cfg.port);
        format!("http://localhost:{port}")
    };
    let invite_link = format!("{base_url}/?invite={invite_token}");

    Ok((
        StatusCode::CREATED,
        Json(InviteUserResponse {
            invited: true,
            invite_token,
            invite_link,
            expires_at,
            email,
            role,
        }),
    ))
}

pub async fn update_user(
    AdminUser(_admin): AdminUser,
    Path(id): Path<i64>,
    State(state): State<AppState>,
    Json(body): Json<UpdateUserRequest>,
) -> ApiResult<Json<Value>> {
    let hash = if let Some(ref pw) = body.password {
        if pw.len() < 8 { return Err(ApiError::bad_request("Password must be at least 8 characters")); }
        Some(hash_password(pw)?)
    } else {
        None
    };
    let normalized_role = match body.role.as_deref() {
        Some(role) => Some(normalize_role(Some(role))?),
        None => None,
    };

    state.db.update_web_user(
        id,
        body.email.as_deref(),
        hash.as_deref(),
        normalized_role.as_deref(),
        body.is_active,
    ).map_err(ApiError::from)?;
    Ok(Json(serde_json::json!({"ok": true})))
}

pub async fn delete_user(
    AdminUser(admin): AdminUser,
    Path(id): Path<i64>,
    State(state): State<AppState>,
) -> ApiResult<Json<Value>> {
    if admin.id == id {
        return Err(ApiError::bad_request("Cannot delete your own account"));
    }
    state.db.delete_web_user(id).map_err(ApiError::from)?;
    Ok(Json(serde_json::json!({"ok": true})))
}

// ── Media ────────────────────────────────────────────────────────────────────

pub async fn get_media(
    AuthUser(_u): AuthUser,
    State(state): State<AppState>,
) -> ApiResult<Json<Vec<crate::db::MediaItem>>> {
    Ok(Json(state.db.get_all_media().map_err(ApiError::from)?))
}

pub async fn check_media_badges_handler(
    AuthUser(_u): AuthUser,
    State(state): State<AppState>,
    Json(body): Json<CheckMediaBadgesRequest>,
) -> ApiResult<Json<Vec<crate::commands::MediaBadgeResult>>> {
    let config = state.db.load_config().map_err(ApiError::from)?;
    let mut results = Vec::with_capacity(body.items.len());
    let mut media_presence_cache: std::collections::HashMap<String, crate::commands::MediaServerCheck> =
        std::collections::HashMap::new();

    for item in body.items {
        let downloaded = crate::commands::compute_local_path(
            &config,
            &item.ftp_path,
            &item.filename,
            item.media_type.as_deref(),
            None,
        )
        .map(|path| path.exists())
        .unwrap_or(false);

        let check = if let Some(cache_key) = crate::commands::plex_badge_cache_key(&item) {
            if let Some(cached) = media_presence_cache.get(&cache_key).cloned() {
                cached
            } else {
                let result = crate::commands::check_media_server_presence(&config, &item)
                    .await
                    .unwrap_or_else(|_| crate::commands::MediaServerCheck {
                        hit: false,
                        plex_hit: false,
                        emby_hit: false,
                        cache_state: "error".to_string(),
                        debug: "media-server-check:error".to_string(),
                    });
                media_presence_cache.insert(cache_key, result.clone());
                result
            }
        } else {
            crate::commands::MediaServerCheck {
                hit: false,
                plex_hit: false,
                emby_hit: false,
                cache_state: "no-cache-key".to_string(),
                debug: "no-cache-key".to_string(),
            }
        };

        results.push(crate::commands::MediaBadgeResult {
            id: item.id,
            downloaded,
            in_emby: check.hit,
            plex_in_library: Some(check.plex_hit),
            emby_in_library: Some(check.emby_hit),
            cache: Some(check.cache_state),
            debug: Some(check.debug),
        });
    }

    Ok(Json(results))
}

pub async fn apply_tmdb_match(
    AuthUser(_u): AuthUser,
    Path(id): Path<i64>,
    State(state): State<AppState>,
    Json(body): Json<ApplyMatchRequest>,
) -> ApiResult<Json<Value>> {
    let config = state.db.load_config().map_err(ApiError::from)?;
    let movie = crate::metadata::fetch_by_id(&config, body.tmdb_id, &body.media_type)
        .await.map_err(ApiError::from)?;
    state.db.update_tmdb_manual(id, &movie, &body.media_type).map_err(ApiError::from)?;
    Ok(Json(serde_json::json!({"ok": true})))
}

pub async fn clear_item_metadata_handler(
    AuthUser(_u): AuthUser,
    Path(id): Path<i64>,
    State(state): State<AppState>,
) -> ApiResult<Json<Value>> {
    state.db.clear_item_metadata(id).map_err(ApiError::from)?;
    Ok(Json(serde_json::json!({"ok": true})))
}

pub async fn clear_all_metadata_handler(
    AuthUser(_u): AuthUser,
    State(state): State<AppState>,
) -> ApiResult<Json<Value>> {
    state.db.clear_all_metadata().map_err(ApiError::from)?;
    Ok(Json(serde_json::json!({"ok": true})))
}

// ── Downloads ────────────────────────────────────────────────────────────────

pub async fn get_downloads(
    AuthUser(_u): AuthUser,
    State(state): State<AppState>,
) -> Json<Vec<crate::downloads::DownloadItem>> {
    let queue = state.queue.lock().unwrap();
    Json(queue.items.clone())
}

pub async fn queue_download(
    AuthUser(_u): AuthUser,
    State(state): State<AppState>,
    Json(body): Json<QueueDownloadRequest>,
) -> ApiResult<Json<u64>> {
    let config = state.db.load_config().map_err(ApiError::from)?;
    let media_type = state.db.get_media_type_by_path(&body.ftp_path).ok().flatten();
    let tmdb_genres = state.db.get_tmdb_genres_by_path(&body.ftp_path).ok().flatten();
    let local_path = crate::commands::compute_local_path(
        &config, &body.ftp_path, &body.filename, media_type.as_deref(), tmdb_genres.as_deref(),
    ).map_err(ApiError::from)?;

    // Deduplicate
    let existing = state.queue.lock().unwrap().find_active_by_ftp_path(&body.ftp_path);
    if let Some(id) = existing { return Ok(Json(id)); }

    if let Some(parent) = local_path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| ApiError::internal(e.to_string()))?;
    }

    let (id, semaphore, cancel_flag) = {
        let mut queue = state.queue.lock().unwrap();
        queue.add(body.ftp_path.clone(), body.filename.clone(),
            local_path.to_string_lossy().to_string(), body.media_title.clone())
    };
    { state.db.save_download_state(&state.queue.lock().unwrap().items).ok(); }

    let window = state.app_handle.get_webview_window("main");
    crate::commands::spawn_download_job_pub(
        state.db.clone(), state.queue.clone(), window, config,
        id, body.ftp_path, local_path.to_string_lossy().to_string(), semaphore, cancel_flag,
    );
    Ok(Json(id))
}

pub async fn cancel_download_handler(
    AuthUser(_u): AuthUser,
    Path(id): Path<u64>,
    State(state): State<AppState>,
) -> ApiResult<Json<Value>> {
    let flag = {
        let queue = state.queue.lock().unwrap();
        queue.cancel_flags.get(&id).cloned()
    };
    if let Some(f) = flag {
        f.store(true, std::sync::atomic::Ordering::SeqCst);
    }
    Ok(Json(serde_json::json!({"ok": true})))
}

pub async fn delete_download_handler(
    AuthUser(_u): AuthUser,
    Path(id): Path<u64>,
    State(state): State<AppState>,
) -> ApiResult<Json<Value>> {
    { state.queue.lock().unwrap().items.retain(|i| i.id != id); }
    state.db.save_download_state(&state.queue.lock().unwrap().items).ok();
    Ok(Json(serde_json::json!({"ok": true})))
}

pub async fn clear_completed_handler(
    AuthUser(_u): AuthUser,
    State(state): State<AppState>,
) -> ApiResult<Json<Value>> {
    { state.queue.lock().unwrap().clear_completed(); }
    state.db.save_download_state(&state.queue.lock().unwrap().items).ok();
    Ok(Json(serde_json::json!({"ok": true})))
}

pub async fn retry_download_handler(
    AuthUser(_u): AuthUser,
    Path(id): Path<u64>,
    State(state): State<AppState>,
) -> ApiResult<Json<Value>> {
    let config = state.db.load_config().map_err(ApiError::from)?;
    let (ftp_path, local_path, semaphore, cancel_flag) = {
        let mut q = state.queue.lock().unwrap();
        let (_, sem, flag) = q.retry(id).map_err(ApiError::from)?;
        let item = q.items.iter().find(|i| i.id == id).cloned()
            .ok_or_else(|| ApiError::not_found("Download not found"))?;
        (item.ftp_path.clone(), item.local_path.clone(), sem, flag)
    };
    let window = state.app_handle.get_webview_window("main");
    crate::commands::spawn_download_job_pub(
        state.db.clone(), state.queue.clone(), window, config,
        id, ftp_path, local_path, semaphore, cancel_flag,
    );
    Ok(Json(serde_json::json!({"ok": true})))
}

pub async fn set_concurrency_handler(
    AuthUser(_u): AuthUser,
    State(state): State<AppState>,
    Json(body): Json<SetConcurrencyRequest>,
) -> ApiResult<Json<Value>> {
    let max = body.max.clamp(1, 10);
    state.queue.lock().unwrap().update_concurrent(max);
    Ok(Json(serde_json::json!({"ok": true})))
}

// ── Indexing ──────────────────────────────────────────────────────────────────

pub async fn start_indexing_handler(
    AuthUser(_u): AuthUser,
    State(state): State<AppState>,
) -> ApiResult<Json<Value>> {
    use std::sync::atomic::Ordering;
    if crate::INDEXING_RUNNING.load(Ordering::SeqCst) {
        return Ok(Json(serde_json::json!({"running": true, "message": "Already in progress"})));
    }
    let db = state.db.clone();
    let queue = state.queue.clone();
    let window = state.app_handle.get_webview_window("main");
    tauri::async_runtime::spawn(async move {
        crate::INDEXING_RUNNING.store(true, Ordering::SeqCst);
        crate::commands::start_indexing_internal(db.clone(), window.clone(), Some(queue)).await.ok();
        crate::INDEXING_RUNNING.store(false, Ordering::SeqCst);
    });
    Ok(Json(serde_json::json!({"running": true, "message": "Indexing started"})))
}

pub async fn rematch_all_handler(
    AuthUser(_u): AuthUser,
    State(state): State<AppState>,
) -> ApiResult<Json<Value>> {
    let db = state.db.clone();
    let window = state.app_handle.get_webview_window("main");
    tauri::async_runtime::spawn(async move {
        crate::commands::rematch_all_internal(db, window).await.ok();
    });
    Ok(Json(serde_json::json!({"ok": true, "message": "Re-match started"})))
}

pub async fn refresh_all_metadata_handler(
    AuthUser(_u): AuthUser,
    State(state): State<AppState>,
) -> ApiResult<Json<Value>> {
    let db = state.db.clone();
    let window = state.app_handle.get_webview_window("main");
    tauri::async_runtime::spawn(async move {
        crate::commands::refresh_all_metadata_internal(db, window, false)
            .await
            .ok();
    });
    Ok(Json(serde_json::json!({"ok": true, "message": "Metadata refresh started"})))
}

pub async fn force_refresh_all_metadata_handler(
    AuthUser(_u): AuthUser,
    State(state): State<AppState>,
) -> ApiResult<Json<Value>> {
    let db = state.db.clone();
    let window = state.app_handle.get_webview_window("main");
    tauri::async_runtime::spawn(async move {
        crate::commands::refresh_all_metadata_internal(db, window, true)
            .await
            .ok();
    });
    Ok(Json(serde_json::json!({"ok": true, "message": "Force metadata refresh started"})))
}

pub async fn indexing_status_handler(
    AuthUser(_u): AuthUser,
    State(state): State<AppState>,
) -> ApiResult<Json<crate::web::dto::IndexingStatusResponse>> {
    let running = crate::INDEXING_RUNNING.load(std::sync::atomic::Ordering::SeqCst);
    let last_indexed_at = state.db.load_last_indexed_at().ok().flatten();
    Ok(Json(IndexingStatusResponse { running, last_indexed_at }))
}

// ── Settings ─────────────────────────────────────────────────────────────────

pub async fn get_settings(
    AuthUser(_u): AuthUser,
    State(state): State<AppState>,
) -> ApiResult<Json<crate::db::AppConfig>> {
    Ok(Json(state.db.load_config().map_err(ApiError::from)?))
}

pub async fn put_settings(
    AuthUser(_u): AuthUser,
    State(state): State<AppState>,
    Json(config): Json<crate::db::AppConfig>,
) -> ApiResult<Json<Value>> {
    state.db.save_config(&config).map_err(ApiError::from)?;
    // Invalidate badge cache so stale "not-configured" entries are evicted on config changes.
    crate::commands::BADGE_RESULT_CACHE.lock().unwrap().clear();
    Ok(Json(serde_json::json!({"ok": true})))
}

pub async fn has_config_handler(State(state): State<AppState>) -> Json<Value> {
    Json(serde_json::json!({"has_config": state.db.has_config().unwrap_or(false)}))
}

pub async fn test_ftp_handler(
    AuthUser(_u): AuthUser,
    Json(body): Json<TestFtpRequest>,
) -> ApiResult<Json<Value>> {
    crate::ftp::test_connection(&body.host, body.port, &body.user, &body.pass)
        .await
        .map_err(ApiError::from)?;
    Ok(Json(serde_json::json!({"ok": true})))
}

#[derive(Debug, serde::Deserialize)]
pub(crate) struct TestMetadataRequest {
    provider: String,
    tmdb_api_key: Option<String>,
    proxy_url: Option<String>,
    proxy_api_key: Option<String>,
}

pub async fn test_metadata_handler(
    AuthUser(_u): AuthUser,
    Json(body): Json<TestMetadataRequest>,
) -> ApiResult<Json<Value>> {
    let cfg = crate::db::AppConfig {
        metadata_provider: body.provider.clone(),
        tmdb_api_key: body.tmdb_api_key.unwrap_or_default(),
        proxy_url: body.proxy_url.unwrap_or_default(),
        proxy_api_key: body.proxy_api_key.unwrap_or_default(),
        ftp_host: String::new(),
        ftp_port: 21,
        ftp_user: String::new(),
        ftp_pass: String::new(),
        ftp_root: String::new(),
        default_language: String::new(),
        download_folder: String::new(),
        folder_types: String::new(),
        max_concurrent_downloads: 1,
        emby_url: String::new(),
        emby_api_key: String::new(),
        plex_url: String::new(),
        plex_token: String::new(),
        auto_check_updates: false,
        updater_endpoint: String::new(),
        updater_pubkey: String::new(),
        movie_destination: String::new(),
        tv_destination: String::new(),
        documentary_destination: String::new(),
        alphabetical_subfolders: false,
        genre_destinations: String::new(),
        close_to_tray: false,
        telegram_bot_token: String::new(),
        telegram_chat_id: String::new(),
        proxy_search_provider: String::new(),
        preferred_rating: "tmdb".to_string(),
    };
    let ok = crate::metadata::validate_config(&cfg).await;
    Ok(Json(serde_json::json!({"ok": ok})))
}

// ── WEBGUI config ─────────────────────────────────────────────────────────────

pub async fn get_webgui_config_handler(
    AuthUser(_u): AuthUser,
    State(state): State<AppState>,
) -> ApiResult<Json<crate::db::WebGuiConfig>> {
    Ok(Json(state.db.load_webgui_config().map_err(ApiError::from)?))
}

pub async fn put_webgui_config_handler(
    AuthUser(_u): AuthUser,
    State(state): State<AppState>,
    Json(config): Json<crate::db::WebGuiConfig>,
) -> ApiResult<Json<Value>> {
    state.db.save_webgui_config(&config).map_err(ApiError::from)?;
    Ok(Json(serde_json::json!({"ok": true, "note": "Restart required for bind changes to take effect"})))
}

// ── TMDB ─────────────────────────────────────────────────────────────────────

pub async fn search_tmdb_handler(
    AuthUser(_u): AuthUser,
    State(state): State<AppState>,
    Json(body): Json<TmdbSearchRequest>,
) -> ApiResult<Json<Vec<crate::tmdb::TmdbMovie>>> {
    let config = state.db.load_config().map_err(ApiError::from)?;
    let media_type = body.media_type.as_deref().unwrap_or("movie");
    let year = body.year.map(|y| y as u16);
    let results = crate::metadata::search_multi_with_year(
        &config, &body.query, media_type, year,
    ).await.map_err(ApiError::from)?;
    Ok(Json(results))
}

// ── Watchlist ─────────────────────────────────────────────────────────────────

pub async fn get_watchlist_handler(
    AuthUser(u): AuthUser,
    State(state): State<AppState>,
) -> ApiResult<Json<Vec<crate::db::WatchlistItem>>> {
    let items = state.db.get_watchlist(u.id).map_err(ApiError::from)?;
    Ok(Json(items))
}

pub async fn add_watchlist_handler(
    AuthUser(u): AuthUser,
    State(state): State<AppState>,
    Json(body): Json<AddWatchlistRequest>,
) -> ApiResult<Json<serde_json::Value>> {
    let auto_download = body.auto_download.unwrap_or(false);
    let id = state.db.add_watchlist_item(
        u.id,
        body.tmdb_id,
        &body.tmdb_type,
        &body.title,
        body.title_en.as_deref(),
        body.poster.as_deref(),
        body.overview.as_deref(),
        body.overview_en.as_deref(),
        body.status.as_deref(),
        body.release_date.as_deref(),
        body.year,
        body.latest_season,
        body.scope.as_deref().unwrap_or("all"),
        auto_download,
        body.profile_id.unwrap_or(1),
    ).map_err(ApiError::from)?;

    // If auto-download is on, check already-indexed files for matches immediately.
    if auto_download {
        let db = state.db.clone();
        let queue = state.queue.clone();
        let window = state.app_handle.get_webview_window("main")
            .filter(|w| w.is_visible().ok().unwrap_or(false));
        tokio::spawn(async move {
            crate::commands::trigger_watchlist_auto_downloads(db, queue, window).await;
        });
    }

    Ok(Json(serde_json::json!({ "id": id })))
}

pub async fn remove_watchlist_handler(
    AuthUser(u): AuthUser,
    Path(id): Path<i64>,
    State(state): State<AppState>,
) -> ApiResult<Json<Value>> {
    state.db.remove_watchlist_item(id, u.id).map_err(ApiError::from)?;
    Ok(Json(serde_json::json!({ "ok": true })))
}

pub async fn update_watchlist_handler(
    AuthUser(u): AuthUser,
    Path(id): Path<i64>,
    State(state): State<AppState>,
    Json(body): Json<UpdateWatchlistRequest>,
) -> ApiResult<Json<Value>> {
    state.db.update_watchlist_item(id, u.id, &body.scope, body.auto_download, body.profile_id.unwrap_or(1)).map_err(ApiError::from)?;
    // If auto-download was just enabled, immediately scan for matching indexed files.
    if body.auto_download {
        let db = state.db.clone();
        let queue = state.queue.clone();
        let window = state.app_handle.get_webview_window("main")
            .filter(|w| w.is_visible().ok().unwrap_or(false));
        tokio::spawn(async move {
            crate::commands::trigger_watchlist_auto_downloads(db, queue, window).await;
        });
    }
    Ok(Json(serde_json::json!({ "ok": true })))
}

pub async fn check_watchlist_handler(
    AuthUser(u): AuthUser,
    Path(tmdb_id): Path<i64>,
    State(state): State<AppState>,
) -> ApiResult<Json<Option<crate::db::WatchlistItem>>> {
    let item = state.db.check_watchlist_item(tmdb_id, u.id).map_err(ApiError::from)?;
    Ok(Json(item))
}

pub async fn watchlist_coverage_handler(
    AuthUser(_u): AuthUser,
    Path(tmdb_id): Path<i64>,
    State(state): State<AppState>,
) -> ApiResult<Json<Vec<crate::db::WatchlistCoverageItem>>> {
    let items = state.db.get_watchlist_library_coverage(tmdb_id).map_err(ApiError::from)?;
    Ok(Json(items))
}

pub async fn get_profiles_handler(
    AuthUser(_u): AuthUser,
    State(state): State<AppState>,
) -> ApiResult<Json<Vec<crate::db::QualityProfile>>> {
    let profiles = state.db.get_quality_profiles().map_err(ApiError::from)?;
    Ok(Json(profiles))
}

pub async fn create_profile_handler(
    AuthUser(_u): AuthUser,
    State(state): State<AppState>,
    Json(body): Json<CreateQualityProfileRequest>,
) -> ApiResult<Json<crate::db::QualityProfile>> {
    let profile = state.db.create_quality_profile(
        &body.name,
        body.min_resolution.as_deref(),
        body.preferred_resolution.as_deref(),
        body.prefer_hdr,
        &body.preferred_codecs,
        &body.preferred_audio_codecs,
        &body.preferred_release_types,
        body.min_size_gb,
        body.max_size_gb,
    ).map_err(ApiError::from)?;
    Ok(Json(profile))
}

pub async fn update_profile_handler(
    AuthUser(_u): AuthUser,
    Path(id): Path<i64>,
    State(state): State<AppState>,
    Json(body): Json<UpdateQualityProfileRequest>,
) -> ApiResult<Json<Value>> {
    state.db.update_quality_profile(
        id,
        &body.name,
        body.min_resolution.as_deref(),
        body.preferred_resolution.as_deref(),
        body.prefer_hdr,
        &body.preferred_codecs,
        &body.preferred_audio_codecs,
        &body.preferred_release_types,
        body.min_size_gb,
        body.max_size_gb,
    ).map_err(ApiError::from)?;
    Ok(Json(serde_json::json!({ "ok": true })))
}

pub async fn delete_profile_handler(
    AuthUser(_u): AuthUser,
    Path(id): Path<i64>,
    State(state): State<AppState>,
) -> ApiResult<Json<Value>> {
    state.db.delete_quality_profile(id).map_err(ApiError::from)?;
    Ok(Json(serde_json::json!({ "ok": true })))
}

// ── SMTP test ─────────────────────────────────────────────────────────────────

pub async fn smtp_test_handler(
    AuthUser(u): AuthUser,
    State(state): State<AppState>,
) -> ApiResult<Json<Value>> {
    let cfg = state.db.load_webgui_config().map_err(ApiError::from)?;
    if cfg.smtp_host.is_empty() {
        return Err(ApiError::bad_request("SMTP host not configured"));
    }
    if cfg.smtp_from.is_empty() {
        return Err(ApiError::bad_request("SMTP from address not configured"));
    }
    // Send a real test email to the logged-in user
    send_otp_email(&cfg, &u.email, "TEST-123456")
        .await
        .map_err(|e| ApiError::bad_request(format!("SMTP test failed: {e}")))?;
    Ok(Json(serde_json::json!({"ok": true, "sent_to": u.email})))
}

// ── SMTP email sending (OTP) ──────────────────────────────────────────────────

pub async fn send_otp_email(cfg: &crate::db::WebGuiConfig, to: &str, code: &str) -> Result<(), String> {
    use lettre::{
        message::Mailbox,
        transport::smtp::authentication::Credentials,
        AsyncSmtpTransport, AsyncTransport, Message, Tokio1Executor,
    };

    let from: Mailbox = cfg.smtp_from.parse().map_err(|e: lettre::address::AddressError| e.to_string())?;
    let to_addr: Mailbox = to.parse().map_err(|e: lettre::address::AddressError| e.to_string())?;

    let subject = if code == "TEST-123456" {
        "Oscata – SMTP test email".to_string()
    } else {
        "Oscata – Your login code".to_string()
    };
    let body = if code == "TEST-123456" {
        "This is a test email from Oscata. Your SMTP configuration is working correctly.".to_string()
    } else {
        format!("Your one-time login code is: {code}\n\nThis code expires in 5 minutes.\nIf you did not request this, ignore this email.")
    };

    let email = Message::builder()
        .from(from)
        .to(to_addr)
        .subject(subject)
        .body(body)
        .map_err(|e| e.to_string())?;

    let creds = Credentials::new(cfg.smtp_user.clone(), cfg.smtp_pass.clone());

    // "tls" = implicit TLS (port 465), "starttls" = STARTTLS upgrade (port 587)
    let use_tls = cfg.smtp_tls_mode == "tls";
    if use_tls {
        let mailer = AsyncSmtpTransport::<Tokio1Executor>::relay(&cfg.smtp_host)
            .map_err(|e| e.to_string())?
            .port(cfg.smtp_port)
            .credentials(creds)
            .build();
        mailer.send(email).await.map_err(|e| e.to_string())?;
    } else {
        let mailer = AsyncSmtpTransport::<Tokio1Executor>::starttls_relay(&cfg.smtp_host)
            .map_err(|e| e.to_string())?
            .port(cfg.smtp_port)
            .credentials(creds)
            .build();
        mailer.send(email).await.map_err(|e| e.to_string())?;
    }
    Ok(())
}

// ─── Personal Telegram subscription handlers ───────────────────────────────────

/// GET /notifications/subscription — returns the calling user's subscription, if any.
pub async fn get_telegram_sub_handler(
    AuthUser(user): AuthUser,
    State(state): State<AppState>,
) -> ApiResult<Json<Value>> {
    let sub = state.db.get_telegram_sub(user.id).map_err(ApiError::from)?;
    Ok(Json(serde_json::to_value(sub).unwrap_or(Value::Null)))
}

/// POST /notifications/subscription/link — discovers chat_id via the user's bot and creates the subscription.
pub async fn link_telegram_bot_handler(
    AuthUser(user): AuthUser,
    State(state): State<AppState>,
    Json(body): Json<LinkTelegramBotRequest>,
) -> ApiResult<Json<Value>> {
    let chat_id = crate::telegram::get_updates_first_chat_id(&body.bot_token)
        .await
        .map_err(ApiError::from)?
        .ok_or_else(|| {
            ApiError::bad_request(
                "Aún no hay mensajes en tu bot. Abre Telegram, busca tu bot y envíale cualquier mensaje, luego vuelve a intentarlo.",
            )
        })?;

    state
        .db
        .upsert_telegram_sub(user.id, &body.bot_token, &chat_id, true, true)
        .map_err(ApiError::from)?;

    let welcome = "✅ <b>Oscata</b> — Tu bot está vinculado correctamente.\n\nA partir de ahora recibirás avisos personales aquí.";
    crate::telegram::send_message(&body.bot_token, &chat_id, welcome)
        .await
        .ok();

    let sub = state.db.get_telegram_sub(user.id).map_err(ApiError::from)?;
    Ok(Json(serde_json::to_value(sub).unwrap_or(Value::Null)))
}

/// PUT /notifications/subscription — updates notification preferences.
pub async fn update_telegram_sub_handler(
    AuthUser(user): AuthUser,
    State(state): State<AppState>,
    Json(body): Json<UpdateTelegramSubRequest>,
) -> ApiResult<Json<Value>> {
    let sub = state
        .db
        .get_telegram_sub(user.id)
        .map_err(ApiError::from)?
        .ok_or_else(|| ApiError::not_found("No hay suscripción activa."))?;
    state
        .db
        .upsert_telegram_sub(user.id, &sub.telegram_bot_token, &sub.telegram_chat_id, body.notify_new_content, body.notify_downloads)
        .map_err(ApiError::from)?;
    Ok(Json(serde_json::json!({"ok": true})))
}

/// DELETE /notifications/subscription — removes the subscription.
pub async fn revoke_telegram_sub_handler(
    AuthUser(user): AuthUser,
    State(state): State<AppState>,
) -> ApiResult<Json<Value>> {
    state
        .db
        .delete_telegram_sub(user.id)
        .map_err(ApiError::from)?;
    Ok(Json(serde_json::json!({"ok": true})))
}

#[derive(serde::Deserialize, Default)]
pub struct SeasonsQuery {
    imdb_id: Option<String>,
}

pub async fn watchlist_seasons_handler(
    AuthUser(_u): AuthUser,
    Path(tmdb_id): Path<i64>,
    State(state): State<AppState>,
    Query(q): Query<SeasonsQuery>,
) -> ApiResult<Json<Vec<crate::tmdb::TmdbSeason>>> {
    let config = state.db.load_config().map_err(ApiError::from)?;
    let seasons = crate::metadata::fetch_tv_seasons(&config, tmdb_id, q.imdb_id.as_deref())
        .await
        .map_err(ApiError::from)?;
    Ok(Json(seasons))
}

// ── WebSocket event stream ────────────────────────────────────────────────────

/// Upgrades a connection to a WebSocket that subscribes to all server-push
/// events (indexed via `crate::ws_broadcast`). Requires a valid auth token in
/// the `Authorization: Bearer <token>` header or `?token=<token>` query param.
pub async fn ws_handler(
    ws: axum::extract::ws::WebSocketUpgrade,
    axum::extract::Query(params): axum::extract::Query<std::collections::HashMap<String, String>>,
    axum::extract::State(state): axum::extract::State<AppState>,
    headers: axum::http::HeaderMap,
) -> axum::response::Response {
    // Accept token from query-string (?token=…) or Authorization header.
    let token = params.get("token").cloned().or_else(|| {
        headers
            .get(axum::http::header::AUTHORIZATION)
            .and_then(|v| v.to_str().ok())
            .and_then(|v| v.strip_prefix("Bearer ").map(str::to_string))
    });

    let authenticated = match token {
        Some(t) => state.db.validate_web_session(&t).ok().flatten().is_some(),
        None => false,
    };

    ws.on_upgrade(move |socket| handle_ws(socket, authenticated))
}

async fn handle_ws(
    mut socket: axum::extract::ws::WebSocket,
    authenticated: bool,
) {
    use axum::extract::ws::Message;

    if !authenticated {
        let _ = socket
            .send(Message::Text(
                r#"{"event":"error","payload":{"message":"Unauthorized"}}"#.into(),
            ))
            .await;
        return;
    }

    let mut rx = crate::WS_TX.subscribe();

    loop {
        tokio::select! {
            // Receive broadcast event and forward to client
            result = rx.recv() => {
                match result {
                    Ok(msg) => {
                        if socket.send(Message::Text(msg.into())).await.is_err() {
                            break; // Client disconnected
                        }
                    }
                    Err(tokio::sync::broadcast::error::RecvError::Lagged(n)) => {
                        eprintln!("[ws] client lagged, skipped {n} messages");
                    }
                    Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
                }
            }
            // Echo client pings back (keep-alive)
            msg = socket.recv() => {
                match msg {
                    Some(Ok(Message::Ping(data))) => {
                        if socket.send(Message::Pong(data)).await.is_err() { break; }
                    }
                    Some(Ok(Message::Close(_))) | None => break,
                    _ => {} // ignore other messages from client
                }
            }
        }
    }
}

