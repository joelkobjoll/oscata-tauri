#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
ENV_FILE="${ENV_FILE:-${REPO_ROOT}/.env.docker-vnc}"

load_env_file() {
  local env_file="$1"
  local line key value

  [[ -f "$env_file" ]] || return 0

  while IFS= read -r line || [[ -n "$line" ]]; do
    [[ -z "$line" || "$line" =~ ^[[:space:]]*# ]] && continue

    if [[ "$line" =~ ^[[:space:]]*([A-Za-z_][A-Za-z0-9_]*)=(.*)$ ]]; then
      key="${BASH_REMATCH[1]}"
      value="${BASH_REMATCH[2]}"

      # Remove optional surrounding single/double quotes in dotenv values.
      if [[ "$value" =~ ^\".*\"$ || "$value" =~ ^\'.*\'$ ]]; then
        value="${value:1:${#value}-2}"
      fi

      # Keep already-exported values (inline env) as highest priority.
      if [[ -z "${!key+x}" ]]; then
        export "$key=$value"
      fi
    fi
  done < "$env_file"
}

load_env_file "$ENV_FILE"

IMAGE_NAME="${IMAGE_NAME:-oscata-vnc:local}"
CONTAINER_NAME="${CONTAINER_NAME:-oscata-vnc}"
CONFIG_DIR="${CONFIG_DIR:-${REPO_ROOT}/.docker-data/config}"
DOWNLOADS_DIR="${DOWNLOADS_DIR:-${REPO_ROOT}/.docker-data/downloads}"
# Backward-compatible aliases:
# - VNC_PORT / NOVNC_PORT / WEBGUI_PORT are interpreted as HOST ports.
VNC_HOST_PORT="${VNC_HOST_PORT:-${VNC_PORT:-5900}}"
NOVNC_HOST_PORT="${NOVNC_HOST_PORT:-${NOVNC_PORT:-6080}}"
WEBGUI_HOST_PORT="${WEBGUI_HOST_PORT:-${WEBGUI_PORT:-47860}}"

# Advanced overrides for container-side ports.
VNC_CONTAINER_PORT="${VNC_CONTAINER_PORT:-5900}"
NOVNC_CONTAINER_PORT="${NOVNC_CONTAINER_PORT:-6080}"
WEBGUI_CONTAINER_PORT="${WEBGUI_CONTAINER_PORT:-47860}"

VNC_RESOLUTION="${VNC_RESOLUTION:-1440x960}"
OSCATA_BOOTSTRAP_WEBGUI="${OSCATA_BOOTSTRAP_WEBGUI:-1}"
VNC_PASSWORD="${VNC_PASSWORD:-}"

usage() {
  cat <<EOF
Usage: $(basename "$0") <command>

Commands:
  build    Build the Docker image only
  run      Run the container with restart unless-stopped
  up       Build the image, then run the container
  stop     Stop and remove the container
  logs     Tail the container logs

Environment overrides:
  IMAGE_NAME, CONTAINER_NAME, CONFIG_DIR, DOWNLOADS_DIR,
  VNC_HOST_PORT, NOVNC_HOST_PORT, WEBGUI_HOST_PORT,
  VNC_CONTAINER_PORT, NOVNC_CONTAINER_PORT, WEBGUI_CONTAINER_PORT,
  VNC_PORT, NOVNC_PORT, WEBGUI_PORT, VNC_RESOLUTION,
  VNC_PASSWORD, OSCATA_BOOTSTRAP_WEBGUI, ENV_FILE

Default env file:
  ${REPO_ROOT}/.env.docker-vnc
EOF
}

require_docker() {
  if ! command -v docker >/dev/null 2>&1; then
    echo "docker is not installed or not in PATH" >&2
    exit 1
  fi
}

ensure_dirs() {
  mkdir -p "$CONFIG_DIR" "$DOWNLOADS_DIR"
}

build_image() {
  require_docker
  echo "[docker-vnc] building image ${IMAGE_NAME}"
  docker build -f "${REPO_ROOT}/docker/Dockerfile" -t "$IMAGE_NAME" "$REPO_ROOT"
}

run_container() {
  require_docker
  ensure_dirs
  local docker_args

  docker_args=(
    -d
    --name "$CONTAINER_NAME"
    --restart unless-stopped
    -p "${VNC_HOST_PORT}:${VNC_CONTAINER_PORT}"
    -p "${NOVNC_HOST_PORT}:${NOVNC_CONTAINER_PORT}"
    -p "${WEBGUI_HOST_PORT}:${WEBGUI_CONTAINER_PORT}"
    -e "VNC_PORT=${VNC_CONTAINER_PORT}"
    -e "NOVNC_PORT=${NOVNC_CONTAINER_PORT}"
    -e "VNC_RESOLUTION=${VNC_RESOLUTION}"
    -e "OSCATA_BOOTSTRAP_WEBGUI=${OSCATA_BOOTSTRAP_WEBGUI}"
    -e "OSCATA_WEBGUI_HOST=0.0.0.0"
    -e "OSCATA_WEBGUI_PORT=${WEBGUI_CONTAINER_PORT}"
    -e "OSCATA_WEBGUI_EXPOSED_PORT=${WEBGUI_HOST_PORT}"
    -v "${CONFIG_DIR}:/config"
    -v "${DOWNLOADS_DIR}:/downloads"
  )

  if [[ -n "$VNC_PASSWORD" ]]; then
    docker_args+=( -e "VNC_PASSWORD=${VNC_PASSWORD}" )
  fi

  if docker ps -a --format '{{.Names}}' | grep -Fxq "$CONTAINER_NAME"; then
    echo "[docker-vnc] removing existing container ${CONTAINER_NAME}"
    docker rm -f "$CONTAINER_NAME" >/dev/null
  fi

  echo "[docker-vnc] starting container ${CONTAINER_NAME}"
  docker run "${docker_args[@]}" "$IMAGE_NAME"

  cat <<EOF
[docker-vnc] container started
  VNC:    vnc://localhost:${VNC_HOST_PORT} (container:${VNC_CONTAINER_PORT})
  noVNC:  http://localhost:${NOVNC_HOST_PORT}/vnc.html (container:${NOVNC_CONTAINER_PORT})
  WebGUI: http://localhost:${WEBGUI_HOST_PORT} (container:${WEBGUI_CONTAINER_PORT})
  Config: ${CONFIG_DIR}
  Files:  ${DOWNLOADS_DIR}
EOF
}

stop_container() {
  require_docker
  if docker ps -a --format '{{.Names}}' | grep -Fxq "$CONTAINER_NAME"; then
    echo "[docker-vnc] stopping ${CONTAINER_NAME}"
    docker rm -f "$CONTAINER_NAME"
  else
    echo "[docker-vnc] container ${CONTAINER_NAME} does not exist"
  fi
}

tail_logs() {
  require_docker
  docker logs -f "$CONTAINER_NAME"
}

COMMAND="${1:-}"

case "$COMMAND" in
  build)
    build_image
    ;;
  run)
    run_container
    ;;
  up)
    build_image
    run_container
    ;;
  stop)
    stop_container
    ;;
  logs)
    tail_logs
    ;;
  ""|-h|--help|help)
    usage
    ;;
  *)
    echo "Unknown command: $COMMAND" >&2
    usage
    exit 1
    ;;
esac
