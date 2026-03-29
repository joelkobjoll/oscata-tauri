# Docker VNC Runtime

This folder adds an isolated Docker path for running the existing Linux Tauri desktop build under VNC, with the existing WebGUI port exposed for power-user access. It does not replace the native desktop release flow.

## What It Does

- Builds the app for Linux inside Docker
- Starts the desktop app automatically under `Xvfb + fluxbox + x11vnc`
- Exposes raw VNC on port `5900`
- Exposes browser-based noVNC on port `6080`
- Exposes the existing WebGUI on port `47860`
- Persists app state under `/config`

## Build

```bash
docker build -f docker/Dockerfile -t oscata-vnc .
```

Or use the helper script from the repo root:

```bash
npm run docker:vnc:build
```

Or use the generic wrapper:

```bash
npm run docker:vnc -- build
```

## Run

```bash
docker run --rm \
  --name oscata-vnc \
  -p 5900:5900 \
  -p 6080:6080 \
  -p 47860:47860 \
  -v /path/to/oscata-config:/config \
  -v /path/to/oscata-downloads:/downloads \
  oscata-vnc
```

Optional: add `-e VNC_PASSWORD=your-password` if you want password-protected VNC.

For a local persistent runtime with automatic restart:

```bash
npm run docker:vnc:up
```

This helper script:

- builds the image if needed
- runs the container as `oscata-vnc`
- uses `--restart unless-stopped`
- stores config in `.docker-data/config`
- stores downloads in `.docker-data/downloads`

Other helper commands:

```bash
npm run docker:vnc -- up
npm run docker:vnc -- stop
npm run docker:vnc -- logs
npm run docker:vnc:run
npm run docker:vnc:stop
npm run docker:vnc:logs
```

You can override runtime settings when invoking it:

```bash
VNC_PASSWORD=mysecret WEBGUI_PORT=48000 npm run docker:vnc:up
```

If `VNC_PASSWORD` is omitted, VNC starts without a password.

## Unraid Notes

- VNC: connect to `<unraid-host>:5900`
- noVNC: open `http://<unraid-host>:6080/vnc.html`
- WebGUI: open `http://<unraid-host>:47860`
- Persistent data lives under `/config/share/oscata-tauri`
- Downloads can be mounted through `/downloads`
- An Unraid template is included at `docker/unraid-template.xml`

## First Boot Behavior

By default, the entrypoint performs a one-time WebGUI bootstrap inside the container:

1. Starts the desktop app once so the SQLite database is created.
2. Writes WebGUI settings into `app_config`.
3. Restarts the desktop app so the built-in WebGUI binds on startup.

This is controlled by `OSCATA_BOOTSTRAP_WEBGUI=1` and only happens once per persisted config volume.

The container does not auto-fill your FTP/TMDB settings. You still complete those in the desktop UI over VNC or later through the WebGUI.

## Environment Variables

- `VNC_PASSWORD`: optional; if omitted or empty, VNC starts without a password
- `VNC_PORT`: defaults to `5900`
- `NOVNC_PORT`: defaults to `6080`
- `VNC_RESOLUTION`: defaults to `1440x960`
- `VNC_COL_DEPTH`: defaults to `24`
- `OSCATA_BOOTSTRAP_WEBGUI`: defaults to `1`
- `OSCATA_WEBGUI_HOST`: defaults to `0.0.0.0`
- `OSCATA_WEBGUI_PORT`: defaults to `47860`
- `OSCATA_WEBGUI_EXPOSED_PORT`: defaults to `47860`
- `OSCATA_WEBGUI_APP_URL`: optional external URL for email links
- `OSCATA_WEBGUI_OTP_ENABLED`: defaults to `0`

## Scope

This runtime is intentionally additive. It packages the current desktop app for Linux and keeps Docker/VNC-specific behavior outside the application code path.
