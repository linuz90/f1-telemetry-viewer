# Pace, tyres and strategy

What the pace, tyre, fuel and strategy numbers mean, and the modelling choices behind them. Keep this file current when a rule here changes in code; model detail lives in the header comments of the files named below.

## Race pace

- Bare `Race Pace` is the arithmetic mean from `getRacePaceEstimate()`: every eligible complete green-flag lap after lap one, SC/VSC, pit-transition and per-stint outlier filtering. Never derive race pace from classification totals or partial history.
- It needs at least three eligible laps. Rankings, highlights and PBs also need at least half the session's maximum eligible sample count. Carry sample counts and confidence into user-facing evidence.
- Race Pace is never a fastest-N window: a mean does not improve with more laps to pick from, a fastest-N does. Mixed strategies are handled by scoping, not trimming: the Results table's compound filter recomputes Best Lap and Race Pace on one compound's laps (`buildRaceDriverStats(..., compound)`), with the ranking floor applied within that compound.
- Historical Race Pace PBs compare only within the same race-distance lap count.
- Name the other measures explicitly, since they answer different questions: same-compound rival pace, stint pace, strategy modelling, and `Peak pace`.
- `Peak pace` is `calculatePeakPace()`: the mean of the fastest three eligible race-pace laps, with the lap count beside it. Every surface showing it (Peak Pace Evolution, Tyre Life cards, any driver table) uses that function and that label; `src/utils/stats/peakPace.ts` holds the reasons for the window.
- Matched Pace (`compareCompoundMatchedRacePace()`) is the same-compound Race Pace mean, so its delta matches the filtered table. The delta is persisted in rival summaries, so changing it needs a `SESSION_SUMMARY_CACHE_VERSION` bump.

## Tyre wear and life

- User-facing wear rates, stint life and strategy projections use worst-wheel wear (max of FL/FR/RL/RR), not the exported average.
- Wear rates are green-flag rates from `getGreenFlagWear()`: per-lap deltas from the snapshot PnG logs on the lap before the stint, over laps no SC/VSC touched (restart laps included), skipping flat or falling snapshots. End wear divided by `stint-length` is wrong three ways: SC laps barely wear, a refitted used set starts above zero, and an unfinished race's final stint counts the lap in progress.
- Exporter quirks in the stint data: [telemetry-data.md](telemetry-data.md#tyre-wear-data).
- The track page's Tyre Life is a stint length in green-flag laps, not a race lap. `estMaxLife` is where the median of the stints' own green-flag curve projections reaches `PUNCTURE_THRESHOLD` (`projectCompoundLapsToWear()`). The card shows the longest green-flag run and the wear it added beside it, because practice races are mostly partial and the number is usually an extrapolation. Strategy stint wear never reads below that same median (`projectCompoundWear()`), even where one real stint covers the plan, so only a managed-tyres plan outlasts the card.

## Stint comparison

- A stint is compared with the player's other stints at the same track, formula scope and race length (`src/analysis/stintCompare.ts`; its header holds the model). Laps pair by tyre age on laps Race Pace counts in both, each pair corrected to equal fuel at `FUEL_LAP_TIME_MS_PER_KG`. Wear is never corrected, since managing it is part of the result. The delta is the mean of the pairs, never the gap between two stint averages.
- Pace travels with wear a lap, fade and the setup diff wherever a comparison shows: a quicker stint that wears more is a trade.
- Long runs lead with it: each stint beside its earlier runs on the same tyre (the progression), the chart's compare line and gap panel, and the lap table's deltas. Races carry it in the Tyres tab, since orange on their other charts is the rival driver. `?vs=` and `?stint=` hold the pair.
- Summaries carry the stints lap by lap (`SessionSummary.stintLaps`); changing `buildPlayerStintLaps()` needs a `SESSION_SUMMARY_CACHE_VERSION` bump. PnG's own summaries lack it, so `useStintComparison` loads the newest few sessions' JSON instead.

## Fuel

- Session pages are retrospective: lead with the game's signed lap-margin estimate at the finish or last captured lap. Never turn one session into a future-load recommendation or present the game estimate as physical range.
- Actionable initial-fuel targets belong on the track page, from same-distance, UID-independent evidence, pooled P75 burn, and confidence.

## Strategy

The dry model is in the header comment of `src/analysis/trackStrategySynthesis.ts`; timing and compound pace are in `trackStrategyTiming.ts`.

- Timing stays race-distance scoped. Wear and degradation differ between 25%, 50% and full-distance races, so same-track tyre pace and wear never cross `total-laps` buckets unless a model explicitly normalizes race-distance percentage. Within a distance, prefer same stop-count samples for timing and wear projection, then fall back to the whole distance bucket.
- Pit loss may cross distance, since pit-lane time loss is distance-independent: same-track user pit loss first (obvious outlier stops rejected), then the attributed PnG F1 defaults, then a low-confidence F1 median. F2 has no invented pit-loss defaults.
- The dry recommendation is synthesized from the player's compound pace and wear, never ranked from observed compound sequences: with one or two races at a track, the most frequent sequence is whatever happened once, DNFs included. `PUNCTURE_THRESHOLD` (`src/utils/stats/tyres.ts`) is its only wear cap; import it rather than adding a strategy-specific ceiling.
- Dry plans pair compounds on adjacent rungs of what the player has run (Soft+Medium, Medium+Hard; Soft+Hard only without a Medium, as in F2), with one fast-durable-fast sandwich per pair. F2 sprints need no stop, so they also get no-stop plans; any feature race in the bucket keeps the stop mandatory.
- Plans within `FAST_START_TIE_MS` go to the one starting on the softer tyre: the model prices neither the start nor track position, and most of the field starts soft. Check recommendations against what finishers ran in races the player completed; when the player quits, the game simulates everyone else's result.
- Alternatives stay useful: a different stop count only when it is time-competitive, otherwise the next best distinct one-stop or pit-window shape.
- Absolute durations are display estimates anchored to completed same-distance races with real tyre-wear history; synthesized or basic-only stints can describe compound sequence and pit laps but never anchor a race duration as zero-wear stints. Without an anchor, show relative deltas with confidence and source copy.
- A dry or wet plan with a stint more than `WEAR_EXTRAPOLATION_TOLERANCE_LAPS` past its compound's longest green-flag run is a wear extrapolation: its timing drops to low confidence and names the tyre.
- Compound pace offsets come from the player's clean laps corrected to an empty tank and fresh tyres (`FUEL_LAP_TIME_MS_PER_KG`, `WEAR_LAP_TIME_MS_PER_PERCENT`, both measured on the corpus), compared only within races that ran two compounds (median polish over per-race medians), never a lap-number trend: in-stint degradation cancels the fuel gain and makes the late, light stint's tyre look fastest. A compound needs 6 clean laps from 2 races (saves of one session count once); a thin or order-inverting compound sits `DEFAULT_COMPOUND_STEP_MS` per rung from the measured ones (interpolated between two) and its plans read low confidence.
- The game's tyre-set `lap-delta-time` is not race pace: per stint it is relative to the fitted set and includes wear, and new sets' deltas are a fresh-tyre ideal about three times the gap races show.
- Wear costs lap time linearly up to the puncture cap. Fuel load changes the wear rate by about 5% across a full tank, so wear projections carry no fuel term.
- Wet plans are separate same-compound stop-count plans, one per wet compound. Wet stints stay out of dry pair ranking, each plan anchors only on races run entirely on its compounds, and slick crossovers stay unmodelled because they depend on when the track dries.
