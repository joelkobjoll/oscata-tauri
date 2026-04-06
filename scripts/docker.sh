#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
ENV_FILE="${ENV_FILE:-${REPO_ROOT}/.env.docker}"

load_env_file() {
  local env_file="$1"
  local line key value

  [[ -f "$env_file" ]] || return 0

  while IFS= read -r line || [[ -n "$line" ]]; do
    [[ -z "$line" || "$line" =~ ^[[:space:]]*# ]] && continue

    if [[ "$line" =~ ^[[:space:]]*([A-Za-z_][A-Za-z0-9_]*)=(.*)$ ]]; then
      key="${BASH_REMATCH[1]}"
      value="${BASH_REMATCH[2]}"

      if [[ "$value" =~ ^\".*\"$ || "$value" =~ ^\'.*\'$ ]]; then
        value="${value:1:${#value}-2}"
      fi

      if [[ -z "${!key+x}" ]]; then
        export "$key=$value"
      fi
    fi
  done < "$env_file"
}

load_env_file "$ENV_FILE"

IMAGE_NAME="${IMAGE_NAME:-oscata:local}"
CONTAINER_NAME="${CONTAINER_NAME:-oscata}"
CONFIG_DIR="${CONFIG_DIR:-${REPO_ROOT}/.docker-data/config}"
DOWNLOADS_DIR="${DOWNLOADS_DIR:-${REPO_ROOT}/.docker-data/downloads}"
WEBGUI_HOST_PORT="${WEBGUI_HOST_PORT:-${WEBGUI_PORT:-47860}}"
WEBGUI_CONTAINER_PORT="${WEBGUI_CONTAINER_PORT:-47860}"

usage() {
  cat <<EOF
Uso: $(basename "$0") <comando>

Comandos:
  build    Construye la imagen Docker
  run      Arranca el contenedor (restart: unless-stopped)
  up       build + run en un paso
  stop     Para y elimina el contenedor
  logs     Muestra los logs en tiempo real

Variables de entorno:
  IMAGE_NAME, CONTAINER_NAME, CONFIG_DIR, DOWNLOADS_DIR,
  WEBGUI_HOST_PORT (alias: WEBGUI_PORT), WEBGUI_CONTAINER_PORT,
  ENV_FILE (por defecto: ${REPO_ROOT}/.env.docker)
EOF
}

require_docker() {
  if ! command -v docker >/dev/null 2>&1; then
    echo "docker no está instalado o no está en el PATH" >&2
    exit 1
  fi
}

ensure_dirs() {
  mkdir -p "$CONFIG_DIR" "$DOWNLOADS_DIR"
}

build_image() {
  require_docker
  echo "[oscata-docker] construyendo imagen ${IMAGE_NAME}"
  docker build -f "${REPO_ROOT}/docker/Dockerfile" -t "$IMAGE_NAME" "$REPO_ROOT"
}

run_container() {
  require_docker
  ensure_dirs

  if docker ps -a --format '{{.Names}}' | grep -Fxq "$CONTAINER_NAME"; then
    echo "[oscata-docker] eliminando contenedor existente ${CONTAINER_NAME}"
    docker rm -f "$CONTAINER_NAME" >/dev/null
  fi

  echo "[oscata-docker] arrancando contenedor ${CONTAINER_NAME}"
  docker run -d \
    --name "$CONTAINER_NAME" \
    --restart unless-stopped \
    -p "${WEBGUI_HOST_PORT}:${WEBGUI_CONTAINER_PORT}" \
    -e "OSCATA_WEBGUI_PORT=${WEBGUI_CONTAINER_PORT}" \
    -e "OSCATA_WEBGUI_EXPOSED_PORT=${WEBGUI_HOST_PORT}" \
    -v "${CONFIG_DIR}:/config" \
    -v "${DOWNLOADS_DIR}:/downloads" \
    "$IMAGE_NAME"

  echo "[oscata-docker] contenedor arrancado"
  echo "  Web UI → http://localhost:${WEBGUI_HOST_PORT}"
  echo "  Config → ${CONFIG_DIR}"
  echo "  Descargas → ${DOWNLOADS_DIR}"
}

stop_container() {
  require_docker
  if docker ps -a --format '{{.Names}}' | grep -Fxq "$CONTAINER_NAME"; then
    echo "[oscata-docker] deteniendo ${CONTAINER_NAME}"
    docker rm -f "$CONTAINER_NAME"
  else
    echo "[oscata-docker] el contenedor ${CONTAINER_NAME} no existe"
  fi
}

tail_logs() {
  require_docker
  docker logs -f "$CONTAINER_NAME"
}

COMMAND="${1:-}"

case "$COMMAND" in
  build) build_image ;;
  run)   run_container ;;
  up)    build_image && run_container ;;
  stop)  stop_container ;;
  logs)  tail_logs ;;
  ""|-h|--help|help) usage ;;
  *) echo "Comando desconocido: $COMMAND" >&2; usage; exit 1 ;;
esac
