# AGENTS.md

Guidance for AI coding agents working in this repository.

## What This Is

F1 Telemetry Viewer is a local-first React app for visualizing telemetry JSON exported by "Pits n' Giggles" (an F1 game telemetry tool).

- No database.
- Local dev indexes telemetry summaries and streams raw telemetry JSON from disk.
- Production/demo mode reads committed demo data or user-uploaded JSON/zip/`.pngt` files.
- Focused Node test suites cover the session-summary index, complete-lap timing, Race Pace estimation, fuel aggregation, tyre wear rates, the race story and session log, Track Strategy synthesis, and lap recordings and their tips. No general UI test runner or linter is configured.

## Commands

```bash
pnpm dev                      # Start dev server, usually http://localhost:5173
pnpm dev:port                 # Print the expected dev server port for this checkout
pnpm dev:telemetry <folder>   # Start dev server against one telemetry folder
pnpm dev:debug                # Use DEBUG_TELEMETRY_DIR from .env
pnpm dev:prod                 # Skip local API; use demo/upload mode
pnpm build                    # Type-check (tsc) + production build
pnpm preview                  # Preview production build
pnpm generate-demo            # Regenerate public/demo/
pnpm find-session <slug-or-url> # Resolve a session URL/slug to JSON on disk
pnpm test                     # Run all focused Node test suites
pnpm test:tracks              # Run canonical track identity/alias regressions
pnpm test:session-index       # Run the focused Node session-index suite
pnpm test:lap-stats           # Run complete-lap timing regressions
pnpm test:race-pace           # Run Race Pace estimator/matching and Classification regressions
pnpm test:energy-stats        # Run ERS/fuel energy-stat regressions
pnpm test:fuel                # Run fuel aggregation and recommendation tests
pnpm test:speed               # Run canonical speed/aero inference regressions
pnpm test:session-story       # Run session kind, session log, race story and online form regressions
pnpm test:search              # Run ⌘K palette matching (aliases, typos, accents)
pnpm test:share-text          # Run plain-text setup/strategy copy formats
pnpm test:strategy            # Run Track Strategy synthesis regressions (dry + wet)
pnpm test:tyre-wear           # Run green-flag tyre wear rate regressions
pnpm test:lap-recording       # Run .pngt reader, completeness and API regressions
pnpm test:lap-telemetry       # Run lap-comparison tips, defaults and track-map calibration
pnpm check:lap-telemetry [folder] # Re-measure lap-tip clock accuracy and tip census on real recordings
pnpm generate-track-geometry  # Regenerate src/constants/trackGeometry.ts (turn markers, circuit paths)
pnpm typecheck:node           # Type-check Node servers/plugins/scripts
pnpm benchmark:session-index  # Benchmark a disposable generated corpus
```

## Local Data

- Copy `.env.example` to `.env` and set `TELEMETRY_DIR` to the telemetry JSON folder.
- For narrow repros, use `pnpm dev:telemetry <folder>` instead of editing `.env`.
- Shared repro files live at `/Users/linuz90/PC Stuff/Pits & Giggles/debug data`.
- `DEBUG_TELEMETRY_DIR` is optional; use `pnpm dev:debug` for broad QA only when that env var is set.
- Never commit real telemetry files, `.env`, machine-specific paths, or debug corpus data.
- The viewer-owned summary cache lives under `.cache/f1-telemetry-viewer/`, outside `TELEMETRY_DIR`. It is ignored, private, derived, and safe to delete while the viewer is stopped.

When a user gives a localhost URL or screenshot, prefer the telemetry source that produced that exact page. Use `pnpm find-session <slug-or-url>` against the active source before guessing.

## Worktrees

- `./workspace-setup.sh init` is the shared setup entry point for Codex/Conductor/T3 Code and plain `git worktree add` checkouts; it reapplies `.worktreeinclude` (e.g. `.env`) from the main checkout.
- T3 Code reads `t3.json` (new threads default to worktrees).
- Conductor shared settings: `.conductor/settings.toml`.
- Personal Conductor overrides: `.conductor/settings.local.toml` (gitignored).
- Dev server ports are deterministic in managed worktrees: Conductor uses `$CONDUCTOR_PORT`; Codex (`$CODEX_HOME/worktrees`) and T3 Code (`$T3CODE_HOME/worktrees`) worktrees get a stable hash-based Vite port. Run `pnpm dev:port` or `pnpm dev:port -- --json` to inspect it. Export `VITE_DEV_PORT` to override manually.
- If no `.env` exists in a worktree, use `pnpm dev:prod` or create one from `.env.example`.

## Architecture

Stack: React 19, TypeScript, Vite 8, Tailwind CSS 4, Recharts 3, React Router 7, TanStack Query 5.

Data flow:

- Pages/hooks -> `TelemetryContext`.
- All network fetching/caching goes through TanStack Query (`QueryClientProvider` in `src/main.tsx`). Query definitions — the `telemetryKeys` key factory, fetchers, `detectDataSource`, and `sessionDetailQueryOptions` — live in `src/queries/telemetry.ts`. `TelemetryContext` wires them to React state: the one-shot data-source detection query (api -> demo -> upload fallback), the session-list query (opt-in polling + refetch-on-focus, api mode only), and the per-session detail query options shared by `useSession` and the imperative `getSession`.
- Dev and self-hosting share `src/plugin/session-summary-index.ts`, which incrementally caches pre-dedup summaries for `/api/sessions` and resolves slugs for raw detail streaming.
- Dev: `src/plugin/telemetry-server.ts` adapts the shared index to Vite middleware.
- Self-hosting: `server.ts` adapts the same index to the production HTTP server.
- Production/demo: `public/demo/sessions.json`.
- Upload mode: JSON/zip/`.pngt` files parsed in-browser.
- Lap recordings (`.pngt`, Pits n' Giggles 5.0 beta): `src/plugin/lap-recording-index.ts` indexes them on their own and serves `/api/lap-recordings/...` for both servers; upload mode and browser imports (`LapImportsProvider`) open them through the same reader in `src/utils/lapRecording/`.

Routes:

- `/` -> newest available formula scope.
- `/:formulaKey` -> Sessions home, e.g. `/f1-26`: latest race, online form, then the session log. Log filters live in the URL (`type`, `mode`, `track`).
- `/:formulaKey/sessions/*` -> session page; `?tab=` picks the tab, `?driver=` opens a driver in Results, and a `?laps=` selection without a tab opens Lap telemetry.
- `/:formulaKey/tracks` -> tracks index.
- `/:formulaKey/tracks/:trackId` -> track page; `?tab=` is one of `TRACK_PAGE_TABS`, and `?tab=<kind>&laps=` (lap imports, older links) opens Lap telemetry on that kind's laps.
- `/:formulaKey/form` -> online form, every online race.
- `/ui-debug` -> dev-only UI fixture page.

Telemetry filenames follow `[SessionType]_[Track]_YYYY_MM_DD_HH_mm_ss.json`. Filename parsing gives stable dates/slugs; `session-info` wins for display metadata.

## Key Code Paths

Entry and data:

- `src/App.tsx` — routes, formula guards, `/ui-debug`.
- `src/queries/telemetry.ts` — TanStack Query definitions: `telemetryKeys` factory, list/detail fetchers, `detectDataSource`, `sessionDetailQueryOptions`.
- `src/context/TelemetryContext.tsx` — binds those queries to React state (mode/upload store) and exposes the provider surface.
- `src/context/zipLoader.ts` — uploaded JSON/zip parsing.
- `src/plugin/telemetry-server.ts` — local telemetry API.
- `src/plugin/session-summary-index.ts` — Node-only incremental summary index, persistence, dedupe finalization, and safe slug resolution.
- `src/utils/parseFilename.ts` — filename -> slug/date parsing.

Product surfaces:

- `src/pages/SessionsPage.tsx` — Sessions home.
- `src/pages/SessionPage.tsx` — picks the view by `sessionKind()`: `src/pages/session/` `RaceView`, `LongRunView`, `QualifyingView`, `TimeTrialView`.
- `src/pages/TrackProgressPage.tsx`, `src/pages/TracksPage.tsx`, `src/pages/FormPage.tsx`
- `src/pages/UiDebugPage.tsx`
- `src/components/lap-telemetry/` — Lap Telemetry tab (session pages and the track page).

Shared UI:

- `src/components/Layout.tsx` and `src/components/shell/` — top bar with the Sessions and Tracks hover menus, ⌘K palette, scroll memory.
- `src/components/session/` — `SessionShell` (‹ › and J/K through the filtered log, day switcher, tabs) and `SessionParts` (`Panel`, `StatDoors`, `WorthList`, `SetupSheet`).
- `src/components/sessions/SessionLog.tsx` — the session log, grouped by day, track and online event.
- `src/components/charts/` — `LapChart`, `TrendChart`, `FormChart`.
- `src/components/track/`
- `src/components/ui/` (`StintChip`, `PillSelect`, table recipes, etc.)

Telemetry intelligence:

- `src/analysis/` — product-facing models, rankings, buckets, chart-ready data. Page models: `sessionKind`, `sessionLog`, `raceStory`, `worthALook`, `lapChartModel`, `onlineForm`, `trackIndex`, `trackBriefing`, `trackSetups`.
- `src/utils/stats/` — low-level reusable telemetry/math primitives.
- `src/constants/` — shared tokens, routes, storage keys, setup ranges, track calendars.
- `src/utils/tracks.ts` is the one entry point for track identity and per-track lookups; per-track tables in `src/constants/` are keyed by its canonical ids.
- Thin compatibility wrappers remain in `src/utils/colors.ts`, `src/utils/routes.ts`, and `src/utils/links.ts`.

## Telemetry Rules

Formula scope:

- The first URL segment is the active scope: `/f1-26`, `/f1-25`, `/f2-25`.
- `F1 Modern` canonicalizes to `f1-25`; `f1-modern` is only a legacy redirect alias.
- F2 exports with `game-year: 25` display as `F2 25`.
- F1 26 / 2026 Season Pack sessions compare under `f1-26`.
- Do not add `?formula=` or new legacy alias routes.
- Pass the active formula key to `sortTracksByCalendar()` so F1 26 uses the canonical Madring calendar slot.

Track identity:

- `SessionSummary.track` keeps the raw exporter label; do not rewrite persisted summaries for presentation.
- Use `getTrackId()` / `isSameTrack()` for grouping and comparison, `getTrackDisplayName()` for UI copy, and `trackPath()` for canonical URLs.
- Keep legacy exporter-derived track slugs resolving so existing bookmarks redirect to the canonical circuit route.
- Turn numbers follow the official numbering in `getTrackCorners()`. Race-control locations come from Pits n' Giggles' `segment-info`, so `normalizeSession()` relabels the segments in `PNG_TURN_FIXES` where its numbers differ; add a range there rather than patching labels in components.

Start reaction:

- Use `session-info["start-reaction-time"]` only; it is the player's exported reaction time as a float in seconds.
- `0`, missing, non-finite, or negative values mean unavailable.
- Current exports do not provide per-driver reaction times; do not build all-driver rankings unless a real per-driver field is added.
- The race hero's Start chip shows it on every race that has it, beside the places gained or lost; values over `0.5s` read as a severe start.
- Do not estimate reaction time from session duration, system time, race-control events, packet timestamps, or lap-one movement.
- This value depends on the telemetry format, not only formula scope: F1 25 and F2 sessions can include it when recorded with the 2026 format.

ERS:

- F1 26 can deploy more than 4 MJ/lap; show deployment as energy (`MJ/lap`), not battery percentage.
- Prefer `per-lap-info[].ers-stats["ers-deployed-j"]`.
- Fall back to `car-status-data["ers-deployed-this-lap"]` for older exports.
- Harvest utilization uses `ers-stats["ers-harv-mguk-j"] / ers-stats["ers-harv-limit-mguk-j"]`, falling back to the matching car-status fields; do not include MGU-H in that ratio.
- Keep explicit zero-harvest laps in the average, exclude pre-race/final-reset and neutralized laps, and allow slight values above 100% from packet timing.
- Older exports without a harvest limit should retain raw harvested energy (`MJ/lap`) instead of inventing a utilization percentage.
- Show battery-store values as percentages only when explicitly displaying remaining store.

Speed:

- Use `src/analysis/speedAnalysis.ts` for every product-facing speed value; do not read raw `top-speed-kmph` fields directly in pages or components.
- `src/analysis/speedProfileAnalysis.ts` is an internal implementation detail of that model; product callers still import `speedAnalysis.ts` only.
- Keep the meanings explicit: Session peak is the highest credible session observation, Lap peak is one completed lap's maximum, Representative high speed is the upper end of repeated eligible laps, and Speed trap is the best fixed-gate crossing.
- `speed-trap-records` is authoritative for trap value/rank. Attach its lap only when `lap-data` reports a matching trap speed; race numbers are not unique enough for identity.
- Aero tendency is a conservative race-only inference from repeated same-lap comparisons, not recorded setup truth. Keep absolute speeds and deltas typed separately, cap current-export confidence at Medium, and show why evidence is inconclusive.
- Never use bare `Top Speed` for session peak, lap peak, trap speed, or a driver delta.

Tyre wear:

- User-facing tyre wear rates, stint life, and strategy projections use worst-wheel wear (max of FL/FR/RL/RR), not the exported average.
- Wear rates are green-flag rates from `getGreenFlagWear()`: per-lap deltas measured from the snapshot PnG logs on the lap before the stint, over laps no SC/VSC touched (restart laps included), skipping flat or falling snapshots. End wear divided by `stint-length` is wrong three ways: SC laps barely wear, a refitted used set starts above zero, and an unfinished race's final stint counts the lap in progress.
- Compact `session-history.tyre-stints-history-data[].end-lap` is one lap before the detailed outgoing stint boundary; use `getDriverStints()` instead of raw compact data so pit-in/out filtering stays aligned.
- PnG may emit a fresh incoming-tyre `0%` snapshot on the previous pit-boundary lap. Normalize duplicate lap wear via shared tyre helpers so outgoing worn tyres are not overwritten by incoming fresh tyres.
- Absolute strategy timing anchors require real tyre-wear history; synthesized/basic-only stints can describe compound sequence and pit laps but must not anchor race-duration estimates as zero-wear stints.
- The track page's Tyre Life is a stint length in green-flag laps, not a race lap: `estMaxLife` is where the median of the stints' own green-flag curve projections reaches `PUNCTURE_THRESHOLD` (`projectCompoundLapsToWear()`), and the card shows the longest green-flag run and the wear it added beside it because practice races are mostly partial and the number is usually an extrapolation. Strategy stint wear never reads below that same median (`projectCompoundWear()`), even where one real stint covers the plan, so only a managed-tyres plan outlasts the card.

Lap timing validity:

- PnG can mark a partial sector fragment as a valid lap while copying that sector into `lap-time-in-ms`. Use `hasCompleteLapTiming()` / `isCompleteValidLap()` for full-lap stats instead of checking only the bit flags and positive total.
- Prefer final-classification best-lap fields for classified race/quali drivers; fall back to complete lap history when classification is unavailable. Time Trial is the exception: its classification can contain a persistent PB/ghost, so current-run UI must use complete history. Never derive race pace from classification totals or partial history.

Race pace:

- Bare `Race Pace` means the arithmetic mean returned by `getRacePaceEstimate()`: every eligible complete green-flag lap after lap-one, SC/VSC, pit-transition, and per-stint outlier filtering.
- At least three eligible laps are required to show Race Pace. Rankings, highlights, and PBs additionally require at least half the session's maximum eligible sample count.
- Carry sample counts/confidence into user-facing evidence. Keep same-compound rival pace, stint pace, strategy modelling, and Peak pace explicitly named because they answer different questions.
- `Peak pace` is `calculatePeakPace()`: the mean of the fastest three eligible race-pace laps, with the lap count beside it. Every surface that shows it (Peak Pace Evolution, Tyre Life cards, any driver table) uses that function and that label; the window and the reasons for it live in `src/utils/stats/peakPace.ts`.
- Historical Race Pace PBs compare only within the same race-distance lap count.
- Race Pace is never a fastest-N window: a mean does not improve with more laps to pick from, a fastest-N does. Mixed strategies are handled by scoping, not trimming: the Results table's compound filter recomputes Best Lap and Race Pace on one compound's laps (`buildRaceDriverStats(..., compound)`), keeping the ranking floor within that compound.
- Matched Pace (`compareCompoundMatchedRacePace()`) is the same-compound Race Pace mean, so its delta matches the filtered table. Its delta is persisted in rival summaries; changing it needs a `SESSION_SUMMARY_CACHE_VERSION` bump.

Analysis layer:

- Calculation-heavy logic belongs in `src/analysis/`, not page/chart components.
- `src/analysis/` returns plain typed models that UI components render.
- Generic primitives belong in `src/utils/stats/`.
- Product-specific ranking, curation, bucketing, and insight thresholds belong in `src/analysis/`.
- Add concise why-comments for exporter quirks, thresholds, and comparison policies.

Fuel recommendations:

- Session pages are retrospective: lead with the game's signed lap-margin estimate at the finish or last captured lap. Do not turn one session into a future-load recommendation or present the game estimate as physical range.
- Actionable initial-fuel targets belong on the track page, where they use same-distance, UID-independent evidence, pooled P75 burn, and confidence.

Session summary cache:

- `SESSION_INDEX_FORMAT_VERSION` covers the persisted index envelope; bump it when that shape changes.
- `SESSION_SUMMARY_CACHE_VERSION` lives beside `buildSessionSummary()`. Bump it whenever `SessionSummary`, `buildSessionSummary()`, filename/path normalization, or any transitive summary-producing policy changes.
- Dedupe and final ordering changes do not require a summary-version bump because the index persists pre-dedup entries and re-derives the final list.
- Never persist globally derived `duplicateCount` values or raw telemetry in the index.
- Never write viewer cache files into `TELEMETRY_DIR` or rely on Pits n' Giggles' incomplete `.png_session_cache.json`.
- Detail endpoints must continue streaming the indexed source file rather than serving cached summary data.
- Benchmark runs must use a disposable scratch root outside live telemetry data, print aggregates only, and delete only their uniquely owned run directory.

Strategy timing:

- Track Strategy timing must stay race-distance scoped. Tyre wear and degradation differ between 25%, 50%, and full-distance races, so do not reuse same-track tyre pace/wear evidence across `total-laps` buckets unless a future model explicitly normalizes race-distance percentage.
- When same-distance strategy evidence exists, prefer same stop-count samples for strategy timing and wear projection, then fall back to the broader selected race-distance bucket.
- Pit-loss fallbacks may cross distance because pit-lane time loss is distance-independent: infer same-track user pit loss first, reject obvious outlier stops, then use attributed Pits n' Giggles F1 defaults, then a low-confidence F1 median. Do not invent F2 pit-loss defaults.
- The dry recommendation is synthesized from the player's compound pace and wear (model in the header comment of `src/analysis/trackStrategySynthesis.ts`), never ranked from observed compound sequences: with one or two races at a track, the most frequent sequence is whatever happened once, DNFs included. `PUNCTURE_THRESHOLD` (`src/utils/stats/tyres.ts`) is its only wear cap; import it rather than adding a strategy-specific ceiling.
- Strategy alternatives should stay useful: prefer a different stop count only when it is time-competitive; otherwise show the next best distinct one-stop or pit-window shape.
- Dry plans pair compounds on adjacent rungs of what the player has run (Soft+Medium, Medium+Hard; Soft+Hard only without a Medium, as in F2), with one fast-durable-fast sandwich per pair. F2 sprints (`session-type` "Race"; the feature race is "Race 2") need no stop, so they also get no-stop plans; any feature race in the bucket keeps the stop mandatory.
- Plans within `FAST_START_TIE_MS` go to the one starting on the softer tyre: the model prices neither the start nor track position, and most of the field starts soft. Check recommendations against what finishers ran in races the player completed; when the player quits, the game simulates everyone else's result.
- Absolute strategy durations are display estimates anchored to completed same-distance races; otherwise prefer relative deltas and confidence/source copy.
- A dry or wet plan with a stint more than `WEAR_EXTRAPOLATION_TOLERANCE_LAPS` past its compound's longest green-flag run is a wear extrapolation: its timing drops to low confidence and names the tyre.
- Compound pace offsets come from the player's clean laps corrected to an empty tank and fresh tyres (`FUEL_LAP_TIME_MS_PER_KG`, `WEAR_LAP_TIME_MS_PER_PERCENT`, both measured on the corpus), compared only within races that ran two compounds (median polish over per-race medians), never a lap-number trend: in-stint degradation cancels the fuel gain and makes the late, light stint's tyre look fastest. A compound needs 6 clean laps from 2 sessions (saves of one session count once); a thin or order-inverting compound sits `DEFAULT_COMPOUND_STEP_MS` per rung from the measured ones (interpolated between two) and its plans read low confidence. The game's tyre-set `lap-delta-time` is not race pace: per stint it is relative to the fitted set and includes wear, and new sets' deltas are a fresh-tyre ideal about three times the gap races show.
- Wear costs lap time linearly up to the puncture cap; fuel load changes the wear rate by about 5% across a full tank, so wear projections carry no fuel term.
- Wet plans are separate same-compound stop-count plans, one per wet compound (PnG exports `Inters` and `Wet`, not `Intermediate`). Keep wet stints out of dry pair ranking, anchor each plan only on races run entirely on its compounds, and leave slick crossovers unmodelled because they depend on when the track dries.

Lap telemetry:

- A recorded lap is complete only by `judgeLapCoverage()`: timed, first and last samples within 30 m of the line, no gap over 30 m. Never trust the exporter's `is_good`; most flagged laps start mid-lap.
- Keep recordings out of `SessionSummary` and the session index. They pair with session JSON through `resolvePairKey()` (a `_Manual_` save can be stamped up to 2 s after its recording) and stay reachable when `deduplicateSessions` hides their session, which is where restarted qualifying runs keep their only complete laps: the surviving row claims them through `duplicateSlugs` (`sessionSaveSlugs()`) for its glyph and session page.
- Player index, track length and sector starts come from the paired session JSON; the recording has none of them.
- Online, another car's recorded clock is the game's estimate: late at the line and corrected after each sector line. `prepareLap()` rebuilds it, so every caller passes the sector starts and the lap's official `sectorEndsMs` (`RecordedLap.sectorEndsMs`, from the paired JSON) when known; `clockDriftS` flags laps it cannot trust.
- A `.pngt` dropped on its own is a browser import (`src/context/lapImports.ts`, IndexedDB), never written to `TELEMETRY_DIR`. "Whose laps are these?" names its owner: a friend's car takes the friend's name and is never `isPlayer`, even when a paired JSON marks it as the player. Imports sit in the shared lap-recording store, which every mode reads first, so they work in the embedded Pits n' Giggles viewer too; an unpaired lap borrows sector starts from the other selected lap.
- Tips come from `compareLaps()` corner units, which telescope to the official lap-time gap; keep tips plus remainder equal to it. `TIP_FLOOR_S` (0.03 s) is about three times the error of one stretch measured against official sector times.
- Every lap-tip threshold is a documented constant in the Tuning section of `src/analysis/lapTelemetryAnalysis.ts`; add new ones there, never inline. Run `pnpm check:lap-telemetry` before and after changing one: it prints aggregates only, and a change shows up as tips moving between rows of its census.
- A corner unit starts at the lift even when the throttle is back before the slowest point, and is named for every turn up to where both laps are flat again. A corner that nets under the floor still gets a note when one phase moved 0.05 s or more; its time stays the true net.
- A tip's evidence itemises every phase of its unit, so the cause it names is never credited with the whole stretch.
- Battery is a lap-long budget: a battery tip names the earlier stretch its energy came from, and that stretch's tip says where it paid back and loses its imperative when the battery was worth more.
- Turn numbers and map paths come from real reference laps in the generated `src/constants/trackGeometry.ts` (`pnpm generate-track-geometry`, MultiViewer), read through `getTrackCorners()` and `getTrackPath()`. Markers sit up to about 50 m from the game's slowest point, so `nameUnits()` matches them by stretch, not exact distance.
- Layouts without published geometry (short, reverse, Madring) keep lap-distance names, and their map falls back to the outline drawing lined up by `calibrateOutline()`.
- On full-throttle stretches, check battery before driving; a flat-out difference with equal battery is car, setup or tow and gets no driving advice. Imperative advice is only for the player's own lap A.
- The reader rejects unknown `.pngt` format versions and decodes only the channels in `LapChannel`; it is the one place to adapt when the beta format changes, except channel units, which `prepareLap()` normalises.

Pages:

- Every element answers a driver question for its page, and every summary card opens the tab or page with the full story.
- `summaryKind()` / `sessionKind()` decide which page a session gets: race, long run (an offline race with no final classification status), qualifying, or time trial. Use them rather than matching session-type strings.
- Each session page leads with a hero headline. A new insight goes into the ranked Worth a look list (`src/analysis/worthALook.ts`), never a new tile or card.
- Worth a look takes every item that clears its threshold in the Tuning section; `WorthList` shows five and folds the rest behind "Show N more". `rankWorthItems()` ranks places before seconds. The list carries no padding or placeholder items and never repeats the headline, and imperative advice comes only from lap-telemetry tips.
- Position changes come from `buildRaceStory()`: a pit cycle nets out once nearby cars have made their matching stop, and a swap that comes back within two laps reads as steady, so chips and headlines never credit a pit cycle or a back-and-forth as places gained.
- Anything per lap is drawn by `LapChart`: a line on a normal time axis (quicker laps lower, pit and SC laps in an "off scale" gutter above), the compound strip beneath, SC/VSC as grey washes, pit hairlines, and the driver's own events lane. A faded dot is a lap Race Pace leaves out (`buildDriverLapSeries()`), a flat line a stint average. Stacked panels (position over lap time) are labelled and spaced apart. Dates are progress lines (`TrendChart`), drivers are sorted bars, places on track use the circuit map; no donuts. A single driver's line is neutral ink; with a comparison driver on the chart, you are `--color-chart-you` (cyan) and they are `--color-chart-compare` (orange). Purple is the fastest.
- Race pages show no whole-race sector split: it is not actionable. Qualifying keeps its one-lap sector cards.
- Circuit maps are `TrackOutline`, drawn from `trackGeometry.ts` in the brand red. `detail` adds the chequered timing line, sector splits (lap fractions from `session-info` `sector-2/3-lap-distance-start`, which older exports leave at 0) and turn numbers, each label placed on the side of the track with the most room.
- The track Setups tab shows the quali setup (fastest or latest), the race setup and every setup run there; `setupIdentity()` ignores brake bias and fuel, which drivers change mid-session.

Rivals roster:

- Online race summaries may include `SessionSummary.rivals`.
- Identity key: normalized `driver-name`.
- Rival facts appear in context, not on a page of their own: the Results driver panel (`DriverPanel`: races together, average matched pace) and ⌘K driver search.
- Qualifying and offline-AI sessions skip the roster to keep summaries slim.

Styling:

- Light and dark themes: `index.html` sets `data-theme` before first paint (`?theme=light|dark`, else the system setting) and `src/index.css` overrides tokens for light.
- Neutrals use the theme-aware `tone-*` scale (`bg-tone-900`, `text-tone-500`, `ring-tone-0/[0.06]`), never `zinc-*`, `white` or `black`, which stay fixed in light mode. Inline and SVG colours use `var(--color-tone-*)`; for a translucent dynamic colour use `color-mix(in oklab, <color> N%, transparent)`, since compound and chart colours can be CSS variables and break hex-alpha suffixes.
- Accent text in 200–400 shades is remapped to darker shades in light mode; meaning-bearing colour goes through `best`/`ahead`/`behind`/`warning`/`active` and `CHART_THEME`.
- `brand` is the logo's red (`AppLogo`, track maps, the What's new dot). It never carries data, so a loss is always `behind`.
- Reuse shared primitives before adding one-off styles.
- Keep chart/card constants in `src/constants/` or shared UI modules.
- Color carries meaning (semantic tokens in `src/index.css`): purple (`best`, the `purple` accent) means fastest or session best, as in F1 broadcasts; green and red (`ahead`, `behind`) mean gaining or losing against a rival or a previous result.
- In a tile that mixes prose with a number, tint only the number (`Slower by <span className="text-behind">+0.583</span>`); verbs, labels and units stay neutral so the eye lands on the data. A tile showing one bare value keeps its full color.

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
