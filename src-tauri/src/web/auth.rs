use axum::{
    extract::FromRequestParts,
    http::{request::Parts, StatusCode},
};
use axum::{
    middleware::Next,
    response::{IntoResponse, Response},
    Json,
};
use rand::Rng;

use crate::web::AppState;

// ── Extractors ───────────────────────────────────────────────────────────────

/// Injected into request extensions by `auth_middleware`.
/// Handlers that require auth use this extractor — returns 401 if absent.
#[derive(Debug, Clone)]
pub struct AuthUser(pub crate::db::WebUser);

impl<S: Send + Sync> FromRequestParts<S> for AuthUser {
    type Rejection = (StatusCode, Json<serde_json::Value>);

    fn from_request_parts(parts: &mut Parts, _: &S) -> impl std::future::Future<Output = Result<Self, Self::Rejection>> + Send {
        let result = parts
            .extensions
            .get::<crate::db::WebUser>()
            .cloned()
            .map(AuthUser)
            .ok_or_else(|| {
                (StatusCode::UNAUTHORIZED, Json(serde_json::json!({"error": "Unauthorized"})))
            });
        std::future::ready(result)
    }
}

/// Like AuthUser but also rejects non-admin users with 403.
pub struct AdminUser(pub crate::db::WebUser);

impl<S: Send + Sync> FromRequestParts<S> for AdminUser {
    type Rejection = (StatusCode, Json<serde_json::Value>);

    fn from_request_parts(parts: &mut Parts, _: &S) -> impl std::future::Future<Output = Result<Self, Self::Rejection>> + Send {
        let result = match parts.extensions.get::<crate::db::WebUser>().cloned() {
            None => Err((StatusCode::UNAUTHORIZED, Json(serde_json::json!({"error": "Unauthorized"})))),
            Some(user) if user.role != "admin" => Err((StatusCode::FORBIDDEN, Json(serde_json::json!({"error": "Admin required"})))),
            Some(user) => Ok(AdminUser(user)),
        };
        std::future::ready(result)
    }
}

// ── Middleware ────────────────────────────────────────────────────────────────

/// Reads the Bearer token and, if valid, inserts the `WebUser` into request
/// extensions. Requests without a token pass through — individual handlers
/// enforce auth via the `AuthUser` / `AdminUser` extractors.
pub async fn auth_middleware(
    axum::extract::State(state): axum::extract::State<AppState>,
    mut req: axum::http::Request<axum::body::Body>,
    next: Next,
) -> Response {
    let token = req
        .headers()
        .get("authorization")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "))
        .map(|s| s.trim().to_string());

    if let Some(tok) = token {
        if let Ok(Some(user)) = state.db.validate_web_session(&tok) {
            req.extensions_mut().insert(user);
        }
    }

    next.run(req).await
}

// ── API error helper ──────────────────────────────────────────────────────────

pub struct ApiError {
    pub status: StatusCode,
    pub message: String,
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        (self.status, Json(serde_json::json!({"error": self.message}))).into_response()
    }
}

impl ApiError {
    pub fn bad_request(msg: impl Into<String>) -> Self {
        Self { status: StatusCode::BAD_REQUEST, message: msg.into() }
    }
    pub fn unauthorized() -> Self {
        Self { status: StatusCode::UNAUTHORIZED, message: "Unauthorized".into() }
    }
    pub fn not_found(msg: impl Into<String>) -> Self {
        Self { status: StatusCode::NOT_FOUND, message: msg.into() }
    }
    pub fn internal(msg: impl Into<String>) -> Self {
        Self { status: StatusCode::INTERNAL_SERVER_ERROR, message: msg.into() }
    }
}

impl From<String> for ApiError {
    fn from(s: String) -> Self {
        Self::internal(s)
    }
}

pub type ApiResult<T> = Result<T, ApiError>;

// ── Password / token utilities ───────────────────────────────────────────────

pub fn hash_password(password: &str) -> Result<String, String> {
    bcrypt::hash(password, bcrypt::DEFAULT_COST).map_err(|e| e.to_string())
}

pub fn verify_password(password: &str, hash: &str) -> Result<bool, String> {
    bcrypt::verify(password, hash).map_err(|e| e.to_string())
}

pub fn new_session_token() -> String {
    uuid::Uuid::new_v4().to_string()
}

pub fn generate_otp() -> String {
    let mut rng = rand::thread_rng();
    format!("{:06}", rng.gen_range(0..1_000_000u32))
}
