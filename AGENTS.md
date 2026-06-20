# AGENTS.md

Guidance for AI coding agents working in this repository.

## What This Is

F1 Telemetry Viewer is a local-first React app for visualizing telemetry JSON exported by "Pits n' Giggles" (an F1 game telemetry tool).

- No database.
- Local dev reads telemetry JSON from disk.
- Production/demo mode reads committed demo data or user-uploaded JSON/zip files.
- No test runner or linter is configured.

## Commands

```bash
pnpm dev                      # Start dev server, usually http://localhost:5173
pnpm dev:telemetry <folder>   # Start dev server against one telemetry folder
pnpm dev:debug                # Use DEBUG_TELEMETRY_DIR from .env
pnpm dev:prod                 # Skip local API; use demo/upload mode
pnpm build                    # Type-check (tsc) + production build
pnpm preview                  # Preview production build
pnpm generate-demo            # Regenerate public/demo/
pnpm find-session <slug-or-url> # Resolve a session URL/slug to JSON on disk
```

## Local Data

- Copy `.env.example` to `.env` and set `TELEMETRY_DIR` to the telemetry JSON folder.
- For narrow repros, use `pnpm dev:telemetry <folder>` instead of editing `.env`.
- Shared repro files live at `/Users/linuz90/PC Stuff/Pits & Giggles/debug data`.
- `DEBUG_TELEMETRY_DIR` is optional; use `pnpm dev:debug` for broad QA only when that env var is set.
- Never commit real telemetry files, `.env`, machine-specific paths, or debug corpus data.

When a user gives a localhost URL or screenshot, prefer the telemetry source that produced that exact page. Use `pnpm find-session <slug-or-url>` against the active source before guessing.

## Worktrees

- `./workspace-setup.sh init` is the shared setup entry point for Codex/Conductor worktrees.
- `.worktreeinclude` copies ignored local env files into managed worktrees.
- Conductor shared settings: `.conductor/settings.toml`.
- Personal Conductor overrides: `.conductor/settings.local.toml` (gitignored).
- If no `.env` exists in a worktree, use `pnpm dev:prod` or create one from `.env.example`.

## Architecture

Stack: React 19, TypeScript, Vite 7, Tailwind CSS 4, Recharts 3, React Router 7.

Data flow:

- Pages/hooks -> `TelemetryContext`.
- Dev: `src/plugin/telemetry-server.ts` serves `/api/sessions` and raw session JSON.
- Production/demo: `public/demo/sessions.json`.
- Upload mode: JSON/zip files parsed in-browser.

Routes:

- `/` -> newest available formula scope.
- `/:formulaKey` -> dashboard, e.g. `/f1-26`.
- `/:formulaKey/sessions/*` -> session detail.
- `/:formulaKey/tracks/:trackId` -> track progress.
- `/ui-debug` -> dev-only UI fixture page.

Telemetry filenames follow `[SessionType]_[Track]_YYYY_MM_DD_HH_mm_ss.json`. Filename parsing gives stable dates/slugs; `session-info` wins for display metadata.

## Key Code Paths

Entry and data:

- `src/App.tsx` — routes, formula guards, `/ui-debug`.
- `src/context/TelemetryContext.tsx` — data-source selection.
- `src/context/zipLoader.ts` — uploaded JSON/zip parsing.
- `src/plugin/telemetry-server.ts` — local telemetry API.
- `src/utils/parseFilename.ts` — filename -> slug/date parsing.

Product surfaces:

- `src/pages/DashboardPage.tsx`
- `src/pages/RaceSessionView.tsx`
- `src/pages/QualifyingSessionView.tsx`
- `src/pages/TrackProgressPage.tsx`
- `src/pages/UiDebugPage.tsx`

Shared UI:

- `src/components/Layout.tsx`
- `src/components/SessionList.tsx`
- `src/components/SessionHeader.tsx`
- `src/components/SessionInsightsGrid.tsx`
- `src/components/dashboard/`
- `src/components/track/`
- `src/components/ui/` (`InsightTile`, `StintChip`, `PillSelect`, table recipes, etc.)

Telemetry intelligence:

- `src/analysis/` — product-facing models, rankings, buckets, insight curation, chart-ready data.
- `src/utils/stats/` — low-level reusable telemetry/math primitives.
- `src/constants/` — shared tokens, routes, storage keys, setup ranges, track calendars.
- Thin compatibility wrappers remain in `src/utils/colors.ts`, `src/utils/routes.ts`, `src/utils/tracks.ts`, and `src/utils/links.ts`.

## Telemetry Rules

Formula scope:

- The first URL segment is the active scope: `/f1-26`, `/f1-25`, `/f2-25`.
- `F1 Modern` canonicalizes to `f1-25`; `f1-modern` is only a legacy redirect alias.
- F2 exports with `game-year: 25` display as `F2 25`.
- F1 26 / 2026 Season Pack sessions compare under `f1-26`.
- Do not add `?formula=` or new legacy alias routes.
- Pass the active formula key to `sortTracksByCalendar()` so F1 26 uses the Madrid/Madring calendar order.

ERS:

- F1 26 can deploy more than 4 MJ/lap; show deployment as energy (`MJ/lap`), not battery percentage.
- Prefer `per-lap-info[].ers-stats["ers-deployed-j"]`.
- Fall back to `car-status-data["ers-deployed-this-lap"]` for older exports.
- Show battery-store values as percentages only when explicitly displaying remaining store.

Analysis layer:

- Calculation-heavy logic belongs in `src/analysis/`, not page/chart components.
- `src/analysis/` returns plain typed models that UI components render.
- Generic primitives belong in `src/utils/stats/`.
- Product-specific ranking, curation, bucketing, and insight thresholds belong in `src/analysis/`.
- Add concise why-comments for exporter quirks, thresholds, and comparison policies.

Rivals roster:

- Online race summaries may include `SessionSummary.rivals`.
- Identity key: normalized `driver-name`.
- Dashboard aggregation lives in `src/analysis/rivalStats.ts`.
- Qualifying and offline-AI sessions skip the roster to keep summaries slim.

Styling:

- Dark Tailwind UI.
- Reuse shared primitives before adding one-off styles.
- Keep chart/card constants in `src/constants/` or shared UI modules.

## Reading Raw Session Telemetry

Only works for local dev API sessions, not uploaded files or `dev:prod`.

```bash
pnpm find-session race-baku-manual-2026-02-21-16-39-26
pnpm find-session http://localhost:5173/f1-25/sessions/race-baku-manual-2026-02-21-16-39-26
```

Then open the returned JSON file.

Slug mapping:

- Filename: `Race_Baku_Manual_2026_02_21_16_39_26.json`.
- Slug: `race-baku-manual-2026-02-21-16-39-26`.
- Formula scope is URL context only; it is not part of the filesystem lookup.

## Commit Messages

Commits feed the user-facing "What's new" modal via `src/plugin/changelog.ts`.

- Do not commit until asked.
- Use conventional commits.
- Only `feat`, `fix`, and `docs` appear in the changelog.
- Use `chore:` or `refactor:` for internal-only work.
- Write changelog-visible subjects as user-facing descriptions.
- Keep the subject concise, imperative, and under 72 chars.
- Never add AI attribution.

Examples:

- Good: `feat(ui): show tyre compounds in qualifying lap breakdown`
- Bad: `feat: refactor TyreChart to use compound map lookup`
