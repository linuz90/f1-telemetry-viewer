# Lap telemetry

Lap recordings (`.pngt`, Pits n' Giggles 5.0 beta) and the Lap telemetry tab that compares two of them. Keep this file current when a rule here changes in code.

## Where recordings come from

- `src/plugin/lap-recording-index.ts` indexes recordings on their own and serves the Pits n' Giggles lap analyzer API (`/lap-analyzer/api/v1/...`) for both the dev and self-hosted servers. Upload mode and browser imports open them through the same reader in `src/utils/lapRecording/`.
- The reader rejects unknown `.pngt` format versions and decodes only the channels in `LapChannel`. It is the one place to adapt when the beta format changes, except channel units, which `prepareLap()` normalises.
- Recordings stay out of `SessionSummary` and the session index. They pair with session JSON through `resolvePairKey()` (a `_Manual_` save can be stamped up to 2 s after its recording) and stay reachable when `deduplicateSessions` hides their session. That is where restarted qualifying runs keep their only complete laps: the surviving row claims them through `duplicateSlugs` (`sessionSaveSlugs()`) for its glyph and session page.
- Player index, track length and sector starts come from the paired session JSON; the recording has none of them.
- A `.pngt` dropped on its own is a browser import (`src/context/lapImports.ts`, IndexedDB), never written to `TELEMETRY_DIR`. "Whose laps are these?" names its owner: a friend's car takes the friend's name and is never `isPlayer`, even when a paired JSON marks it as the player. Imports sit in the shared lap-recording store, which every mode reads first, so they work in the embedded PnG viewer too. An unpaired lap borrows sector starts from the other selected lap.

## Lap data

- A recorded lap is complete only by `judgeLapCoverage()`: timed, first and last samples within 30 m of the line, no gap over 30 m. Ignore the exporter's `is_good`; most flagged laps start mid-lap.
- Online, another car's recorded clock is the game's estimate: late at the line and corrected after each sector line. `prepareLap()` rebuilds it, so every caller passes the sector starts and the lap's official `sectorEndsMs` (`RecordedLap.sectorEndsMs`, from the paired JSON) when known; `clockDriftS` flags laps it cannot trust.
- Turn numbers and map paths come from real reference laps in the generated `src/constants/trackGeometry.ts` (`pnpm generate-track-geometry`, MultiViewer), read through `getTrackCorners()` and `getTrackPath()`. Markers sit up to about 50 m from the game's slowest point, so `nameUnits()` matches them by stretch, not exact distance.
- Layouts without published geometry (short, reverse, Madring) keep lap-distance names, and their map falls back to the outline drawing lined up by `calibrateOutline()`.

## Tips

- Tips come from `compareLaps()` corner units, which telescope to the official lap-time gap; tips plus remainder always equal it. `TIP_FLOOR_S` (0.03 s) is about three times the error of one stretch measured against official sector times.
- Every lap-tip threshold is a documented constant in the Tuning section of `src/analysis/lapTelemetryAnalysis.ts`; add new ones there, never inline. Run `pnpm check:lap-telemetry` before and after changing one: it prints aggregates only, and a change shows up as tips moving between rows of its census.
- A corner unit starts at the lift even when the throttle is back before the slowest point, and is named for every turn up to where both laps are flat again. A corner that nets under the floor still gets a note when one phase moved 0.05 s or more; its time stays the true net.
- A tip's evidence itemises every phase of its unit, so the cause it names is never credited with the whole stretch.
- Battery is a lap-long budget: a battery tip names the earlier stretch its energy came from, and that stretch's tip says where it paid back and loses its imperative when the battery was worth more.
- On full-throttle stretches, check battery before driving: a flat-out difference with equal battery is car, setup or tow and gets no driving advice. Imperative advice is only for the player's own lap A.

## Picking and showing laps

- Lap B is picked automatically only when the reference is obviously fair (`defaultComparison()`): in a session, the race page's rival or the session's fastest lap by someone else; on a track page, your best from another run for qualifying and time trial. Track-page race laps open alone, since laps from different races compare fuel, tyres and traffic before the driving. Lap A alone always gets one-tap suggestions (`CompareSuggestions`, from `resolvePresets()`), and a pair from two races says so in the comparability line.
- The tip list labels each tip by its unit's turns (`CornerUnit.marker`: "T4", "T6–7", "→T11" for the run into Turn 11), never a running count, which a driver reads as a turn number. The map labels only the active tip and the three worth most, the rest are dots, so a 27-turn circuit stays legible. Without a hover the readouts rest on the active tip, else the one worth most, instead of dashes.
- The battery gauge takes the deploy mode's colour from `ERS_MODE_COLORS`, PnG's own palette, so it matches its HUD. Lap A and B use the chart's you/compare colours ([ui.md](ui.md#charts)).
