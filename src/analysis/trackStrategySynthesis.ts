import type {
  CompoundLifeSample,
  CompoundLifeStats,
} from "../utils/stats/trackAggregates";
import {
  PUNCTURE_THRESHOLD,
  projectCompoundWear,
  projectWearFromCurve,
} from "../utils/stats/tyres";
import {
  isDryCompound,
  rankDryCompoundsByPace,
  rankWetCompounds,
} from "./trackStrategyCompounds";
import {
  buildSingleCompoundTimingContext,
  buildTimingContext,
  findRaceTimeAnchor,
  scoreShape,
  timeEstimateForCandidate,
  type StrategyScore,
} from "./trackStrategyTiming";
import type {
  BucketRaceEntry,
  TrackStrategyShape,
  TrackStrategySuggestion,
  TrackStrategyTimeEstimate,
} from "./trackStrategyTypes";

function buildPitWindow(stintEndLap: number, totalLaps: number) {
  const target = stintEndLap;
  const earliest = Math.max(1, target - 1);
  const latest = Math.min(totalLaps - 1, target + 1);
  return { earliest, latest, target };
}

// ─── Wear-derived strategy synthesis ─────────────────────────────────────────
//
// The recommendation is intentionally NOT a "replay the sequence we observed
// most often" lookup — with thin samples (one or two races at a track) that
// approach surfaces whatever was actually run, including DNFs and weird
// experiments. Instead, we build a generic F1 one-stopper from compound pace +
// wear data, using a wear-balanced pit lap with a slight undercut bias:
//
//   1. Rank dry compounds by softness (softer = faster on fresh rubber).
//   2. Pair compounds on adjacent rungs of what the player has run: Soft+Medium
//      and Medium+Hard, never Soft+Hard across a Medium (0/35 observations in
//      user telemetry). Without a Medium, as in F2, Soft+Hard is adjacent.
//   3. For each pair, the pit lap is set so BOTH stints hit roughly the same
//      fraction of their aggregate wear life:
//          balanced = round(totalLaps * wearRate(second)
//                           / (wearRate(first) + wearRate(second)))
//      then nudged 1 lap earlier to bank a small undercut margin (fresh rubber
//      gives ~1.5–2s on the out-lap; one lap = roughly that gain).
//   4. Projected stint wear prefers matching real stint samples (same compound,
//      same sequence slot, and enough green-flag laps to cover the projected
//      stint), reading the sample's green-flag wear curve at the planned lap.
//      Past every real stint it uses the compound projection Tyre Life uses
//      (`projectCompoundWear`), so a plan never outlasts the card. Both
//      projected stints must clear the PUNCTURE_THRESHOLD safety cap — the
//      puncture-risk threshold beyond which grip falls off a cliff.
//   5. Candidate strategies are scored by distance-matched compound pace, wear
//      degradation, pit-loss cost, and managed-tyre risk. The fastest scored
//      candidate becomes Recommended; Alternative prefers a different stop count
//      only when it stays time-competitive, otherwise the next best distinct shape.
//   6. A two-stop sandwich (fast-durable-fast) per adjacent pair stays in the
//      candidate set so the scorer can decide when an extra stop pays back on
//      high-wear tracks. Races without a mandatory stop (F2 sprints) add a
//      no-stop plan on each compound.
//   7. Plans the model can't separate go to the one starting on the softer
//      tyre, which is what most of the field does.
//
// Pit windows are centered on the projected pit lap with ±1 lap of slack.

// PUNCTURE_THRESHOLD (75% worst-wheel wear) is defined above and reused here
// as the strategy-synthesis safety cap — same threshold the StintTimeline
// renders as the red puncture line and the same one estimateMaxLife() uses.

/** How many laps earlier than the wear-balanced pit lap we recommend pitting,
 *  to bank a small undercut margin. F1 broadcasts cite ~1.5–2s gain on the
 *  out-lap from fresh rubber, which is roughly one lap of pace differential. */
const UNDERCUT_NUDGE_LAPS = 1;

/** Borderline stretched stints (dry one-stops, wet plans with fewer stops) are
 *  useful to see, but only when they're within about one high-deg lap of the
 *  normal puncture-risk cap. Anything beyond this is too far into "hope for a
 *  safety car" territory to present as a strategy. */
const MANAGED_WEAR_BUFFER = 7;
/** Stop counts tried for a same-compound wet plan. Three stops already cover
 *  ~100 laps at typical Inters wear, so higher counts only add pit loss. */
const WET_STOP_COUNTS = [0, 1, 2, 3] as const;
const ONE_STOP_PIT_LAP_ADJUSTMENTS = [0, -1, 1] as const;
// Show stop-count variety only when it is plausibly actionable. A 15-20s slower
// two-stop is technically different, but a near-even one-stop mirror is the more
// useful alternative for race planning.
const STOP_COUNT_ALTERNATIVE_MAX_DELTA_MS = 5_000;
/** Score gap within which a softer-first plan beats a harder-first one.
 *  Mirror one-stops land within 0.7 s on rounding alone, and the model doesn't
 *  price the start or track position, where the softer tyre gains; 73–100% of
 *  human finishers in the player's races start on it. */
const FAST_START_TIE_MS = 2_000;
/** Laps a planned stint may run past the compound's longest green-flag run
 *  before its timing reads as a guess. Real stints' wear rate drifts under 10%
 *  from first third to last, and the late-stint rate covers most of that, so
 *  two laps past the evidence move the projection by a fraction of a lap. */
const WEAR_EXTRAPOLATION_TOLERANCE_LAPS = 2;

function pickLatestRelevantSample(
  samples: CompoundLifeSample[],
  plannedLaps: number,
): CompoundLifeSample | null {
  return (
    [...samples].sort((a, b) => {
      if (a.sessionSortKey !== b.sessionSortKey) {
        return b.sessionSortKey - a.sessionSortKey;
      }
      const aExtra = Math.abs(a.greenLaps - plannedLaps);
      const bExtra = Math.abs(b.greenLaps - plannedLaps);
      if (aExtra !== bExtra) return aExtra - bExtra;
      return b.greenLaps - a.greenLaps;
    })[0] ?? null
  );
}

function hasSameStintRole(
  sample: CompoundLifeSample,
  stintIndex: number,
  stintCount: number,
): boolean {
  if (stintIndex === 0) return sample.stintIndex === 0;
  if (stintIndex === stintCount - 1) return sample.isFinalStint;
  return sample.stintIndex > 0 && !sample.isFinalStint;
}

function projectedWearForSample(
  sample: CompoundLifeSample,
  plannedLaps: number,
): number {
  return (
    projectWearFromCurve(sample.wearCurve, plannedLaps) ??
    sample.wearRatePerLap * plannedLaps
  );
}

/** A stint well past every real green-flag run on its compound rests on a
 *  wear extrapolation, often from one short stint in a partial race, so the
 *  plan's timing drops to low confidence and says which tyre it guessed. */
function withWearEvidenceCaveat(
  estimate: TrackStrategyTimeEstimate | undefined,
  shape: TrackStrategyShape,
  compoundLifeStats: CompoundLifeStats[],
): TrackStrategyTimeEstimate | undefined {
  if (!estimate) return estimate;
  for (const [index, name] of shape.compounds.entries()) {
    const compound = compoundLifeStats.find((stats) => stats.compound === name);
    if (!compound) continue;
    const evidenceLaps = compound.longestGreenRun;
    if (
      shape.stintLaps[index]! <=
      evidenceLaps + WEAR_EXTRAPOLATION_TOLERANCE_LAPS
    ) {
      continue;
    }
    return {
      ...estimate,
      confidence: "low",
      details: {
        ...estimate.details,
        paceSource: `${estimate.details?.paceSource}; ${name} wear extrapolated past your longest ${evidenceLaps}-lap green-flag run`,
      },
    };
  }
  return estimate;
}

function wearForProjectedStint(
  compound: CompoundLifeStats,
  plannedLaps: number,
  stintIndex: number,
  stintCount: number,
  preferredStopCount?: number,
): number {
  const longEnoughSamples = compound.samples.filter(
    (sample) => sample.wearRatePerLap > 0 && sample.greenLaps >= plannedLaps,
  );
  const pickFromSamples = (samples: CompoundLifeSample[]) => {
    const exactSlotSample = pickLatestRelevantSample(
      samples.filter((sample) => sample.stintIndex === stintIndex),
      plannedLaps,
    );
    if (exactSlotSample) return exactSlotSample;

    const roleMatchedSample = pickLatestRelevantSample(
      samples.filter((sample) =>
        hasSameStintRole(sample, stintIndex, stintCount),
      ),
      plannedLaps,
    );
    if (roleMatchedSample) return roleMatchedSample;

    return pickLatestRelevantSample(samples, plannedLaps);
  };

  const strategyMatchedSample =
    preferredStopCount != null
      ? pickFromSamples(
          longEnoughSamples.filter(
            (sample) => sample.strategyStopCount === preferredStopCount,
          ),
        )
      : null;
  const sample = strategyMatchedSample ?? pickFromSamples(longEnoughSamples);
  const compoundWear = projectCompoundWear(
    compound.samples.map((compoundSample) => compoundSample.wearCurve),
    plannedLaps,
  );
  if (!sample) {
    return compoundWear ?? compound.avgWearRatePerLap * plannedLaps;
  }
  // A matching real stint can read gentler than the compound as a whole; the
  // compound projection stays the floor so a plan never outlasts Tyre Life.
  return Math.max(
    projectedWearForSample(sample, plannedLaps),
    compoundWear ?? 0,
  );
}

function projectedStintWear(
  compound: CompoundLifeStats,
  plannedLaps: number,
  stintIndex: number,
  stintCount: number,
  preferredStopCount?: number,
): number {
  return wearForProjectedStint(
    compound,
    plannedLaps,
    stintIndex,
    stintCount,
    preferredStopCount,
  );
}

/** One-stop strategy with `first` compound on stint 1, `second` on stint 2.
 *  Pit lap is wear-balanced (both stints hit ~the same fraction of their wear
 *  life) and nudged earlier by UNDERCUT_NUDGE_LAPS to bank fresh-rubber out-lap
 *  pace as undercut margin. Returns null when either stint would exceed the
 *  PUNCTURE_THRESHOLD puncture cap, unless `allowManaged` accepts a small
 *  overage for a clearly flagged tyre-management alternative. */
function buildOneStopShape(
  first: CompoundLifeStats,
  second: CompoundLifeStats,
  totalLaps: number,
  options: { allowManaged?: boolean; pitLapAdjustment?: number } = {},
): TrackStrategyShape | null {
  const firstWear = first.avgWearRatePerLap;
  const secondWear = second.avgWearRatePerLap;
  if (firstWear <= 0 || secondWear <= 0) return null;
  // Wear-balanced pit lap: stint1 ends when both compounds would have burned
  // the same fraction of their life by the flag. Same as solving
  //   stint1 * firstWear = (total - stint1) * secondWear  for stint1.
  const balancedPitLap = Math.round(
    (totalLaps * secondWear) / (firstWear + secondWear),
  );
  // Slight undercut bias: pit one lap earlier than balance so the fresh-tyre
  // out-lap stings whoever's ahead. Clamped to [1, totalLaps - 1].
  const stint1 = Math.max(
    1,
    Math.min(
      totalLaps - 1,
      balancedPitLap - UNDERCUT_NUDGE_LAPS + (options.pitLapAdjustment ?? 0),
    ),
  );
  const stint2 = totalLaps - stint1;
  if (stint2 < 1) return null;
  // Safety cap: both stints must stay under the puncture threshold. If the
  // user's wear rates are too aggressive for either compound to make its half
  // of the race, fall through and let synthesizeStrategies try a harder pair
  // (or eventually a two-stop sandwich).
  const projectedWears = [
    projectedStintWear(first, stint1, 0, 2, 1),
    projectedStintWear(second, stint2, 1, 2, 1),
  ];
  const projectedMaxWear = Math.max(...projectedWears);
  const overThreshold = projectedMaxWear - PUNCTURE_THRESHOLD;
  if (overThreshold > 0) {
    if (!options.allowManaged || overThreshold > MANAGED_WEAR_BUFFER) {
      return null;
    }

    const limitingIndex = projectedWears[0] >= projectedWears[1] ? 0 : 1;
    const compounds = [first.compound, second.compound];
    const stintLaps = [stint1, stint2];
    return {
      compounds,
      stintLaps,
      stintWearPercentages: projectedWears,
      risk: {
        kind: "managed-tyres",
        projectedMaxWear,
        overThreshold,
        limitingCompound: compounds[limitingIndex],
        limitingStintLaps: stintLaps[limitingIndex],
      },
    };
  }
  return {
    compounds: [first.compound, second.compound],
    stintLaps: [stint1, stint2],
    stintWearPercentages: projectedWears,
  };
}

/** Two-stop sandwich splits in preference order: an even third each with
 *  leftover laps on the middle (durable) stint, then a wear-balanced split
 *  where every stint uses the same share of its tyre's life, the twin of the
 *  one-stop's balanced pit lap, for when the faster tyre cannot last a third
 *  of the race. */
function twoStopSplits(
  fastest: CompoundLifeStats,
  durable: CompoundLifeStats,
  totalLaps: number,
): number[][] {
  const base = Math.floor(totalLaps / 3);
  const even = [base, totalLaps - base * 2, base];
  // Solves outer * fastestWear = middle * durableWear with 2 * outer + middle
  // = totalLaps.
  const outer = Math.round(
    (totalLaps * durable.avgWearRatePerLap) /
      (2 * durable.avgWearRatePerLap + fastest.avgWearRatePerLap),
  );
  return [even, [outer, totalLaps - outer * 2, outer]];
}

/** Two-stop sandwich: fastest – durable – fastest. Kept in the candidate set
 *  even when a one-stop is viable so the timing model can decide whether lower
 *  wear plus a fresh final stint pays back the extra pit loss. */
function buildTwoStopShape(
  fastest: CompoundLifeStats,
  durable: CompoundLifeStats,
  stintLaps: number[],
): TrackStrategyShape | null {
  if (stintLaps.some((l) => l < 1)) return null;
  const stintWearPercentages = [
    projectedStintWear(fastest, stintLaps[0], 0, 3, 2),
    projectedStintWear(durable, stintLaps[1], 1, 3, 2),
    projectedStintWear(fastest, stintLaps[2], 2, 3, 2),
  ];
  if (stintWearPercentages.some((wear) => wear > PUNCTURE_THRESHOLD)) {
    return null;
  }
  return {
    compounds: [fastest.compound, durable.compound, fastest.compound],
    stintLaps,
    stintWearPercentages,
  };
}

/** Evenly split race on one compound. Even stints minimise the worst stint's
 *  wear when every stint runs the same tyre; leftover laps go to the later
 *  stints so stops land slightly early, the same undercut bias as the dry
 *  one-stop. Returns null past the managed-tyre buffer. */
function buildSameCompoundShape(
  compound: CompoundLifeStats,
  totalLaps: number,
  stopCount: number,
): TrackStrategyShape | null {
  const stintCount = stopCount + 1;
  const base = Math.floor(totalLaps / stintCount);
  if (base < 1) return null;
  const remainder = totalLaps - base * stintCount;
  const stintLaps = Array.from(
    { length: stintCount },
    (_, i) => base + (i >= stintCount - remainder ? 1 : 0),
  );
  const stintWearPercentages = stintLaps.map((laps, i) =>
    projectedStintWear(compound, laps, i, stintCount, stopCount),
  );
  const compounds = stintLaps.map(() => compound.compound);
  const projectedMaxWear = Math.max(...stintWearPercentages);
  const overThreshold = projectedMaxWear - PUNCTURE_THRESHOLD;
  if (overThreshold <= 0) {
    return { compounds, stintLaps, stintWearPercentages };
  }
  if (overThreshold > MANAGED_WEAR_BUFFER) return null;

  return {
    compounds,
    stintLaps,
    stintWearPercentages,
    risk: {
      kind: "managed-tyres",
      projectedMaxWear,
      overThreshold,
      limitingCompound: compound.compound,
      limitingStintLaps:
        stintLaps[stintWearPercentages.indexOf(projectedMaxWear)],
    },
  };
}

function suggestionFromShape(
  shape: TrackStrategyShape,
  totalLaps: number,
  raceCount: number,
  fullDistanceRaceCount: number,
  fastStart?: boolean,
  timeEstimate?: TrackStrategyTimeEstimate,
): TrackStrategySuggestion {
  const pitWindows: { earliest: number; latest: number; target: number }[] = [];
  let cumulative = 0;
  for (let i = 0; i < shape.compounds.length - 1; i++) {
    cumulative += shape.stintLaps[i];
    pitWindows.push(buildPitWindow(cumulative, totalLaps));
  }
  return {
    compounds: shape.compounds,
    stintLaps: shape.stintLaps,
    stintWearPercentages: shape.stintWearPercentages,
    pitWindows,
    raceCount,
    fullDistanceRaceCount,
    isEvidenceBacked: true,
    fastStart,
    risk: shape.risk,
    timeEstimate,
  };
}

interface StrategyCandidate {
  shape: TrackStrategyShape;
  fastStart?: boolean;
  kind: "no-stop" | "one-stop" | "managed-one-stop" | "two-stop";
  score?: StrategyScore;
}

function shapeKey(shape: TrackStrategyShape): string {
  return `${shape.compounds.join(">")}|${shape.stintLaps.join("-")}`;
}

function isCompetitiveStopCountAlternative(
  suggestion: TrackStrategySuggestion,
): boolean {
  return (
    suggestion.timeEstimate != null &&
    suggestion.timeEstimate.deltaToFastestMs <=
      STOP_COUNT_ALTERNATIVE_MAX_DELTA_MS
  );
}

function candidateFallbackRank(candidate: StrategyCandidate): number {
  // Without pit loss to weigh, a no-stop that keeps its tyres under the cap
  // beats any stop.
  if (candidate.kind === "no-stop" && !candidate.shape.risk) return -1;
  if (candidate.kind === "one-stop") return 0;
  if (candidate.kind === "two-stop") return 1;
  return 2;
}

export function synthesizeStrategies(
  compoundLifeStats: CompoundLifeStats[],
  totalLaps: number,
  raceCount: number,
  fullDistanceRaceCount: number,
  entries: BucketRaceEntry[],
  pitLossEntries: BucketRaceEntry[],
  { requiresPitStop = true }: { requiresPitStop?: boolean } = {},
): {
  recommended: TrackStrategySuggestion | null;
  alternative: TrackStrategySuggestion | null;
} {
  const ranked = rankDryCompoundsByPace(compoundLifeStats);
  if (ranked.length < (requiresPitStop ? 2 : 1)) {
    return { recommended: null, alternative: null };
  }

  const candidates = new Map<string, StrategyCandidate>();
  const addCandidate = (
    shape: TrackStrategyShape | null,
    kind: StrategyCandidate["kind"],
    fastStart?: boolean,
  ) => {
    if (!shape) return;
    const key = shapeKey(shape);
    if (candidates.has(key)) return;
    candidates.set(key, { shape, kind, fastStart });
  };
  const addManagedOneStop = (
    shape: TrackStrategyShape | null,
    fastStart: boolean,
  ) => {
    if (!shape?.risk) return;
    addCandidate(shape, "managed-one-stop", fastStart);
  };

  // Walk adjacent compound pairs in softness order, collecting every viable
  // fast-first/slow-first shape plus a ±1 lap pit-window variant. Ranking
  // happens after timing is scored, so softness order is only the generation
  // order. Pairs skip no rung of the player's compounds: strategists don't run
  // Soft+Hard when a Medium is there.
  for (let i = 0; i < ranked.length - 1; i++) {
    const softer = ranked[i];
    const harder = ranked[i + 1];
    for (const pitLapAdjustment of ONE_STOP_PIT_LAP_ADJUSTMENTS) {
      const fastFirst = buildOneStopShape(softer, harder, totalLaps, {
        pitLapAdjustment,
      });
      const slowFirst = buildOneStopShape(harder, softer, totalLaps, {
        pitLapAdjustment,
      });
      const managedFastFirst = buildOneStopShape(softer, harder, totalLaps, {
        allowManaged: true,
        pitLapAdjustment,
      });
      const managedSlowFirst = buildOneStopShape(harder, softer, totalLaps, {
        allowManaged: true,
        pitLapAdjustment,
      });
      addCandidate(fastFirst, "one-stop", true);
      addCandidate(slowFirst, "one-stop", false);
      addManagedOneStop(managedFastFirst, true);
      addManagedOneStop(managedSlowFirst, false);
    }
  }

  // Two-stop sandwiches stay in the candidate set even when a one-stop is
  // feasible, because the timing model can answer whether the extra stop is
  // paid back by lower wear plus a fresh final stint. One per adjacent pair:
  // Medium-Hard-Medium is the field's most common two-stop at long, high-wear
  // races even when a Soft is available.
  for (let i = 0; i < ranked.length - 1; i++) {
    for (const stintLaps of twoStopSplits(
      ranked[i],
      ranked[i + 1],
      totalLaps,
    )) {
      const twoStop = buildTwoStopShape(ranked[i], ranked[i + 1], stintLaps);
      if (!twoStop) continue;
      addCandidate(twoStop, "two-stop");
      break;
    }
  }

  if (!requiresPitStop) {
    for (const compound of ranked) {
      addCandidate(buildSameCompoundShape(compound, totalLaps, 0), "no-stop");
    }
  }

  const candidateList = [...candidates.values()];
  if (candidateList.length === 0) {
    return { recommended: null, alternative: null };
  }

  const timingContext = buildTimingContext(entries, pitLossEntries, ranked);
  if (timingContext) {
    for (const candidate of candidateList) {
      candidate.score = scoreShape(candidate.shape, timingContext);
    }
    candidateList.sort((a, b) => a.score!.totalScoreMs - b.score!.totalScoreMs);
    const best = candidateList[0];
    if (best.fastStart === false) {
      // Only the same tyres in the other order: which compounds to run is a
      // pace question the model does answer.
      const tyres = [...best.shape.compounds].sort().join();
      const fastStart = candidateList.find(
        (candidate) =>
          candidate.fastStart === true &&
          candidate.kind === best.kind &&
          [...candidate.shape.compounds].sort().join() === tyres &&
          candidate.score!.totalScoreMs - best.score!.totalScoreMs <=
            FAST_START_TIE_MS,
      );
      if (fastStart) {
        candidateList.splice(candidateList.indexOf(fastStart), 1);
        candidateList.unshift(fastStart);
      }
    }
  } else {
    const hasStrictOneStop = candidateList.some(
      (candidate) => candidate.kind === "one-stop",
    );
    candidateList.sort((a, b) => {
      const aRank =
        hasStrictOneStop && a.kind === "two-stop"
          ? Number.POSITIVE_INFINITY
          : candidateFallbackRank(a);
      const bRank =
        hasStrictOneStop && b.kind === "two-stop"
          ? Number.POSITIVE_INFINITY
          : candidateFallbackRank(b);
      if (aRank !== bRank) return aRank - bRank;
      return (
        (a.shape.risk?.overThreshold ?? 0) - (b.shape.risk?.overThreshold ?? 0)
      );
    });
  }

  // The softer-start promotion can put a slightly slower plan first; timing
  // deltas still count from the fastest.
  const fastestScoreMs = Math.min(
    ...candidateList.map((candidate) => candidate.score?.totalScoreMs ?? 0),
  );
  const anchor = timingContext
    ? findRaceTimeAnchor(entries, timingContext, isDryCompound)
    : null;
  const suggestions = candidateList.map((candidate) =>
    suggestionFromShape(
      candidate.shape,
      totalLaps,
      raceCount,
      fullDistanceRaceCount,
      candidate.fastStart,
      timingContext
        ? withWearEvidenceCaveat(
            timeEstimateForCandidate(
              candidate,
              fastestScoreMs,
              timingContext,
              anchor,
            ),
            candidate.shape,
            compoundLifeStats,
          )
        : undefined,
    ),
  );

  const recommended = suggestions[0] ?? null;
  const recommendedKey = recommended
    ? `${recommended.compounds.join(">")}|${recommended.stintLaps.join("-")}`
    : null;
  const recommendedStopCount = recommended?.pitWindows.length ?? 0;
  const isDifferentSuggestion = (suggestion: TrackStrategySuggestion) =>
    `${suggestion.compounds.join(">")}|${suggestion.stintLaps.join("-")}` !==
    recommendedKey;
  const hasRecommendedStopCount = (suggestion: TrackStrategySuggestion) =>
    suggestion.pitWindows.length === recommendedStopCount;
  const alternative =
    suggestions.find(
      (suggestion) =>
        isDifferentSuggestion(suggestion) &&
        !hasRecommendedStopCount(suggestion) &&
        isCompetitiveStopCountAlternative(suggestion),
    ) ??
    suggestions.find(
      (suggestion) =>
        isDifferentSuggestion(suggestion) &&
        hasRecommendedStopCount(suggestion),
    ) ??
    // The sandwich is the only two-stop shape, so a winning two-stop has no
    // same-count alternative: offer the next best plan instead.
    (recommendedStopCount === 2
      ? suggestions.find(isDifferentSuggestion)
      : undefined) ??
    null;

  return { recommended, alternative };
}

/** Wet races drop the two-compound rule, so a wet plan is a stop-count choice
 *  on one compound. Inters vs Full Wets is decided by rain intensity rather
 *  than lap time, so each wet compound with bucket evidence gets its own plan
 *  instead of competing in one ranking. Crossovers to slicks are not modelled:
 *  their timing depends on when the track dries, which past races can't
 *  forecast. */
export function synthesizeWetStrategies(
  compoundLifeStats: CompoundLifeStats[],
  totalLaps: number,
  raceCount: number,
  fullDistanceRaceCount: number,
  entries: BucketRaceEntry[],
  pitLossEntries: BucketRaceEntry[],
): TrackStrategySuggestion[] {
  return rankWetCompounds(compoundLifeStats).flatMap((compound) => {
    const shapes = WET_STOP_COUNTS.map((stopCount) =>
      buildSameCompoundShape(compound, totalLaps, stopCount),
    ).filter((shape): shape is TrackStrategyShape => shape != null);
    if (shapes.length === 0) return [];

    const timingContext = buildSingleCompoundTimingContext(
      entries,
      pitLossEntries,
      compound.compound,
    );
    const candidates = shapes.map((shape) => ({
      shape,
      score: timingContext ? scoreShape(shape, timingContext) : undefined,
    }));
    // Shapes are generated in stop-count order, so the stable fallback sort
    // keeps the fewest-stop strict plan first when pit loss is unknown.
    candidates.sort((a, b) =>
      a.score && b.score
        ? a.score.totalScoreMs - b.score.totalScoreMs
        : Number(a.shape.risk != null) - Number(b.shape.risk != null),
    );
    const best = candidates[0];
    const closeCandidate = candidates
      .slice(1)
      .find((candidate) => !candidate.shape.risk);
    const closeDeltaMs =
      best.score && closeCandidate?.score
        ? closeCandidate.score.totalScoreMs - best.score.totalScoreMs
        : null;
    const anchor = timingContext
      ? findRaceTimeAnchor(
          entries,
          timingContext,
          (candidate) => candidate === compound.compound,
        )
      : null;
    const estimate =
      timingContext && best.score
        ? timeEstimateForCandidate(
            best,
            best.score.totalScoreMs,
            timingContext,
            anchor,
          )
        : undefined;
    return [
      {
        ...suggestionFromShape(
          best.shape,
          totalLaps,
          raceCount,
          fullDistanceRaceCount,
          undefined,
          // Wet evidence is often a short opening stint on a drying track.
          withWearEvidenceCaveat(estimate, best.shape, [compound]),
        ),
        closeStopCount:
          closeCandidate &&
          closeDeltaMs != null &&
          closeDeltaMs <= STOP_COUNT_ALTERNATIVE_MAX_DELTA_MS
            ? {
                stopCount: closeCandidate.shape.compounds.length - 1,
                deltaMs: Math.round(closeDeltaMs),
              }
            : undefined,
      },
    ];
  });
}
