use serde::{Deserialize, Serialize};

// ── Auth ─────────────────────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct BootstrapRequest {
    pub email: String,
    pub password: String,
}

#[derive(Debug, Deserialize)]
pub struct LoginRequest {
    pub email: String,
    pub password: String,
}

#[derive(Debug, Serialize)]
#[serde(tag = "state")]
pub enum LoginResponse {
    #[serde(rename = "ok")]
    Ok { token: String, user: UserResponse },
    #[serde(rename = "otp_required")]
    OtpRequired { challenge_id: String },
}

#[derive(Debug, Deserialize)]
pub struct OtpVerifyRequest {
    pub challenge_id: String,
    pub code: String,
}

#[derive(Debug, Serialize, Clone)]
pub struct UserResponse {
    pub id: i64,
    pub email: String,
    pub role: String,
    pub is_active: bool,
}

impl From<crate::db::WebUser> for UserResponse {
    fn from(u: crate::db::WebUser) -> Self {
        let role = if u.role == "viewer" { "user".to_string() } else { u.role };
        Self { id: u.id, email: u.email, role, is_active: u.is_active }
    }
}

// ── User management ──────────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct CreateUserRequest {
    pub email: String,
    pub password: String,
    pub role: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct InviteUserRequest {
    pub email: Option<String>,
    pub role: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct InviteUserResponse {
    pub invited: bool,
    pub invite_token: String,
    pub invite_link: String,
    pub expires_at: String,
    pub email: Option<String>,
    pub role: String,
}

#[derive(Debug, Deserialize)]
pub struct InviteAcceptRequest {
    pub token: String,
    pub email: String,
    pub password: String,
}

#[derive(Debug, Deserialize)]
pub struct UpdateUserRequest {
    pub email: Option<String>,
    pub password: Option<String>,
    pub role: Option<String>,
    pub is_active: Option<bool>,
}

// ── Downloads ────────────────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct QueueDownloadRequest {
    pub ftp_path: String,
    pub filename: String,
    pub media_title: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct SetConcurrencyRequest {
    pub max: usize,
}

// ── Indexing ─────────────────────────────────────────────────────────────────

#[derive(Debug, Serialize)]
pub struct IndexingStatusResponse {
    pub running: bool,
    pub last_indexed_at: Option<String>,
}

// ── Server info ──────────────────────────────────────────────────────────────

#[derive(Debug, Serialize)]
pub struct ServerInfoResponse {
    pub bind_host: String,
    pub bind_port: u16,
    pub exposed_port: Option<u16>,
    pub app_url: String,
    pub otp_enabled: bool,
    pub has_config: bool,
    pub bootstrap_required: bool,
    pub version: String,
}

// ── TMDB ─────────────────────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct TmdbSearchRequest {
    pub query: String,
    pub media_type: Option<String>,
    pub year: Option<i64>,
}

#[derive(Debug, Deserialize)]
pub struct ApplyMatchRequest {
    pub tmdb_id: i64,
    pub media_type: String,
}

// ── Media actions ────────────────────────────────────────────────────────────

// ── Watchlist ─────────────────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct AddWatchlistRequest {
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
    pub scope: Option<String>,
    pub auto_download: Option<bool>,
    pub profile_id: Option<i64>,
}

#[derive(Debug, Deserialize)]
pub struct UpdateWatchlistRequest {
    pub scope: String,
    pub auto_download: bool,
    pub profile_id: Option<i64>,
}

#[derive(Debug, Deserialize)]
pub struct CreateQualityProfileRequest {
    pub name: String,
    pub min_resolution: Option<String>,
    pub preferred_resolution: Option<String>,
    pub prefer_hdr: bool,
    pub preferred_codecs: String,
    pub preferred_audio_codecs: String,
    pub preferred_release_types: String,
    pub min_size_gb: Option<f64>,
    pub max_size_gb: Option<f64>,
}

#[derive(Debug, Deserialize)]
pub struct UpdateQualityProfileRequest {
    pub name: String,
    pub min_resolution: Option<String>,
    pub preferred_resolution: Option<String>,
    pub prefer_hdr: bool,
    pub preferred_codecs: String,
    pub preferred_audio_codecs: String,
    pub preferred_release_types: String,
    pub min_size_gb: Option<f64>,
    pub max_size_gb: Option<f64>,
}

// ─── Telegram personal subscription DTOs ──────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct LinkTelegramBotRequest {
    pub bot_token: String,
}

#[derive(Debug, Deserialize)]
pub struct UpdateTelegramSubRequest {
    pub notify_new_content: bool,
    pub notify_downloads: bool,
}


#[derive(Debug, Deserialize)]
pub struct TestFtpRequest {
    pub host: String,
    pub port: u16,
    pub user: String,
    pub pass: String,
}
