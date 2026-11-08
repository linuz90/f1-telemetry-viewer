# Running the viewer

Data sources, repro files, worktrees and the Pits n' Giggles (PnG) embed. Setup, self-hosting and host build variables for users are in the README. Keep this file current when a rule here changes in code.

## Data sources

The app tries the local telemetry API, then the bundled demo, then browser uploads (`detectDataSource` in `src/queries/telemetry.ts`).

- **Local API** (`pnpm dev`, `pnpm start`): `.env`'s `TELEMETRY_DIR`. For a narrow repro, run `pnpm dev:telemetry <folder>` rather than editing `.env`; shared repro files live in `/Users/linuz90/PC Stuff/Pits & Giggles/debug data`. `pnpm dev:debug` serves `DEBUG_TELEMETRY_DIR` for broad QA, only when that variable is set.
- **Demo** (`pnpm dev:prod`, the hosted demo): `public/demo/`, built by `pnpm generate-demo` from real F1 26 sessions: a Sakhir race weekend with one bundled `.pngt` (`recordings.json`, opened in the browser so the demo has Lap telemetry), Miami long runs, and synthetic online races with no detail behind them (`isSynthetic`). It replaces every human name with a fictional handle, so regenerate rather than hand-edit. The session-index tests and benchmark read their own anonymised copies in `tests/fixtures/session-index/`.
- **Upload**: JSON, zip and `.pngt` files parsed in the browser (`src/context/zipLoader.ts`).

## Finding a session's JSON

When given a localhost URL or screenshot, open the telemetry file behind that exact page before guessing. `pnpm find-session <slug-or-url>` resolves it, but searches only `.env`'s `TELEMETRY_DIR`; for a `dev:telemetry` or `dev:debug` server, search that folder for the slug with `-` turned back into `_` (case-insensitive). Uploaded files and `dev:prod` have no file on disk.

## Worktrees and ports

- `./workspace-setup.sh init` prepares any worktree (T3 Code, Codex, Conductor or plain `git worktree add`) and copies the `.worktreeinclude` files, `.env` included, from the main checkout. Without a `.env`, use `pnpm dev:prod` or create one from `.env.example`.
- Dev ports are deterministic per worktree: Conductor uses `$CONDUCTOR_PORT`, Codex and T3 Code worktrees get a stable hash-based port. `pnpm dev:port` prints it; `VITE_DEV_PORT` overrides it.

## Embedded in Pits n' Giggles

PnG ships this repo as a git submodule (`apps/external/f1-save-viewer`) served under `/save-viewer/`. Its build variables are in the README's Embedding section.

- PnG's Python server builds the session list itself (`apps/web/session_discovery.py`, a port of an older `buildSessionSummary()`), so new summary fields reach PnG users only when PnG ports them. It omits `isOnline`, `isAutoSave` and most race and quali extras: read every summary field as optional and degrade gracefully.
- It rewrites our built `index.html` by exact string to inject its sidebar, icons and `window.__PNG_*` config: the favicon and touch-icon hrefs, `<body class="`, `<div id="root">` and `</head>`. Keep those strings as they are.
- It answers unknown `/save-viewer/*` paths, API ones included, with that page, so a missing endpoint returns HTML rather than a 404.
