# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

F1 Telemetry Viewer — a React app for visualizing telemetry JSON files exported by "Pits n' Giggles" (an F1 game telemetry tool). Local-only, no database — reads JSON files from disk.

## Commands

```bash
pnpm dev            # Start dev server (default: http://localhost:5173)
pnpm dev:prod       # Dev server without local API (uses demo data, like production)
pnpm build          # Type-check (tsc) + production build
pnpm preview        # Preview production build
pnpm generate-demo  # Regenerate trimmed demo data in public/demo/
pnpm find-session <slug-or-url>  # Resolve a session URL/slug to its JSON file on disk
```

No test runner or linter is configured.

## Setup

Copy `.env.example` to `.env` and set `TELEMETRY_DIR` to the directory containing telemetry JSON files. The app recursively scans this directory for `.json` files.

## Architecture

**Stack:** React 19 + TypeScript + Vite 7 + Tailwind CSS 4 + Recharts 3 + React Router 7

**Custom Vite plugin** (`src/plugin/telemetry-server.ts`) acts as the backend during development:
- `GET /api/sessions` — lists all sessions (date from filename; track, session type, and formula from JSON when available)
- `GET /api/sessions/:relativePath` — returns raw session JSON

Telemetry filenames follow the pattern `[SessionType]_[Track]_YYYY_MM_DD_HH_mm_ss.json`. The plugin parses filenames for stable dates/slugs, then prefers `session-info` fields from the JSON for display metadata because filenames may include modifiers like `Manual` or numbered sessions like `Race_2`.

**Routing** (defined in `src/App.tsx`):
- `/` — Dashboard with performance trends across all sessions
- `/session/*` — Session detail (delegates to `RaceSessionView` or `QualifyingSessionView` based on session data)
- `/track/:trackId` — Track-specific progress over time

**Data flow:** Pages use custom hooks (`useSessionList`, `useSession`) → `TelemetryContext` → Vite plugin endpoints (dev) or static demo files (prod) or in-memory store (upload).

**Key directories:**
- `src/components/` — Chart components (LapTimeChart, PositionChart, TyreWearChart, StintTimeline, SectorComparison) and data tables
- `src/pages/` — Route-level components
- `src/utils/` — Formatting (lap times, sectors), statistics (best laps, consistency, tyre wear rates), team/compound color mappings
- `src/types/telemetry.ts` — All TypeScript types for the telemetry data model
- `src/plugin/` — Vite plugin (has its own tsconfig: `tsconfig.node.json`)
- `scripts/` — `generate-demo-data.ts` creates trimmed demo files; `find-session.sh` resolves session slugs/URLs to file paths
- `public/demo/` — Bundled demo sessions (committed, deployed as static assets)

**Mode detection:** On mount, `TelemetryContext` runs: `/api/sessions` → `/demo/sessions.json` → upload mode. `VITE_SKIP_API=true` skips the API step (used by `dev:prod`).

**Formula handling:** F1 is the primary/default formula, but labels and PB/history comparisons are game-generation-aware when `game-year` metadata is available. Older `F1 Modern`/`F2` Pits n' Giggles exports with `game-year: 25` display as `F1 25`/`F2 25`, while `F1 26` / 2026 Season Pack sessions stay in the broad F1 family but compare under a separate `f1-26` key. Track pages show a formula switcher when a track has multiple comparison groups, default bare track URLs to the newest game generation, and still accept legacy query keys like `?formula=f1-modern` and `?formula=f2`.

**ERS handling:** Pits n' Giggles F1 26 saved sessions can deploy more than the 4 MJ battery capacity per lap because the 2026 ruleset has no fixed deploy limit. Display ERS deployment as energy (`MJ/lap`), preferring `per-lap-info[].ers-stats["ers-deployed-j"]` and falling back to `car-status-data["ers-deployed-this-lap"]` for older exports. Keep battery-store values as percentages only when explicitly showing remaining store.

**Styling:** Dark theme (slate-950 background). All styling via Tailwind utility classes.

## Reading Session Telemetry Data

When the user references a session by URL, or when you're testing in the browser and land on a session page (e.g. `http://localhost:5173/session/race-baku-manual-2026-02-21-16-39-26`), you can read the raw telemetry JSON to understand the data. The URL slug maps to a file on disk under `TELEMETRY_DIR` (set in `.env`).

**This only works in local dev mode (`pnpm dev`)**, where sessions are served from the `TELEMETRY_DIR` directory. It won't work for uploaded sessions (JSON/zip via drag-and-drop) or when running `dev:prod` / production, since those sessions live in-memory in the browser.

**How the slug-to-file mapping works:**
- Filenames follow: `Race_Baku_Manual_2026_02_21_16_39_26.json` (with date subdirs like `2026_02_21/race-info/`)
- `toSlug()` in `src/utils/parseFilename.ts` lowercases the basename and replaces `_` with `-` → `race-baku-manual-2026-02-21-16-39-26`
- To reverse: replace `-` with `_` and search case-insensitively under `TELEMETRY_DIR`

**Use the helper script to find the file:**
```bash
pnpm find-session race-baku-manual-2026-02-21-16-39-26
# → /Users/.../data/2026_02_21/race-info/Race_Baku_Manual_2026_02_21_16_39_26.json

pnpm find-session http://localhost:5173/session/race-baku-manual-2026-02-21-16-39-26
# Same result — accepts full URLs too
```

Then read the returned file path to inspect the raw telemetry JSON.

## Commit Message Guidelines

Commit messages feed a **user-facing changelog** (the "What's new" modal). A Vite plugin (`src/plugin/changelog.ts`) parses `git log` at build time, extracts the conventional commit type and subject, and displays them in the UI via `ChangelogModal.tsx`.

DO NOT commit until you're asked to.

**Rules:**

- Use conventional commits: `feat:`, `fix:`, `docs:`, etc.
- The subject after the prefix is shown **verbatim** to users — write it as a user-facing change description, not a developer note.
  - Good: `feat(ui): show tyre compounds in qualifying lap breakdown`
  - Bad: `feat: refactor TyreChart to use compound map lookup`
- Only `feat`, `fix`, and `docs` commits appear in the changelog. Other types (`chore`, `refactor`, `style`, etc.) are filtered out at build time.
- Keep subjects concise and in imperative mood (matches conventional commit convention).
- Internal-only changes should use `chore:` or `refactor:` so they stay out of the user-facing changelog. This includes: dev tooling (Vite config, linter setup), dependency updates, CI/CD, refactors, build config, and anything that doesn't change what the user sees or experiences in the app.
  - Good: `chore(dev): auto-open browser on dev server start` (dev tooling, not user-facing)
  - Bad: `feat(dev): auto-open browser on dev server start` (this would show up in the changelog)
