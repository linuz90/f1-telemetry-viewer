# F1 Telemetry Viewer

A local-first dashboard for telemetry exported by [Pits n' Giggles](https://github.com/ashwin-nat/pits-n-giggles). It turns the JSON files saved after each F1 game session into a fast, private web app for race results, rival comparisons, qualifying pace, tyre strategy, and track progress.

Supports recent F1 (and F2) telemetry, including the newly released **2026 Season Pack**.

<p align="center">
  <img src="assets/demo.gif" alt="F1 Telemetry Viewer dashboard showing race results, recent sessions, insights, rivals, and track progress" width="900">
</p>

> [!NOTE]
> Created by [Fabrizio Rinaldi](https://fabrizio.so) ([@linuz90](https://x.com/linuz90)). Built for the [Pits n' Giggles](https://www.pitsngiggles.com/) telemetry format and now integrated into Pits n' Giggles itself, thanks to the kind help of its founder.

## What It Does

- 🏁 **Results dashboard** - See your real race form at a glance: average finish, podiums, wins, front-row starts, top-five rate, DNFs, grid gain, recent results, best and toughest tracks, comeback drives, lap-one gains, fastest-lap highlights, and tyre-management patterns.
- 🧭 **Formula scopes** - Keep F1 26, F1 25, F2 25, and older data separate with one app-wide selector and clean scoped URLs such as `/f1-26`, `/f1-26/tracks/sakhir`, and `/f1-26/sessions/session-slug`.
- 🤝 **Rivals & teammates** - Aggregate online race rosters into teammate pace, frequent rivals, head-to-heads, fastest-lap threats, pole sitters, overtakers, and other repeat patterns.
- 📊 **Session detail** - Open any race or qualifying session for lap-by-lap charts, sector tables, stint timelines, tyre wear, damage, ERS, fuel, position history, and driver-vs-driver deltas.
- 🗺️ **Track progress** - Drill into a circuit within the active game scope to review best laps, qualifying progression, race pace, setup history, tyre life, fuel usage, and every saved session for that track.
- 🔒 **Private data loading** - Use the local API during development, self-host against your telemetry folder, or drag in `.json` files / a `.zip` in the browser. Hosted uploads stay in memory and never leave your device.

The dashboard prefers representative online races when there is enough human-grid data. If that is not available for a formula scope, it gracefully falls back to whatever race results or session history exists, so you only see an empty state when there is truly no data to show.

## Loading Your Data

There are three ways to use the app:

| Mode               | Best for                                   | How it works                                                           |
| ------------------ | ------------------------------------------ | ---------------------------------------------------------------------- |
| Local development  | Your full telemetry folder while building  | Set `TELEMETRY_DIR`; Vite serves `/api/sessions` from disk             |
| Hosted/static demo | Trying the app or sharing it publicly      | Bundled sample data loads first; users can drag in their own files     |
| Self-hosted server | Running it permanently on a machine or NAS | Build once, then serve `dist/` and the telemetry API with `pnpm start` |

Telemetry files are scanned recursively, so your normal Pits n' Giggles folder structure can stay as-is. Filenames are expected to follow the Pits n' Giggles pattern:

```txt
SessionType_Track_YYYY_MM_DD_HH_mm_ss.json
```

For example:

```txt
Race_Monza_2026_05_18_21_40_00.json
Short_Qualifying_Madrid_2026_06_12_20_18_00.json
```

## Quick Start

```bash
pnpm install
cp .env.example .env
```

Edit `.env` and point it at your telemetry folder:

```bash
TELEMETRY_DIR=/path/to/your/telemetry/files
```

Then start the app:

```bash
pnpm dev
```

Open [http://localhost:5173](http://localhost:5173).

## Commands

```bash
pnpm dev            # Start dev server at http://localhost:5173
pnpm dev:telemetry <folder>  # Start dev server with a specific telemetry folder
pnpm dev:debug      # Start dev server with DEBUG_TELEMETRY_DIR from .env
pnpm dev:prod       # Run the production-like demo/upload flow locally
pnpm build          # Type-check and build the production app
pnpm preview        # Preview the production build locally
pnpm start          # Serve dist/ plus the telemetry API
pnpm generate-demo  # Regenerate trimmed demo data in public/demo/
pnpm find-session <slug-or-url>  # Resolve a session URL or slug to JSON
```

No test runner or linter is configured yet; `pnpm build` is the main validation command.

For debugging shared repro files without pointing at your full telemetry history, put the files in a small folder and launch against that folder:

```bash
pnpm dev:telemetry "/Users/linuz90/PC Stuff/Pits & Giggles/debug data"
pnpm dev:telemetry /path/to/debug-data -- --host 127.0.0.1 --port 5174
```

The folder is served through the normal local `/api/sessions` flow, so scoped session URLs, track pages, and browser refreshes work the same way as your main telemetry directory.

If you have a larger generated/debug telemetry corpus, keep its path out of git
and put it in your local `.env`:

```bash
DEBUG_TELEMETRY_DIR=/path/to/generated/debug-telemetry
pnpm dev:debug
```

For contributors working with the Pits n' Giggles repo, this can point at the
folder produced after running its integration telemetry downloader/generator
(for example `poetry run python tests/integration_test/runner.py` in that
repo). This is optional local QA data, not something the open-source app
requires or commits.

## Self-Hosting

Build the frontend once, then run the lightweight production server against your telemetry folder:

```bash
pnpm build
TELEMETRY_DIR=/path/to/your/telemetry pnpm start
```

By default this serves the app at [http://localhost:3080](http://localhost:3080). Unlike `pnpm dev`, it does not run Vite's dev toolchain, file watchers, HMR, or source maps, so it is much lighter for an always-on setup.

| Variable        | Default               | Description                                        |
| --------------- | --------------------- | -------------------------------------------------- |
| `TELEMETRY_DIR` | _(required)_          | Path to your Pits n' Giggles telemetry folder      |
| `PORT`          | `3080`                | HTTP port for the production server                |
| `DIST_DIR`      | `./dist`              | Path to the built frontend                         |
| `VITE_APP_NAME` | `F1 Telemetry Viewer` | Optional product-name override for embedded builds |

Works on macOS, Linux, and Windows.

## Stack

React 19, TypeScript, Vite 8, Tailwind CSS 4, Recharts 3, React Router 7, JSZip, Motion, and lucide-react.

## Supported Data

- Race, short qualifying, one-shot qualifying, time trial, practice, and other Pits n' Giggles session JSON files
- Formula-aware comparisons for F1 26 / 2026 DLC, F1 25, F2 25, and older F1 generations
- Current F1 26 track ordering, including Madrid / Madring support
- Online race rosters when available, including rival identity, team, lap stats, overtakes, grid position, finish position, penalties, DNFs, and fastest-lap flags
- Older exports that do not include all summary fields; the UI falls back to the data it can infer

## Architecture

```txt
src/
  components/    Layout, charts, tables, upload UI, dashboard sections
  analysis/      UI-ready telemetry models, insight curation, track/session/rival/setup analysis
  context/       TelemetryProvider and browser zip/json loader
  hooks/         Session list, session detail, and track history hooks
  pages/         Dashboard, session detail, and track progress routes
  plugin/        Vite local API for reading telemetry JSON from disk
  utils/         Formatting, formula scopes, storage, summaries, routes, low-level stats
  types/         TypeScript telemetry model
```

The `TelemetryProvider` uses one data-access path for every screen:

1. Try the local telemetry API (`/api/sessions`).
2. Fall back to bundled demo data (`public/demo/`).
3. Fall back to browser upload mode.

That keeps dashboard cards, track pages, and session pages working the same way whether the app is reading your local folder, serving demo data, or parsing files dropped into the browser.

Formula/game scope is part of the route, not a query parameter. The root path redirects to the latest scope with data; all analysis screens live under `/:formulaKey` so dashboard cards, sidebar sessions, track history, PBs, tyre life, and setup comparisons always describe the same game generation.

Telemetry calculations are split into two layers. `src/utils/stats/` contains small reusable primitives such as lap filtering, ERS energy, tyre wear, and pace helpers. `src/analysis/` contains product-facing models and policies such as session insight cards, dashboard result aggregates, rival cards, track progress buckets, setup comparison, and chart-ready lap/sector/stint/damage/tyre models. UI components should render those models rather than reimplementing telemetry rules inline.
