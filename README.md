# Oscata

Oscata is a desktop media-library browser built with Tauri, React, TypeScript, and Rust.

It connects to an FTP media source, indexes movie and TV files, enriches them with TMDB metadata, and presents everything in a polished desktop UI with downloads, badges, filters, bilingual metadata, and grouped browsing.

## What the app does

Oscata is designed for people who keep a remote FTP-based media library and want a desktop app that feels closer to a modern streaming/browser experience instead of a raw file listing.

Today the app can:

- index media files from an FTP server
- detect movies, TV episodes, documentaries, resolutions, HDR, codecs, and release types
- match titles against TMDB and store metadata locally
- keep both Spanish and English metadata fields
- browse movies in grouped or file-level mode
- browse TV by show or episode
- paginate large libraries for better performance
- queue, resume, retry, cancel, and delete downloads
- show download state and presence badges
- connect to Emby and Plex for library checks
- preserve indexed data and metadata in a local SQLite database between runs

## Main features

### Library indexing

The backend scans the configured FTP root, parses media filenames, and stores results in SQLite. Indexed items are cached locally so the app does not need to start from zero every time.

### Metadata enrichment

Oscata uses TMDB to match titles and store posters, overviews, ratings, dates, genres, and localized metadata. Manual fixes are preserved and bulk refresh actions avoid overwriting manual matches.

### Downloads

Downloads are handled from the app UI and support:

- persistent queue state
- resume from partial files when possible
- retry after failure
- cancellation and delete actions
- local destination folder mapping

### Bilingual UI and metadata

Spanish is the default language, with English available across the main UI and stored metadata.

### Desktop-focused UX

The interface uses a top-nav layout with filters, grouped browsing, detail panels, download feedback toasts, keyboard shortcuts, and app-style settings/download screens.

## Tech stack

- Tauri 2
- React 19
- TypeScript
- Vite
- Rust
- SQLite via `rusqlite`
- TMDB API
- FTP via `suppaftp`

## Project structure

- `src/` — React UI, hooks, components, filters, pages, and localization
- `src-tauri/` — Rust backend, FTP/indexing/download logic, SQLite persistence, and Tauri commands
- `scripts/` — local release automation scripts

## Requirements

- Node.js 22
- npm
- Rust toolchain
- Tauri development prerequisites for your platform

On this project, frontend commands are typically run with Node 22:

```bash
source ~/.nvm/nvm.sh
nvm use 22
```

## Local development

Install dependencies:

```bash
npm install
```

Run the desktop app in dev mode:

```bash
npm run tauri dev
```

Frontend-only dev server:

```bash
npm run dev
```

Build the frontend bundle:

```bash
npm run build
```

## Configuration

The app stores its runtime configuration in SQLite and exposes it through the in-app settings screen.

Key settings include:

- FTP host, port, user, password, and root path
- TMDB API key
- default language
- download folder
- max concurrent downloads
- folder-type mapping
- Emby and Plex connection details

## Data storage

Oscata stores its local database in the user data directory under:

```text
oscata-tauri/library.db
```

That database includes:

- indexed media items
- TMDB metadata
- persisted downloads state
- app configuration
- timestamps such as the last successful indexing time

This means local library state survives normal app restarts and rebuilds.

## Validation commands

Useful validation commands while developing:

```bash
npx tsc --noEmit
cargo check --manifest-path src-tauri/Cargo.toml
npm run build
```

## Release / versioning workflow

Oscata now uses `package.json` as the main app version source, and the local release script keeps Rust metadata in sync.

Available commands:

```bash
npm run release -- patch
npm run release -- minor
npm run release -- major
npm run release -- 0.2.0
```

Shortcuts:

```bash
npm run release:patch
npm run release:minor
npm run release:major
```

What the release script does:

- bumps `package.json`
- updates `package-lock.json`
- syncs `src-tauri/Cargo.toml`
- runs `npm run build`
- runs `cargo check`

Optional release build:

```bash
npm run release -- patch --build
```

That will also run:

```bash
npm run tauri build
```

## Current updater status

The runtime updater is currently disabled/removed. Versioning and release preparation are in place, but in-app update checking/install flow is not active right now.

## Notes

- The app currently uses scheduled indexing and cached metadata to avoid unnecessary full refreshes.
- Downloads and library state are designed to persist locally between sessions.
- The current desktop bundle identifier is `com.oscata.media`.

## License

This repository currently does not define a license file.
