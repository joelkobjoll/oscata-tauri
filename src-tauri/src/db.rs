use rusqlite::{params, Connection, OptionalExtension, Result as SqlResult};
use serde::{Deserialize, Serialize};
use std::sync::{Arc, Mutex};

const DEFAULT_FTP_ROOT: &str = "/Compartida";
const DEFAULT_FOLDER_TYPES: &str = r#"{}"#;
const LEGACY_FOLDER_TYPES: &str =
    r#"{"Peliculas":"movie","Series":"tv","Documentales":"documentary","Movies":"movie","TV Shows":"tv","Documentaries":"documentary"}"#;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppConfig {
    pub ftp_host: String,
    pub ftp_port: u16,
    pub ftp_user: String,
    pub ftp_pass: String,
    pub ftp_root: String,
    pub tmdb_api_key: String,
    pub default_language: String,
    pub download_folder: String,
    pub folder_types: String, // JSON: {"Movies": "movie", "TV Shows": "tv"}
    pub max_concurrent_downloads: u8,
    pub emby_url: String,
    pub emby_api_key: String,
    pub plex_url: String,
    pub plex_token: String,
    pub auto_check_updates: bool,
    pub updater_endpoint: String,
    pub updater_pubkey: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MediaItem {
    pub id: i64,
    pub ftp_path: String,
    pub filename: String,
    pub size_bytes: Option<i64>,
    pub title: Option<String>,
    pub year: Option<i64>,
    pub season: Option<i64>,
    pub episode: Option<i64>,
    pub episode_end: Option<i64>,
    pub resolution: Option<String>,
    pub codec: Option<String>,
    pub audio_codec: Option<String>,
    pub languages: Option<String>,
    pub hdr: Option<String>,
    pub release_type: Option<String>,
    pub release_group: Option<String>,
    pub media_type: Option<String>,
    pub tmdb_id: Option<i64>,
    pub tmdb_type: Option<String>,
    pub tmdb_title: Option<String>,
    pub tmdb_title_en: Option<String>,
    pub tmdb_year: Option<String>,
    pub tmdb_release_date: Option<String>,
    pub tmdb_overview: Option<String>,
    pub tmdb_overview_en: Option<String>,
    pub tmdb_poster: Option<String>,
    pub tmdb_poster_en: Option<String>,
    pub tmdb_rating: Option<f64>,
    pub tmdb_genres: Option<String>,
    pub indexed_at: Option<String>,
    pub metadata_at: Option<String>,
    pub manual_match: Option<i64>,
}

#[derive(Clone)]
pub struct Db(Arc<Mutex<Connection>>);

pub struct UpsertMediaResult {
    pub id: i64,
    pub needs_metadata: bool,
}

impl Db {
    fn default_folder_types() -> String {
        DEFAULT_FOLDER_TYPES.to_string()
    }

    fn normalized_folder_types(value: Option<String>) -> String {
        match value {
            Some(raw) => {
                let trimmed = raw.trim();
                if trimmed.is_empty() || trimmed == "{}" || trimmed == LEGACY_FOLDER_TYPES {
                    Self::default_folder_types()
                } else {
                    raw
                }
            }
            None => Self::default_folder_types(),
        }
    }

    fn app_data_dir() -> std::path::PathBuf {
        dirs_next::data_dir()
            .unwrap_or_else(|| std::path::PathBuf::from("."))
            .join("oscata-tauri")
    }

    fn db_path() -> std::path::PathBuf {
        Self::app_data_dir().join("library.db")
    }

    fn apply_migrations(conn: &Connection) -> SqlResult<()> {
        conn.execute_batch("PRAGMA journal_mode=WAL;")?;
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS app_config (
                key   TEXT PRIMARY KEY,
                value TEXT NOT NULL
             );
             CREATE TABLE IF NOT EXISTS media_items (
                id            INTEGER PRIMARY KEY AUTOINCREMENT,
                ftp_path      TEXT UNIQUE NOT NULL,
                filename      TEXT NOT NULL,
                size_bytes    INTEGER,
                title         TEXT,
                year          INTEGER,
                season        INTEGER,
                episode       INTEGER,
                episode_end   INTEGER,
                resolution    TEXT,
                codec         TEXT,
                audio_codec   TEXT,
                languages     TEXT,
                hdr           TEXT,
                release_type  TEXT,
                release_group TEXT,
                media_type    TEXT,
                tmdb_id       INTEGER,
                tmdb_type     TEXT,
                tmdb_title    TEXT,
                tmdb_title_en TEXT,
                tmdb_year     TEXT,
                tmdb_release_date TEXT,
                tmdb_overview TEXT,
                tmdb_poster   TEXT,
                tmdb_overview_en TEXT,
                tmdb_poster_en TEXT,
                tmdb_rating   REAL,
                tmdb_genres   TEXT,
                indexed_at    TEXT,
                metadata_at   TEXT,
                manual_match  INTEGER DEFAULT 0
             );",
        )?;
        conn.execute_batch("ALTER TABLE media_items ADD COLUMN media_type TEXT;").ok();
        conn.execute_batch("ALTER TABLE media_items ADD COLUMN tmdb_release_date TEXT;").ok();
        conn.execute_batch("ALTER TABLE media_items ADD COLUMN season INTEGER;").ok();
        conn.execute_batch("ALTER TABLE media_items ADD COLUMN episode INTEGER;").ok();
        conn.execute_batch("ALTER TABLE media_items ADD COLUMN episode_end INTEGER;").ok();
        conn.execute_batch("ALTER TABLE media_items ADD COLUMN release_type TEXT;").ok();
        conn.execute_batch("ALTER TABLE media_items ADD COLUMN release_group TEXT;").ok();
        conn.execute_batch("ALTER TABLE media_items ADD COLUMN manual_match INTEGER DEFAULT 0;").ok();
        conn.execute_batch("ALTER TABLE media_items ADD COLUMN tmdb_title_en TEXT;").ok();
        conn.execute_batch("ALTER TABLE media_items ADD COLUMN tmdb_overview_en TEXT;").ok();
        conn.execute_batch("ALTER TABLE media_items ADD COLUMN tmdb_poster_en TEXT;").ok();
        Ok(())
    }

    pub fn new() -> SqlResult<Self> {
        let data_dir = Self::app_data_dir();
        std::fs::create_dir_all(&data_dir).ok();
        let conn = Connection::open(Self::db_path())?;
        Self::apply_migrations(&conn)?;
        Ok(Self(Arc::new(Mutex::new(conn))))
    }

    fn save_app_value(&self, key: &str, value: &str) -> Result<(), String> {
        let conn = self.0.lock().unwrap();
        conn.execute(
            "INSERT OR REPLACE INTO app_config (key, value) VALUES (?1, ?2)",
            params![key, value],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    fn load_app_value(&self, key: &str) -> Result<Option<String>, String> {
        let conn = self.0.lock().unwrap();
        conn.query_row(
            "SELECT value FROM app_config WHERE key = ?1",
            params![key],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(|e| e.to_string())
    }

    fn sanitize_version_for_filename(version: &str) -> String {
        let sanitized = version
            .chars()
            .map(|ch| if ch.is_ascii_alphanumeric() { ch } else { '_' })
            .collect::<String>();
        if sanitized.is_empty() {
            "unknown".to_string()
        } else {
            sanitized
        }
    }

    pub fn prepare_for_app_version(&self, current_version: &str) -> Result<Option<String>, String> {
        let previous_version = self.load_app_value("last_app_version")?;
        match previous_version.as_deref() {
            Some(previous) if previous != current_version => {
                let backup_path = self.backup_database_for_update(previous, current_version)?;
                self.save_app_value("last_app_version", current_version)?;
                if let Some(path) = backup_path.as_deref() {
                    self.save_app_value("last_update_backup_path", path)?;
                }
                Ok(backup_path)
            }
            Some(_) => Ok(None),
            None => {
                self.save_app_value("last_app_version", current_version)?;
                Ok(None)
            }
        }
    }

    pub fn backup_database_for_update(
        &self,
        from_version: &str,
        to_version: &str,
    ) -> Result<Option<String>, String> {
        if from_version.trim().is_empty() || from_version == to_version {
            return Ok(None);
        }

        let backups_dir = Self::app_data_dir().join("backups");
        std::fs::create_dir_all(&backups_dir).map_err(|e| e.to_string())?;
        let timestamp = chrono::Utc::now().format("%Y%m%dT%H%M%SZ");
        let backup_path = backups_dir.join(format!(
            "library-{}-to-{}-{}.sqlite3",
            Self::sanitize_version_for_filename(from_version),
            Self::sanitize_version_for_filename(to_version),
            timestamp
        ));
        let escaped_path = backup_path.to_string_lossy().replace('\'', "''");

        let conn = self.0.lock().unwrap();
        conn.execute_batch(&format!("VACUUM INTO '{}';", escaped_path))
            .map_err(|e| e.to_string())?;

        Ok(Some(backup_path.to_string_lossy().to_string()))
    }

    pub fn export_database_to(&self, target_path: &str) -> Result<(), String> {
        let target = std::path::Path::new(target_path);
        if let Some(parent) = target.parent() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        if target.exists() {
            std::fs::remove_file(target).map_err(|e| e.to_string())?;
        }

        let conn = self.0.lock().unwrap();
        let mut dest = Connection::open(target).map_err(|e| e.to_string())?;
        let backup =
            rusqlite::backup::Backup::new(&conn, &mut dest).map_err(|e| e.to_string())?;
        backup
            .run_to_completion(128, std::time::Duration::from_millis(5), None)
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn import_database_from(&self, source_path: &str) -> Result<(), String> {
        let source = std::path::Path::new(source_path);
        if !source.exists() {
            return Err("Selected backup file does not exist".to_string());
        }

        let source_conn = Connection::open(source).map_err(|e| e.to_string())?;
        let mut dest_conn = self.0.lock().unwrap();
        {
            let backup = rusqlite::backup::Backup::new(&source_conn, &mut dest_conn)
                .map_err(|e| e.to_string())?;
            backup
                .run_to_completion(128, std::time::Duration::from_millis(5), None)
                .map_err(|e| e.to_string())?;
        }
        Self::apply_migrations(&dest_conn).map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn save_config(&self, config: &AppConfig) -> Result<(), String> {
        let conn = self.0.lock().unwrap();
        let pairs = [
            ("ftp_host", config.ftp_host.as_str()),
            ("ftp_user", config.ftp_user.as_str()),
            ("ftp_pass", config.ftp_pass.as_str()),
            ("ftp_root", config.ftp_root.as_str()),
            ("tmdb_api_key", config.tmdb_api_key.as_str()),
            ("default_language", config.default_language.as_str()),
            ("download_folder", config.download_folder.as_str()),
            ("folder_types", config.folder_types.as_str()),
            ("emby_url", config.emby_url.as_str()),
            ("emby_api_key", config.emby_api_key.as_str()),
            ("plex_url", config.plex_url.as_str()),
            ("plex_token", config.plex_token.as_str()),
            (
                "auto_check_updates",
                if config.auto_check_updates { "1" } else { "0" },
            ),
            ("updater_endpoint", config.updater_endpoint.as_str()),
            ("updater_pubkey", config.updater_pubkey.as_str()),
        ];
        let port_str = config.ftp_port.to_string();
        for (k, v) in &pairs {
            conn.execute(
                "INSERT OR REPLACE INTO app_config (key, value) VALUES (?1, ?2)",
                params![k, v],
            )
            .map_err(|e| e.to_string())?;
        }
        conn.execute(
            "INSERT OR REPLACE INTO app_config (key, value) VALUES ('ftp_port', ?1)",
            params![port_str],
        )
        .map_err(|e| e.to_string())?;
        conn.execute(
            "INSERT OR REPLACE INTO app_config (key, value) VALUES ('max_concurrent_downloads', ?1)",
            params![config.max_concurrent_downloads.to_string()],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn save_last_indexed_at(&self, timestamp: &str) -> Result<(), String> {
        self.save_app_value("last_indexed_at", timestamp)
    }

    pub fn load_last_indexed_at(&self) -> Result<Option<String>, String> {
        self.load_app_value("last_indexed_at")
    }

    pub fn save_download_state(&self, items: &[crate::downloads::DownloadItem]) -> Result<(), String> {
        let conn = self.0.lock().unwrap();
        let json = serde_json::to_string(items).map_err(|e| e.to_string())?;
        conn.execute(
            "INSERT OR REPLACE INTO app_config (key, value) VALUES ('downloads_state', ?1)",
            params![json],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn load_download_state(&self) -> Result<Vec<crate::downloads::DownloadItem>, String> {
        let conn = self.0.lock().unwrap();
        let json = conn
            .query_row(
                "SELECT value FROM app_config WHERE key = 'downloads_state'",
                [],
                |row| row.get::<_, String>(0),
            )
            .optional()
            .map_err(|e| e.to_string())?;

        match json {
            Some(value) => serde_json::from_str(&value).map_err(|e| e.to_string()),
            None => Ok(Vec::new()),
        }
    }

    pub fn load_config(&self) -> Result<AppConfig, String> {
        let conn = self.0.lock().unwrap();
        let get = |key: &str| -> Result<String, String> {
            conn.query_row(
                "SELECT value FROM app_config WHERE key = ?1",
                params![key],
                |row| row.get::<_, String>(0),
            )
            .map_err(|e| format!("Missing config key '{key}': {e}"))
        };
        Ok(AppConfig {
            ftp_host: get("ftp_host")?,
            ftp_port: get("ftp_port")?
                .parse()
                .map_err(|_| "Invalid ftp_port".to_string())?,
            ftp_user: get("ftp_user")?,
            ftp_pass: get("ftp_pass")?,
            ftp_root: get("ftp_root").unwrap_or_else(|_| DEFAULT_FTP_ROOT.to_string()),
            tmdb_api_key: get("tmdb_api_key")?,
            default_language: get("default_language").unwrap_or_else(|_| "es".to_string()),
            download_folder: get("download_folder").unwrap_or_default(),
            folder_types: Self::normalized_folder_types(get("folder_types").ok()),
            max_concurrent_downloads: get("max_concurrent_downloads")
                .ok()
                .and_then(|v| v.parse().ok())
                .unwrap_or(2),
            emby_url: get("emby_url").unwrap_or_default(),
            emby_api_key: get("emby_api_key").unwrap_or_default(),
            plex_url: get("plex_url").unwrap_or_default(),
            plex_token: get("plex_token").unwrap_or_default(),
            auto_check_updates: get("auto_check_updates")
                .ok()
                .map(|v| matches!(v.as_str(), "1" | "true" | "TRUE" | "True"))
                .unwrap_or(false),
            updater_endpoint: get("updater_endpoint").unwrap_or_default(),
            updater_pubkey: get("updater_pubkey").unwrap_or_default(),
        })
    }

    pub fn has_config(&self) -> Result<bool, String> {
        let conn = self.0.lock().unwrap();
        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM app_config", [], |r| r.get(0))
            .map_err(|e| e.to_string())?;
        Ok(count >= 6)
    }

    pub fn clear_app_config(&self) -> Result<(), String> {
        let conn = self.0.lock().unwrap();
        conn.execute("DELETE FROM app_config", [])
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn count_media_items(&self) -> Result<i64, String> {
        let conn = self.0.lock().unwrap();
        conn
            .query_row("SELECT COUNT(*) FROM media_items", [], |r| r.get(0))
            .map_err(|e| e.to_string())
    }

    pub fn upsert_media(
        &self,
        path: &str,
        filename: &str,
        size_bytes: Option<u64>,
        parsed: &crate::parser::ParsedMedia,
        media_type: Option<&str>,
    ) -> Result<UpsertMediaResult, String> {
        let conn = self.0.lock().unwrap();
        let now = chrono::Utc::now().to_rfc3339();
        conn.execute(
            "INSERT INTO media_items
                (ftp_path, filename, size_bytes, title, year, season, episode, episode_end,
                 resolution, codec, audio_codec, hdr, languages, release_type, release_group,
                 media_type, indexed_at)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17)
             ON CONFLICT(ftp_path) DO UPDATE SET
                filename=excluded.filename, size_bytes=excluded.size_bytes,
                title=excluded.title, year=excluded.year,
                season=excluded.season, episode=excluded.episode, episode_end=excluded.episode_end,
                resolution=excluded.resolution, codec=excluded.codec,
                audio_codec=excluded.audio_codec, hdr=excluded.hdr,
                languages=excluded.languages,
                release_type=excluded.release_type, release_group=excluded.release_group,
                media_type=COALESCE(excluded.media_type, media_items.media_type),
                indexed_at=excluded.indexed_at",
            params![
                path,
                filename,
                size_bytes.map(|s| s as i64),
                parsed.title,
                parsed.year.map(|y| y as i64),
                parsed.season.map(|s| s as i64),
                parsed.episode.map(|e| e as i64),
                parsed.episode_end.map(|e| e as i64),
                parsed.resolution,
                parsed.codec,
                parsed.audio_codec,
                parsed.hdr,
                if parsed.languages.is_empty() { None } else { Some(parsed.languages.join(",")) },
                parsed.release_type,
                parsed.release_group,
                media_type,
                now,
            ],
        )
        .map_err(|e| e.to_string())?;

        let (id, metadata_at): (i64, Option<String>) = conn
            .query_row(
                "SELECT id, metadata_at FROM media_items WHERE ftp_path = ?1",
                params![path],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .map_err(|e| e.to_string())?;
        Ok(UpsertMediaResult {
            id,
            needs_metadata: metadata_at.is_none(),
        })
    }

    fn update_tmdb_with_mode(
        &self,
        id: i64,
        movie: &crate::tmdb::TmdbMovie,
        media_type: &str,
        manual_match: bool,
    ) -> Result<(), String> {
        let conn = self.0.lock().unwrap();
        let now = chrono::Utc::now().to_rfc3339();
        let genres = serde_json::to_string(&movie.genre_ids).ok();
        conn.execute(
            "UPDATE media_items SET
                tmdb_id=?1, tmdb_type=?2, tmdb_title=?3, tmdb_title_en=?4, tmdb_year=?5,
                tmdb_release_date=?6, tmdb_overview=?7, tmdb_overview_en=?8, tmdb_poster=?9, tmdb_poster_en=?10,
                tmdb_rating=?11, tmdb_genres=?12, metadata_at=?13, manual_match=?14
             WHERE id=?15",
            params![
                movie.id,
                media_type,
                movie.title,
                movie.title_en,
                movie.release_date.as_deref().and_then(|d| d.get(..4)),
                movie.release_date,
                movie.overview,
                movie.overview_en,
                movie.poster_path,
                movie.poster_path_en,
                movie.vote_average,
                genres,
                now,
                if manual_match { 1 } else { 0 },
                id,
            ],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn update_tmdb_auto(
        &self,
        id: i64,
        movie: &crate::tmdb::TmdbMovie,
        media_type: &str,
    ) -> Result<(), String> {
        self.update_tmdb_with_mode(id, movie, media_type, false)
    }

    pub fn update_tmdb_manual(
        &self,
        id: i64,
        movie: &crate::tmdb::TmdbMovie,
        media_type: &str,
    ) -> Result<(), String> {
        self.update_tmdb_with_mode(id, movie, media_type, true)
    }

    pub fn refresh_tmdb_metadata(
        &self,
        id: i64,
        movie: &crate::tmdb::TmdbMovie,
        media_type: &str,
        manual_match: bool,
    ) -> Result<(), String> {
        self.update_tmdb_with_mode(id, movie, media_type, manual_match)
    }

    pub fn get_all_media(&self) -> Result<Vec<MediaItem>, String> {
        let conn = self.0.lock().unwrap();
        let mut stmt = conn
            .prepare("SELECT id, ftp_path, filename, size_bytes, title, year, season, episode, episode_end, \
                      resolution, codec, audio_codec, languages, hdr, release_type, release_group, \
                      media_type, tmdb_id, tmdb_type, tmdb_title, tmdb_title_en, tmdb_year, tmdb_release_date, \
                      tmdb_overview, tmdb_overview_en, tmdb_poster, tmdb_poster_en, tmdb_rating, tmdb_genres, indexed_at, metadata_at, manual_match \
                      FROM media_items ORDER BY COALESCE(tmdb_title, title, filename)")
            .map_err(|e| e.to_string())?;

        let items = stmt
            .query_map([], |row| {
                Ok(MediaItem {
                    id: row.get(0)?,
                    ftp_path: row.get(1)?,
                    filename: row.get(2)?,
                    size_bytes: row.get(3)?,
                    title: row.get(4)?,
                    year: row.get(5)?,
                    season: row.get(6)?,
                    episode: row.get(7)?,
                    episode_end: row.get(8)?,
                    resolution: row.get(9)?,
                    codec: row.get(10)?,
                    audio_codec: row.get(11)?,
                    languages: row.get(12)?,
                    hdr: row.get(13)?,
                    release_type: row.get(14)?,
                    release_group: row.get(15)?,
                    media_type: row.get(16)?,
                    tmdb_id: row.get(17)?,
                    tmdb_type: row.get(18)?,
                    tmdb_title: row.get(19)?,
                    tmdb_title_en: row.get(20)?,
                    tmdb_year: row.get(21)?,
                    tmdb_release_date: row.get(22)?,
                    tmdb_overview: row.get(23)?,
                    tmdb_overview_en: row.get(24)?,
                    tmdb_poster: row.get(25)?,
                    tmdb_poster_en: row.get(26)?,
                    tmdb_rating: row.get(27)?,
                    tmdb_genres: row.get(28)?,
                    indexed_at: row.get(29)?,
                    metadata_at: row.get(30)?,
                    manual_match: row.get(31)?,
                })
            })
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;

        Ok(items)
    }

    pub fn get_media_type_by_path(&self, ftp_path: &str) -> SqlResult<Option<String>> {
        let conn = self.0.lock().unwrap();
        conn.query_row(
            "SELECT media_type FROM media_items WHERE ftp_path = ?1 LIMIT 1",
            params![ftp_path],
            |row| row.get(0),
        ).optional()
    }

    pub fn clear_item_metadata(&self, id: i64) -> Result<(), String> {
        let conn = self.0.lock().unwrap();
        conn.execute(
            "UPDATE media_items SET
                tmdb_id=NULL, tmdb_type=NULL, tmdb_title=NULL, tmdb_year=NULL,
                tmdb_title_en=NULL, tmdb_release_date=NULL, tmdb_overview=NULL, tmdb_overview_en=NULL, tmdb_poster=NULL, tmdb_poster_en=NULL,
                tmdb_rating=NULL, tmdb_genres=NULL, metadata_at=NULL, manual_match=0
             WHERE id=?1",
            params![id],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn clear_all_metadata(&self) -> Result<usize, String> {
        let conn = self.0.lock().unwrap();
        let count = conn.execute(
            "UPDATE media_items SET
                tmdb_id=NULL, tmdb_type=NULL, tmdb_title=NULL, tmdb_year=NULL,
                tmdb_title_en=NULL, tmdb_release_date=NULL, tmdb_overview=NULL, tmdb_overview_en=NULL, tmdb_poster=NULL, tmdb_poster_en=NULL,
                tmdb_rating=NULL, tmdb_genres=NULL, metadata_at=NULL
             WHERE COALESCE(manual_match, 0) = 0",
            [],
        )
        .map_err(|e| e.to_string())?;
        Ok(count)
    }

    /// Clear metadata for all items sharing the same tmdb_id (all episodes of a show)
    pub fn clear_show_metadata(&self, tmdb_id: i64) -> Result<usize, String> {
        let conn = self.0.lock().unwrap();
        let count = conn.execute(
            "UPDATE media_items SET
                tmdb_id=NULL, tmdb_type=NULL, tmdb_title=NULL, tmdb_year=NULL,
                tmdb_title_en=NULL, tmdb_release_date=NULL, tmdb_overview=NULL, tmdb_overview_en=NULL, tmdb_poster=NULL, tmdb_poster_en=NULL,
                tmdb_rating=NULL, tmdb_genres=NULL, metadata_at=NULL, manual_match=0
             WHERE tmdb_id=?1",
            params![tmdb_id],
        )
        .map_err(|e| e.to_string())?;
        Ok(count)
    }
}
