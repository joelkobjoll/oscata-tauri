pub mod auth;
pub mod dto;
pub mod handlers;

use axum::{
    middleware,
    routing::{delete, get, post, put},
    Router,
};
#[cfg(debug_assertions)]
use axum::{
    body::Body,
    extract::Request,
    response::{IntoResponse, Response},
};
#[cfg(not(debug_assertions))]
use axum::response::Html;
use std::net::{IpAddr, Ipv4Addr, SocketAddr};
#[cfg(not(debug_assertions))]
use tauri::Manager;
#[cfg(not(debug_assertions))]
use tower_http::services::{ServeDir, ServeFile};
use tower_http::cors::CorsLayer;

static WEBGUI_RUNNING: std::sync::LazyLock<std::sync::atomic::AtomicBool> =
    std::sync::LazyLock::new(|| std::sync::atomic::AtomicBool::new(false));

#[derive(Clone)]
pub struct AppState {
    pub db: crate::db::Db,
    pub queue: crate::downloads::SharedQueue,
    pub app_handle: tauri::AppHandle,
}

pub fn spawn_if_enabled(db: crate::db::Db, queue: crate::downloads::SharedQueue, app_handle: tauri::AppHandle) {
    let cfg = match db.load_webgui_config() {
        Ok(c) => c,
        Err(e) => { eprintln!("[webgui] config load failed: {e}"); return; }
    };
    if !cfg.enabled { return; }
    if WEBGUI_RUNNING
        .compare_exchange(
            false,
            true,
            std::sync::atomic::Ordering::SeqCst,
            std::sync::atomic::Ordering::SeqCst,
        )
        .is_err()
    {
        println!("[webgui] already running");
        return;
    }

    let addr = SocketAddr::new(parse_bind_ip(&cfg.host), cfg.port);
    let state = AppState { db, queue, app_handle };

    tauri::async_runtime::spawn(async move {
        let listener = match tokio::net::TcpListener::bind(addr).await {
            Ok(l) => l,
            Err(e) => {
                WEBGUI_RUNNING.store(false, std::sync::atomic::Ordering::SeqCst);
                eprintln!("[webgui] bind {addr} failed: {e}");
                return;
            }
        };
        println!("[webgui] listening on http://{addr}");
        if let Err(e) = axum::serve(listener, build_router(state)).await {
            WEBGUI_RUNNING.store(false, std::sync::atomic::Ordering::SeqCst);
            eprintln!("[webgui] stopped: {e}");
        }
    });
}

fn build_router(state: AppState) -> Router {
    let cors = CorsLayer::permissive();
    let api_state = state.clone();
    let auth_mw = middleware::from_fn_with_state(api_state.clone(), auth::auth_middleware);

    let api = Router::new()
        // public
        .route("/health",                  get(handlers::health))
        .route("/server-info",             get(handlers::server_info))
        .route("/settings/has-config",     get(handlers::has_config_handler))
        .route("/auth/bootstrap",          post(handlers::auth_bootstrap))
        .route("/auth/login",              post(handlers::auth_login))
        .route("/auth/invite/accept",      post(handlers::auth_invite_accept))
        .route("/auth/otp/verify",         post(handlers::auth_otp_verify))
        // auth-gated
        .route("/auth/me",                 get(handlers::auth_me))
        .route("/auth/logout",             post(handlers::auth_logout))
        .route("/users",                   get(handlers::list_users).post(handlers::create_user))
        .route("/users/invite",            post(handlers::invite_user))
        .route("/users/{id}",              put(handlers::update_user).delete(handlers::delete_user))
        .route("/media",                   get(handlers::get_media))
        .route("/media/badges",            post(handlers::check_media_badges_handler))
        .route("/media/{id}/match",        put(handlers::apply_tmdb_match))
        .route("/media/{id}/metadata",     delete(handlers::clear_item_metadata_handler))
        .route("/media/clear-all-metadata",post(handlers::clear_all_metadata_handler))
        .route("/downloads",               get(handlers::get_downloads).post(handlers::queue_download))
        .route("/downloads/clear-completed", post(handlers::clear_completed_handler))
        .route("/downloads/concurrency",   put(handlers::set_concurrency_handler))
        .route("/downloads/{id}",          delete(handlers::delete_download_handler))
        .route("/downloads/{id}/cancel",   post(handlers::cancel_download_handler))
        .route("/downloads/{id}/retry",    post(handlers::retry_download_handler))
        .route("/indexing/start",          post(handlers::start_indexing_handler))
        .route("/indexing/rematch",        post(handlers::rematch_all_handler))
        .route("/indexing/refresh-metadata", post(handlers::refresh_all_metadata_handler))
        .route("/indexing/status",         get(handlers::indexing_status_handler))
        .route("/settings",                get(handlers::get_settings).put(handlers::put_settings))
        .route("/settings/smtp-test",      post(handlers::smtp_test_handler))
        .route("/webgui/config",           get(handlers::get_webgui_config_handler).put(handlers::put_webgui_config_handler))
        .route("/tmdb/search",             post(handlers::search_tmdb_handler))
        .layer(auth_mw)
        .with_state(api_state);

    // In debug builds, proxy all frontend requests to the Vite dev server (port 1420).
    // In release builds, serve built frontend from bundled resources or local dist/.
    let mut root = Router::new().nest("/api", api);

    #[cfg(debug_assertions)]
    {
        root = root.fallback(vite_proxy);
    }

    #[cfg(not(debug_assertions))]
    {
        let dist = find_dist_dir(&state.app_handle);
        if let Some(d) = dist {
            let index = d.join("index.html");
            root = root.fallback_service(
                ServeDir::new(&d).not_found_service(ServeFile::new(index))
            );
        } else {
            root = root
                .route("/", get(dev_root_page))
                .fallback(get(dev_root_page));
        }
    }

    root.layer(cors)
}

/// In debug mode, proxy all non-API requests to the Vite dev server (HMR included).
#[cfg(debug_assertions)]
async fn vite_proxy(req: Request) -> Response {
    static CLIENT: std::sync::OnceLock<reqwest::Client> = std::sync::OnceLock::new();
    let client = CLIENT.get_or_init(|| reqwest::Client::new());

    let path_and_query = req
        .uri()
        .path_and_query()
        .map(|pq| pq.as_str())
        .unwrap_or("/");
    let target = format!("http://localhost:1420{path_and_query}");

    let method = reqwest::Method::from_bytes(req.method().as_str().as_bytes())
        .unwrap_or(reqwest::Method::GET);

    let body_bytes = match axum::body::to_bytes(req.into_body(), usize::MAX).await {
        Ok(b) => b,
        Err(_) => return (axum::http::StatusCode::BAD_GATEWAY, "body read error").into_response(),
    };

    let upstream = match client.request(method, &target).body(body_bytes).send().await {
        Ok(r) => r,
        Err(_) => {
            return (
                axum::http::StatusCode::BAD_GATEWAY,
                format!("Vite dev server not reachable at {target}"),
            )
                .into_response()
        }
    };

    let status = axum::http::StatusCode::from_u16(upstream.status().as_u16())
        .unwrap_or(axum::http::StatusCode::INTERNAL_SERVER_ERROR);
    let mut builder = Response::builder().status(status);
    for (k, v) in upstream.headers() {
        // Skip transfer-encoding to avoid chunked encoding conflicts
        if k.as_str().eq_ignore_ascii_case("transfer-encoding") { continue; }
        builder = builder.header(k, v);
    }
    let bytes = upstream.bytes().await.unwrap_or_default();
    builder.body(Body::from(bytes)).unwrap_or_else(|_| {
        (axum::http::StatusCode::INTERNAL_SERVER_ERROR, "response build error").into_response()
    })
}

#[cfg(not(debug_assertions))]
async fn dev_root_page() -> Html<&'static str> {
    Html(
    r#"<!doctype html>
<html lang="en">
    <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>Oscata WebGUI</title>
        <style>
            :root { color-scheme: dark; }
            body {
                margin: 0;
                font-family: "Segoe UI", sans-serif;
                background: #0d0d0f;
                color: #e8e8f0;
                min-height: 100vh;
                display: grid;
                place-items: center;
            }
            .card {
                width: min(760px, calc(100% - 2rem));
                border: 1px solid #2e2e38;
                background: #18181c;
                border-radius: 12px;
                padding: 1rem 1.1rem;
            }
            h1 { margin: 0 0 0.5rem; font-size: 1.1rem; }
            p { color: #a3a3b8; line-height: 1.5; margin: 0.35rem 0; }
            code { color: #fff; }
            a { color: #9585ff; }
        </style>
    </head>
    <body>
        <div class="card">
            <h1>WebGUI API is running</h1>
            <p>The root page is unavailable because no built frontend was found in <code>dist/</code>.</p>
            <p>API health check: <a href="/api/health">/api/health</a></p>
        </div>
    </body>
</html>"#,
    )
}

#[cfg(not(debug_assertions))]
fn find_dist_dir(app_handle: &tauri::AppHandle) -> Option<std::path::PathBuf> {
    // 1. Bundled resource paths (production install)
    let resource_candidates = [
        "dist/index.html",
        "index.html",
        "frontend/index.html",
        "www/index.html",
    ];
    for rel in resource_candidates {
        if let Ok(candidate) = app_handle
            .path()
            .resolve(rel, tauri::path::BaseDirectory::Resource)
        {
            if candidate.exists() {
                return candidate.parent().map(|p| p.to_path_buf());
            }
        }
    }

    // 2. Next to the binary
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            let candidate = dir.join("dist");
            if candidate.join("index.html").exists() { return Some(candidate); }

            // Common macOS app bundle layout: <App>.app/Contents/MacOS/<exe>
            let macos_resources = dir.join("..").join("Resources").join("dist");
            if macos_resources.join("index.html").exists() {
                return Some(macos_resources);
            }
        }
    }

    // 3. Current working directory (dev mode)
    let cwd = std::path::PathBuf::from("dist");
    if cwd.join("index.html").exists() { return Some(cwd); }
    None
}

fn parse_bind_ip(host: &str) -> IpAddr {
    let t = host.trim();
    if t.eq_ignore_ascii_case("localhost") { return IpAddr::V4(Ipv4Addr::LOCALHOST); }
    t.parse().unwrap_or(IpAddr::V4(Ipv4Addr::UNSPECIFIED))
}
