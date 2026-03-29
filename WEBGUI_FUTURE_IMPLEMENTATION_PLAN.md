# WEBGUI Future Implementation Plan

## Goal
Add an optional WEBGUI mode for Oscata that can be enabled for LAN access with web-only authentication, while preserving current desktop behavior when WEBGUI is disabled.

## Scope (v1)
- LAN access on same network.
- Single-admin bootstrap flow, then admin-managed user CRUD.
- Full responsive UI coverage for login, library, detail panels, settings, and wizard.
- WEBGUI runs only while the desktop app process is alive (including tray/background mode).
- Optional email OTP flow for web login via SMTP.
- Configurable public APP_URL for reverse-proxy deployments.

## Phase 1: Foundation
1. Add WEBGUI settings in app config:
   - enabled
   - host
   - port (internal bind)
   - exposed_port (public external port shown in links and API metadata)
   - app_url (canonical public URL when behind reverse proxy)
   - otp_enabled (optional)
   - smtp_host / smtp_port / smtp_user / smtp_pass / smtp_from
2. Add backend module boundaries:
   - `src-tauri/src/web/mod.rs`
   - `src-tauri/src/web/routes.rs`
   - `src-tauri/src/web/auth.rs`
   - `src-tauri/src/web/dto.rs`
3. Wire WEBGUI startup and shutdown from `src-tauri/src/lib.rs` so server starts only when enabled.
4. Keep desktop IPC behavior unchanged.

## Phase 2: Shared Service Layer
1. Extract business logic from Tauri commands into reusable services so both IPC and HTTP handlers call the same code.
2. Prioritize extraction for:
   - media listing/updates
   - download queue operations
   - indexing status/start actions

## Phase 3: Auth and User Management (Web-only)
1. Add DB migrations in `src-tauri/src/db.rs` for:
   - users
   - sessions
   - otp_challenges (hashed code, expiry, attempts)
   - optional audit log table
2. Implement bootstrap admin endpoint (only when no users exist).
3. Implement login/logout/current-user/session validation.
4. Implement admin-only user CRUD endpoints.
5. Add optional OTP login step:
   - if otp_enabled is false: normal password login
   - if otp_enabled is true: password check + email OTP challenge/verify
6. Add SMTP connectivity validation command and safe secret handling for SMTP credentials.

## Phase 4: HTTP API Surface
1. Add API endpoints for:
   - media list/filter/read
   - metadata actions
   - download queue actions
   - indexing start/status
   - essential settings read/write
2. Start with polling for progress/status in v1.
3. Consider SSE/WebSocket in v1.1.
4. Expose effective server metadata endpoint (bind host/port, exposed_port, app_url) for frontend and diagnostics.

## Phase 5: Frontend Web Shell
1. Add transport abstraction in frontend so feature hooks can use:
   - Tauri invoke (desktop)
   - HTTP API (web)
2. Add auth context + protected routing for web mode.
3. Add user management page (xbytes-astro inspired focus):
   - user list
   - create user
   - edit user
   - delete user
4. Add optional OTP verification screen in login flow when backend requires OTP.
5. Use app_url for absolute links/share actions and fallback to exposed_port if app_url is empty.

## Phase 6: Responsive UI Pass
1. Convert right-side desktop panels to responsive variants:
   - desktop docked side panel
   - mobile/tablet bottom sheet or full-screen modal
2. Add responsive navigation and filter layouts.
3. Make settings and wizard fully responsive with no overlap/overflow regressions.

## Phase 7: Background Behavior and Security Hardening
1. Ensure tray/background behavior keeps process alive and WEBGUI reachable while process runs.
2. Ensure WEBGUI stops when app process exits.
3. Add hardening:
   - host/bind validation
   - exposed_port and app_url validation (reject malformed public URL)
   - trusted proxy handling for forwarded headers when app_url is set
   - origin/CORS policy
   - SMTP timeout/retry limits and OTP attempt throttling
   - session expiration and invalidation
   - sensitive logging redaction

## Testing and Verification Checklist
- `cd src-tauri && cargo check`
- `npx tsc --noEmit`
- `npm run build`
- Auth flow tests:
  - bootstrap admin
  - login/logout
   - optional OTP challenge/verify success and failure paths
   - OTP expiry and max-attempt lock behavior
  - unauthorized access rejection
  - admin-only user CRUD authorization
- SMTP config validation tests (valid TLS settings, auth failure, timeout handling).
- Reverse-proxy tests for app_url and exposed_port behavior in generated links and callback URLs.
- API smoke tests for media/download/indexing/settings actions.
- Responsive QA at mobile, tablet, desktop breakpoints.
- Regression QA with WEBGUI disabled to confirm current desktop flow remains unchanged.

## Suggested Implementation Order
1. Phase 1 + Phase 2
2. Phase 3
3. Phase 4
4. Phase 5
5. Phase 6
6. Phase 7
