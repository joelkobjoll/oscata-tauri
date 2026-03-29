#!/usr/bin/env bash
set -Eeuo pipefail

APP_DIR="/opt/oscata"
APP_BIN="$APP_DIR/oscata-tauri"
APP_DB_PATH="${XDG_DATA_HOME}/oscata-tauri/library.db"
BOOTSTRAP_MARKER="${XDG_DATA_HOME}/oscata-tauri/.docker_webgui_bootstrapped"
XVFB_PID=""
FLUXBOX_PID=""
X11VNC_PID=""
NOVNC_PID=""
APP_PID=""

log() {
  printf '[oscata-docker] %s\n' "$*"
}

sqlite_escape() {
  printf '%s' "$1" | sed "s/'/''/g"
}

cleanup() {
  local exit_code=$?

  for pid in "$APP_PID" "$NOVNC_PID" "$X11VNC_PID" "$FLUXBOX_PID" "$XVFB_PID" "${DBUS_SESSION_BUS_PID:-}"; do
    if [[ -n "${pid}" ]] && kill -0 "${pid}" 2>/dev/null; then
      kill "${pid}" 2>/dev/null || true
    fi
  done

  wait || true
  exit "$exit_code"
}

trap cleanup EXIT INT TERM

mkdir -p \
  "$HOME" \
  "$XDG_CONFIG_HOME" \
  "$XDG_CACHE_HOME" \
  "$XDG_DATA_HOME/oscata-tauri" \
  /downloads

eval "$(dbus-launch --sh-syntax)"

log "Starting Xvfb on display ${DISPLAY}"
Xvfb "$DISPLAY" -screen 0 "${VNC_RESOLUTION}x${VNC_COL_DEPTH}" -ac +extension GLX +render -noreset &
XVFB_PID=$!
sleep 1

log "Starting fluxbox"
fluxbox >/tmp/fluxbox.log 2>&1 &
FLUXBOX_PID=$!
sleep 1

if [[ -n "${VNC_PASSWORD:-}" ]]; then
  log "Configuring VNC password authentication"
  mkdir -p /config/.vnc
  x11vnc -storepasswd "$VNC_PASSWORD" /config/.vnc/passwd >/dev/null
  X11VNC_PASSWORD_ARGS=(-rfbauth /config/.vnc/passwd)
else
  log "Starting VNC without password"
  X11VNC_PASSWORD_ARGS=(-nopw)
fi

log "Starting x11vnc on port ${VNC_PORT}"
x11vnc \
  -display "$DISPLAY" \
  -forever \
  -shared \
  -rfbport "$VNC_PORT" \
  -xkb \
  -ncache 10 \
  "${X11VNC_PASSWORD_ARGS[@]}" \
  >/tmp/x11vnc.log 2>&1 &
X11VNC_PID=$!

if command -v websockify >/dev/null 2>&1 && [[ -d /usr/share/novnc ]]; then
  log "Starting noVNC on port ${NOVNC_PORT}"
  websockify --web=/usr/share/novnc/ "$NOVNC_PORT" "127.0.0.1:${VNC_PORT}" >/tmp/novnc.log 2>&1 &
  NOVNC_PID=$!
fi

launch_app() {
  log "Launching Oscata desktop app"
  "$APP_BIN" >/tmp/oscata-app.log 2>&1 &
  APP_PID=$!
}

stop_app() {
  if [[ -n "$APP_PID" ]] && kill -0 "$APP_PID" 2>/dev/null; then
    log "Stopping Oscata desktop app"
    kill "$APP_PID" 2>/dev/null || true
    wait "$APP_PID" || true
  fi
  APP_PID=""
}

bootstrap_webgui_if_needed() {
  if [[ "${OSCATA_BOOTSTRAP_WEBGUI:-1}" != "1" ]]; then
    log "Skipping WebGUI bootstrap because OSCATA_BOOTSTRAP_WEBGUI is disabled"
    return
  fi

  if [[ -f "$BOOTSTRAP_MARKER" ]]; then
    log "WebGUI bootstrap already completed earlier"
    return
  fi

  launch_app

  log "Waiting for SQLite app database"
  for _ in $(seq 1 60); do
    if [[ -f "$APP_DB_PATH" ]] && sqlite3 "$APP_DB_PATH" ".tables" 2>/dev/null | grep -q '\bapp_config\b'; then
      break
    fi
    sleep 1
  done

  if [[ ! -f "$APP_DB_PATH" ]]; then
    log "Database did not appear during bootstrap; leaving app running"
    return
  fi

  local webgui_port="${OSCATA_WEBGUI_PORT:-47860}"
  local exposed_port="${OSCATA_WEBGUI_EXPOSED_PORT:-$webgui_port}"
  local app_url="${OSCATA_WEBGUI_APP_URL:-}"
  local otp_enabled="${OSCATA_WEBGUI_OTP_ENABLED:-0}"
  local webgui_host
  local webgui_host_sql
  local app_url_sql

  webgui_host="${OSCATA_WEBGUI_HOST:-0.0.0.0}"
  webgui_host_sql="$(sqlite_escape "$webgui_host")"
  app_url_sql="$(sqlite_escape "$app_url")"

  log "Persisting WebGUI bootstrap settings into SQLite config"
  sqlite3 "$APP_DB_PATH" <<SQL
INSERT OR REPLACE INTO app_config (key, value) VALUES
  ('webgui_enabled', '1'),
  ('webgui_host', '${webgui_host_sql}'),
  ('webgui_port', '${webgui_port}'),
  ('webgui_exposed_port', '${exposed_port}'),
  ('webgui_app_url', '${app_url_sql}'),
  ('webgui_otp_enabled', '${otp_enabled}');
SQL

  touch "$BOOTSTRAP_MARKER"
  stop_app
}

bootstrap_webgui_if_needed

if [[ -z "$APP_PID" ]]; then
  launch_app
fi

log "Container ready: VNC=${VNC_PORT} noVNC=${NOVNC_PORT} WebGUI=${OSCATA_WEBGUI_PORT}"
wait "$APP_PID"
