# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

F1 Telemetry Viewer — a React app for visualizing telemetry JSON files exported by "Pits n' Giggles" (an F1 game telemetry tool). Local-only, no database — reads JSON files from disk.

## Commands

```bash
pnpm dev        # Start dev server (default: http://localhost:5173)
pnpm build      # Type-check (tsc) + production build
pnpm preview    # Preview production build
```

No test runner or linter is configured.

## Setup

Copy `.env.example` to `.env` and set `TELEMETRY_DIR` to the directory containing telemetry JSON files. The app recursively scans this directory for `.json` files.

## Architecture

**Stack:** React 19 + TypeScript + Vite 7 + Tailwind CSS 4 + Recharts 3 + React Router 7

**Custom Vite plugin** (`src/plugin/telemetry-server.ts`) acts as the backend during development:
- `GET /api/sessions` — lists all sessions (metadata parsed from filenames)
- `GET /api/sessions/:relativePath` — returns raw session JSON

Telemetry filenames follow the pattern `[SessionType]_[Track]_YYYY_MM_DD_HH_mm_ss.json`. The plugin parses this to extract session type, track name, and date.

**Routing** (defined in `src/App.tsx`):
- `/` — Dashboard with performance trends across all sessions
- `/session/*` — Session detail (delegates to `RaceSessionView` or `QualifyingSessionView` based on session data)
- `/track/:trackId` — Track-specific progress over time

**Data flow:** Pages use custom hooks (`useSessionList`, `useSession`) → API client (`src/api/client.ts`) → Vite plugin endpoints → local JSON files.

**Key directories:**
- `src/components/` — Chart components (LapTimeChart, PositionChart, TyreWearChart, StintTimeline, SectorComparison) and data tables
- `src/pages/` — Route-level components
- `src/utils/` — Formatting (lap times, sectors), statistics (best laps, consistency, tyre wear rates), team/compound color mappings
- `src/types/telemetry.ts` — All TypeScript types for the telemetry data model
- `src/plugin/` — Vite plugin (has its own tsconfig: `tsconfig.node.json`)

**Styling:** Dark theme (slate-950 background). All styling via Tailwind utility classes.
