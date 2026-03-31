use rusqlite::{params, Connection, OptionalExtension, Result as SqlResult};
use serde::{Deserialize, Serialize};
use std::sync::{Arc, Mutex};
use chrono::Datelike;

const DEFAULT_FTP_ROOT: &str = "/Compartida";
const DEFAULT_FOLDER_TYPES: &str =
    r#"{"Documentales 4K 2160p - HD 1080p":"documentary","P-Peticiones":"mixed","Peliculas BDRemux 1080p":"movie","Peliculas BDrip 1080p X264":"movie","Peliculas BDrip 1080p X265":"movie","Peliculas UHDRemux 2160p":"movie","Peliculas WEB DL Micro 1080p":"movie","Peliculas WEB DL-UHDRip 2160p":"movie","Peliculas y Series mas antiguas":"mixed","Series 4K 2160p":"tv","Series HD 1080p":"tv","Series HD 1080p X265":"tv"}"#;
const LEGACY_FOLDER_TYPES: &str =
    r#"{"Peliculas":"movie","Series":"tv","Documentales":"documentary","Movies":"movie","TV Shows":"tv","Documentaries":"documentary"}"#;
const REMOVED_FOLDER_TYPE_KEYS: &[&str] = &[
    "Peliculas",
    "Series",
    "Documentales",
    "Movies",
    "Documentaries",
    "TV Shows",
];
const DEFAULT_WEBGUI_HOST: &str = "0.0.0.0";
const DEFAULT_WEBGUI_PORT: u16 = 47860;
const DEFAULT_SMTP_PORT: u16 = 587;
const SESSION_EXPIRY_DAYS: i64 = 7;
const INVITE_EXPIRY_DAYS: i64 = 7;
const OTP_EXPIRY_MINUTES: i64 = 5;
const OTP_MAX_ATTEMPTS: i64 = 5;

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
pub struct WebGuiConfig {
    pub enabled: bool,
    pub host: String,
    pub port: u16,
    pub exposed_port: Option<u16>,
    pub app_url: String,
    pub otp_enabled: bool,
    pub smtp_host: String,
    pub smtp_port: u16,
    pub smtp_user: String,
    pub smtp_pass: String,
    pub smtp_from: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WebUser {
    pub id: i64,
    pub email: String,
    pub role: String,
    pub is_active: bool,
    pub created_at: String,
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
    pub imdb_id: Option<String>,
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
    pub is_new: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppliedMigration {
    pub id: String,
    pub applied_at: String,
}

impl Db {
    fn default_folder_types() -> String {
        DEFAULT_FOLDER_TYPES.to_string()
    }

    fn merged_folder_types(raw: &str) -> String {
        let defaults = serde_json::from_str::<std::collections::HashMap<String, String>>(
            DEFAULT_FOLDER_TYPES,
        )
        .unwrap_or_default();
        let parsed = serde_json::from_str::<std::collections::HashMap<String, String>>(raw)
            .unwrap_or_default();
        let parsed = parsed
            .into_iter()
            .filter(|(key, _)| !REMOVED_FOLDER_TYPE_KEYS.contains(&key.as_str()));
        let merged = defaults
            .into_iter()
            .chain(parsed)
            .collect::<std::collections::HashMap<_, _>>();
        serde_json::to_string(&merged).unwrap_or_else(|_| Self::default_folder_types())
    }

    fn normalized_folder_types(value: Option<String>) -> String {
        match value {
            Some(raw) => {
                let trimmed = raw.trim();
                if trimmed.is_empty() || trimmed == "{}" || trimmed == LEGACY_FOLDER_TYPES {
                    Self::default_folder_types()
                } else {
                    Self::merged_folder_types(&raw)
                }
            }
            None => Self::default_folder_types(),
        }
    }

    fn migrate_old_folder_type_mapping(conn: &Connection) {
        let raw: Option<String> = conn
            .query_row(
                "SELECT value FROM app_config WHERE key = 'folder_types' LIMIT 1",
                [],
                |row| row.get(0),
            )
            .optional()
            .ok()
            .flatten();

        let Some(raw) = raw else {
            return;
        };

        let mut parsed = serde_json::from_str::<std::collections::HashMap<String, String>>(&raw)
            .unwrap_or_default();
        let key = "Peliculas y Series mas antiguas";
        let needs_update = parsed
            .get(key)
            .map(|value| !value.eq_ignore_ascii_case("mixed"))
            .unwrap_or(false);

        if !needs_update {
            return;
        }

        parsed.insert(key.to_string(), "mixed".to_string());
        if let Ok(serialized) = serde_json::to_string(&parsed) {
            conn.execute(
                "INSERT OR REPLACE INTO app_config (key, value) VALUES ('folder_types', ?1)",
                params![serialized],
            )
            .ok();
        }
    }

    fn repair_future_indexed_timestamps(conn: &Connection) {
        let now = chrono::Utc::now();
        let future_threshold = now + chrono::Duration::days(1);

        let mut stmt = match conn.prepare(
            "SELECT id, indexed_at FROM media_items WHERE indexed_at IS NOT NULL",
        ) {
            Ok(stmt) => stmt,
            Err(_) => return,
        };

        let rows = match stmt.query_map([], |row| {
            Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?))
        }) {
            Ok(rows) => rows,
            Err(_) => return,
        };

        let mut updates: Vec<(i64, String)> = Vec::new();
        for row in rows.flatten() {
            let (id, indexed_at) = row;
            let parsed = match chrono::DateTime::parse_from_rfc3339(&indexed_at) {
                Ok(value) => value.with_timezone(&chrono::Utc),
                Err(_) => continue,
            };

            if parsed > future_threshold {
                let normalized = if let Some(value) = parsed.with_year(parsed.year() - 1) {
                    value
                } else {
                    parsed - chrono::Duration::days(365)
                };
                updates.push((id, normalized.to_rfc3339()));
            }
        }

        let mut update_stmt = match conn.prepare("UPDATE media_items SET indexed_at = ?1 WHERE id = ?2") {
            Ok(stmt) => stmt,
            Err(_) => return,
        };

        for (id, normalized) in updates {
            update_stmt.execute(params![normalized, id]).ok();
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
                 CREATE TABLE IF NOT EXISTS schema_migrations (
                     id         TEXT PRIMARY KEY,
                     applied_at TEXT NOT NULL
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
                imdb_id       TEXT,
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
        conn.execute_batch("ALTER TABLE media_items ADD COLUMN imdb_id TEXT;").ok();
        // Web GUI auth tables
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS web_users (
                id            INTEGER PRIMARY KEY AUTOINCREMENT,
                email         TEXT UNIQUE NOT NULL,
                password_hash TEXT NOT NULL,
                role          TEXT NOT NULL DEFAULT 'viewer',
                is_active     INTEGER NOT NULL DEFAULT 1,
                created_at    TEXT NOT NULL
             );
             CREATE TABLE IF NOT EXISTS web_sessions (
                id         TEXT PRIMARY KEY,
                user_id    INTEGER NOT NULL,
                expires_at TEXT NOT NULL,
                created_at TEXT NOT NULL,
                FOREIGN KEY (user_id) REFERENCES web_users(id) ON DELETE CASCADE
             );
             CREATE TABLE IF NOT EXISTS web_otp_challenges (
                id         TEXT PRIMARY KEY,
                user_id    INTEGER NOT NULL,
                code       TEXT NOT NULL,
                expires_at TEXT NOT NULL,
                attempts   INTEGER NOT NULL DEFAULT 0,
                FOREIGN KEY (user_id) REFERENCES web_users(id) ON DELETE CASCADE
                 );
                 CREATE TABLE IF NOT EXISTS web_invites (
                     id         TEXT PRIMARY KEY,
                     email      TEXT,
                     role       TEXT NOT NULL,
                     expires_at TEXT NOT NULL,
                     used_at    TEXT,
                     created_at TEXT NOT NULL
             );",
        ).ok();

        // Folder type migration: this directory contains mixed content and should
        // no longer be treated as movie-only in older persisted configs.
        Self::migrate_old_folder_type_mapping(conn);

        // Data repair for old installs: episodic entries that were saved as movie
        // should be categorized as TV so they render in the correct tab.
        conn.execute(
            "UPDATE media_items
             SET media_type = 'tv',
                 tmdb_type = CASE
                     WHEN tmdb_type IS NULL OR tmdb_type = '' OR tmdb_type = 'movie' THEN 'tv'
                     ELSE tmdb_type
                 END
             WHERE (season IS NOT NULL OR episode IS NOT NULL OR episode_end IS NOT NULL)
               AND (media_type = 'movie' OR media_type IS NULL OR media_type = '')",
            [],
        )
        .ok();

        // Data repair for clock-skewed FTP dates previously persisted into indexed_at.
        // Rule: if indexed_at is in the future, subtract one year.
        Self::repair_future_indexed_timestamps(conn);
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

    pub fn list_applied_migrations(&self) -> Result<Vec<AppliedMigration>, String> {
        let conn = self.0.lock().unwrap();
        let mut stmt = conn
            .prepare("SELECT id, applied_at FROM schema_migrations ORDER BY applied_at ASC, id ASC")
            .map_err(|e| e.to_string())?;

        let rows = stmt
            .query_map([], |row| {
                Ok(AppliedMigration {
                    id: row.get(0)?,
                    applied_at: row.get(1)?,
                })
            })
            .map_err(|e| e.to_string())?;

        let mut out = Vec::new();
        for row in rows {
            out.push(row.map_err(|e| e.to_string())?);
        }
        Ok(out)
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

    fn escape_sqlite_path(path: &std::path::Path) -> String {
        path.to_string_lossy().replace('\'', "''")
    }

    fn migration_applied(conn: &Connection, migration_id: &str) -> Result<bool, String> {
        conn.query_row(
            "SELECT 1 FROM schema_migrations WHERE id = ?1 LIMIT 1",
            params![migration_id],
            |_row| Ok(()),
        )
        .optional()
        .map(|row| row.is_some())
        .map_err(|e| e.to_string())
    }

    fn mark_migration_applied(conn: &Connection, migration_id: &str) -> Result<(), String> {
        let now = chrono::Utc::now().to_rfc3339();
        conn.execute(
            "INSERT OR IGNORE INTO schema_migrations (id, applied_at) VALUES (?1, ?2)",
            params![migration_id, now],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
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

    pub fn backfill_imdb_ids_from_seed(
        &self,
        seed_path: &std::path::Path,
        app_version: &str,
    ) -> Result<usize, String> {
        if !seed_path.exists() {
            return Ok(0);
        }

        let escaped_seed_path = Self::escape_sqlite_path(seed_path);
        let conn = self.0.lock().unwrap();
        let migration_id = format!("seed:backfill-imdb:{app_version}");

        if Self::migration_applied(&conn, &migration_id)? {
            return Ok(0);
        }

        conn.execute_batch(&format!("ATTACH '{}' AS seed;", escaped_seed_path))
            .map_err(|e| e.to_string())?;

        let result: Result<usize, String> = (|| {
            let mut stmt = conn
                .prepare("PRAGMA seed.table_info(media_items)")
                .map_err(|e| e.to_string())?;
            let source_has_imdb = stmt
                .query_map([], |row| row.get::<_, String>(1))
                .map_err(|e| e.to_string())?
                .filter_map(Result::ok)
                .any(|name| name == "imdb_id");

            if !source_has_imdb {
                return Ok(0);
            }

            conn.execute(
                "UPDATE media_items AS local
                 SET imdb_id = (
                     SELECT src.imdb_id
                     FROM seed.media_items src
                     WHERE src.ftp_path = local.ftp_path
                 )
                 WHERE (local.imdb_id IS NULL OR TRIM(local.imdb_id) = '')
                   AND EXISTS (
                       SELECT 1
                       FROM seed.media_items src
                       WHERE src.ftp_path = local.ftp_path
                         AND src.imdb_id IS NOT NULL
                         AND TRIM(src.imdb_id) <> ''
                   )",
                [],
            )
            .map_err(|e| e.to_string())
        })();

        conn.execute_batch("DETACH seed;").ok();
        let updated = result?;
        Self::mark_migration_applied(&conn, &migration_id)?;
        Ok(updated)
    }

    pub fn refresh_library_from_seed(
        &self,
        seed_path: &std::path::Path,
        app_version: &str,
    ) -> Result<(usize, usize), String> {
        if !seed_path.exists() {
            return Ok((0, 0));
        }

        let refresh_key = format!("seed_library_refreshed_for_{}", app_version);
        let migration_id = format!("seed:refresh-library:{app_version}");

        let escaped_seed_path = Self::escape_sqlite_path(seed_path);
        let conn = self.0.lock().unwrap();

        if Self::migration_applied(&conn, &migration_id)? {
            return Ok((0, 0));
        }
        // Backward compatibility with older app_config-based gating.
        let legacy_done = conn
            .query_row(
                "SELECT value FROM app_config WHERE key = ?1",
                params![refresh_key],
                |row| row.get::<_, String>(0),
            )
            .optional()
            .map_err(|e| e.to_string())?
            .as_deref()
            .map(|value| value == "1")
            .unwrap_or(false);
        if legacy_done {
            Self::mark_migration_applied(&conn, &migration_id)?;
            return Ok((0, 0));
        }

        conn.execute_batch(&format!("ATTACH '{}' AS seed;", escaped_seed_path))
            .map_err(|e| e.to_string())?;

        let result: Result<(usize, usize), String> = (|| {
            let seed_has_media = conn
                .query_row(
                    "SELECT 1 FROM seed.sqlite_master WHERE type='table' AND name='media_items' LIMIT 1",
                    [],
                    |_row| Ok(()),
                )
                .optional()
                .map_err(|e| e.to_string())?
                .is_some();

            if !seed_has_media {
                return Ok((0, 0));
            }

            let inserted = conn
                .execute(
                    "INSERT INTO media_items (
                        ftp_path, filename, size_bytes, title, year, season, episode, episode_end,
                        resolution, codec, audio_codec, languages, hdr, release_type, release_group,
                        media_type, tmdb_id, imdb_id, tmdb_type, tmdb_title, tmdb_title_en, tmdb_year,
                        tmdb_release_date, tmdb_overview, tmdb_overview_en, tmdb_poster, tmdb_poster_en,
                        tmdb_rating, tmdb_genres, indexed_at, metadata_at, manual_match
                    )
                    SELECT
                        src.ftp_path, src.filename, src.size_bytes, src.title, src.year, src.season, src.episode, src.episode_end,
                        src.resolution, src.codec, src.audio_codec, src.languages, src.hdr, src.release_type, src.release_group,
                        src.media_type, src.tmdb_id, src.imdb_id, src.tmdb_type, src.tmdb_title, src.tmdb_title_en, src.tmdb_year,
                        src.tmdb_release_date, src.tmdb_overview, src.tmdb_overview_en, src.tmdb_poster, src.tmdb_poster_en,
                        src.tmdb_rating, src.tmdb_genres, src.indexed_at, src.metadata_at, COALESCE(src.manual_match, 0)
                    FROM seed.media_items src
                    WHERE NOT EXISTS (
                        SELECT 1 FROM media_items local WHERE local.ftp_path = src.ftp_path
                    )",
                    [],
                )
                .map_err(|e| e.to_string())?;

            let merged = conn
                .execute(
                    "UPDATE media_items
                    SET
                        imdb_id = COALESCE(NULLIF(TRIM(imdb_id), ''), (
                            SELECT NULLIF(TRIM(src.imdb_id), '')
                            FROM seed.media_items src
                            WHERE src.ftp_path = media_items.ftp_path
                        )),
                        indexed_at = COALESCE(NULLIF(TRIM(indexed_at), ''), (
                            SELECT NULLIF(TRIM(src.indexed_at), '')
                            FROM seed.media_items src
                            WHERE src.ftp_path = media_items.ftp_path
                        )),
                        media_type = COALESCE(NULLIF(TRIM(media_type), ''), (
                            SELECT NULLIF(TRIM(src.media_type), '')
                            FROM seed.media_items src
                            WHERE src.ftp_path = media_items.ftp_path
                        )),
                        tmdb_type = COALESCE(NULLIF(TRIM(tmdb_type), ''), (
                            SELECT NULLIF(TRIM(src.tmdb_type), '')
                            FROM seed.media_items src
                            WHERE src.ftp_path = media_items.ftp_path
                        )),
                        tmdb_id = COALESCE(tmdb_id, (
                            SELECT src.tmdb_id
                            FROM seed.media_items src
                            WHERE src.ftp_path = media_items.ftp_path
                        )),
                        tmdb_title = COALESCE(NULLIF(TRIM(tmdb_title), ''), (
                            SELECT NULLIF(TRIM(src.tmdb_title), '')
                            FROM seed.media_items src
                            WHERE src.ftp_path = media_items.ftp_path
                        )),
                        tmdb_title_en = COALESCE(NULLIF(TRIM(tmdb_title_en), ''), (
                            SELECT NULLIF(TRIM(src.tmdb_title_en), '')
                            FROM seed.media_items src
                            WHERE src.ftp_path = media_items.ftp_path
                        )),
                        tmdb_release_date = COALESCE(NULLIF(TRIM(tmdb_release_date), ''), (
                            SELECT NULLIF(TRIM(src.tmdb_release_date), '')
                            FROM seed.media_items src
                            WHERE src.ftp_path = media_items.ftp_path
                        )),
                        tmdb_overview = COALESCE(NULLIF(TRIM(tmdb_overview), ''), (
                            SELECT NULLIF(TRIM(src.tmdb_overview), '')
                            FROM seed.media_items src
                            WHERE src.ftp_path = media_items.ftp_path
                        )),
                        tmdb_overview_en = COALESCE(NULLIF(TRIM(tmdb_overview_en), ''), (
                            SELECT NULLIF(TRIM(src.tmdb_overview_en), '')
                            FROM seed.media_items src
                            WHERE src.ftp_path = media_items.ftp_path
                        )),
                        tmdb_poster = COALESCE(NULLIF(TRIM(tmdb_poster), ''), (
                            SELECT NULLIF(TRIM(src.tmdb_poster), '')
                            FROM seed.media_items src
                            WHERE src.ftp_path = media_items.ftp_path
                        )),
                        tmdb_poster_en = COALESCE(NULLIF(TRIM(tmdb_poster_en), ''), (
                            SELECT NULLIF(TRIM(src.tmdb_poster_en), '')
                            FROM seed.media_items src
                            WHERE src.ftp_path = media_items.ftp_path
                        )),
                        tmdb_rating = COALESCE(tmdb_rating, (
                            SELECT src.tmdb_rating
                            FROM seed.media_items src
                            WHERE src.ftp_path = media_items.ftp_path
                        )),
                        tmdb_genres = COALESCE(NULLIF(TRIM(tmdb_genres), ''), (
                            SELECT NULLIF(TRIM(src.tmdb_genres), '')
                            FROM seed.media_items src
                            WHERE src.ftp_path = media_items.ftp_path
                        )),
                        metadata_at = COALESCE(NULLIF(TRIM(metadata_at), ''), (
                            SELECT NULLIF(TRIM(src.metadata_at), '')
                            FROM seed.media_items src
                            WHERE src.ftp_path = media_items.ftp_path
                        ))
                    WHERE EXISTS (
                        SELECT 1 FROM seed.media_items src WHERE src.ftp_path = media_items.ftp_path
                    )",
                    [],
                )
                .map_err(|e| e.to_string())?;

            Ok((inserted, merged))
        })();

        conn.execute_batch("DETACH seed;").ok();
        let (inserted, merged) = result?;

        Self::mark_migration_applied(&conn, &migration_id)?;
        conn.execute(
            "INSERT OR REPLACE INTO app_config (key, value) VALUES (?1, '1')",
            params![refresh_key],
        )
        .map_err(|e| e.to_string())?;

        Ok((inserted, merged))
    }

    /// Override TMDB metadata for all matching items from the bundled seed database.
    /// Unlike `refresh_library_from_seed`, this unconditionally replaces seed-sourced
    /// fields even when the local row already has values. Runs once per app version,
    /// tracked by the `schema_migrations` table.
    pub fn override_library_from_seed(
        &self,
        seed_path: &std::path::Path,
        app_version: &str,
    ) -> Result<(usize, usize), String> {
        if !seed_path.exists() {
            return Ok((0, 0));
        }

        let migration_id = format!("seed:override-library:{app_version}");
        let escaped_seed_path = Self::escape_sqlite_path(seed_path);
        let conn = self.0.lock().unwrap();

        if Self::migration_applied(&conn, &migration_id)? {
            return Ok((0, 0));
        }

        conn.execute_batch(&format!("ATTACH '{}' AS seed;", escaped_seed_path))
            .map_err(|e| e.to_string())?;

        let result: Result<(usize, usize), String> = (|| {
            let seed_has_media = conn
                .query_row(
                    "SELECT 1 FROM seed.sqlite_master WHERE type='table' AND name='media_items' LIMIT 1",
                    [],
                    |_row| Ok(()),
                )
                .optional()
                .map_err(|e| e.to_string())?
                .is_some();

            if !seed_has_media {
                return Ok((0, 0));
            }

            // Insert items from seed that are not yet in the local library.
            let inserted = conn
                .execute(
                    "INSERT INTO media_items (
                        ftp_path, filename, size_bytes, title, year, season, episode, episode_end,
                        resolution, codec, audio_codec, languages, hdr, release_type, release_group,
                        media_type, tmdb_id, imdb_id, tmdb_type, tmdb_title, tmdb_title_en, tmdb_year,
                        tmdb_release_date, tmdb_overview, tmdb_overview_en, tmdb_poster, tmdb_poster_en,
                        tmdb_rating, tmdb_genres, indexed_at, metadata_at, manual_match
                    )
                    SELECT
                        src.ftp_path, src.filename, src.size_bytes, src.title, src.year,
                        src.season, src.episode, src.episode_end,
                        src.resolution, src.codec, src.audio_codec, src.languages, src.hdr,
                        src.release_type, src.release_group,
                        src.media_type, src.tmdb_id, src.imdb_id, src.tmdb_type,
                        src.tmdb_title, src.tmdb_title_en, src.tmdb_year,
                        src.tmdb_release_date, src.tmdb_overview, src.tmdb_overview_en,
                        src.tmdb_poster, src.tmdb_poster_en,
                        src.tmdb_rating, src.tmdb_genres, src.indexed_at, src.metadata_at,
                        COALESCE(src.manual_match, 0)
                    FROM seed.media_items src
                    WHERE NOT EXISTS (
                        SELECT 1 FROM media_items local WHERE local.ftp_path = src.ftp_path
                    )",
                    [],
                )
                .map_err(|e| e.to_string())?;

            // Unconditionally override TMDB-sourced metadata for existing items.
            // Preserves user data: ftp_path, filename, size_bytes, indexed_at, manual_match,
            // and parsed fields (title, year, season, episode, resolution, codec, etc.).
            let overridden = conn
                .execute(
                    "UPDATE media_items
                    SET
                        imdb_id        = COALESCE((SELECT NULLIF(TRIM(src.imdb_id), '')        FROM seed.media_items src WHERE src.ftp_path = media_items.ftp_path), imdb_id),
                        media_type     = COALESCE((SELECT NULLIF(TRIM(src.media_type), '')     FROM seed.media_items src WHERE src.ftp_path = media_items.ftp_path), media_type),
                        tmdb_id        = COALESCE((SELECT src.tmdb_id                          FROM seed.media_items src WHERE src.ftp_path = media_items.ftp_path AND src.tmdb_id IS NOT NULL), tmdb_id),
                        tmdb_type      = COALESCE((SELECT NULLIF(TRIM(src.tmdb_type), '')      FROM seed.media_items src WHERE src.ftp_path = media_items.ftp_path), tmdb_type),
                        tmdb_title     = COALESCE((SELECT NULLIF(TRIM(src.tmdb_title), '')     FROM seed.media_items src WHERE src.ftp_path = media_items.ftp_path), tmdb_title),
                        tmdb_title_en  = COALESCE((SELECT NULLIF(TRIM(src.tmdb_title_en), '') FROM seed.media_items src WHERE src.ftp_path = media_items.ftp_path), tmdb_title_en),
                        tmdb_release_date = COALESCE((SELECT NULLIF(TRIM(src.tmdb_release_date), '') FROM seed.media_items src WHERE src.ftp_path = media_items.ftp_path), tmdb_release_date),
                        tmdb_overview  = COALESCE((SELECT NULLIF(TRIM(src.tmdb_overview), '')  FROM seed.media_items src WHERE src.ftp_path = media_items.ftp_path), tmdb_overview),
                        tmdb_overview_en = COALESCE((SELECT NULLIF(TRIM(src.tmdb_overview_en), '') FROM seed.media_items src WHERE src.ftp_path = media_items.ftp_path), tmdb_overview_en),
                        tmdb_poster    = COALESCE((SELECT NULLIF(TRIM(src.tmdb_poster), '')    FROM seed.media_items src WHERE src.ftp_path = media_items.ftp_path), tmdb_poster),
                        tmdb_poster_en = COALESCE((SELECT NULLIF(TRIM(src.tmdb_poster_en), '') FROM seed.media_items src WHERE src.ftp_path = media_items.ftp_path), tmdb_poster_en),
                        tmdb_rating    = COALESCE((SELECT src.tmdb_rating                      FROM seed.media_items src WHERE src.ftp_path = media_items.ftp_path AND src.tmdb_rating IS NOT NULL), tmdb_rating),
                        tmdb_genres    = COALESCE((SELECT NULLIF(TRIM(src.tmdb_genres), '')    FROM seed.media_items src WHERE src.ftp_path = media_items.ftp_path), tmdb_genres),
                        metadata_at    = COALESCE((SELECT NULLIF(TRIM(src.metadata_at), '')    FROM seed.media_items src WHERE src.ftp_path = media_items.ftp_path), metadata_at)
                    WHERE EXISTS (
                        SELECT 1 FROM seed.media_items src WHERE src.ftp_path = media_items.ftp_path
                    )",
                    [],
                )
                .map_err(|e| e.to_string())?;

            Ok((inserted, overridden))
        })();

        conn.execute_batch("DETACH seed;").ok();
        let (inserted, overridden) = result?;
        Self::mark_migration_applied(&conn, &migration_id)?;
        Ok((inserted, overridden))
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

    // ── WebGUI config ──────────────────────────────────────────────────────

    pub fn save_webgui_config(&self, c: &WebGuiConfig) -> Result<(), String> {
        let host = c.host.trim();
        if host.is_empty() { return Err("WEBGUI host cannot be empty".into()); }
        if c.port == 0 { return Err("WEBGUI port must be > 0".into()); }
        self.save_app_value("webgui_enabled",  if c.enabled { "1" } else { "0" })?;
        self.save_app_value("webgui_host",     host)?;
        self.save_app_value("webgui_port",     &c.port.to_string())?;
        self.save_app_value("webgui_exposed_port", &c.exposed_port.map(|p| p.to_string()).unwrap_or_default())?;
        self.save_app_value("webgui_app_url",  &c.app_url)?;
        self.save_app_value("webgui_otp_enabled", if c.otp_enabled { "1" } else { "0" })?;
        self.save_app_value("webgui_smtp_host", &c.smtp_host)?;
        self.save_app_value("webgui_smtp_port", &c.smtp_port.to_string())?;
        self.save_app_value("webgui_smtp_user", &c.smtp_user)?;
        self.save_app_value("webgui_smtp_pass", &c.smtp_pass)?;
        self.save_app_value("webgui_smtp_from", &c.smtp_from)?;
        Ok(())
    }

    pub fn load_webgui_config(&self) -> Result<WebGuiConfig, String> {
        let bool_val = |key: &str| -> bool {
            self.load_app_value(key).ok().flatten()
                .map(|v| matches!(v.as_str(), "1" | "true" | "TRUE" | "True"))
                .unwrap_or(false)
        };
        let str_val = |key: &str| -> String {
            self.load_app_value(key).ok().flatten().unwrap_or_default()
        };
        let port_val = |key: &str, default: u16| -> u16 {
            self.load_app_value(key).ok().flatten()
                .and_then(|v| v.parse::<u16>().ok()).filter(|&p| p > 0)
                .unwrap_or(default)
        };
        let host = str_val("webgui_host");
        let exposed_port_str = str_val("webgui_exposed_port");
        Ok(WebGuiConfig {
            enabled:      bool_val("webgui_enabled"),
            host:         if host.is_empty() { DEFAULT_WEBGUI_HOST.into() } else { host },
            port:         port_val("webgui_port", DEFAULT_WEBGUI_PORT),
            exposed_port: exposed_port_str.parse::<u16>().ok().filter(|&p| p > 0),
            app_url:      str_val("webgui_app_url"),
            otp_enabled:  bool_val("webgui_otp_enabled"),
            smtp_host:    str_val("webgui_smtp_host"),
            smtp_port:    port_val("webgui_smtp_port", DEFAULT_SMTP_PORT),
            smtp_user:    str_val("webgui_smtp_user"),
            smtp_pass:    str_val("webgui_smtp_pass"),
            smtp_from:    str_val("webgui_smtp_from"),
        })
    }

    // ── Web auth ───────────────────────────────────────────────────────────

    pub fn web_user_count(&self) -> Result<i64, String> {
        let conn = self.0.lock().unwrap();
        conn.query_row("SELECT COUNT(*) FROM web_users", [], |r| r.get(0))
            .map_err(|e| e.to_string())
    }

    pub fn create_web_user(&self, email: &str, hash: &str, role: &str) -> Result<WebUser, String> {
        let conn = self.0.lock().unwrap();
        let now = chrono::Utc::now().to_rfc3339();
        conn.execute(
            "INSERT INTO web_users (email, password_hash, role, is_active, created_at) VALUES (?1,?2,?3,1,?4)",
            params![email.trim().to_lowercase(), hash, role, now],
        ).map_err(|e| e.to_string())?;
        let id = conn.last_insert_rowid();
        Ok(WebUser { id, email: email.trim().to_lowercase(), role: role.into(), is_active: true, created_at: now })
    }

    pub fn get_web_user_by_email(&self, email: &str) -> Result<Option<(WebUser, String)>, String> {
        let conn = self.0.lock().unwrap();
        conn.query_row(
            "SELECT id, email, role, is_active, created_at, password_hash FROM web_users WHERE email = ?1",
            params![email.trim().to_lowercase()],
            |r| Ok((
                WebUser { id: r.get(0)?, email: r.get(1)?, role: r.get(2)?,
                    is_active: r.get::<_, i64>(3)? != 0, created_at: r.get(4)? },
                r.get::<_, String>(5)?,
            )),
        ).optional().map_err(|e| e.to_string())
    }

    pub fn list_web_users(&self) -> Result<Vec<WebUser>, String> {
        let conn = self.0.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, email, role, is_active, created_at FROM web_users ORDER BY id"
        ).map_err(|e| e.to_string())?;
        let users = stmt.query_map([], |r| Ok(WebUser {
            id: r.get(0)?, email: r.get(1)?, role: r.get(2)?,
            is_active: r.get::<_, i64>(3)? != 0, created_at: r.get(4)?,
        })).map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())?;
        Ok(users)
    }

    pub fn update_web_user(
        &self, id: i64,
        email: Option<&str>, hash: Option<&str>, role: Option<&str>, is_active: Option<bool>,
    ) -> Result<(), String> {
        let conn = self.0.lock().unwrap();
        if let Some(e) = email {
            conn.execute("UPDATE web_users SET email=?1 WHERE id=?2",
                params![e.trim().to_lowercase(), id]).map_err(|e| e.to_string())?;
        }
        if let Some(h) = hash {
            conn.execute("UPDATE web_users SET password_hash=?1 WHERE id=?2",
                params![h, id]).map_err(|e| e.to_string())?;
        }
        if let Some(r) = role {
            conn.execute("UPDATE web_users SET role=?1 WHERE id=?2",
                params![r, id]).map_err(|e| e.to_string())?;
        }
        if let Some(a) = is_active {
            conn.execute("UPDATE web_users SET is_active=?1 WHERE id=?2",
                params![if a { 1i64 } else { 0 }, id]).map_err(|e| e.to_string())?;
        }
        Ok(())
    }

    pub fn delete_web_user(&self, id: i64) -> Result<(), String> {
        let conn = self.0.lock().unwrap();
        conn.execute("DELETE FROM web_users WHERE id=?1", params![id])
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    // Sessions

    pub fn create_web_session(&self, user_id: i64, token: &str) -> Result<(), String> {
        let conn = self.0.lock().unwrap();
        let now = chrono::Utc::now();
        let expires = (now + chrono::Duration::days(SESSION_EXPIRY_DAYS)).to_rfc3339();
        conn.execute(
            "INSERT INTO web_sessions (id, user_id, expires_at, created_at) VALUES (?1,?2,?3,?4)",
            params![token, user_id, expires, now.to_rfc3339()],
        ).map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn validate_web_session(&self, token: &str) -> Result<Option<WebUser>, String> {
        let conn = self.0.lock().unwrap();
        let now = chrono::Utc::now().to_rfc3339();
        conn.query_row(
            "SELECT u.id, u.email, u.role, u.is_active, u.created_at
             FROM web_sessions s JOIN web_users u ON u.id = s.user_id
             WHERE s.id = ?1 AND s.expires_at > ?2 AND u.is_active = 1",
            params![token, now],
            |r| Ok(WebUser {
                id: r.get(0)?, email: r.get(1)?, role: r.get(2)?,
                is_active: r.get::<_, i64>(3)? != 0, created_at: r.get(4)?,
            }),
        ).optional().map_err(|e| e.to_string())
    }

    pub fn revoke_web_session(&self, token: &str) -> Result<(), String> {
        let conn = self.0.lock().unwrap();
        conn.execute("DELETE FROM web_sessions WHERE id=?1", params![token])
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn cleanup_expired_sessions(&self) -> Result<(), String> {
        let conn = self.0.lock().unwrap();
        let now = chrono::Utc::now().to_rfc3339();
        conn.execute("DELETE FROM web_sessions WHERE expires_at <= ?1", params![now])
            .map_err(|e| e.to_string())?;
        conn.execute("DELETE FROM web_otp_challenges WHERE expires_at <= ?1", params![now])
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    // OTP challenges

    pub fn create_otp_challenge(&self, user_id: i64, code: &str) -> Result<String, String> {
        let conn = self.0.lock().unwrap();
        let id = uuid::Uuid::new_v4().to_string();
        let expires = (chrono::Utc::now() + chrono::Duration::minutes(OTP_EXPIRY_MINUTES)).to_rfc3339();
        conn.execute(
            "INSERT INTO web_otp_challenges (id, user_id, code, expires_at, attempts) VALUES (?1,?2,?3,?4,0)",
            params![id, user_id, code, expires],
        ).map_err(|e| e.to_string())?;
        Ok(id)
    }

    pub fn verify_otp_challenge(&self, challenge_id: &str, code: &str) -> Result<Option<i64>, String> {
        let conn = self.0.lock().unwrap();
        let now = chrono::Utc::now().to_rfc3339();
        let row: Option<(i64, String, i64)> = conn.query_row(
            "SELECT user_id, code, attempts FROM web_otp_challenges WHERE id=?1 AND expires_at > ?2",
            params![challenge_id, now],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        ).optional().map_err(|e| e.to_string())?;

        match row {
            None => Ok(None),
            Some((user_id, stored_code, attempts)) => {
                if attempts >= OTP_MAX_ATTEMPTS {
                    conn.execute("DELETE FROM web_otp_challenges WHERE id=?1", params![challenge_id]).ok();
                    return Ok(None);
                }
                if stored_code == code {
                    conn.execute("DELETE FROM web_otp_challenges WHERE id=?1", params![challenge_id]).ok();
                    Ok(Some(user_id))
                } else {
                    conn.execute("UPDATE web_otp_challenges SET attempts=attempts+1 WHERE id=?1", params![challenge_id]).ok();
                    Ok(None)
                }
            }
        }
    }

    // Invite tokens

    pub fn create_web_invite(&self, email: Option<&str>, role: &str) -> Result<(String, String), String> {
        let conn = self.0.lock().unwrap();
        let token = uuid::Uuid::new_v4().to_string();
        let now = chrono::Utc::now();
        let expires_at = (now + chrono::Duration::days(INVITE_EXPIRY_DAYS)).to_rfc3339();
        let normalized_email = email
            .map(|e| e.trim().to_lowercase())
            .filter(|e| !e.is_empty());
        conn.execute(
            "INSERT INTO web_invites (id, email, role, expires_at, used_at, created_at) VALUES (?1, ?2, ?3, ?4, NULL, ?5)",
            params![token, normalized_email, role, expires_at, now.to_rfc3339()],
        ).map_err(|e| e.to_string())?;
        Ok((token, expires_at))
    }

    pub fn consume_web_invite(
        &self,
        token: &str,
        email: &str,
        password_hash: &str,
    ) -> Result<WebUser, String> {
        let conn = self.0.lock().unwrap();
        let now = chrono::Utc::now().to_rfc3339();
        let normalized_email = email.trim().to_lowercase();

        let invite: Option<(Option<String>, String)> = conn.query_row(
            "SELECT email, role FROM web_invites WHERE id=?1 AND used_at IS NULL AND expires_at > ?2",
            params![token, now],
            |r| Ok((r.get(0)?, r.get(1)?)),
        ).optional().map_err(|e| e.to_string())?;

        let (invited_email, role) = invite.ok_or_else(|| "Invalid or expired invite".to_string())?;

        if let Some(invited_email) = invited_email {
            if invited_email != normalized_email {
                return Err("Invite email does not match".to_string());
            }
        }

        let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
        tx.execute(
            "INSERT INTO web_users (email, password_hash, role, is_active, created_at) VALUES (?1, ?2, ?3, 1, ?4)",
            params![normalized_email, password_hash, role, now],
        ).map_err(|e| e.to_string())?;

        let user_id = tx.last_insert_rowid();
        tx.execute(
            "UPDATE web_invites SET used_at=?1 WHERE id=?2",
            params![now, token],
        ).map_err(|e| e.to_string())?;
        tx.commit().map_err(|e| e.to_string())?;

        Ok(WebUser {
            id: user_id,
            email: normalized_email,
            role,
            is_active: true,
            created_at: now,
        })
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

    pub fn delete_media_missing_from_scan(
        &self,
        current_paths: &[String],
    ) -> Result<usize, String> {
        let conn = self.0.lock().unwrap();

        conn.execute_batch(
            "CREATE TEMP TABLE IF NOT EXISTS current_scan_paths (
                ftp_path TEXT PRIMARY KEY
             );
             DELETE FROM current_scan_paths;",
        )
        .map_err(|e| e.to_string())?;

        {
            let mut insert_stmt = conn
                .prepare("INSERT OR IGNORE INTO current_scan_paths (ftp_path) VALUES (?1)")
                .map_err(|e| e.to_string())?;

            for path in current_paths {
                insert_stmt
                    .execute(params![path])
                    .map_err(|e| e.to_string())?;
            }
        }

        let deleted = conn
            .execute(
                "DELETE FROM media_items
                 WHERE NOT EXISTS (
                     SELECT 1 FROM current_scan_paths scan
                     WHERE scan.ftp_path = media_items.ftp_path
                 )",
                [],
            )
            .map_err(|e| e.to_string())?;

        conn.execute("DELETE FROM current_scan_paths", [])
            .map_err(|e| e.to_string())?;

        Ok(deleted)
    }

    pub fn upsert_media(
        &self,
        path: &str,
        filename: &str,
        size_bytes: Option<u64>,
        parsed: &crate::parser::ParsedMedia,
        media_type: Option<&str>,
        ftp_indexed_at: Option<&str>,
    ) -> Result<UpsertMediaResult, String> {
        let conn = self.0.lock().unwrap();
        let now = chrono::Utc::now().to_rfc3339();

        #[derive(Debug)]
        struct ExistingRow {
            title: Option<String>,
            year: Option<i64>,
            season: Option<i64>,
            episode: Option<i64>,
            episode_end: Option<i64>,
            media_type: Option<String>,
            metadata_at: Option<String>,
            tmdb_id: Option<i64>,
            imdb_id: Option<String>,
            manual_match: i64,
        }

        let existing = conn
            .query_row(
                "SELECT title, year, season, episode, episode_end, media_type, metadata_at, tmdb_id, imdb_id, COALESCE(manual_match, 0)
                 FROM media_items WHERE ftp_path = ?1 LIMIT 1",
                params![path],
                |r| {
                    Ok(ExistingRow {
                        title: r.get(0)?,
                        year: r.get(1)?,
                        season: r.get(2)?,
                        episode: r.get(3)?,
                        episode_end: r.get(4)?,
                        media_type: r.get(5)?,
                        metadata_at: r.get(6)?,
                        tmdb_id: r.get(7)?,
                        imdb_id: r.get(8)?,
                        manual_match: r.get(9)?,
                    })
                },
            )
            .optional()
            .map_err(|e| e.to_string())?;

        conn.execute(
            "INSERT INTO media_items
                (ftp_path, filename, size_bytes, title, year, season, episode, episode_end,
                 resolution, codec, audio_codec, hdr, languages, release_type, release_group,
                 media_type, indexed_at)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,COALESCE(?17, ?18))
             ON CONFLICT(ftp_path) DO UPDATE SET
                filename=excluded.filename, size_bytes=excluded.size_bytes,
                title=excluded.title, year=excluded.year,
                season=excluded.season, episode=excluded.episode, episode_end=excluded.episode_end,
                resolution=excluded.resolution, codec=excluded.codec,
                audio_codec=excluded.audio_codec, hdr=excluded.hdr,
                languages=excluded.languages,
                release_type=excluded.release_type, release_group=excluded.release_group,
                media_type=COALESCE(excluded.media_type, media_items.media_type),
                     indexed_at=CASE WHEN ?17 IS NOT NULL THEN ?17 ELSE media_items.indexed_at END",
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
                ftp_indexed_at,
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

        let parsed_title = Some(parsed.title.clone());
        let parsed_year = parsed.year.map(|value| value as i64);
        let parsed_season = parsed.season.map(|value| value as i64);
        let parsed_episode = parsed.episode.map(|value| value as i64);
        let parsed_episode_end = parsed.episode_end.map(|value| value as i64);

        let existing_missing_metadata = existing
            .as_ref()
            .map(|row| {
                row.metadata_at.is_none()
                    || row.tmdb_id.is_none()
                    || row.imdb_id.as_deref().unwrap_or("").trim().is_empty()
            })
            .unwrap_or(false);

        let parsed_changed = existing
            .as_ref()
            .map(|row| {
                let effective_media_type = media_type
                    .map(|value| value.to_string())
                    .or_else(|| row.media_type.clone());
                row.title != parsed_title
                    || row.year != parsed_year
                    || row.season != parsed_season
                    || row.episode != parsed_episode
                    || row.episode_end != parsed_episode_end
                    || row.media_type != effective_media_type
            })
            .unwrap_or(false);

        let is_manual_match = existing
            .as_ref()
            .map(|row| row.manual_match != 0)
            .unwrap_or(false);

        if parsed_changed && !is_manual_match {
            conn.execute(
                "UPDATE media_items SET
                    tmdb_id=NULL, imdb_id=NULL, tmdb_type=NULL, tmdb_title=NULL, tmdb_year=NULL,
                    tmdb_title_en=NULL, tmdb_release_date=NULL, tmdb_overview=NULL, tmdb_overview_en=NULL, tmdb_poster=NULL, tmdb_poster_en=NULL,
                    tmdb_rating=NULL, tmdb_genres=NULL, metadata_at=NULL, manual_match=0
                 WHERE id=?1",
                params![id],
            )
            .map_err(|e| e.to_string())?;
        }

        let needs_metadata = if existing.is_none() {
            metadata_at.is_none()
        } else {
            existing_missing_metadata || (parsed_changed && !is_manual_match)
        };

        Ok(UpsertMediaResult {
            id,
            // Request metadata for new rows, incomplete rows, and rows whose parsed signature changed
            // (unless they were manually matched and should remain pinned).
            needs_metadata,
            is_new: existing.is_none(),
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
                tmdb_id=?1, imdb_id=?2, tmdb_type=?3, tmdb_title=?4, tmdb_title_en=?5, tmdb_year=?6,
                tmdb_release_date=?7, tmdb_overview=?8, tmdb_overview_en=?9, tmdb_poster=?10, tmdb_poster_en=?11,
                tmdb_rating=?12, tmdb_genres=?13, metadata_at=?14, manual_match=?15
             WHERE id=?16",
            params![
                movie.id,
                movie.imdb_id,
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
                      media_type, tmdb_id, imdb_id, tmdb_type, tmdb_title, tmdb_title_en, tmdb_year, tmdb_release_date, \
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
                    imdb_id: row.get(18)?,
                    tmdb_type: row.get(19)?,
                    tmdb_title: row.get(20)?,
                    tmdb_title_en: row.get(21)?,
                    tmdb_year: row.get(22)?,
                    tmdb_release_date: row.get(23)?,
                    tmdb_overview: row.get(24)?,
                    tmdb_overview_en: row.get(25)?,
                    tmdb_poster: row.get(26)?,
                    tmdb_poster_en: row.get(27)?,
                    tmdb_rating: row.get(28)?,
                    tmdb_genres: row.get(29)?,
                    indexed_at: row.get(30)?,
                    metadata_at: row.get(31)?,
                    manual_match: row.get(32)?,
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
                tmdb_id=NULL, imdb_id=NULL, tmdb_type=NULL, tmdb_title=NULL, tmdb_year=NULL,
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
                tmdb_id=NULL, imdb_id=NULL, tmdb_type=NULL, tmdb_title=NULL, tmdb_year=NULL,
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
                tmdb_id=NULL, imdb_id=NULL, tmdb_type=NULL, tmdb_title=NULL, tmdb_year=NULL,
                tmdb_title_en=NULL, tmdb_release_date=NULL, tmdb_overview=NULL, tmdb_overview_en=NULL, tmdb_poster=NULL, tmdb_poster_en=NULL,
                tmdb_rating=NULL, tmdb_genres=NULL, metadata_at=NULL, manual_match=0
             WHERE tmdb_id=?1",
            params![tmdb_id],
        )
        .map_err(|e| e.to_string())?;
        Ok(count)
    }
}
