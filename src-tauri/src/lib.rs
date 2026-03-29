mod commands;
mod db;
mod downloads;
mod ftp;
mod parser;
mod tmdb;

use std::sync::{Arc, Mutex};
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(db::Db::new().expect("Failed to init SQLite"))
        .manage(Arc::new(Mutex::new(downloads::DownloadQueue::new(2))) as downloads::SharedQueue)
        .invoke_handler(tauri::generate_handler![
            commands::get_config,
            commands::ftp_list_raw,
            commands::test_ftp_connection,
            commands::test_tmdb_key,
            commands::test_emby_connection,
            commands::test_plex_connection,
            commands::save_config,
            commands::has_config,
            commands::get_all_media,
            commands::start_indexing,
            commands::rematch_all,
            commands::queue_download,
            commands::get_downloads,
            commands::cancel_download,
            commands::clear_completed,
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
        ])
        .setup(|app| {
            let db = app.state::<db::Db>().inner().clone();
            let queue = app.state::<downloads::SharedQueue>().inner().clone();
            commands::restore_download_queue(db.clone(), queue.clone());
            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                let interval_secs = std::time::Duration::from_secs(3600);
                let db = handle.state::<db::Db>().inner().clone();
                let queue = handle.state::<downloads::SharedQueue>().inner().clone();
                if let Some(window) = handle.get_webview_window("main") {
                    commands::resume_pending_downloads(db.clone(), queue.clone(), window).await.ok();
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
                        commands::start_indexing_internal(db.clone(), window).await.ok();
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
                        commands::start_indexing_internal(db.clone(), window).await.ok();
                    }
                }
            });
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
