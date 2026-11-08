# Telemetry data

How to read Pits n' Giggles (PnG) session JSON: identity, units, and the exporter quirks behind each field. Keep this file current when a rule here changes in code.

## Sessions and slugs

- Filenames follow `[SessionType]_[Track]_YYYY_MM_DD_HH_mm_ss.json`, sometimes with `_Manual_` before the date. Filename parsing (`src/utils/parseFilename.ts`) gives stable dates and slugs; `session-info` wins for display metadata.
- A slug is the lowercased basename with `_` turned into `-`: `Race_Baku_Manual_2026_02_21_16_39_26.json` is `race-baku-manual-2026-02-21-16-39-26`. The formula scope in a URL is not part of the file lookup.
- `summaryKind()` / `sessionKind()` decide what a session is: race, long run (an offline race with no final classification status), qualifying, or time trial. Use them rather than matching `session-type` strings. F2 sprints are `session-type` "Race" and the feature race is "Race 2".

## Formula scope

- The first URL segment is the active scope: `/f1-26`, `/f1-25`, `/f2-25`. Add no `?formula=` param and no new legacy alias routes.
- `F1 Modern` canonicalizes to `f1-25`; `f1-modern` is only a legacy redirect alias.
- F2 exports with `game-year: 25` display as `F2 25`. F1 26 and 2026 Season Pack sessions compare under `f1-26`.
- Pass the active formula key to `sortTracksByCalendar()` so F1 26 uses the canonical Madring calendar slot.

## Tracks and turns

- `src/utils/tracks.ts` is the one entry point for track identity and per-track lookups; per-track tables in `src/constants/` are keyed by its canonical ids.
- `SessionSummary.track` keeps the raw exporter label; persisted summaries are never rewritten for presentation. Use `getTrackId()` / `isSameTrack()` to group and compare, `getTrackDisplayName()` for UI copy, and `trackPath()` for canonical URLs.
- Legacy exporter-derived track slugs keep resolving, so old bookmarks redirect to the canonical circuit route.
- Turn numbers follow the official numbering in `getTrackCorners()`. Race-control locations come from PnG's `segment-info`, so `normalizeSession()` relabels the segments in `PNG_TURN_FIXES` where PnG's numbers differ; add a range there rather than patching labels in components.

## Lap timing validity

- PnG can mark a partial sector fragment as a valid lap while copying that sector into `lap-time-in-ms`. Use `hasCompleteLapTiming()` / `isCompleteValidLap()` for full-lap stats, not just the bit flags and a positive total.
- Prefer final-classification best-lap fields for classified race and quali drivers, falling back to complete lap history when classification is missing. Time Trial is the exception: its classification can hold a persistent PB or ghost, so current-run UI uses complete history.

## Start reaction

- Read `session-info["start-reaction-time"]` only: the player's reaction time as a float in seconds. `0`, missing, non-finite or negative means unavailable.
- Exports carry no per-driver reaction times, so build no all-driver ranking until a real per-driver field exists. Never estimate it from session duration, system time, race-control events, packet timestamps or lap-one movement.
- It depends on the telemetry format, not the formula scope: F1 25 and F2 sessions recorded with the 2026 format can include it.
- The race hero's Start chip shows it on every race that has it, beside places gained or lost; over `0.5s` reads as a severe start.

## ERS

- F1 26 can deploy more than 4 MJ/lap, so show deployment as energy (`MJ/lap`), not battery percentage. Show battery-store values as percentages only when displaying remaining store.
- Deployment: prefer `per-lap-info[].ers-stats["ers-deployed-j"]`, falling back to `car-status-data["ers-deployed-this-lap"]` on older exports.
- Harvest utilization is `ers-harv-mguk-j / ers-harv-limit-mguk-j` (falling back to the matching car-status fields), MGU-H excluded. Keep explicit zero-harvest laps in the average, exclude pre-race, final-reset and neutralized laps, and allow slightly over 100% from packet timing.
- Older exports without a harvest limit show raw harvested energy (`MJ/lap`) rather than an invented percentage.

## Speed

- Every product-facing speed value comes from `src/analysis/speedAnalysis.ts`; pages and components never read raw `top-speed-kmph` fields. `speedProfileAnalysis.ts` is its internal detail, so callers import `speedAnalysis.ts` only.
- Keep the meanings apart: Session peak is the highest credible session observation, Lap peak one completed lap's maximum, Representative high speed the upper end of repeated eligible laps, Speed trap the best fixed-gate crossing. Never label any of them, or a driver delta, bare `Top Speed`.
- `speed-trap-records` is authoritative for trap value and rank. Attach its lap only when `lap-data` reports a matching trap speed; race numbers are not unique enough for identity.
- Aero tendency is a conservative race-only inference from repeated same-lap comparisons, not recorded setup truth. Type absolute speeds and deltas separately, cap current-export confidence at Medium, and show why evidence is inconclusive.

## Tyre wear data

- Compact `session-history.tyre-stints-history-data[].end-lap` is one lap before the detailed outgoing stint boundary; use `getDriverStints()` rather than raw compact data so pit-in/out filtering stays aligned.
- PnG may emit a fresh incoming-tyre `0%` snapshot on the previous pit-boundary lap. The shared tyre helpers normalize duplicate lap wear so the incoming fresh set never overwrites the outgoing worn one.
- Wet compounds export as `Inters` and `Wet`, not `Intermediate`.

## Rivals

- Online race summaries may carry `SessionSummary.rivals`, keyed by normalized `driver-name`. Qualifying and offline-AI sessions skip the roster to keep summaries slim.
- Rival facts appear in context, never on a page of their own: the Results driver panel (`DriverPanel`: races together, average matched pace) and ⌘K driver search.
