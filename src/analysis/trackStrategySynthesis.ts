import type {
  CompoundLifeSample,
  CompoundLifeStats,
} from "../utils/stats/trackAggregates";
import { PUNCTURE_THRESHOLD, projectWearFromCurve } from "../utils/stats/tyres";
import {
  DRY_COMPOUND_PRIORITY,
  rankDryCompoundsByPace,
} from "./trackStrategyCompounds";
import {
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
//   2. Walk compound PAIRS from softest to hardest, SKIPPING Soft+Hard
//      (across-the-allocation pairings are dominated by Soft+Medium or
//      Medium+Hard — confirmed at 0/35 observations in user telemetry).
//   3. For each pair, the pit lap is set so BOTH stints hit roughly the same
//      fraction of their aggregate wear life:
//          balanced = round(totalLaps * wearRate(second)
//                           / (wearRate(first) + wearRate(second)))
//      then nudged 1 lap earlier to bank a small undercut margin (fresh rubber
//      gives ~1.5–2s on the out-lap; one lap = roughly that gain).
//   4. Projected stint wear prefers matching real stint samples (same compound,
//      same sequence slot, and long enough for the projected stint), using the
//      observed worst-wheel wear curve at the planned lap before falling back
//      to the aggregate compound average. Both projected stints must clear the
//      PUNCTURE_THRESHOLD safety cap — the puncture-risk threshold beyond which
//      grip falls off a cliff.
//   5. Candidate strategies are scored by distance-matched compound pace, wear
//      degradation, pit-loss cost, and managed-tyre risk. The fastest scored
//      candidate becomes Recommended; Alternative prefers a different stop count
//      only when it stays time-competitive, otherwise the next best distinct shape.
//   6. Two-stop sandwich (fast-durable-fast) stays in the candidate set so the
//      scorer can decide when an extra stop pays back on high-wear tracks.
//
// Pit windows are centered on the projected pit lap with ±1 lap of slack.

// PUNCTURE_THRESHOLD (75% worst-wheel wear) is defined above and reused here
// as the strategy-synthesis safety cap — same threshold the StintTimeline
// renders as the red puncture line and the same one estimateMaxLife() uses.

/** How many laps earlier than the wear-balanced pit lap we recommend pitting,
 *  to bank a small undercut margin. F1 broadcasts cite ~1.5–2s gain on the
 *  out-lap from fresh rubber, which is roughly one lap of pace differential. */
const UNDERCUT_NUDGE_LAPS = 1;

/** Borderline one-stops are useful to see, but only when they're within about
 *  one high-deg lap of the normal puncture-risk cap. Anything beyond this is
 *  too far into "hope for a safety car" territory to present as a strategy. */
const MANAGED_ONE_STOP_WEAR_BUFFER = 7;
const ONE_STOP_PIT_LAP_ADJUSTMENTS = [0, -1, 1] as const;
// Show stop-count variety only when it is plausibly actionable. A 15-20s slower
// two-stop is technically different, but a near-even one-stop mirror is the more
// useful alternative for race planning.
const STOP_COUNT_ALTERNATIVE_MAX_DELTA_MS = 5_000;

function pickLatestRelevantSample(
  samples: CompoundLifeSample[],
  plannedLaps: number,
): CompoundLifeSample | null {
  return (
    [...samples].sort((a, b) => {
      if (a.sessionSortKey !== b.sessionSortKey) {
        return b.sessionSortKey - a.sessionSortKey;
      }
      const aExtra = Math.abs(a.stintLength - plannedLaps);
      const bExtra = Math.abs(b.stintLength - plannedLaps);
      if (aExtra !== bExtra) return aExtra - bExtra;
      return b.stintLength - a.stintLength;
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

function wearForProjectedStint(
  compound: CompoundLifeStats,
  plannedLaps: number,
  stintIndex: number,
  stintCount: number,
  preferredStopCount?: number,
): number {
  const longEnoughSamples = compound.samples.filter(
    (sample) => sample.wearRatePerLap > 0 && sample.stintLength >= plannedLaps,
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

  if (preferredStopCount != null) {
    const strategyMatchedSample = pickFromSamples(
      longEnoughSamples.filter(
        (sample) => sample.strategyStopCount === preferredStopCount,
      ),
    );
    if (strategyMatchedSample) {
      return projectedWearForSample(strategyMatchedSample, plannedLaps);
    }
  }

  const sample = pickFromSamples(longEnoughSamples);
  if (sample) return projectedWearForSample(sample, plannedLaps);

  return compound.avgWearRatePerLap * plannedLaps;
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
    if (!options.allowManaged || overThreshold > MANAGED_ONE_STOP_WEAR_BUFFER) {
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

/** Two-stop sandwich: fastest – durable – fastest. Kept in the candidate set
 *  even when a one-stop is viable so the timing model can decide whether lower
 *  wear plus a fresh final stint pays back the extra pit loss. */
function buildTwoStopShape(
  fastest: CompoundLifeStats,
  durable: CompoundLifeStats,
  totalLaps: number,
): TrackStrategyShape | null {
  const base = Math.floor(totalLaps / 3);
  const remainder = totalLaps - base * 3;
  // Concentrate any leftover laps on the middle (durable) stint.
  const stintLaps = [base, base + remainder, base];
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

/** Soft+Hard is a pairing that skips the Medium allocation rung. In observed
 *  user races (35 dry multi-stint races) it appeared 0 times — strategists
 *  default to Soft+Medium or Medium+Hard since they share an adjacent rung.
 *  We suppress it here so the recommendation never offers a shape that
 *  doesn't show up in practice. */
function isSoftHardPair(a: CompoundLifeStats, b: CompoundLifeStats): boolean {
  const aPri = DRY_COMPOUND_PRIORITY[a.compound] ?? Number.POSITIVE_INFINITY;
  const bPri = DRY_COMPOUND_PRIORITY[b.compound] ?? Number.POSITIVE_INFINITY;
  const softest = Math.min(aPri, bPri);
  const hardest = Math.max(aPri, bPri);
  return softest === 0 && hardest === 2;
}

interface StrategyCandidate {
  shape: TrackStrategyShape;
  fastStart?: boolean;
  kind: "one-stop" | "managed-one-stop" | "two-stop";
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
): {
  recommended: TrackStrategySuggestion | null;
  alternative: TrackStrategySuggestion | null;
} {
  const ranked = rankDryCompoundsByPace(compoundLifeStats);
  if (ranked.length < 2) return { recommended: null, alternative: null };

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

  // Walk adjacent compound pairs in softness order, but collect every viable
  // fast-first/slow-first shape plus a ±1 lap pit-window variant. Ranking happens
  // after timing is scored, so softness order is only the generation order now.
  // Soft+Hard is skipped because strategists don't skip allocation rungs in
  // practice when Soft+Medium or Medium+Hard exists.
  for (let i = 0; i < ranked.length - 1; i++) {
    for (let j = i + 1; j < ranked.length; j++) {
      const softer = ranked[i];
      const harder = ranked[j];
      if (isSoftHardPair(softer, harder)) continue;
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
  }

  // The two-stop sandwich stays in the candidate set even when a one-stop is
  // feasible, because the timing model can now answer whether the extra stop is
  // paid back by lower wear plus a fresh final stint.
  const twoStop = buildTwoStopShape(ranked[0], ranked[1], totalLaps);
  addCandidate(twoStop, "two-stop");

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

  const fastestScoreMs = candidateList[0].score?.totalScoreMs ?? 0;
  const anchor = timingContext
    ? findRaceTimeAnchor(entries, timingContext)
    : null;
  const suggestions = candidateList.map((candidate) =>
    suggestionFromShape(
      candidate.shape,
      totalLaps,
      raceCount,
      fullDistanceRaceCount,
      candidate.fastStart,
      timingContext
        ? timeEstimateForCandidate(
            candidate,
            fastestScoreMs,
            timingContext,
            anchor,
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
    null;

  return { recommended, alternative };
}
