mod commands;
mod db;
mod downloads;
mod ftp;
mod parser;
mod tmdb;
mod web;

use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::sync::atomic::{AtomicU64, Ordering};
use tauri::Emitter;
use tauri::Manager;
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIcon, TrayIconBuilder, TrayIconEvent};

struct TrayState(Mutex<Option<TrayIcon>>);

#[derive(Default)]
pub(crate) struct WatchdogWindowState {
    awaiting_nonce: Option<u64>,
    recovered_once: bool,
}

pub(crate) struct WatchdogState(pub(crate) Mutex<HashMap<String, WatchdogWindowState>>);

/// Global flag that tracks whether an FTP index pass is currently running.
/// Set/cleared by `start_indexing_internal`; read by the WEBGUI status endpoint.
pub static INDEXING_RUNNING: std::sync::LazyLock<Arc<std::sync::atomic::AtomicBool>> =
    std::sync::LazyLock::new(|| Arc::new(std::sync::atomic::AtomicBool::new(false)));
static WATCHDOG_NONCE: AtomicU64 = AtomicU64::new(1);

fn schedule_window_watchdog(app: &tauri::AppHandle, window: &tauri::WebviewWindow) {
    let nonce = WATCHDOG_NONCE.fetch_add(1, Ordering::SeqCst);
    let label = window.label().to_string();

    {
        let watchdog = app.state::<WatchdogState>();
        let mut guard = watchdog.0.lock().unwrap();
        let state = guard.entry(label.clone()).or_default();
        state.awaiting_nonce = Some(nonce);
    }

    window
        .emit("watchdog:ping", serde_json::json!({ "nonce": nonce }))
        .ok();

    let app_handle = app.clone();
    let window_clone = window.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(std::time::Duration::from_millis(5000)).await;

        let should_recover = {
            let watchdog = app_handle.state::<WatchdogState>();
            let mut guard = watchdog.0.lock().unwrap();
            let state = guard.entry(label.clone()).or_default();
            if state.awaiting_nonce == Some(nonce) {
                state.awaiting_nonce = None;
                if state.recovered_once {
                    false
                } else {
                    state.recovered_once = true;
                    true
                }
            } else {
                false
            }
        };

        if should_recover {
            window_clone.eval("window.location.reload();").ok();
        }
    });
}

fn show_main_window(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        window.unminimize().ok();
        window.show().ok();
        window.set_focus().ok();
        schedule_window_watchdog(app, &window);
    }
}

fn visible_main_window(app: &tauri::AppHandle) -> Option<tauri::WebviewWindow> {
    let window = app.get_webview_window("main")?;
    if window.is_visible().ok()? {
        Some(window)
    } else {
        None
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
        .manage(WatchdogState(Mutex::new(HashMap::new())))
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
            commands::get_applied_migrations,
            commands::seed_starter_library,
            commands::export_library_backup,
            commands::import_library_backup,
            commands::get_db_path,
            commands::init_db_path,
            commands::set_db_path,
            commands::is_portable_mode,
            commands::reset_db_path,
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
            commands::watchdog_pong,
            commands::quit_app,
            commands::get_watchlist,
            commands::add_to_watchlist,
            commands::remove_from_watchlist,
            commands::update_watchlist_item,
            commands::check_watchlist_item,
            commands::get_watchlist_coverage,
            commands::get_tv_seasons,
            commands::get_quality_profiles,
            commands::create_quality_profile,
            commands::update_quality_profile,
            commands::delete_quality_profile,
        ])
        .on_window_event(|window, event| {
            if window.label() != "main" {
                return;
            }
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let app = window.app_handle().clone();
                let window_clone = window.clone();
                tauri::async_runtime::spawn(async move {
                    let db = app.state::<db::Db>().inner().clone();
                    let close_to_tray = db.load_config()
                        .map(|c| c.close_to_tray)
                        .unwrap_or(true);
                    if close_to_tray {
                        window_clone.hide().ok();
                        return;
                    }
                    // close_to_tray is off: check for active downloads before quitting
                    let active_count = {
                        let shared = app.state::<downloads::SharedQueue>();
                        let queue = shared.lock().unwrap();
                        queue.items.iter().filter(|i| matches!(
                            i.status,
                            downloads::DownloadStatus::Queued | downloads::DownloadStatus::Downloading
                        )).count()
                    };
                    if active_count > 0 {
                        // Show the window so the dialog is visible, then emit
                        window_clone.show().ok();
                        window_clone.set_focus().ok();
                        window_clone.emit(
                            "app:quit-requested",
                            serde_json::json!({ "active": active_count }),
                        ).ok();
                    } else {
                        app.exit(0);
                    }
                });
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
                        let active_count = {
                            let shared = app_handle.state::<downloads::SharedQueue>();
                            let queue = shared.lock().unwrap();
                            queue.items.iter().filter(|i| matches!(
                                i.status,
                                downloads::DownloadStatus::Queued | downloads::DownloadStatus::Downloading
                            )).count()
                        };
                        if active_count > 0 {
                            show_main_window(app_handle);
                            if let Some(w) = app_handle.get_webview_window("main") {
                                w.emit(
                                    "app:quit-requested",
                                    serde_json::json!({ "active": active_count }),
                                ).ok();
                            }
                        } else {
                            app_handle.exit(0);
                        }
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
            let seed_path = commands::resolve_seed_db_path(&app.handle().clone());

            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                let interval_secs = std::time::Duration::from_secs(15 * 60);
                let db = handle.state::<db::Db>().inner().clone();
                let queue = handle.state::<downloads::SharedQueue>().inner().clone();

                // Load ftp_root for path normalization. Falls back to "/" if config unavailable.
                let ftp_root = db.load_config()
                    .map(|c| c.ftp_root)
                    .unwrap_or_else(|_| "/".to_string());

                // Backfill ftp_relative_path for existing rows whose path starts with current root.
                if let Err(e) = db.populate_ftp_relative_paths(&ftp_root) {
                    eprintln!("ftp_relative_path backfill failed: {e}");
                }

                // Re-parse codec/resolution/audio_codec/hdr/release_type from the
                // stored ftp_path so that items indexed before the parent-folder
                // fallback was added get their tech tags populated.
                match db.reparse_tech_tags() {
                    Ok(n) if n > 0 => println!("Reparsed tech tags for {n} library items"),
                    Ok(_) => {}
                    Err(e) => eprintln!("reparse_tech_tags failed: {e}"),
                }

                if let Ok(Some(backup_path)) = db.prepare_for_app_version(&current_version) {
                    println!(
                        "App updated to v{}; preserved existing library cache backup at {}",
                        current_version, backup_path
                    );
                }
                if let Some(ref seed_path) = seed_path {
                    match db.refresh_library_from_seed(seed_path, &current_version, &ftp_root) {
                        Ok((inserted, merged)) if inserted > 0 || merged > 0 => {
                            println!(
                                "Refreshed user library from bundled seed (inserted {}, merged {})",
                                inserted, merged
                            );
                        }
                        Ok(_) => {}
                        Err(error) => {
                            eprintln!("Seed library refresh skipped: {error}");
                        }
                    }

                    match db.backfill_imdb_ids_from_seed(seed_path, &current_version, &ftp_root) {
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

                    match db.override_library_from_seed(seed_path, &current_version, &ftp_root) {
                        Ok((inserted, overridden)) if inserted > 0 || overridden > 0 => {
                            println!(
                                "Seed override applied: inserted {}, overrode metadata for {} library items",
                                inserted, overridden
                            );
                        }
                        Ok(_) => {}
                        Err(error) => {
                            eprintln!("Seed override skipped: {error}");
                        }
                    }
                }
                commands::restore_download_queue(db.clone(), queue.clone());

                if let Some(window) = visible_main_window(&handle) {
                    commands::resume_pending_downloads(db.clone(), queue.clone(), window).await.ok();
                }
                if let Some(window) = visible_main_window(&handle) {
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
                    let window = visible_main_window(&handle);
                    commands::start_indexing_internal(db.clone(), window.clone(), Some(queue.clone())).await.ok();
                    commands::refresh_all_metadata_internal(db.clone(), window).await.ok();
                } else if let Some(value) = last_indexed_at
                    .as_deref()
                    .and_then(|raw| chrono::DateTime::parse_from_rfc3339(raw).ok())
                    .and_then(|raw| (chrono::Utc::now() - raw.with_timezone(&chrono::Utc)).to_std().ok())
                {
                    tokio::time::sleep(interval_secs.saturating_sub(value)).await;
                }

                loop {
                    // Compute how long until 15 minutes after the last index run
                    // (whether that was manual or automatic).
                    let sleep_duration = db.load_last_indexed_at()
                        .ok()
                        .flatten()
                        .and_then(|raw| chrono::DateTime::parse_from_rfc3339(&raw).ok())
                        .and_then(|last| {
                            let elapsed = (chrono::Utc::now() - last.with_timezone(&chrono::Utc))
                                .to_std()
                                .ok()?;
                            interval_secs.checked_sub(elapsed)
                        })
                        .unwrap_or(interval_secs);

                    tokio::time::sleep(sleep_duration).await;

                    // Re-check after waking: a manual index that ran while we slept would
                    // have updated last_indexed_at, so the 15 min window resets from there.
                    let elapsed_since_last = db.load_last_indexed_at()
                        .ok()
                        .flatten()
                        .and_then(|raw| chrono::DateTime::parse_from_rfc3339(&raw).ok())
                        .and_then(|last| {
                            (chrono::Utc::now() - last.with_timezone(&chrono::Utc))
                                .to_std()
                                .ok()
                        });
                    if elapsed_since_last.map(|e| e < interval_secs).unwrap_or(false) {
                        // A recent index (likely manual) happened — skip this tick.
                        continue;
                    }

                    let window = visible_main_window(&handle);
                    commands::start_indexing_internal(db.clone(), window.clone(), Some(queue.clone())).await.ok();
                    commands::refresh_all_metadata_internal(db.clone(), window).await.ok();
                }
            });
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
