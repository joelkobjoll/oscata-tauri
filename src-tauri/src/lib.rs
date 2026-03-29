mod commands;
mod db;
mod downloads;
mod ftp;
mod parser;
mod tmdb;
mod web;

use std::sync::{Arc, Mutex};
use tauri::Manager;
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIcon, TrayIconBuilder, TrayIconEvent};

struct TrayState(Mutex<Option<TrayIcon>>);

/// Global flag that tracks whether an FTP index pass is currently running.
/// Set/cleared by `start_indexing_internal`; read by the WEBGUI status endpoint.
pub static INDEXING_RUNNING: std::sync::LazyLock<Arc<std::sync::atomic::AtomicBool>> =
    std::sync::LazyLock::new(|| Arc::new(std::sync::atomic::AtomicBool::new(false)));

fn show_main_window(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        window.unminimize().ok();
        window.show().ok();
        window.set_focus().ok();
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            show_main_window(app);
        }))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(db::Db::new().expect("Failed to init SQLite"))
        .manage(Arc::new(Mutex::new(downloads::DownloadQueue::new(2))) as downloads::SharedQueue)
        .manage(TrayState(Mutex::new(None)))
        .invoke_handler(tauri::generate_handler![
            commands::get_config,
            commands::ftp_list_raw,
            commands::test_ftp_connection,
            commands::test_tmdb_key,
            commands::test_emby_connection,
            commands::test_plex_connection,
            commands::save_config,
            commands::get_webgui_config,
            commands::save_webgui_config,
            commands::init_webgui_now,
            commands::has_config,
            commands::seed_starter_library,
            commands::export_library_backup,
            commands::import_library_backup,
            commands::get_all_media,
            commands::start_indexing,
            commands::rematch_all,
            commands::queue_download,
            commands::get_downloads,
            commands::cancel_download,
            commands::clear_completed,
            commands::delete_download,
            commands::set_max_concurrent,
            commands::retry_download,
            commands::open_download_folder,
            commands::search_tmdb,
            commands::apply_tmdb_match,
            commands::clear_item_metadata,
            commands::clear_show_metadata,
            commands::clear_all_metadata,
            commands::refresh_all_metadata,
            commands::check_media_badges,
            commands::ftp_list_root_dirs,
            commands::ftp_list_root_dirs_preview,
        ])
        .on_window_event(|window, event| {
            if window.label() != "main" {
                return;
            }
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                window.hide().ok();
            }
        })
        .setup(|app| {
            let show = MenuItem::with_id(app, "tray_show", "Open Oscata", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "tray_quit", "Quit", true, None::<&str>)?;
            let tray_menu = Menu::with_items(app, &[&show, &quit])?;

            let mut tray_builder = TrayIconBuilder::new()
                .menu(&tray_menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app_handle: &tauri::AppHandle, event| match event.id.as_ref() {
                    "tray_show" => {
                        show_main_window(app_handle);
                    }
                    "tray_quit" => {
                        app_handle.exit(0);
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray_icon: &TrayIcon, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        if let Some(window) = tray_icon.app_handle().get_webview_window("main") {
                            let visible = window.is_visible().unwrap_or(false);
                            if visible {
                                window.hide().ok();
                            } else {
                                show_main_window(tray_icon.app_handle());
                            }
                        }
                    }
                })
                ;

            // Explicitly set tray icon to avoid an invisible tray entry on Windows.
            let tray_icon = app.default_window_icon().cloned().or_else(|| {
                Some(tauri::include_image!("icons/32x32.png"))
            });
            if let Some(icon) = tray_icon {
                tray_builder = tray_builder.icon(icon);
            }

            let tray = tray_builder.build(app)?;
            *app.state::<TrayState>().0.lock().unwrap() = Some(tray);

            let db = app.state::<db::Db>().inner().clone();
            let queue = app.state::<downloads::SharedQueue>().inner().clone();
            // Spawn WEBGUI HTTP server if enabled in config
            web::spawn_if_enabled(db.clone(), queue.clone(), app.handle().clone());
            let current_version = app.package_info().version.to_string();
            if let Ok(Some(backup_path)) = db.prepare_for_app_version(&current_version) {
                println!(
                    "App updated to v{}; preserved existing library cache backup at {}",
                    current_version, backup_path
                );
            }
            if let Some(seed_path) = commands::resolve_seed_db_path(&app.handle().clone()) {
                match db.backfill_imdb_ids_from_seed(&seed_path) {
                    Ok(updated) if updated > 0 => {
                        println!(
                            "Backfilled imdb_id for {} library items from bundled seed database",
                            updated
                        );
                    }
                    Ok(_) => {}
                    Err(error) => {
                        eprintln!("IMDb seed backfill skipped: {error}");
                    }
                }
            }
            commands::restore_download_queue(db.clone(), queue.clone());
            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                let interval_secs = std::time::Duration::from_secs(3600);
                let db = handle.state::<db::Db>().inner().clone();
                let queue = handle.state::<downloads::SharedQueue>().inner().clone();
                if let Some(window) = handle.get_webview_window("main") {
                    commands::resume_pending_downloads(db.clone(), queue.clone(), window).await.ok();
                }
                if let Some(window) = handle.get_webview_window("main") {
                    commands::refresh_all_metadata_internal(db.clone(), Some(window)).await.ok();
                }
                let last_indexed_at = db.load_last_indexed_at().ok().flatten();
                let should_run_now = last_indexed_at
                    .as_deref()
                    .and_then(|value| chrono::DateTime::parse_from_rfc3339(value).ok())
                    .and_then(|value| (chrono::Utc::now() - value.with_timezone(&chrono::Utc)).to_std().ok())
                    .map(|elapsed| elapsed >= interval_secs)
                    .unwrap_or(true);

                if should_run_now {
                    if let Some(window) = handle.get_webview_window("main") {
                        commands::start_indexing_internal(db.clone(), Some(window)).await.ok();
                    }
                } else if let Some(value) = last_indexed_at
                    .as_deref()
                    .and_then(|raw| chrono::DateTime::parse_from_rfc3339(raw).ok())
                    .and_then(|raw| (chrono::Utc::now() - raw.with_timezone(&chrono::Utc)).to_std().ok())
                {
                    tokio::time::sleep(interval_secs.saturating_sub(value)).await;
                }

                let mut interval = tokio::time::interval(interval_secs);
                loop {
                    interval.tick().await;
                    if let Some(window) = handle.get_webview_window("main") {
                        commands::start_indexing_internal(db.clone(), Some(window)).await.ok();
                    }
                }
            });
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
