# Oscata – Copilot Agent Guidelines

> These instructions apply to all AI-assisted work on this repository.
> Follow them consistently to keep the codebase coherent, maintainable, and scalable.

## Language

All user-facing text written by Copilot — changelog entries, UI strings, error messages, tooltips, and any other copy shown to the user — must be written in **Spanish (Spain)**. Use natural, everyday Spain Spanish: informal "tú" address, Castilian vocabulary, and a direct conversational tone. Avoid Latin American variants, overly formal register, and literal translations from English.

---

## Project Overview

**Oscata** is a Tauri 2.x desktop application (React + Rust) that:

- Connects to an FTP server and indexes media files
- Enriches metadata via TMDB
- Presents a dark media-library UI (movies, TV shows, documentaries)
- Manages a download queue with concurrent transfer support

**Oscata also ships as a web application** (Docker / self-hosted). The same React frontend runs in a browser via a Rust HTTP server. Both surfaces share the same codebase. Use `isTauri()` from `src/lib/transport.ts` to gate Tauri-only features (file pickers, `invoke`, native dialogs). All UI features that don't depend on native OS access **must work in both modes**.

**Stack:**

- Frontend: React 18, TypeScript, inline CSS (CSS custom properties via `src/index.css`)
- Backend: Rust / Tauri 2.x (`src-tauri/src/`)
- Database: SQLite via `rusqlite`
- IPC: Tauri commands (`invoke`) + events (`listen`); falls back to HTTP fetch in web mode via `src/lib/transport.ts`

---

## Architecture

### Vertical Slice Pattern

Organise work **by feature**, not by layer. Each feature owns its types, logic, and UI together.

```
src/
├── features/
│   ├── library/          # Media grid, filtering, tab navigation
│   │   ├── useLibrary.ts         # State + derived data
│   │   ├── LibraryPage.tsx       # Page shell (layout only)
│   │   ├── MediaGrid.tsx         # Grid rendering
│   │   └── types.ts              # Feature-local types
│   ├── media-detail/     # Side panel + fix-match
│   ├── downloads/        # Queue, progress, retry
│   ├── tv-browser/       # Season/episode browser
│   ├── indexing/         # FTP scan + progress
│   └── settings/         # Config form + wizard
├── components/           # Truly shared, dumb UI components only
│   ├── Badge.tsx
│   ├── Button.tsx
│   ├── Modal.tsx
│   └── Spinner.tsx
├── hooks/                # Shared cross-feature hooks only
│   └── useEventListener.ts
├── lib/                  # Pure utilities (no React, no Tauri)
│   ├── format.ts         # formatBytes, formatDuration, formatSize
│   └── media.ts          # parseLanguages, getReleaseTypeColor
└── index.css             # Design system tokens (CSS variables)
```

> **Rule:** If a component or hook is only used within one feature, it lives inside that feature's folder, not in `components/` or `hooks/`.

### Rust Backend (`src-tauri/src/`)

```
src-tauri/src/
├── commands.rs    # Tauri #[command] handlers — thin, delegate to services
├── db.rs          # All SQLite access (structs, queries, migrations)
├── downloads.rs   # Download queue state machine
├── ftp.rs         # FTP client logic
├── parser.rs      # Filename parser (pure, unit-tested)
├── tmdb.rs        # TMDB API client
└── lib.rs         # Tauri app builder, plugin registration, state setup
```

---

## Frontend Rules

### Component Design

**1. Single Responsibility**
Each component does one thing. A component that manages state AND renders a complex tree AND calls APIs is three components.

```tsx
// ❌ Bad — one component does everything
export function LibraryPage() {
  const [items, setItems] = useState([]);
  useEffect(() => {
    invoke("get_all_media").then(setItems);
  }, []);
  return (
    <div>
      {items.map((i) => (
        <div>...giant inline block...</div>
      ))}
    </div>
  );
}

// ✅ Good — logic in hook, rendering in component
export function LibraryPage() {
  const { items, filters, setFilters } = useLibrary();
  return (
    <MediaGrid items={items} filters={filters} onFilterChange={setFilters} />
  );
}
```

**2. Separate business logic from rendering**

- Business logic belongs in **hooks** (`use*.ts` files), not in component bodies.
- Hooks call `invoke()`, hold state, compute derived values, and expose a clean API.
- Components only read from hooks and render. No `invoke()` calls in JSX files.

```tsx
// ❌ Bad — invoke inside component
function DownloadsTab() {
  const [items, setItems] = useState([]);
  useEffect(() => {
    invoke("get_downloads").then(setItems);
  }, []);
}

// ✅ Good — all Tauri access in the hook
function DownloadsTab() {
  const { downloads, retryDownload, cancelDownload } = useDownloads();
}
```

**3. Props interface first**
Always define a named `interface` for component props before the component.

```tsx
interface MediaCardProps {
  item: MediaItem;
  onDownload: (item: MediaItem) => void;
  onSelect?: (item: MediaItem) => void;
}

export default function MediaCard({ item, onDownload, onSelect }: MediaCardProps) { ... }
```

**4. Reusable shared components**
Before building a new button, badge, modal, or spinner: check `src/components/`. If a shared primitive doesn't exist yet, extract one with a clean prop API. Never inline the same visual pattern in more than one place.

**5. Always use `Toggle` instead of checkboxes**
Never use `<input type="checkbox">` for boolean settings or preferences. Always use the `Toggle` component from `src/components/Toggle.tsx`. Pattern for inline label + toggle:

```tsx
// ❌ Bad
<label>
  <input type="checkbox" checked={value} onChange={(e) => setValue(e.target.checked)} />
  Label text
</label>

// ✅ Good
<div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
  <span style={{ fontSize: 13, color: "var(--color-text)" }}>Label text</span>
  <Toggle checked={value} onChange={setValue} />
</div>
```

**6. Avoid prop drilling beyond 2 levels**
If a value needs to go more than 2 levels deep, promote it to a hook or a React context.

---

### Styling Rules

**Use CSS variables everywhere.** Never hardcode a color that has a variable equivalent.

```tsx
// ❌ Bad
<div style={{ background: "#18181c", color: "#e8e8f0" }}>

// ✅ Good
<div style={{ background: "var(--color-surface)", color: "var(--color-text)" }}>
```

**Full design token reference** (defined in `src/index.css`):

| Token                   | Value                | Use                                 |
| ----------------------- | -------------------- | ----------------------------------- |
| `--color-bg`            | `#0d0d0f`            | Page background                     |
| `--color-surface`       | `#18181c`            | Cards, panels                       |
| `--color-surface-2`     | `#222228`            | Inputs, elevated surfaces           |
| `--color-border`        | `#2e2e38`            | All borders                         |
| `--color-text`          | `#e8e8f0`            | Primary text                        |
| `--color-text-muted`    | `#8888a0`            | Secondary/label text                |
| `--color-primary`       | `#7c6ef7`            | Buttons, active states, focus rings |
| `--color-primary-hover` | `#9585ff`            | Hover on primary elements           |
| `--color-danger`        | `#e05555`            | Errors, destructive actions         |
| `--color-success`       | `#3db07e`            | Success states                      |
| `--color-warning`       | `#c8932a`            | Warnings, ratings                   |
| `--color-teal`          | `#14b8a6`            | TV/browse actions                   |
| `--radius`              | `8px`                | Default border-radius               |
| `--radius-lg`           | `12px`               | Cards, modals                       |
| `--radius-full`         | `9999px`             | Pills, badges                       |
| `--font-sans`           | `"Inter", system-ui` | All text                            |

**Hover states** — use `useState<boolean>` for hover; do not use CSS classes unless in an actual `.css` file.

```tsx
const [hovered, setHovered] = useState(false);
<div
  onMouseEnter={() => setHovered(true)}
  onMouseLeave={() => setHovered(false)}
  style={{
    background: "var(--color-surface)",
    ...(hovered && {
      borderColor: "var(--color-primary)",
      transform: "translateY(-2px)",
    }),
  }}
/>;
```

**Transitions:** always `transition: "property 0.15s ease"`. Never skip transitions on interactive elements.

---

### TypeScript Rules

- **No `any`.** Use `unknown` and narrow it, or define a proper type.
- **All Tauri event payloads must have explicit interfaces** in the hook that listens to them.
- **Co-locate types** with the feature that owns them (`features/downloads/types.ts`). Only promote to `shared/types.ts` if two or more features depend on the same type.
- **Prefer `interface` over `type`** for object shapes; use `type` for unions and aliases.
- Run `npx tsc --noEmit` after every batch of changes. Fix all errors before moving on.

---

### File & Naming Conventions

| Thing            | Convention                     | Example             |
| ---------------- | ------------------------------ | ------------------- |
| React components | PascalCase `.tsx`              | `MediaCard.tsx`     |
| Hooks            | camelCase, `use` prefix, `.ts` | `useDownloads.ts`   |
| Pure utilities   | camelCase `.ts`                | `format.ts`         |
| Feature folders  | kebab-case                     | `tv-browser/`       |
| CSS variables    | `--color-*`, `--radius-*`      | `--color-primary`   |
| Tauri commands   | snake_case                     | `queue_download`    |
| IPC event names  | `noun:verb`                    | `download:progress` |

---

## Rust Backend Rules

### Command Handlers Are Thin

`commands.rs` handlers should do nothing except: validate input → call a service/module → return result. All real logic lives in `db.rs`, `ftp.rs`, `tmdb.rs`, `downloads.rs`, or `parser.rs`.

```rust
// ❌ Bad — business logic inline in command
#[tauri::command]
pub async fn queue_download(ftp_path: String, ...) -> Result<u32, String> {
    let mut conn = Connection::open(&db_path)?;
    // 40 lines of SQL and download logic...
}

// ✅ Good — delegates immediately
#[tauri::command]
pub async fn queue_download(
    ftp_path: String,
    filename: String,
    state: State<'_, SharedQueue>,
    app: AppHandle,
) -> Result<u32, String> {
    downloads::enqueue(ftp_path, filename, state, app).await.map_err(|e| e.to_string())
}
```

### Error Handling

- Commands return `Result<T, String>` — convert errors at the boundary with `.map_err(|e| e.to_string())`.
- Internal functions use `anyhow::Result` or domain-specific error enums.
- Never `unwrap()` or `expect()` in production paths. Use `?` and propagate.
- Log unexpected errors with `eprintln!` or `tracing` before returning them.

### Database (`db.rs`)

- All schema changes go through migrations at startup (`.ok()` pattern for additive columns).
- `MediaItem` struct field order must exactly match the `SELECT` column order in `get_all_media`.
- All queries are in `db.rs`. No SQL strings outside that file.
- Use parameterised queries (`?` placeholders) — never string-interpolate user data into SQL.

### Parser (`parser.rs`)

- The parser is **pure** — no I/O, no database, no Tauri. It takes a filename `&str` and returns `ParsedMedia`.
- Every new parsing pattern needs a unit test in the `#[cfg(test)]` block at the bottom.
- Use `(?ix)` (case-insensitive + verbose) regex mode — never use `\` + literal newline for multiline alternations in raw strings.

---

## IPC Conventions (Frontend ↔ Rust)

### Commands (Request/Response)

```ts
// Always type the return value
const result = await invoke<MediaItem[]>("get_all_media");
```

### Events (Push from Rust)

```ts
// Always define the payload type
interface ProgressPayload {
  current: number;
  total: number;
  filename: string;
}
const unlisten = await listen<ProgressPayload>("index:progress", ({ payload }) => { ... });
// Always return the unlisten fn from useEffect cleanup
return () => { unlisten.then(f => f()); };
```

### Event Naming

| Pattern                                              | Example                             |
| ---------------------------------------------------- | ----------------------------------- |
| `noun:verb` for state changes                        | `download:update`, `index:progress` |
| `noun:added` / `noun:removed` for collection changes | `download:added`                    |
| Past tense for completed one-shots                   | `index:complete`                    |

---

## Feature Development Checklist

When adding a new feature, work through these in order:

1. **Define types first** — create `features/<name>/types.ts` with all interfaces
2. **Write the Rust command(s)** — thin handlers + real logic in the appropriate module
3. **Register the command** in `lib.rs`
4. **Write the hook** — all `invoke`/`listen` calls, state, derived values
5. **Build the UI** — components consume the hook only; no raw Tauri calls
6. **Extract shared primitives** — if you wrote a `Badge` or `Button` that could be reused, move it to `src/components/`
7. **Type-check**: `npx tsc --noEmit` must pass clean
8. **Rust check**: `cargo check` must pass with zero errors (warnings OK if documented)

---

## What NOT to Do

- ❌ Do not call `invoke()` directly inside JSX or component render bodies
- ❌ Do not add `any` types — use proper interfaces
- ❌ Do not duplicate visual patterns — extract shared components
- ❌ Do not put SQL in `commands.rs` — all queries go in `db.rs`
- ❌ Do not hardcode colors that have a CSS variable — use `var(--color-*)`
- ❌ Do not `unwrap()` or `expect()` in non-test Rust code
- ❌ Do not leave `console.log` or `dbg!` in committed code
- ❌ Do not create markdown planning files in the repo — use the session workspace
- ❌ Do not add a UI feature to the Tauri desktop without also verifying it works (or is intentionally gated with `isTauri()`) in the web UI

---

## Web / Desktop Feature Parity

Oscata runs as both a Tauri desktop app and a browser-based web app. **Every UI feature must work in both surfaces** unless it explicitly requires native OS access (file pickers, native dialogs, direct `invoke` calls).

### Rules

1. **Gate native-only code with `isTauri()`** from `src/lib/transport.ts`. Never call `invoke()` unconditionally in shared components.
2. **Global React state (context) must wrap both render paths.** Providers live in `main.tsx` above `<Router />`, so they cover both the Tauri path and the web path automatically.
3. **When adding a feature to the desktop nav/header, check the web nav** in `WebRouter` (inside `src/router.tsx`) and add it there too if it's surface-agnostic.
4. **Settings sections that don't require native access must appear in both modes.** The Appearance (theme) section is an example: it lives in `Settings.tsx` unconditionally and is accessible from both the Tauri modal and the web nav's Settings page.
5. **Shared context hooks** (`useTheme`, etc.) must always be consumed inside their Provider. If a hook throws "must be used inside Provider", the Provider is missing from a render path — fix by moving it higher in `main.tsx`.

### Current shared global providers (in `main.tsx`)

| Provider        | Hook         | Purpose                                                   |
| --------------- | ------------ | --------------------------------------------------------- |
| `ThemeProvider` | `useTheme()` | Dark / light / system theme, synced across all components |

---

## Running the Project

```bash
# Frontend dev (requires Node 22 via nvm)
source ~/.nvm/nvm.sh && nvm use 22 && npm run tauri dev

# Type-check frontend only
npx tsc --noEmit

# Rust compile check
cd src-tauri && cargo check

# Run Rust unit tests (parser, etc.)
cd src-tauri && cargo test
```

---

## Key Technical Decisions (Context for AI)

- **Regex in parser.rs**: always use `(?ix)` verbose mode — `\` + literal newline in raw strings creates wrong alternation branches
- **Recursive async in Rust**: use `Box::pin(async move { ... })` with explicit lifetimes
- **Download concurrency**: controlled by a `Semaphore` in `downloads.rs`, configured from settings
- **TMDB matching**: `smart_search()` in `tmdb.rs` tries title+year, falls back to title-only; results ranked by popularity + year proximity
- **Column order in `get_all_media`**: id=0, ftp_path=1, filename=2, size_bytes=3, title=4, year=5, season=6, episode=7, episode_end=8, resolution=9, codec=10, audio_codec=11, languages=12, hdr=13, release_type=14, release_group=15, media_type=16, tmdb_id=17, tmdb_type=18, tmdb_title=19, tmdb_year=20, tmdb_release_date=21, tmdb_overview=22, tmdb_poster=23, tmdb_rating=24, tmdb_genres=25, indexed_at=26, metadata_at=27
- **Node version**: must use Node 22 (Vite 7 incompatible with Node 20)
