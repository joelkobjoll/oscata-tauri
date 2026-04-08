use rusqlite::{params, Connection, OptionalExtension, Result as SqlResult};
use serde::{Deserialize, Serialize};
use std::sync::{Arc, Mutex};
use chrono::Datelike;

const DEFAULT_FTP_ROOT: &str = "/Compartida";
const DEFAULT_FOLDER_TYPES: &str =
    r#"{"Documentales 4K 2160p - HD 1080p":"documentary","P-Peticiones":"mixed","Peliculas BDRemux 1080p":"movie","Peliculas BDrip 1080p X264":"movie","Peliculas BDrip 1080p X265":"movie","Peliculas UHDRemux 2160p":"movie","Peliculas WEB DL Micro 1080p":"movie","Peliculas WEB DL-UHDRip 2160p":"movie","Peliculas y Series mas antiguas":"mixed","Series 4K 2160p":"tv","Series HD 1080p":"tv"}"#;
const LEGACY_FOLDER_TYPES: &str =
    r#"{"Peliculas":"movie","Series":"tv","Documentales":"documentary","Movies":"movie","TV Shows":"tv","Documentaries":"documentary"}"#;
const REMOVED_FOLDER_TYPE_KEYS: &[&str] = &[
    "Peliculas",
    "Series",
    "Documentales",
    "Movies",
    "Documentaries",
    "TV Shows",
    "Series HD 1080p X265",
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
    #[serde(default)]
    pub emby_url: String,
    #[serde(default)]
    pub emby_api_key: String,
    #[serde(default)]
    pub plex_url: String,
    #[serde(default)]
    pub plex_token: String,
    #[serde(default)]
    pub auto_check_updates: bool,
    #[serde(default)]
    pub updater_endpoint: String,
    #[serde(default)]
    pub updater_pubkey: String,
    #[serde(default)]
    pub movie_destination: String,       // "" = use download_folder/Movies
    #[serde(default)]
    pub tv_destination: String,          // "" = use download_folder/TV Shows
    #[serde(default)]
    pub documentary_destination: String, // "" = use download_folder/Documentaries
    #[serde(default = "default_alphabetical_subfolders")]
    pub alphabetical_subfolders: bool,   // default true
    #[serde(default)]
    pub genre_destinations: String,      // JSON: GenreDestRule[]
    #[serde(default = "default_close_to_tray")]
    pub close_to_tray: bool,             // default true
    #[serde(default)]
    pub telegram_bot_token: String,      // "" = disabled
    #[serde(default)]
    pub telegram_chat_id: String,        // "" = disabled
    /// "tmdb" (default) or "proxy"
    #[serde(default = "default_metadata_provider")]
    pub metadata_provider: String,
    /// Base URL of the metadata-proxy server (e.g. "https://metadata.example.com")
    #[serde(default)]
    pub proxy_url: String,
    /// API key for the metadata-proxy (`x-api-key` header)
    #[serde(default)]
    pub proxy_api_key: String,
}

fn default_alphabetical_subfolders() -> bool {
    true
}

fn default_close_to_tray() -> bool {
    true
}

fn default_metadata_provider() -> String {
    "tmdb".to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct WebGuiConfig {
    pub enabled: bool,
    pub host: String,
    pub port: u16,
    pub exposed_port: Option<u16>,
    pub app_url: String,
    pub otp_enabled: bool,
    pub smtp_host: String,
    pub smtp_port: u16,
    pub smtp_tls_mode: String, // "starttls" (587) or "tls" (465)
    pub smtp_user: String,
    pub smtp_pass: String,
    pub smtp_from: String,
    pub pwa_name: String,
    pub pwa_short_name: String,
    pub pwa_enabled: bool,
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
pub struct TelegramSub {
    pub user_id: i64,
    pub telegram_bot_token: String,
    pub telegram_chat_id: String,
    pub notify_new_content: bool,
    pub notify_downloads: bool,
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
pub struct Db {
    conn: Arc<Mutex<Connection>>,
    data_dir: std::path::PathBuf,
    is_portable: bool,
}

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

// ── Quality profiles ────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QualityProfile {
    pub id: i64,
    pub name: String,
    pub min_resolution: Option<String>,       // "720P" | "1080P" | "2160P" | null
    pub preferred_resolution: Option<String>, // target resolution
    pub prefer_hdr: bool,
    pub preferred_codecs: String,             // JSON array e.g. '["HEVC","AVC"]'
    pub preferred_audio_codecs: String,       // JSON array
    pub preferred_release_types: String,      // JSON array
    pub min_size_gb: Option<f64>,
    pub max_size_gb: Option<f64>,
    pub is_builtin: bool,
    pub created_at: String,
}

// ── Watchlist ────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WatchlistItem {
    pub id: i64,
    pub user_id: i64,
    pub tmdb_id: i64,
    pub tmdb_type: String,
    pub title: String,
    pub title_en: Option<String>,
    pub poster: Option<String>,
    pub overview: Option<String>,
    pub overview_en: Option<String>,
    pub status: Option<String>,
    pub release_date: Option<String>,
    pub year: Option<i64>,
    pub latest_season: Option<i64>,
    pub next_episode_date: Option<String>,
    pub scope: String,
    pub auto_download: i64,
    pub profile_id: i64,  // references quality_profiles.id; 1 = "Any" (default)
    pub added_at: String,
    pub library_count: i64,
    pub library_status: String,  // "pending" | "available"
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WatchlistCoverageItem {
    pub season: Option<i64>,
    pub episode: Option<i64>,
    pub filename: String,
    pub resolution: Option<String>,
    pub ftp_path: String,
    /// `true` only when this file was explicitly transferred via the download queue (status = Done).
    /// `false` for files that were discovered via FTP index scan but not downloaded through Oscata.
    pub downloaded: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WatchlistAutoItem {
    pub ftp_path: String,
    pub filename: String,
    pub tmdb_id: i64,
    pub media_type: Option<String>,
    pub tmdb_genres: Option<String>,
    pub media_title: Option<String>,
    pub resolution: Option<String>,
    pub release_type: Option<String>,
    pub hdr: Option<String>,
    pub codec: Option<String>,
    pub audio_codec: Option<String>,
    pub size_bytes: Option<i64>,
    pub profile_id: i64,  // from watchlist.profile_id
    pub season: Option<i64>,
    pub episode: Option<i64>,
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

    // ── Path resolution ──────────────────────────────────────────────────────

    /// The fixed system-level data dir — used to find bootstrap.json regardless
    /// of any custom location configured there.
    fn default_data_dir() -> std::path::PathBuf {
        dirs_next::data_dir()
            .unwrap_or_else(|| std::path::PathBuf::from("."))
            .join("oscata-tauri")
    }

    /// Detect portable mode: look for `.oscata-portable` next to the executable.
    /// On macOS the binary lives inside `Foo.app/Contents/MacOS/` so we walk up
    /// three levels to reach the folder that contains the `.app` bundle.
    fn detect_portable() -> Option<std::path::PathBuf> {
        let exe = std::env::current_exe().ok()?;
        let exe_dir = exe.parent()?;

        // On macOS bundles: Contents/MacOS → Contents → .app → parent folder
        let candidates: Vec<std::path::PathBuf> = if exe_dir.ends_with("Contents/MacOS") {
            vec![
                exe_dir.to_path_buf(),
                exe_dir.parent().map(|p| p.to_path_buf()).unwrap_or_default(),
                exe_dir.parent().and_then(|p| p.parent()).map(|p| p.to_path_buf()).unwrap_or_default(),
                exe_dir.parent().and_then(|p| p.parent()).and_then(|p| p.parent()).map(|p| p.to_path_buf()).unwrap_or_default(),
            ]
        } else {
            vec![exe_dir.to_path_buf()]
        };

        for candidate in candidates {
            if candidate.join(".oscata-portable").exists() {
                return Some(candidate.join("oscata-data"));
            }
        }
        None
    }

    /// Read a custom db dir from bootstrap.json stored in the default location.
    fn read_bootstrap() -> Option<std::path::PathBuf> {
        let bootstrap = Self::default_data_dir().join("bootstrap.json");
        let content = std::fs::read_to_string(&bootstrap).ok()?;
        let val: serde_json::Value = serde_json::from_str(&content).ok()?;
        let dir = val.get("db_dir")?.as_str()?;
        if dir.is_empty() { return None; }
        Some(std::path::PathBuf::from(dir))
    }

    /// Write (or delete when `None`) the custom db dir to bootstrap.json.
    pub fn write_bootstrap(dir: Option<&std::path::Path>) {
        let bootstrap = Self::default_data_dir().join("bootstrap.json");
        std::fs::create_dir_all(Self::default_data_dir()).ok();
        match dir {
            Some(d) => {
                let json = serde_json::json!({ "db_dir": d.to_string_lossy() });
                std::fs::write(&bootstrap, json.to_string()).ok();
            }
            None => { std::fs::remove_file(&bootstrap).ok(); }
        }
    }

    /// Resolve the effective data directory using the priority chain:
    /// 1. Portable marker next to exe (takes precedence over everything)
    /// 2. bootstrap.json custom path
    /// 3. Default system location
    fn resolve_data_dir() -> (std::path::PathBuf, bool) {
        if let Some(portable_dir) = Self::detect_portable() {
            return (portable_dir, true);
        }
        if let Some(custom_dir) = Self::read_bootstrap() {
            return (custom_dir, false);
        }
        (Self::default_data_dir(), false)
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
        conn.execute_batch("ALTER TABLE media_items ADD COLUMN ftp_relative_path TEXT;").ok();
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

        // Watchlist table (additive migration)
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS watchlist (
                id                INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id           INTEGER NOT NULL DEFAULT 0,
                tmdb_id           INTEGER NOT NULL,
                tmdb_type         TEXT    NOT NULL,
                title             TEXT    NOT NULL,
                title_en          TEXT,
                poster            TEXT,
                overview          TEXT,
                overview_en       TEXT,
                status            TEXT,
                release_date      TEXT,
                year              INTEGER,
                latest_season     INTEGER,
                next_episode_date TEXT,
                scope             TEXT NOT NULL DEFAULT 'all',
                auto_download     INTEGER NOT NULL DEFAULT 0,
                added_at          TEXT NOT NULL DEFAULT (datetime('now')),
                UNIQUE(user_id, tmdb_id)
             );",
        ).ok();
        // Additive column for quality tier (no-op if already exists)
        conn.execute_batch(
            "ALTER TABLE watchlist ADD COLUMN quality_tier TEXT NOT NULL DEFAULT 'any';",
        ).ok();

        // Quality profiles table
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS quality_profiles (
                id                     INTEGER PRIMARY KEY AUTOINCREMENT,
                name                   TEXT    NOT NULL,
                min_resolution         TEXT,
                preferred_resolution   TEXT,
                prefer_hdr             INTEGER NOT NULL DEFAULT 0,
                preferred_codecs       TEXT    NOT NULL DEFAULT '[]',
                preferred_audio_codecs TEXT    NOT NULL DEFAULT '[]',
                preferred_release_types TEXT   NOT NULL DEFAULT '[]',
                max_size_gb            REAL,
                is_builtin             INTEGER NOT NULL DEFAULT 0,
                created_at             TEXT    NOT NULL DEFAULT (datetime('now'))
             );",
        ).ok();

        // Additive column for min_size_gb (no-op if already exists)
        conn.execute_batch(
            "ALTER TABLE quality_profiles ADD COLUMN min_size_gb REAL;",
        ).ok();

        // Add profile_id to watchlist (references quality_profiles; default=1=Any)
        conn.execute_batch(
            "ALTER TABLE watchlist ADD COLUMN profile_id INTEGER NOT NULL DEFAULT 1;",
        ).ok();

        // Migrate old quality_tier values to profile_id (runs once; safe if profile_id already set)
        conn.execute_batch(
            "UPDATE watchlist SET profile_id =
               CASE quality_tier
                 WHEN 'hd'  THEN 2
                 WHEN 'fhd' THEN 3
                 WHEN '4k'  THEN 4
                 ELSE 1
               END
             WHERE profile_id = 1;",
        ).ok();

        // Personal Telegram subscription tables
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS telegram_subscriptions (
                id                   INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id              INTEGER UNIQUE NOT NULL DEFAULT 0,
                telegram_bot_token   TEXT    NOT NULL DEFAULT '',
                telegram_chat_id     TEXT    NOT NULL,
                notify_new_content   INTEGER NOT NULL DEFAULT 1,
                notify_downloads     INTEGER NOT NULL DEFAULT 1,
                created_at           TEXT    NOT NULL
             );
             CREATE TABLE IF NOT EXISTS telegram_verify_tokens (
                token      TEXT    PRIMARY KEY,
                user_id    INTEGER NOT NULL DEFAULT 0,
                chat_id    TEXT    NOT NULL,
                expires_at TEXT    NOT NULL
             );",
        ).ok();
        // Additive migration: add telegram_bot_token column if it doesn't exist yet
        conn.execute(
            "ALTER TABLE telegram_subscriptions ADD COLUMN telegram_bot_token TEXT NOT NULL DEFAULT ''",
            [],
        ).ok();

        Ok(())
    }

    pub fn new() -> SqlResult<Self> {
        let (data_dir, is_portable) = Self::resolve_data_dir();
        std::fs::create_dir_all(&data_dir).ok();
        let db_path = data_dir.join("library.db");
        let conn = Connection::open(&db_path)?;
        Self::apply_migrations(&conn)?;
        Ok(Self { conn: Arc::new(Mutex::new(conn)), data_dir, is_portable })
    }

    /// The directory where the database and backups are stored.
    pub fn data_dir(&self) -> &std::path::Path {
        &self.data_dir
    }

    /// Whether the app is running in portable mode (marker file detected).
    pub fn is_portable(&self) -> bool {
        self.is_portable
    }

    /// Copy the live database to `new_dir` using SQLite's VACUUM INTO, then
    /// persist the new location in bootstrap.json so the next startup finds it.
    pub fn migrate_to(&self, new_dir: &std::path::Path) -> Result<(), String> {
        std::fs::create_dir_all(new_dir).map_err(|e| e.to_string())?;
        let db_path = new_dir.join("library.db");
        // Escape any single-quotes in the path for the SQL literal.
        let escaped = db_path.to_string_lossy().replace('\'', "''");
        let conn = self.conn.lock().unwrap();
        conn.execute_batch(&format!("VACUUM INTO '{}';", escaped))
            .map_err(|e| e.to_string())?;
        drop(conn);
        Self::write_bootstrap(Some(new_dir));
        Ok(())
    }

    fn save_app_value(&self, key: &str, value: &str) -> Result<(), String> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT OR REPLACE INTO app_config (key, value) VALUES (?1, ?2)",
            params![key, value],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    fn load_app_value(&self, key: &str) -> Result<Option<String>, String> {
        let conn = self.conn.lock().unwrap();
        conn.query_row(
            "SELECT value FROM app_config WHERE key = ?1",
            params![key],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(|e| e.to_string())
    }

    pub fn list_applied_migrations(&self) -> Result<Vec<AppliedMigration>, String> {
        let conn = self.conn.lock().unwrap();
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

    /// Compute the root-relative path: strips `ftp_root` prefix and leading slash.
    /// Used as a stable, root-independent identity for deduplication across root changes.
    /// e.g. root="/Compartida", path="/Compartida/Series/foo.mkv" → "Series/foo.mkv"
    pub fn compute_relative_path(path: &str, ftp_root: &str) -> String {
        let root = ftp_root.trim_end_matches('/');
        path.strip_prefix(root)
            .unwrap_or(path)
            .trim_start_matches('/')
            .to_string()
    }

    /// Backfill `ftp_relative_path` for all existing rows that match the current FTP root
    /// and don't yet have a relative path set. Safe to call on every startup.
    pub fn populate_ftp_relative_paths(&self, ftp_root: &str) -> Result<usize, String> {
        let root = ftp_root.trim_end_matches('/').to_string();
        // LENGTH(root) + 2 skips the root prefix AND the following slash.
        let prefix_len = (root.len() + 2) as i64;
        let like_pattern = format!("{}/%", root);
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE media_items
             SET ftp_relative_path = SUBSTR(ftp_path, ?1)
             WHERE ftp_relative_path IS NULL
               AND ftp_path LIKE ?2",
            params![prefix_len, like_pattern],
        )
        .map_err(|e| e.to_string())
    }

    /// Re-parse `codec`, `resolution`, `audio_codec`, `hdr`, and `release_type`
    /// for every media item using the current parser (which can now look at
    /// ancestor folder names).  Only updates rows where the parser produces a
    /// non-null value that differs from what is stored, so this is idempotent
    /// and safe to call on every startup.
    pub fn reparse_tech_tags(&self) -> Result<usize, String> {
        // Collect all (id, ftp_path, filename) rows first so we can release
        // the mutex lock before running the parser and doing per-row updates.
        let rows: Vec<(i64, String, String)> = {
            let conn = self.conn.lock().unwrap();
            let mut stmt = conn
                .prepare("SELECT id, ftp_path, filename FROM media_items")
                .map_err(|e| e.to_string())?;
            let mut out = Vec::new();
            let mut rowset = stmt.query([]).map_err(|e| e.to_string())?;
            while let Some(row) = rowset.next().map_err(|e| e.to_string())? {
                out.push((row.get(0).map_err(|e| e.to_string())?,
                          row.get(1).map_err(|e| e.to_string())?,
                          row.get(2).map_err(|e| e.to_string())?));
            }
            out
        };

        let mut updated = 0usize;
        for (id, ftp_path, filename) in rows {
            let parsed = crate::parser::parse_media_path(&ftp_path, &filename);
            let conn = self.conn.lock().unwrap();
            let n = conn
                .execute(
                    "UPDATE media_items SET
                        codec        = COALESCE(?2, codec),
                        resolution   = COALESCE(?3, resolution),
                        audio_codec  = COALESCE(?4, audio_codec),
                        hdr          = COALESCE(?5, hdr),
                        release_type = COALESCE(?6, release_type)
                     WHERE id = ?1
                       AND (
                           (?2 IS NOT NULL AND (codec       IS NULL OR codec       != ?2)) OR
                           (?3 IS NOT NULL AND (resolution  IS NULL OR resolution  != ?3)) OR
                           (?4 IS NOT NULL AND (audio_codec IS NULL OR audio_codec != ?4)) OR
                           (?5 IS NOT NULL AND (hdr         IS NULL OR hdr         != ?5)) OR
                           (?6 IS NOT NULL AND (release_type IS NULL OR release_type != ?6))
                       )",
                    params![
                        id,
                        parsed.codec,
                        parsed.resolution,
                        parsed.audio_codec,
                        parsed.hdr,
                        parsed.release_type,
                    ],
                )
                .map_err(|e| e.to_string())?;
            updated += n;
        }
        Ok(updated)
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
        _ftp_root: &str,
    ) -> Result<usize, String> {
        if !seed_path.exists() {
            return Ok(0);
        }

        let escaped_seed_path = Self::escape_sqlite_path(seed_path);
        let conn = self.conn.lock().unwrap();
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
                        OR (local.ftp_relative_path IS NOT NULL AND local.ftp_relative_path != ''
                            AND SUBSTR(src.ftp_path, INSTR(SUBSTR(src.ftp_path, 2), '/') + 2) = local.ftp_relative_path)
                     LIMIT 1
                 )
                 WHERE (local.imdb_id IS NULL OR TRIM(local.imdb_id) = '')
                   AND EXISTS (
                       SELECT 1
                       FROM seed.media_items src
                       WHERE (src.ftp_path = local.ftp_path
                          OR (local.ftp_relative_path IS NOT NULL AND local.ftp_relative_path != ''
                              AND SUBSTR(src.ftp_path, INSTR(SUBSTR(src.ftp_path, 2), '/') + 2) = local.ftp_relative_path))
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
        _ftp_root: &str,
    ) -> Result<(usize, usize), String> {
        if !seed_path.exists() {
            return Ok((0, 0));
        }

        let refresh_key = format!("seed_library_refreshed_for_{}", app_version);
        let migration_id = format!("seed:refresh-library:{app_version}");

        let escaped_seed_path = Self::escape_sqlite_path(seed_path);
        let conn = self.conn.lock().unwrap();

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
                        SELECT 1 FROM media_items local
                        WHERE local.ftp_path = src.ftp_path
                           OR (local.ftp_relative_path IS NOT NULL AND local.ftp_relative_path != ''
                               AND SUBSTR(src.ftp_path, INSTR(SUBSTR(src.ftp_path, 2), '/') + 2) = local.ftp_relative_path)
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
                               OR (media_items.ftp_relative_path IS NOT NULL AND media_items.ftp_relative_path != ''
                                   AND SUBSTR(src.ftp_path, INSTR(SUBSTR(src.ftp_path, 2), '/') + 2) = media_items.ftp_relative_path)
                            LIMIT 1
                        )),
                        indexed_at = COALESCE(NULLIF(TRIM(indexed_at), ''), (
                            SELECT NULLIF(TRIM(src.indexed_at), '')
                            FROM seed.media_items src
                            WHERE src.ftp_path = media_items.ftp_path
                               OR (media_items.ftp_relative_path IS NOT NULL AND media_items.ftp_relative_path != ''
                                   AND SUBSTR(src.ftp_path, INSTR(SUBSTR(src.ftp_path, 2), '/') + 2) = media_items.ftp_relative_path)
                            LIMIT 1
                        )),
                        media_type = COALESCE(NULLIF(TRIM(media_type), ''), (
                            SELECT NULLIF(TRIM(src.media_type), '')
                            FROM seed.media_items src
                            WHERE src.ftp_path = media_items.ftp_path
                               OR (media_items.ftp_relative_path IS NOT NULL AND media_items.ftp_relative_path != ''
                                   AND SUBSTR(src.ftp_path, INSTR(SUBSTR(src.ftp_path, 2), '/') + 2) = media_items.ftp_relative_path)
                            LIMIT 1
                        )),
                        tmdb_type = COALESCE(NULLIF(TRIM(tmdb_type), ''), (
                            SELECT NULLIF(TRIM(src.tmdb_type), '')
                            FROM seed.media_items src
                            WHERE src.ftp_path = media_items.ftp_path
                               OR (media_items.ftp_relative_path IS NOT NULL AND media_items.ftp_relative_path != ''
                                   AND SUBSTR(src.ftp_path, INSTR(SUBSTR(src.ftp_path, 2), '/') + 2) = media_items.ftp_relative_path)
                            LIMIT 1
                        )),
                        tmdb_id = COALESCE(tmdb_id, (
                            SELECT src.tmdb_id
                            FROM seed.media_items src
                            WHERE src.ftp_path = media_items.ftp_path
                               OR (media_items.ftp_relative_path IS NOT NULL AND media_items.ftp_relative_path != ''
                                   AND SUBSTR(src.ftp_path, INSTR(SUBSTR(src.ftp_path, 2), '/') + 2) = media_items.ftp_relative_path)
                            LIMIT 1
                        )),
                        tmdb_title = COALESCE(NULLIF(TRIM(tmdb_title), ''), (
                            SELECT NULLIF(TRIM(src.tmdb_title), '')
                            FROM seed.media_items src
                            WHERE src.ftp_path = media_items.ftp_path
                               OR (media_items.ftp_relative_path IS NOT NULL AND media_items.ftp_relative_path != ''
                                   AND SUBSTR(src.ftp_path, INSTR(SUBSTR(src.ftp_path, 2), '/') + 2) = media_items.ftp_relative_path)
                            LIMIT 1
                        )),
                        tmdb_title_en = COALESCE(NULLIF(TRIM(tmdb_title_en), ''), (
                            SELECT NULLIF(TRIM(src.tmdb_title_en), '')
                            FROM seed.media_items src
                            WHERE src.ftp_path = media_items.ftp_path
                               OR (media_items.ftp_relative_path IS NOT NULL AND media_items.ftp_relative_path != ''
                                   AND SUBSTR(src.ftp_path, INSTR(SUBSTR(src.ftp_path, 2), '/') + 2) = media_items.ftp_relative_path)
                            LIMIT 1
                        )),
                        tmdb_release_date = COALESCE(NULLIF(TRIM(tmdb_release_date), ''), (
                            SELECT NULLIF(TRIM(src.tmdb_release_date), '')
                            FROM seed.media_items src
                            WHERE src.ftp_path = media_items.ftp_path
                               OR (media_items.ftp_relative_path IS NOT NULL AND media_items.ftp_relative_path != ''
                                   AND SUBSTR(src.ftp_path, INSTR(SUBSTR(src.ftp_path, 2), '/') + 2) = media_items.ftp_relative_path)
                            LIMIT 1
                        )),
                        tmdb_overview = COALESCE(NULLIF(TRIM(tmdb_overview), ''), (
                            SELECT NULLIF(TRIM(src.tmdb_overview), '')
                            FROM seed.media_items src
                            WHERE src.ftp_path = media_items.ftp_path
                               OR (media_items.ftp_relative_path IS NOT NULL AND media_items.ftp_relative_path != ''
                                   AND SUBSTR(src.ftp_path, INSTR(SUBSTR(src.ftp_path, 2), '/') + 2) = media_items.ftp_relative_path)
                            LIMIT 1
                        )),
                        tmdb_overview_en = COALESCE(NULLIF(TRIM(tmdb_overview_en), ''), (
                            SELECT NULLIF(TRIM(src.tmdb_overview_en), '')
                            FROM seed.media_items src
                            WHERE src.ftp_path = media_items.ftp_path
                               OR (media_items.ftp_relative_path IS NOT NULL AND media_items.ftp_relative_path != ''
                                   AND SUBSTR(src.ftp_path, INSTR(SUBSTR(src.ftp_path, 2), '/') + 2) = media_items.ftp_relative_path)
                            LIMIT 1
                        )),
                        tmdb_poster = COALESCE(NULLIF(TRIM(tmdb_poster), ''), (
                            SELECT NULLIF(TRIM(src.tmdb_poster), '')
                            FROM seed.media_items src
                            WHERE src.ftp_path = media_items.ftp_path
                               OR (media_items.ftp_relative_path IS NOT NULL AND media_items.ftp_relative_path != ''
                                   AND SUBSTR(src.ftp_path, INSTR(SUBSTR(src.ftp_path, 2), '/') + 2) = media_items.ftp_relative_path)
                            LIMIT 1
                        )),
                        tmdb_poster_en = COALESCE(NULLIF(TRIM(tmdb_poster_en), ''), (
                            SELECT NULLIF(TRIM(src.tmdb_poster_en), '')
                            FROM seed.media_items src
                            WHERE src.ftp_path = media_items.ftp_path
                               OR (media_items.ftp_relative_path IS NOT NULL AND media_items.ftp_relative_path != ''
                                   AND SUBSTR(src.ftp_path, INSTR(SUBSTR(src.ftp_path, 2), '/') + 2) = media_items.ftp_relative_path)
                            LIMIT 1
                        )),
                        tmdb_rating = COALESCE(tmdb_rating, (
                            SELECT src.tmdb_rating
                            FROM seed.media_items src
                            WHERE src.ftp_path = media_items.ftp_path
                               OR (media_items.ftp_relative_path IS NOT NULL AND media_items.ftp_relative_path != ''
                                   AND SUBSTR(src.ftp_path, INSTR(SUBSTR(src.ftp_path, 2), '/') + 2) = media_items.ftp_relative_path)
                            LIMIT 1
                        )),
                        tmdb_genres = COALESCE(NULLIF(TRIM(tmdb_genres), ''), (
                            SELECT NULLIF(TRIM(src.tmdb_genres), '')
                            FROM seed.media_items src
                            WHERE src.ftp_path = media_items.ftp_path
                               OR (media_items.ftp_relative_path IS NOT NULL AND media_items.ftp_relative_path != ''
                                   AND SUBSTR(src.ftp_path, INSTR(SUBSTR(src.ftp_path, 2), '/') + 2) = media_items.ftp_relative_path)
                            LIMIT 1
                        )),
                        metadata_at = COALESCE(NULLIF(TRIM(metadata_at), ''), (
                            SELECT NULLIF(TRIM(src.metadata_at), '')
                            FROM seed.media_items src
                            WHERE src.ftp_path = media_items.ftp_path
                               OR (media_items.ftp_relative_path IS NOT NULL AND media_items.ftp_relative_path != ''
                                   AND SUBSTR(src.ftp_path, INSTR(SUBSTR(src.ftp_path, 2), '/') + 2) = media_items.ftp_relative_path)
                            LIMIT 1
                        ))
                    WHERE EXISTS (
                        SELECT 1 FROM seed.media_items src
                        WHERE src.ftp_path = media_items.ftp_path
                           OR (media_items.ftp_relative_path IS NOT NULL AND media_items.ftp_relative_path != ''
                               AND SUBSTR(src.ftp_path, INSTR(SUBSTR(src.ftp_path, 2), '/') + 2) = media_items.ftp_relative_path)
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
        _ftp_root: &str,
    ) -> Result<(usize, usize), String> {
        if !seed_path.exists() {
            return Ok((0, 0));
        }

        let migration_id = format!("seed:override-library:{app_version}");
        let escaped_seed_path = Self::escape_sqlite_path(seed_path);
        let conn = self.conn.lock().unwrap();

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
                        SELECT 1 FROM media_items local
                        WHERE local.ftp_path = src.ftp_path
                           OR (local.ftp_relative_path IS NOT NULL AND local.ftp_relative_path != ''
                               AND SUBSTR(src.ftp_path, INSTR(SUBSTR(src.ftp_path, 2), '/') + 2) = local.ftp_relative_path)
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
                        imdb_id        = COALESCE((SELECT NULLIF(TRIM(src.imdb_id), '')        FROM seed.media_items src WHERE src.ftp_path = media_items.ftp_path OR (media_items.ftp_relative_path IS NOT NULL AND media_items.ftp_relative_path != '' AND SUBSTR(src.ftp_path, INSTR(SUBSTR(src.ftp_path, 2), '/') + 2) = media_items.ftp_relative_path) LIMIT 1), imdb_id),
                        media_type     = COALESCE((SELECT NULLIF(TRIM(src.media_type), '')     FROM seed.media_items src WHERE src.ftp_path = media_items.ftp_path OR (media_items.ftp_relative_path IS NOT NULL AND media_items.ftp_relative_path != '' AND SUBSTR(src.ftp_path, INSTR(SUBSTR(src.ftp_path, 2), '/') + 2) = media_items.ftp_relative_path) LIMIT 1), media_type),
                        tmdb_id        = COALESCE((SELECT src.tmdb_id                          FROM seed.media_items src WHERE (src.ftp_path = media_items.ftp_path OR (media_items.ftp_relative_path IS NOT NULL AND media_items.ftp_relative_path != '' AND SUBSTR(src.ftp_path, INSTR(SUBSTR(src.ftp_path, 2), '/') + 2) = media_items.ftp_relative_path)) AND src.tmdb_id IS NOT NULL LIMIT 1), tmdb_id),
                        tmdb_type      = COALESCE((SELECT NULLIF(TRIM(src.tmdb_type), '')      FROM seed.media_items src WHERE src.ftp_path = media_items.ftp_path OR (media_items.ftp_relative_path IS NOT NULL AND media_items.ftp_relative_path != '' AND SUBSTR(src.ftp_path, INSTR(SUBSTR(src.ftp_path, 2), '/') + 2) = media_items.ftp_relative_path) LIMIT 1), tmdb_type),
                        tmdb_title     = COALESCE((SELECT NULLIF(TRIM(src.tmdb_title), '')     FROM seed.media_items src WHERE src.ftp_path = media_items.ftp_path OR (media_items.ftp_relative_path IS NOT NULL AND media_items.ftp_relative_path != '' AND SUBSTR(src.ftp_path, INSTR(SUBSTR(src.ftp_path, 2), '/') + 2) = media_items.ftp_relative_path) LIMIT 1), tmdb_title),
                        tmdb_title_en  = COALESCE((SELECT NULLIF(TRIM(src.tmdb_title_en), '') FROM seed.media_items src WHERE src.ftp_path = media_items.ftp_path OR (media_items.ftp_relative_path IS NOT NULL AND media_items.ftp_relative_path != '' AND SUBSTR(src.ftp_path, INSTR(SUBSTR(src.ftp_path, 2), '/') + 2) = media_items.ftp_relative_path) LIMIT 1), tmdb_title_en),
                        tmdb_release_date = COALESCE((SELECT NULLIF(TRIM(src.tmdb_release_date), '') FROM seed.media_items src WHERE src.ftp_path = media_items.ftp_path OR (media_items.ftp_relative_path IS NOT NULL AND media_items.ftp_relative_path != '' AND SUBSTR(src.ftp_path, INSTR(SUBSTR(src.ftp_path, 2), '/') + 2) = media_items.ftp_relative_path) LIMIT 1), tmdb_release_date),
                        tmdb_overview  = COALESCE((SELECT NULLIF(TRIM(src.tmdb_overview), '')  FROM seed.media_items src WHERE src.ftp_path = media_items.ftp_path OR (media_items.ftp_relative_path IS NOT NULL AND media_items.ftp_relative_path != '' AND SUBSTR(src.ftp_path, INSTR(SUBSTR(src.ftp_path, 2), '/') + 2) = media_items.ftp_relative_path) LIMIT 1), tmdb_overview),
                        tmdb_overview_en = COALESCE((SELECT NULLIF(TRIM(src.tmdb_overview_en), '') FROM seed.media_items src WHERE src.ftp_path = media_items.ftp_path OR (media_items.ftp_relative_path IS NOT NULL AND media_items.ftp_relative_path != '' AND SUBSTR(src.ftp_path, INSTR(SUBSTR(src.ftp_path, 2), '/') + 2) = media_items.ftp_relative_path) LIMIT 1), tmdb_overview_en),
                        tmdb_poster    = COALESCE((SELECT NULLIF(TRIM(src.tmdb_poster), '')    FROM seed.media_items src WHERE src.ftp_path = media_items.ftp_path OR (media_items.ftp_relative_path IS NOT NULL AND media_items.ftp_relative_path != '' AND SUBSTR(src.ftp_path, INSTR(SUBSTR(src.ftp_path, 2), '/') + 2) = media_items.ftp_relative_path) LIMIT 1), tmdb_poster),
                        tmdb_poster_en = COALESCE((SELECT NULLIF(TRIM(src.tmdb_poster_en), '') FROM seed.media_items src WHERE src.ftp_path = media_items.ftp_path OR (media_items.ftp_relative_path IS NOT NULL AND media_items.ftp_relative_path != '' AND SUBSTR(src.ftp_path, INSTR(SUBSTR(src.ftp_path, 2), '/') + 2) = media_items.ftp_relative_path) LIMIT 1), tmdb_poster_en),
                        tmdb_rating    = COALESCE((SELECT src.tmdb_rating                      FROM seed.media_items src WHERE (src.ftp_path = media_items.ftp_path OR (media_items.ftp_relative_path IS NOT NULL AND media_items.ftp_relative_path != '' AND SUBSTR(src.ftp_path, INSTR(SUBSTR(src.ftp_path, 2), '/') + 2) = media_items.ftp_relative_path)) AND src.tmdb_rating IS NOT NULL LIMIT 1), tmdb_rating),
                        tmdb_genres    = COALESCE((SELECT NULLIF(TRIM(src.tmdb_genres), '')    FROM seed.media_items src WHERE src.ftp_path = media_items.ftp_path OR (media_items.ftp_relative_path IS NOT NULL AND media_items.ftp_relative_path != '' AND SUBSTR(src.ftp_path, INSTR(SUBSTR(src.ftp_path, 2), '/') + 2) = media_items.ftp_relative_path) LIMIT 1), tmdb_genres),
                        metadata_at    = COALESCE((SELECT NULLIF(TRIM(src.metadata_at), '')    FROM seed.media_items src WHERE src.ftp_path = media_items.ftp_path OR (media_items.ftp_relative_path IS NOT NULL AND media_items.ftp_relative_path != '' AND SUBSTR(src.ftp_path, INSTR(SUBSTR(src.ftp_path, 2), '/') + 2) = media_items.ftp_relative_path) LIMIT 1), metadata_at)
                    WHERE EXISTS (
                        SELECT 1 FROM seed.media_items src
                        WHERE src.ftp_path = media_items.ftp_path
                           OR (media_items.ftp_relative_path IS NOT NULL AND media_items.ftp_relative_path != ''
                               AND SUBSTR(src.ftp_path, INSTR(SUBSTR(src.ftp_path, 2), '/') + 2) = media_items.ftp_relative_path)
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

        let backups_dir = self.data_dir.join("backups");
        std::fs::create_dir_all(&backups_dir).map_err(|e| e.to_string())?;
        let timestamp = chrono::Utc::now().format("%Y%m%dT%H%M%SZ");
        let backup_path = backups_dir.join(format!(
            "library-{}-to-{}-{}.sqlite3",
            Self::sanitize_version_for_filename(from_version),
            Self::sanitize_version_for_filename(to_version),
            timestamp
        ));
        let escaped_path = backup_path.to_string_lossy().replace('\'', "''");

        let conn = self.conn.lock().unwrap();
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

        let conn = self.conn.lock().unwrap();
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
        let mut dest_conn = self.conn.lock().unwrap();
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
        // Detect whether ftp_root is changing so we can rewrite stored paths.
        let old_root = {
            let conn = self.conn.lock().unwrap();
            conn.query_row(
                "SELECT value FROM app_config WHERE key = 'ftp_root'",
                [],
                |r| r.get::<_, String>(0),
            )
            .optional()
            .unwrap_or(None)
        };

        let conn = self.conn.lock().unwrap();
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
            ("movie_destination", config.movie_destination.as_str()),
            ("tv_destination", config.tv_destination.as_str()),
            ("documentary_destination", config.documentary_destination.as_str()),
            (
                "alphabetical_subfolders",
                if config.alphabetical_subfolders { "1" } else { "0" },
            ),
            ("genre_destinations", config.genre_destinations.as_str()),
            (
                "close_to_tray",
                if config.close_to_tray { "1" } else { "0" },
            ),
            ("telegram_bot_token", config.telegram_bot_token.as_str()),
            ("telegram_chat_id", config.telegram_chat_id.as_str()),
            ("metadata_provider", config.metadata_provider.as_str()),
            ("proxy_url", config.proxy_url.as_str()),
            ("proxy_api_key", config.proxy_api_key.as_str()),
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

        // If ftp_root changed, rewrite all stored ftp_path values in-place.
        let new_root = config.ftp_root.trim_end_matches('/');
        if let Some(ref old) = old_root {
            let old = old.trim_end_matches('/');
            if old != new_root && !old.is_empty() {
                let prefix_len = (old.len() + 1) as i64; // +1 for the slash after root
                let like_pattern = format!("{old}/%");
                // Rewrite ftp_path by replacing old root prefix with new root.
                conn.execute(
                    "UPDATE media_items
                     SET ftp_path = ?1 || '/' || SUBSTR(ftp_path, ?2),
                         ftp_relative_path = SUBSTR(ftp_path, ?2)
                     WHERE ftp_path LIKE ?3",
                    params![new_root, prefix_len, like_pattern],
                )
                .map_err(|e| e.to_string())?;
            }
        }

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
        self.save_app_value("webgui_smtp_tls_mode", &c.smtp_tls_mode)?;
        self.save_app_value("webgui_smtp_user", &c.smtp_user)?;
        self.save_app_value("webgui_smtp_pass", &c.smtp_pass)?;
        self.save_app_value("webgui_smtp_from", &c.smtp_from)?;
        self.save_app_value("webgui_pwa_name", &c.pwa_name)?;
        self.save_app_value("webgui_pwa_short_name", &c.pwa_short_name)?;
        self.save_app_value("webgui_pwa_enabled", if c.pwa_enabled { "1" } else { "0" })?;
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
            smtp_tls_mode: { let v = str_val("webgui_smtp_tls_mode"); if v.is_empty() { "starttls".into() } else { v } },
            smtp_user:    str_val("webgui_smtp_user"),
            smtp_pass:    str_val("webgui_smtp_pass"),
            smtp_from:    str_val("webgui_smtp_from"),
            pwa_name:     { let v = str_val("webgui_pwa_name"); if v.is_empty() { "Oscata".into() } else { v } },
            pwa_short_name: { let v = str_val("webgui_pwa_short_name"); if v.is_empty() { "Oscata".into() } else { v } },
            pwa_enabled:  bool_val("webgui_pwa_enabled"),
        })
    }

    // ── Web auth ───────────────────────────────────────────────────────────

    pub fn web_user_count(&self) -> Result<i64, String> {
        let conn = self.conn.lock().unwrap();
        conn.query_row("SELECT COUNT(*) FROM web_users", [], |r| r.get(0))
            .map_err(|e| e.to_string())
    }

    pub fn create_web_user(&self, email: &str, hash: &str, role: &str) -> Result<WebUser, String> {
        let conn = self.conn.lock().unwrap();
        let now = chrono::Utc::now().to_rfc3339();
        conn.execute(
            "INSERT INTO web_users (email, password_hash, role, is_active, created_at) VALUES (?1,?2,?3,1,?4)",
            params![email.trim().to_lowercase(), hash, role, now],
        ).map_err(|e| e.to_string())?;
        let id = conn.last_insert_rowid();
        Ok(WebUser { id, email: email.trim().to_lowercase(), role: role.into(), is_active: true, created_at: now })
    }

    pub fn get_web_user_by_email(&self, email: &str) -> Result<Option<(WebUser, String)>, String> {
        let conn = self.conn.lock().unwrap();
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
        let conn = self.conn.lock().unwrap();
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
        let conn = self.conn.lock().unwrap();
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
        let conn = self.conn.lock().unwrap();
        conn.execute("DELETE FROM web_users WHERE id=?1", params![id])
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    // Sessions

    pub fn create_web_session(&self, user_id: i64, token: &str) -> Result<(), String> {
        let conn = self.conn.lock().unwrap();
        let now = chrono::Utc::now();
        let expires = (now + chrono::Duration::days(SESSION_EXPIRY_DAYS)).to_rfc3339();
        conn.execute(
            "INSERT INTO web_sessions (id, user_id, expires_at, created_at) VALUES (?1,?2,?3,?4)",
            params![token, user_id, expires, now.to_rfc3339()],
        ).map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn validate_web_session(&self, token: &str) -> Result<Option<WebUser>, String> {
        let conn = self.conn.lock().unwrap();
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
        let conn = self.conn.lock().unwrap();
        conn.execute("DELETE FROM web_sessions WHERE id=?1", params![token])
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    // OTP challenges

    pub fn create_otp_challenge(&self, user_id: i64, code: &str) -> Result<String, String> {
        let conn = self.conn.lock().unwrap();
        let id = uuid::Uuid::new_v4().to_string();
        let expires = (chrono::Utc::now() + chrono::Duration::minutes(OTP_EXPIRY_MINUTES)).to_rfc3339();
        conn.execute(
            "INSERT INTO web_otp_challenges (id, user_id, code, expires_at, attempts) VALUES (?1,?2,?3,?4,0)",
            params![id, user_id, code, expires],
        ).map_err(|e| e.to_string())?;
        Ok(id)
    }

    pub fn verify_otp_challenge(&self, challenge_id: &str, code: &str) -> Result<Option<i64>, String> {
        let conn = self.conn.lock().unwrap();
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
        let conn = self.conn.lock().unwrap();
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
        let conn = self.conn.lock().unwrap();
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
        let conn = self.conn.lock().unwrap();
        let json = serde_json::to_string(items).map_err(|e| e.to_string())?;
        conn.execute(
            "INSERT OR REPLACE INTO app_config (key, value) VALUES ('downloads_state', ?1)",
            params![json],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn load_download_state(&self) -> Result<Vec<crate::downloads::DownloadItem>, String> {
        let conn = self.conn.lock().unwrap();
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

    pub fn save_upload_state(&self, items: &[crate::uploads::UploadItem]) -> Result<(), String> {
        let conn = self.conn.lock().unwrap();
        let json = serde_json::to_string(items).map_err(|e| e.to_string())?;
        conn.execute(
            "INSERT OR REPLACE INTO app_config (key, value) VALUES ('uploads_state', ?1)",
            params![json],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn load_upload_state(&self) -> Result<Vec<crate::uploads::UploadItem>, String> {
        let conn = self.conn.lock().unwrap();
        let json = conn
            .query_row(
                "SELECT value FROM app_config WHERE key = 'uploads_state'",
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
        let conn = self.conn.lock().unwrap();
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
            movie_destination: get("movie_destination").unwrap_or_default(),
            tv_destination: get("tv_destination").unwrap_or_default(),
            documentary_destination: get("documentary_destination").unwrap_or_default(),
            alphabetical_subfolders: get("alphabetical_subfolders")
                .ok()
                .map(|v| !matches!(v.as_str(), "0" | "false" | "FALSE" | "False"))
                .unwrap_or(true),
            genre_destinations: get("genre_destinations").unwrap_or_else(|_| "[]".to_string()),
            close_to_tray: get("close_to_tray")
                .ok()
                .map(|v| !matches!(v.as_str(), "0" | "false" | "FALSE" | "False"))
                .unwrap_or(true),
            telegram_bot_token: get("telegram_bot_token").unwrap_or_default(),
            telegram_chat_id: get("telegram_chat_id").unwrap_or_default(),
            metadata_provider: get("metadata_provider").unwrap_or_else(|_| "tmdb".to_string()),
            proxy_url: get("proxy_url").unwrap_or_default(),
            proxy_api_key: get("proxy_api_key").unwrap_or_default(),
        })
    }

    pub fn has_config(&self) -> Result<bool, String> {
        let conn = self.conn.lock().unwrap();
        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM app_config", [], |r| r.get(0))
            .map_err(|e| e.to_string())?;
        Ok(count >= 6)
    }

    pub fn clear_app_config(&self) -> Result<(), String> {
        let conn = self.conn.lock().unwrap();
        conn.execute("DELETE FROM app_config", [])
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn count_media_items(&self) -> Result<i64, String> {
        let conn = self.conn.lock().unwrap();
        conn
            .query_row("SELECT COUNT(*) FROM media_items", [], |r| r.get(0))
            .map_err(|e| e.to_string())
    }

    pub fn delete_media_missing_from_scan(
        &self,
        current_paths: &[String],
    ) -> Result<usize, String> {
        let conn = self.conn.lock().unwrap();

        conn.execute_batch(
            "CREATE TEMP TABLE IF NOT EXISTS current_scan_paths (
                ftp_path TEXT PRIMARY KEY
             );
             DELETE FROM current_scan_paths;",
        )
        .map_err(|e| e.to_string())?;

        // Wrap the bulk-insert into the temp table in an explicit transaction so
        // all N inserts are committed in a single fsync instead of N individual ones.
        conn.execute_batch("BEGIN").map_err(|e| e.to_string())?;
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
        conn.execute_batch("COMMIT").map_err(|e| e.to_string())?;

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

    /// Begin an explicit write transaction on the underlying connection.
    /// Call this before a batch of `upsert_media` calls, then call
    /// `commit_batch` when the batch is complete. This replaces N implicit
    /// per-statement transactions with a single WAL write round-trip.
    ///
    /// # Safety
    /// Only one batch may be open at a time. Calls are not re-entrant.
    /// The caller MUST call `commit_batch` (or `rollback_batch`) before
    /// initiating another batch or any other write.
    pub fn begin_batch(&self) -> Result<(), String> {
        let conn = self.conn.lock().unwrap();
        conn.execute_batch("BEGIN").map_err(|e| e.to_string())
    }

    /// Commit the transaction opened by `begin_batch`.
    pub fn commit_batch(&self) -> Result<(), String> {
        let conn = self.conn.lock().unwrap();
        conn.execute_batch("COMMIT").map_err(|e| e.to_string())
    }

    /// Roll back the transaction opened by `begin_batch` (e.g. on error).
    pub fn rollback_batch(&self) -> Result<(), String> {
        let conn = self.conn.lock().unwrap();
        conn.execute_batch("ROLLBACK").map_err(|e| e.to_string())
    }

    pub fn upsert_media(
        &self,
        path: &str,
        filename: &str,
        size_bytes: Option<u64>,
        parsed: &crate::parser::ParsedMedia,
        media_type: Option<&str>,
        ftp_indexed_at: Option<&str>,
        ftp_root: &str,
    ) -> Result<UpsertMediaResult, String> {
        let conn = self.conn.lock().unwrap();
        let now = chrono::Utc::now().to_rfc3339();
        let relative_path = Self::compute_relative_path(path, ftp_root);

        #[derive(Debug)]
        struct ExistingRow {
            title: Option<String>,
            year: Option<i64>,
            season: Option<i64>,
            episode: Option<i64>,
            episode_end: Option<i64>,
            media_type: Option<String>,
            metadata_at: Option<String>,
            manual_match: i64,
        }

        // Primary lookup: exact ftp_path match (fast path).
        let mut existing = conn
            .query_row(
                "SELECT title, year, season, episode, episode_end, media_type, metadata_at, COALESCE(manual_match, 0)
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
                        manual_match: r.get(7)?,
                    })
                },
            )
            .optional()
            .map_err(|e| e.to_string())?;

        // Fallback: if no exact match, search for a row with the same relative path
        // but a different ftp_path (happens when ftp_root changes or the FTP server
        // exposes the same share under a different mount point).
        // Re-key that row to the current path so all metadata is preserved.
        if existing.is_none() && !relative_path.is_empty() {
            let stale_id: Option<i64> = conn
                .query_row(
                    "SELECT id FROM media_items
                     WHERE ftp_relative_path = ?1 AND ftp_path != ?2
                     LIMIT 1",
                    params![relative_path, path],
                    |r| r.get(0),
                )
                .optional()
                .map_err(|e| e.to_string())?;

            if let Some(id) = stale_id {
                // Update only the path fields; all metadata columns are preserved.
                conn.execute(
                    "UPDATE media_items SET ftp_path = ?1, ftp_relative_path = ?2 WHERE id = ?3",
                    params![path, relative_path, id],
                )
                .map_err(|e| e.to_string())?;

                // Now read it back as an existing row.
                existing = conn
                    .query_row(
                        "SELECT title, year, season, episode, episode_end, media_type, metadata_at, COALESCE(manual_match, 0)
                         FROM media_items WHERE id = ?1",
                        params![id],
                        |r| {
                            Ok(ExistingRow {
                                title: r.get(0)?,
                                year: r.get(1)?,
                                season: r.get(2)?,
                                episode: r.get(3)?,
                                episode_end: r.get(4)?,
                                media_type: r.get(5)?,
                                metadata_at: r.get(6)?,
                                manual_match: r.get(7)?,
                            })
                        },
                    )
                    .optional()
                    .map_err(|e| e.to_string())?;
            }
        }

        conn.execute(
            "INSERT INTO media_items
                (ftp_path, ftp_relative_path, filename, size_bytes, title, year, season, episode, episode_end,
                 resolution, codec, audio_codec, hdr, languages, release_type, release_group,
                 media_type, indexed_at)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,COALESCE(?18, ?19))
             ON CONFLICT(ftp_path) DO UPDATE SET
                ftp_relative_path=excluded.ftp_relative_path,
                filename=excluded.filename, size_bytes=excluded.size_bytes,
                title=excluded.title, year=excluded.year,
                season=excluded.season, episode=excluded.episode, episode_end=excluded.episode_end,
                resolution=excluded.resolution, codec=excluded.codec,
                audio_codec=excluded.audio_codec, hdr=excluded.hdr,
                languages=excluded.languages,
                release_type=excluded.release_type, release_group=excluded.release_group,
                media_type=COALESCE(excluded.media_type, media_items.media_type),
                indexed_at=CASE WHEN ?18 IS NOT NULL THEN ?18 ELSE media_items.indexed_at END",
            params![
                path,
                relative_path,
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
                // metadata_at is the canonical "we already fetched TMDB" flag.
                // tmdb_id being NULL with metadata_at set means no match was found — don't retry.
                // imdb_id is intentionally excluded: TV episodes and many TMDB items have no IMDb ID,
                // so checking it caused every re-index to re-queue all existing items.
                row.metadata_at.is_none()
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
        let conn = self.conn.lock().unwrap();
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
        let conn = self.conn.lock().unwrap();
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
        let conn = self.conn.lock().unwrap();
        conn.query_row(
            "SELECT media_type FROM media_items WHERE ftp_path = ?1 LIMIT 1",
            params![ftp_path],
            |row| row.get(0),
        ).optional()
    }

    pub fn get_tmdb_genres_by_path(&self, ftp_path: &str) -> SqlResult<Option<String>> {
        let conn = self.conn.lock().unwrap();
        conn.query_row(
            "SELECT tmdb_genres FROM media_items WHERE ftp_path = ?1 LIMIT 1",
            params![ftp_path],
            |row| row.get(0),
        ).optional()
    }

    pub fn clear_item_metadata(&self, id: i64) -> Result<(), String> {
        let conn = self.conn.lock().unwrap();
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
        let conn = self.conn.lock().unwrap();
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
        let conn = self.conn.lock().unwrap();
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

    // ── Watchlist ─────────────────────────────────────────────────────────────

    pub fn add_watchlist_item(
        &self,
        user_id: i64,
        tmdb_id: i64,
        tmdb_type: &str,
        title: &str,
        title_en: Option<&str>,
        poster: Option<&str>,
        overview: Option<&str>,
        overview_en: Option<&str>,
        status: Option<&str>,
        release_date: Option<&str>,
        year: Option<i64>,
        latest_season: Option<i64>,
        scope: &str,
        auto_download: bool,
        profile_id: i64,
    ) -> Result<i64, String> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO watchlist
                (user_id, tmdb_id, tmdb_type, title, title_en, poster, overview, overview_en,
                 status, release_date, year, latest_season, scope, auto_download, profile_id, added_at)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,datetime('now'))
             ON CONFLICT(user_id, tmdb_id) DO UPDATE SET
                scope         = excluded.scope,
                auto_download = excluded.auto_download,
                profile_id    = excluded.profile_id",
            params![
                user_id, tmdb_id, tmdb_type, title, title_en, poster, overview, overview_en,
                status, release_date, year, latest_season, scope, auto_download as i64, profile_id,
            ],
        )
        .map_err(|e| e.to_string())?;
        let id = conn.last_insert_rowid();
        Ok(id)
    }

    pub fn get_watchlist(&self, user_id: i64) -> Result<Vec<WatchlistItem>, String> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn
            .prepare(
                "SELECT w.id, w.user_id, w.tmdb_id, w.tmdb_type, w.title, w.title_en,
                        w.poster, w.overview, w.overview_en, w.status, w.release_date,
                        w.year, w.latest_season, w.next_episode_date, w.scope, w.auto_download,
                        w.profile_id, w.added_at,
                        COUNT(m.id) AS library_count,
                        CASE WHEN COUNT(m.id) > 0 THEN 'available' ELSE 'pending' END AS library_status
                 FROM watchlist w
                 LEFT JOIN media_items m ON m.tmdb_id = w.tmdb_id
                 WHERE w.user_id = ?1
                 GROUP BY w.id
                 ORDER BY w.added_at DESC",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![user_id], |row| {
                Ok(WatchlistItem {
                    id: row.get(0)?,
                    user_id: row.get(1)?,
                    tmdb_id: row.get(2)?,
                    tmdb_type: row.get(3)?,
                    title: row.get(4)?,
                    title_en: row.get(5)?,
                    poster: row.get(6)?,
                    overview: row.get(7)?,
                    overview_en: row.get(8)?,
                    status: row.get(9)?,
                    release_date: row.get(10)?,
                    year: row.get(11)?,
                    latest_season: row.get(12)?,
                    next_episode_date: row.get(13)?,
                    scope: row.get(14)?,
                    auto_download: row.get(15)?,
                    profile_id: row.get(16)?,
                    added_at: row.get(17)?,
                    library_count: row.get(18)?,
                    library_status: row.get(19)?,
                })
            })
            .map_err(|e| e.to_string())?;
        let mut out = Vec::new();
        for row in rows {
            out.push(row.map_err(|e| e.to_string())?);
        }
        Ok(out)
    }

    pub fn remove_watchlist_item(&self, id: i64, user_id: i64) -> Result<(), String> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "DELETE FROM watchlist WHERE id=?1 AND user_id=?2",
            params![id, user_id],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn update_watchlist_item(
        &self,
        id: i64,
        user_id: i64,
        scope: &str,
        auto_download: bool,
        profile_id: i64,
    ) -> Result<(), String> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE watchlist SET scope=?3, auto_download=?4, profile_id=?5 WHERE id=?1 AND user_id=?2",
            params![id, user_id, scope, auto_download as i64, profile_id],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn check_watchlist_item(
        &self,
        tmdb_id: i64,
        user_id: i64,
    ) -> Result<Option<WatchlistItem>, String> {
        let conn = self.conn.lock().unwrap();
        conn.query_row(
            "SELECT w.id, w.user_id, w.tmdb_id, w.tmdb_type, w.title, w.title_en,
                    w.poster, w.overview, w.overview_en, w.status, w.release_date,
                    w.year, w.latest_season, w.next_episode_date, w.scope, w.auto_download,
                    w.profile_id, w.added_at,
                    COUNT(m.id) AS library_count,
                    CASE WHEN COUNT(m.id) > 0 THEN 'available' ELSE 'pending' END AS library_status
             FROM watchlist w
             LEFT JOIN media_items m ON m.tmdb_id = w.tmdb_id
             WHERE w.tmdb_id=?1 AND w.user_id=?2
             GROUP BY w.id",
            params![tmdb_id, user_id],
            |row| {
                Ok(WatchlistItem {
                    id: row.get(0)?,
                    user_id: row.get(1)?,
                    tmdb_id: row.get(2)?,
                    tmdb_type: row.get(3)?,
                    title: row.get(4)?,
                    title_en: row.get(5)?,
                    poster: row.get(6)?,
                    overview: row.get(7)?,
                    overview_en: row.get(8)?,
                    status: row.get(9)?,
                    release_date: row.get(10)?,
                    year: row.get(11)?,
                    latest_season: row.get(12)?,
                    next_episode_date: row.get(13)?,
                    scope: row.get(14)?,
                    auto_download: row.get(15)?,
                    profile_id: row.get(16)?,
                    added_at: row.get(17)?,
                    library_count: row.get(18)?,
                    library_status: row.get(19)?,
                })
            },
        )
        .optional()
        .map_err(|e| e.to_string())
    }

    pub fn get_watchlist_library_coverage(
        &self,
        tmdb_id: i64,
    ) -> Result<Vec<WatchlistCoverageItem>, String> {
        // Build a set of ftp_paths that were explicitly downloaded via the queue (status = Done).
        let done_paths: std::collections::HashSet<String> = {
            let downloaded_items = self.load_download_state().unwrap_or_default();
            downloaded_items
                .into_iter()
                .filter(|d| matches!(d.status, crate::downloads::DownloadStatus::Done))
                .map(|d| d.ftp_path)
                .collect()
        };

        let conn = self.conn.lock().unwrap();
        let mut stmt = conn
            .prepare(
                "SELECT season, episode, filename, resolution, ftp_path
                 FROM media_items
                 WHERE tmdb_id=?1
                 ORDER BY season, episode",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![tmdb_id], |row| {
                let ftp_path: String = row.get(4)?;
                Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?, ftp_path))
            })
            .map_err(|e| e.to_string())?;
        let mut out = Vec::new();
        for row in rows {
            let (season, episode, filename, resolution, ftp_path) =
                row.map_err(|e| e.to_string())?;
            let downloaded = done_paths.contains(&ftp_path);
            out.push(WatchlistCoverageItem {
                season,
                episode,
                filename,
                resolution,
                ftp_path,
                downloaded,
            });
        }
        Ok(out)
    }

    /// Returns all media_items that match an auto_download=1 watchlist entry.
    /// Used by the post-indexing trigger to auto-queue new files.
    pub fn get_watchlist_auto_download_candidates(&self) -> Result<Vec<WatchlistAutoItem>, String> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn
            .prepare(
                "SELECT m.ftp_path, m.filename, m.tmdb_id,
                        m.media_type, m.tmdb_genres, COALESCE(m.tmdb_title, m.title),
                        m.resolution, m.release_type, m.hdr, m.codec, m.audio_codec,
                        m.size_bytes, w.profile_id, m.season, m.episode
                 FROM media_items m
                 INNER JOIN watchlist w ON w.tmdb_id = m.tmdb_id AND w.auto_download = 1",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |row| {
                Ok(WatchlistAutoItem {
                    ftp_path: row.get(0)?,
                    filename: row.get(1)?,
                    tmdb_id: row.get(2)?,
                    media_type: row.get(3)?,
                    tmdb_genres: row.get(4)?,
                    media_title: row.get(5)?,
                    resolution: row.get(6)?,
                    release_type: row.get(7)?,
                    hdr: row.get(8)?,
                    codec: row.get(9)?,
                    audio_codec: row.get(10)?,
                    size_bytes: row.get(11)?,
                    profile_id: row.get(12)?,
                    season: row.get(13)?,
                    episode: row.get(14)?,
                })
            })
            .map_err(|e| e.to_string())?;
        let mut out = Vec::new();
        for row in rows {
            out.push(row.map_err(|e| e.to_string())?);
        }
        Ok(out)
    }

    // ── Quality Profiles ─────────────────────────────────────────────────────

    pub fn get_quality_profiles(&self) -> Result<Vec<QualityProfile>, String> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn
            .prepare(
                "SELECT id, name, min_resolution, preferred_resolution, prefer_hdr,
                        preferred_codecs, preferred_audio_codecs, preferred_release_types,
                        min_size_gb, max_size_gb, is_builtin, created_at
                 FROM quality_profiles ORDER BY id",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |row| {
                Ok(QualityProfile {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    min_resolution: row.get(2)?,
                    preferred_resolution: row.get(3)?,
                    prefer_hdr: row.get::<_, i64>(4)? != 0,
                    preferred_codecs: row.get(5)?,
                    preferred_audio_codecs: row.get(6)?,
                    preferred_release_types: row.get(7)?,
                    min_size_gb: row.get(8)?,
                    max_size_gb: row.get(9)?,
                    is_builtin: row.get::<_, i64>(10)? != 0,
                    created_at: row.get(11)?,
                })
            })
            .map_err(|e| e.to_string())?;
        let mut out = Vec::new();
        for row in rows {
            out.push(row.map_err(|e| e.to_string())?);
        }
        Ok(out)
    }

    pub fn create_quality_profile(
        &self,
        name: &str,
        min_resolution: Option<&str>,
        preferred_resolution: Option<&str>,
        prefer_hdr: bool,
        preferred_codecs: &str,
        preferred_audio_codecs: &str,
        preferred_release_types: &str,
        min_size_gb: Option<f64>,
        max_size_gb: Option<f64>,
    ) -> Result<QualityProfile, String> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO quality_profiles
                (name, min_resolution, preferred_resolution, prefer_hdr,
                 preferred_codecs, preferred_audio_codecs, preferred_release_types,
                 min_size_gb, max_size_gb)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9)",
            params![
                name, min_resolution, preferred_resolution, prefer_hdr as i64,
                preferred_codecs, preferred_audio_codecs, preferred_release_types,
                min_size_gb, max_size_gb
            ],
        )
        .map_err(|e| e.to_string())?;
        let id = conn.last_insert_rowid();
        conn.query_row(
            "SELECT id, name, min_resolution, preferred_resolution, prefer_hdr,
                    preferred_codecs, preferred_audio_codecs, preferred_release_types,
                    min_size_gb, max_size_gb, is_builtin, created_at
             FROM quality_profiles WHERE id=?1",
            params![id],
            |row| Ok(QualityProfile {
                id: row.get(0)?,
                name: row.get(1)?,
                min_resolution: row.get(2)?,
                preferred_resolution: row.get(3)?,
                prefer_hdr: row.get::<_, i64>(4)? != 0,
                preferred_codecs: row.get(5)?,
                preferred_audio_codecs: row.get(6)?,
                preferred_release_types: row.get(7)?,
                min_size_gb: row.get(8)?,
                max_size_gb: row.get(9)?,
                is_builtin: row.get::<_, i64>(10)? != 0,
                created_at: row.get(11)?,
            }),
        )
        .map_err(|e| e.to_string())
    }

    pub fn update_quality_profile(
        &self,
        id: i64,
        name: &str,
        min_resolution: Option<&str>,
        preferred_resolution: Option<&str>,
        prefer_hdr: bool,
        preferred_codecs: &str,
        preferred_audio_codecs: &str,
        preferred_release_types: &str,
        min_size_gb: Option<f64>,
        max_size_gb: Option<f64>,
    ) -> Result<(), String> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE quality_profiles SET name=?2, min_resolution=?3, preferred_resolution=?4,
             prefer_hdr=?5, preferred_codecs=?6, preferred_audio_codecs=?7,
             preferred_release_types=?8, min_size_gb=?9, max_size_gb=?10 WHERE id=?1",
            params![
                id, name, min_resolution, preferred_resolution, prefer_hdr as i64,
                preferred_codecs, preferred_audio_codecs, preferred_release_types,
                min_size_gb, max_size_gb
            ],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn delete_quality_profile(&self, id: i64) -> Result<(), String> {
        let conn = self.conn.lock().unwrap();
        // Reset any watchlist items referencing this profile to 0 (no profile)
        conn.execute(
            "UPDATE watchlist SET profile_id=0 WHERE profile_id=?1",
            params![id],
        )
        .map_err(|e| e.to_string())?;
        conn.execute("DELETE FROM quality_profiles WHERE id=?1", params![id])
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    // ── Telegram personal subscriptions ──────────────────────────────────────

    pub fn get_telegram_sub(&self, user_id: i64) -> Result<Option<TelegramSub>, String> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn
            .prepare(
                "SELECT user_id, telegram_bot_token, telegram_chat_id, notify_new_content, notify_downloads, created_at
                 FROM telegram_subscriptions WHERE user_id=?1",
            )
            .map_err(|e| e.to_string())?;
        let mut rows = stmt.query(params![user_id]).map_err(|e| e.to_string())?;
        if let Some(row) = rows.next().map_err(|e| e.to_string())? {
            Ok(Some(TelegramSub {
                user_id: row.get(0).map_err(|e| e.to_string())?,
                telegram_bot_token: row.get(1).map_err(|e| e.to_string())?,
                telegram_chat_id: row.get(2).map_err(|e| e.to_string())?,
                notify_new_content: row.get::<_, i64>(3).map_err(|e| e.to_string())? != 0,
                notify_downloads: row.get::<_, i64>(4).map_err(|e| e.to_string())? != 0,
                created_at: row.get(5).map_err(|e| e.to_string())?,
            }))
        } else {
            Ok(None)
        }
    }

    pub fn upsert_telegram_sub(
        &self,
        user_id: i64,
        bot_token: &str,
        chat_id: &str,
        notify_new_content: bool,
        notify_downloads: bool,
    ) -> Result<(), String> {
        let conn = self.conn.lock().unwrap();
        let now = chrono::Utc::now().to_rfc3339();
        conn.execute(
            "INSERT INTO telegram_subscriptions
                 (user_id, telegram_bot_token, telegram_chat_id, notify_new_content, notify_downloads, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)
             ON CONFLICT(user_id) DO UPDATE SET
                 telegram_bot_token = excluded.telegram_bot_token,
                 telegram_chat_id   = excluded.telegram_chat_id,
                 notify_new_content = excluded.notify_new_content,
                 notify_downloads   = excluded.notify_downloads",
            params![
                user_id,
                bot_token,
                chat_id,
                notify_new_content as i64,
                notify_downloads as i64,
                now,
            ],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn delete_telegram_sub(&self, user_id: i64) -> Result<(), String> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "DELETE FROM telegram_subscriptions WHERE user_id=?1",
            params![user_id],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    /// Returns all active personal subscribers (for broadcast notifications).
    pub fn list_telegram_subs(&self) -> Result<Vec<TelegramSub>, String> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn
            .prepare(
                "SELECT user_id, telegram_bot_token, telegram_chat_id, notify_new_content, notify_downloads, created_at
                 FROM telegram_subscriptions",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |row| {
                Ok(TelegramSub {
                    user_id: row.get(0)?,
                    telegram_bot_token: row.get(1)?,
                    telegram_chat_id: row.get(2)?,
                    notify_new_content: row.get::<_, i64>(3)? != 0,
                    notify_downloads: row.get::<_, i64>(4)? != 0,
                    created_at: row.get(5)?,
                })
            })
            .map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
    }

}

// ── Fix 2: SQLite transaction tests ─────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;

    /// Helper: open an in-memory Db for testing (bypasses file I/O).
    fn in_memory_db() -> Db {
        let conn = Connection::open_in_memory().expect("in-memory db");
        Db::apply_migrations(&conn).expect("migrations");
        Db(Arc::new(Mutex::new(conn)))
    }

    /// Minimal ParsedMedia for inserting test rows.
    fn parsed(title: &str) -> crate::parser::ParsedMedia {
        crate::parser::ParsedMedia {
            title: title.to_string(),
            year: None,
            season: None,
            episode: None,
            episode_end: None,
            resolution: None,
            codec: None,
            audio_codec: None,
            hdr: None,
            languages: vec![],
            release_type: None,
            release_group: None,
        }
    }

    // ── begin/commit_batch ─────────────────────────────────────────────────

    #[test]
    fn batch_upsert_produces_same_results_as_individual_upserts() {
        let db = in_memory_db();
        let ftp_root = "/Compartida";

        // Insert 3 items inside a transaction.
        db.begin_batch().expect("begin_batch");
        for i in 0..3u32 {
            let path = format!("/Compartida/Movies/file{i}.mkv");
            let filename = format!("file{i}.mkv");
            db.upsert_media(
                &path,
                &filename,
                Some(1024),
                &parsed(&format!("Movie {i}")),
                Some("movie"),
                None,
                ftp_root,
            )
            .expect("upsert");
        }
        db.commit_batch().expect("commit_batch");

        let items = db.get_all_media().expect("get_all_media");
        assert_eq!(items.len(), 3);
        // Titles are stored; order is alphabetical by title
        let titles: Vec<_> = items.iter().filter_map(|i| i.title.as_deref()).collect();
        assert!(titles.contains(&"Movie 0"));
        assert!(titles.contains(&"Movie 1"));
        assert!(titles.contains(&"Movie 2"));
    }

    #[test]
    fn batch_upsert_is_idempotent_for_duplicate_paths() {
        let db = in_memory_db();
        let ftp_root = "/Compartida";
        let path = "/Compartida/Movies/dup.mkv";

        db.begin_batch().expect("begin");
        db.upsert_media(path, "dup.mkv", Some(100), &parsed("Original"), Some("movie"), None, ftp_root)
            .expect("first upsert");
        db.upsert_media(path, "dup.mkv", Some(200), &parsed("Updated"), Some("movie"), None, ftp_root)
            .expect("second upsert");
        db.commit_batch().expect("commit");

        let items = db.get_all_media().expect("get_all_media");
        // Must have exactly 1 row (upsert, not insert)
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].title.as_deref(), Some("Updated"));
        assert_eq!(items[0].size_bytes, Some(200));
    }

    #[test]
    fn rollback_batch_leaves_db_unchanged() {
        let db = in_memory_db();
        let ftp_root = "/Compartida";

        db.begin_batch().expect("begin");
        db.upsert_media(
            "/Compartida/Movies/abandoned.mkv",
            "abandoned.mkv",
            Some(999),
            &parsed("Ghost"),
            Some("movie"),
            None,
            ftp_root,
        )
        .expect("upsert");
        // Simulate failure: rollback instead of commit
        db.rollback_batch().expect("rollback");

        let items = db.get_all_media().expect("get_all_media");
        assert_eq!(items.len(), 0, "Rolled-back items must not persist");
    }

    // ── delete_media_missing_from_scan ────────────────────────────────────

    #[test]
    fn delete_missing_removes_stale_entries() {
        let db = in_memory_db();
        let ftp_root = "/Compartida";

        // Seed 3 items
        let paths = [
            "/Compartida/Movies/keep1.mkv",
            "/Compartida/Movies/keep2.mkv",
            "/Compartida/Movies/stale.mkv",
        ];
        db.begin_batch().expect("begin");
        for path in &paths {
            let filename = path.rsplit('/').next().unwrap();
            db.upsert_media(path, filename, Some(1), &parsed(filename), Some("movie"), None, ftp_root)
                .expect("upsert");
        }
        db.commit_batch().expect("commit");

        assert_eq!(db.get_all_media().expect("get_all_media").len(), 3);

        // Simulate a new scan that no longer sees "stale.mkv"
        let current = vec![
            "/Compartida/Movies/keep1.mkv".to_string(),
            "/Compartida/Movies/keep2.mkv".to_string(),
        ];
        let removed = db
            .delete_media_missing_from_scan(&current)
            .expect("delete_missing");

        assert_eq!(removed, 1);
        let remaining = db.get_all_media().expect("get_all_media");
        assert_eq!(remaining.len(), 2);
        let paths_left: Vec<_> = remaining.iter().map(|i| i.ftp_path.as_str()).collect();
        assert!(paths_left.contains(&"/Compartida/Movies/keep1.mkv"));
        assert!(paths_left.contains(&"/Compartida/Movies/keep2.mkv"));
    }

    #[test]
    fn delete_missing_with_empty_scan_removes_all() {
        let db = in_memory_db();
        let ftp_root = "/Compartida";

        db.begin_batch().expect("begin");
        db.upsert_media(
            "/Compartida/Movies/orphan.mkv",
            "orphan.mkv",
            Some(1),
            &parsed("Orphan"),
            Some("movie"),
            None,
            ftp_root,
        )
        .expect("upsert");
        db.commit_batch().expect("commit");

        let removed = db.delete_media_missing_from_scan(&[]).expect("delete_missing");
        assert_eq!(removed, 1);
        assert_eq!(db.get_all_media().expect("get_all_media").len(), 0);
    }

    #[test]
    fn delete_missing_is_no_op_when_all_paths_present() {
        let db = in_memory_db();
        let ftp_root = "/Compartida";
        let paths: Vec<String> = (0..5)
            .map(|i| format!("/Compartida/Movies/file{i}.mkv"))
            .collect();

        db.begin_batch().expect("begin");
        for path in &paths {
            let filename = path.rsplit('/').next().unwrap();
            db.upsert_media(path, filename, Some(1), &parsed(filename), Some("movie"), None, ftp_root)
                .expect("upsert");
        }
        db.commit_batch().expect("commit");

        let removed = db.delete_media_missing_from_scan(&paths).expect("delete_missing");
        assert_eq!(removed, 0);
        assert_eq!(db.get_all_media().expect("get_all_media").len(), 5);
    }
}
