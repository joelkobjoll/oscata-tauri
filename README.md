# Oscata FTP Client

Oscata FTP Client is a desktop media-library browser built with Tauri, React, TypeScript, and Rust.

It connects to an FTP media source, indexes movie and TV files, enriches them with TMDB metadata, and presents everything in a polished desktop UI with downloads, badges, filters, bilingual metadata, and grouped browsing.

## What the app does

Oscata FTP Client is designed for people who keep a remote FTP-based media library and want a desktop app that feels closer to a modern streaming/browser experience instead of a raw file listing.

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

Oscata FTP Client uses TMDB to match titles and store posters, overviews, ratings, dates, genres, and localized metadata. Manual fixes are preserved and bulk refresh actions avoid overwriting manual matches.

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
- backup export / restore actions

## Data storage

Oscata FTP Client stores its local database in the user data directory under:

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

You can also export the database from Settings and later import it into a fresh install.

## Validation commands

Useful validation commands while developing:

```bash
npx tsc --noEmit
cargo check --manifest-path src-tauri/Cargo.toml
npm run build
```

## Release / versioning workflow

Oscata FTP Client now uses `package.json` as the main app version source, and the local release script keeps Rust metadata in sync.

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

Optional bundled starter database:

```bash
npm run seed-db
npm run seed-db -- --from /path/to/library-backup.db
npm run release -- patch --build --seed-db /path/to/library-backup.db
```

`npm run seed-db` copies the current local app database into `src-tauri/resources/library.seed.db`.

If `src-tauri/resources/library.seed.db` is present in the build, fresh installs can auto-seed their local database from that bundled backup on first launch.

### GitHub release installers

This repository now includes a GitHub Actions workflow at `.github/workflows/release-installers.yml`.

When you publish a GitHub Release, the workflow will:

- build installers on macOS, Windows, and Linux runners
- upload the generated installers back to that GitHub Release
- include `src-tauri/resources/library.seed.db` in the app bundle when that file is committed in the repository

Recommended release flow:

```bash
npm run seed-db
git add src-tauri/resources/library.seed.db
git commit -m "Update starter database"
git push
```

Then create or publish the GitHub Release for the version you want to ship. The workflow will build platform-specific installers for that release.

If you want fresh installs to ship with indexed media and metadata, make sure the updated `src-tauri/resources/library.seed.db` is committed before publishing the release.

### macOS signing and notarization

If macOS release downloads say the app is **damaged** or cannot be opened, that usually means the app was built without a trusted Apple signature/notarization and Gatekeeper blocked it.

The GitHub workflow now supports macOS signing automatically when these repository secrets are configured:

- required for signing:
  - `APPLE_CERTIFICATE`
  - `APPLE_CERTIFICATE_PASSWORD`
  - `KEYCHAIN_PASSWORD`
- optional for notarization via Apple ID:
  - `APPLE_ID`
  - `APPLE_PASSWORD`
  - `APPLE_TEAM_ID`
- optional for notarization via App Store Connect API:
  - `APPLE_API_KEY`
  - `APPLE_API_ISSUER`
  - `APPLE_API_KEY_CONTENT`

Notes:

- `APPLE_CERTIFICATE` should contain the base64-encoded `.p12` certificate export
- `APPLE_API_KEY_CONTENT` should contain the contents of the downloaded `.p8` key file
- if `APPLE_CERTIFICATE` is missing, the workflow now falls back to ad-hoc signing (`APPLE_SIGNING_IDENTITY=-`) for macOS builds
- ad-hoc signing is useful for testing and is better than a completely unsigned app on Apple Silicon, but it is still not equivalent to Developer ID signing + notarization
- without a real Apple Developer signing setup, macOS may still show warnings for GitHub-downloaded builds

## Current updater status

The runtime updater is currently disabled/removed. Versioning and release preparation are in place, but in-app update checking/install flow is not active right now.

## Notes

- The app currently uses scheduled indexing and cached metadata to avoid unnecessary full refreshes.
- Downloads and library state are designed to persist locally between sessions.
- The current desktop bundle identifier is `com.oscata.media`.

## License

This repository currently does not define a license file.
