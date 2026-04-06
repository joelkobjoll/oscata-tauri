#!/usr/bin/env bash
set -Eeuo pipefail

mkdir -p "$HOME" "$XDG_CONFIG_HOME" "$XDG_CACHE_HOME" "$XDG_DATA_HOME/oscata-tauri" /downloads

# Tauri/WebKit requires a display even in headless mode.
# We start a minimal 1×1 virtual display; the actual window is hidden by OSCATA_HEADLESS=1.
Xvfb :99 -screen 0 1x1x8 -ac -nolisten tcp &

exec /opt/oscata/oscata-tauri
