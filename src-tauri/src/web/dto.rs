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


