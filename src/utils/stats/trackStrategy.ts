import type { DriverData, TelemetrySession } from "../../types/telemetry";
import { bestSectorTimeMs } from "../format";
import { findPlayer, isRaceSession } from "./drivers";
import { avgErsDeployMj } from "./energy";
import type { CompoundLifeStats, TrackFuelStats } from "./trackAggregates";
import {
  getBestLapTime,
  getCleanRaceLapSamples,
  getCleanRaceLaps,
} from "./laps";
import { avgWearRate, PUNCTURE_THRESHOLD } from "./tyres";

// ─── Track-level Race "Key Insights" recommendation ──────────────────────────

export interface TrackBestRaceLap {
  /** Best clean race lap time in ms */
  bestLapMs: number;
  /** Visual compound the lap was set on, if known */
  compound: string | null;
  /** Sum-of-best-sectors theoretical best from clean race laps */
  theoreticalBestMs: number;
  /** Gap to theoretical best (bestLapMs - theoreticalBestMs); 0 if either side missing */
  gapToTheoreticalMs: number;
}

export interface TrackStrategySuggestion {
  /** Visual compound sequence, e.g. ["Medium", "Hard"] */
  compounds: string[];
  /** Stint lengths the recommendation is anchored on (laps). Same length as compounds */
  stintLaps: number[];
  /** Pit-window per stop, indexed by the pit (stops between compounds[i] and compounds[i+1]).
   *  Empty for a no-stop strategy. */
  pitWindows: { earliest: number; latest: number; target: number }[];
  /** Number of races in the bucket that ran this exact sequence */
  raceCount: number;
  /** Number of those races that were near-full-distance */
  fullDistanceRaceCount: number;
  /** True when at least one near-full-distance multi-stint race backs this sequence */
  isEvidenceBacked: boolean;
  /** True when the first stint is on a softer compound than the second — a
   *  "fast start, durable finish" shape. False for the mirror "durable start,
   *  fast finish" alternative. Undefined for two-stop sandwiches. */
  fastStart?: boolean;
}

export interface TrackFuelTarget {
  /** Recommended delta over zero-laps-remaining at lights out (in laps) */
  recommendedDeltaLaps: number;
  /** Recommended total fuel load (kg) the delta translates to */
  recommendedFuelKg: number;
  /** Average green-flag burn rate, kg/lap */
  burnRateKgPerLap: number;
  /** Average projected excess at finish (laps). Positive = over-fueling. */
  excessAtFinishLaps: number;
  /** Number of races in the sample */
  raceCount: number;
}

export interface TrackSinceLastRaceDelta {
  /** Best clean lap delta vs. previous race here (ms). Negative = improvement. 0 if either side missing */
  bestLapDeltaMs: number;
  /** Avg wear-rate delta (%/lap). Negative = gentler than before. 0 if either side missing */
  wearRateDelta: number;
}

export interface TrackRaceRecommendation {
  /** Number of races in the selected bucket */
  raceCount: number;
  /** Number of races in the bucket that finished near full distance (>= totalLaps - 1) */
  fullDistanceRaceCount: number;
  /** Whether we have at least one near-full-distance multi-stint race in the bucket */
  hasEvidence: boolean;
  bestRaceLap: TrackBestRaceLap | null;
  /** Best race lap vs best quali lap (ms). Negative = race lap was faster. 0 if either side missing */
  raceVsQualiDeltaMs: number;
  /** Average ERS deployed per lap across the bucket's races (MJ). 0 if no data */
  avgErsDeployMj: number;
  recommended: TrackStrategySuggestion | null;
  alternative: TrackStrategySuggestion | null;
  fuelTarget: TrackFuelTarget | null;
  sinceLastRace: TrackSinceLastRaceDelta | null;
}

/** A race counts as "near full distance" when the player completed >= totalLaps - 1 laps */
function isNearFullDistanceRace(
  session: TelemetrySession,
  player: DriverData,
): boolean {
  const totalLaps = session["session-info"]["total-laps"];
  if (!Number.isFinite(totalLaps) || totalLaps <= 0) return false;
  const lapsCompleted = player["session-history"]["num-laps"] ?? 0;
  return lapsCompleted >= totalLaps - 1;
}

interface BucketRaceEntry {
  session: TelemetrySession;
  player: DriverData;
  totalLaps: number;
  isFullDistance: boolean;
}

function buildBucketEntries(sessions: TelemetrySession[]): BucketRaceEntry[] {
  const entries: BucketRaceEntry[] = [];
  for (const session of sessions) {
    if (!isRaceSession(session)) continue;
    const player = findPlayer(session);
    if (!player) continue;
    const totalLaps = session["session-info"]["total-laps"];
    if (!Number.isFinite(totalLaps) || totalLaps <= 0) continue;
    entries.push({
      session,
      player,
      totalLaps: Math.round(totalLaps),
      isFullDistance: isNearFullDistanceRace(session, player),
    });
  }
  return entries;
}

/** Build the pit window for the transition between two stints, anchored on the
 *  target end-lap. Window widens by ±1 lap to communicate uncertainty; clamped
 *  to [1, totalLaps - 1]. */
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
//      fraction of their wear life:
//          balanced = round(totalLaps * wearRate(second)
//                           / (wearRate(first) + wearRate(second)))
//      then nudged 1 lap earlier to bank a small undercut margin (fresh rubber
//      gives ~1.5–2s on the out-lap; one lap = roughly that gain).
//   4. Both stints must clear the PUNCTURE_THRESHOLD safety cap — the
//      puncture-risk threshold beyond which grip falls off a cliff.
//   5. Recommended = first feasible (fast-first) pairing; Alternative = its
//      mirror (slow-first, "fast-finisher") when also feasible.
//   6. Two-stop sandwich (fast-durable-fast) only when NO one-stop pair fits.
//
// Pit windows are centered on the projected pit lap with ±1 lap of slack.

// PUNCTURE_THRESHOLD (75% worst-wheel wear) is defined above and reused here
// as the strategy-synthesis safety cap — same threshold the StintTimeline
// renders as the red puncture line and the same one estimateMaxLife() uses.

/** How many laps earlier than the wear-balanced pit lap we recommend pitting,
 *  to bank a small undercut margin. F1 broadcasts cite ~1.5–2s gain on the
 *  out-lap from fresh rubber, which is roughly one lap of pace differential. */
const UNDERCUT_NUDGE_LAPS = 1;

/** Dry compound softness priority — lower number = softer = faster on fresh
 *  rubber. Soft/Medium/Hard are the relative labels Pits n' Giggles surfaces
 *  for the three compounds allocated to a given track; C1–C5 are the raw
 *  ASN compound IDs that show up on older exports (C5 = softest, C1 = hardest). */
const DRY_COMPOUND_PRIORITY: Record<string, number> = {
  Soft: 0,
  Medium: 1,
  Hard: 2,
  C5: 0,
  C4: 0.5,
  C3: 1,
  C2: 1.5,
  C1: 2,
};

function isDryCompound(compound: string): boolean {
  return compound in DRY_COMPOUND_PRIORITY;
}

/** Max laps a stint of this compound can safely cover without crossing the
 *  wear threshold, given the observed average wear rate (%/lap). */
function safeStintMaxLaps(wearRatePerLap: number): number {
  if (wearRatePerLap <= 0) return Number.POSITIVE_INFINITY;
  return Math.max(1, Math.floor(PUNCTURE_THRESHOLD / wearRatePerLap));
}

/** Sort dry compound stats by relative softness (Soft → Medium → Hard).
 *  Observed best-lap order isn't trustworthy here because fuel load and
 *  driver effort confound it — a player's best Hard lap can easily beat
 *  their best Medium lap simply because the Hard stint ran on lower fuel.
 *  The compound names are themselves relative-pace labels for the track,
 *  so the priority ordering matches F1 fresh-lap pace assumptions directly. */
function rankDryCompoundsByPace(
  compoundLifeStats: CompoundLifeStats[],
): CompoundLifeStats[] {
  const dry = compoundLifeStats.filter(
    (c) =>
      isDryCompound(c.compound) && c.stintCount > 0 && c.avgWearRatePerLap > 0,
  );
  return dry.sort((a, b) => {
    const aPri = DRY_COMPOUND_PRIORITY[a.compound] ?? Number.POSITIVE_INFINITY;
    const bPri = DRY_COMPOUND_PRIORITY[b.compound] ?? Number.POSITIVE_INFINITY;
    if (aPri !== bPri) return aPri - bPri;
    // Tie-break by stint sample size — more evidence wins.
    return b.stintCount - a.stintCount;
  });
}

interface SynthesizedStrategyShape {
  compounds: string[];
  stintLaps: number[];
}

/** One-stop strategy with `first` compound on stint 1, `second` on stint 2.
 *  Pit lap is wear-balanced (both stints hit ~the same fraction of their wear
 *  life) and nudged earlier by UNDERCUT_NUDGE_LAPS to bank fresh-rubber out-lap
 *  pace as undercut margin. Returns null when either stint would exceed the
 *  PUNCTURE_THRESHOLD puncture cap at the recommended pit lap. */
function buildOneStopShape(
  first: CompoundLifeStats,
  second: CompoundLifeStats,
  totalLaps: number,
): SynthesizedStrategyShape | null {
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
    Math.min(totalLaps - 1, balancedPitLap - UNDERCUT_NUDGE_LAPS),
  );
  const stint2 = totalLaps - stint1;
  if (stint2 < 1) return null;
  // Safety cap: both stints must stay under the puncture threshold. If the
  // user's wear rates are too aggressive for either compound to make its half
  // of the race, fall through and let synthesizeStrategies try a harder pair
  // (or eventually a two-stop sandwich).
  if (stint1 * firstWear > PUNCTURE_THRESHOLD) return null;
  if (stint2 * secondWear > PUNCTURE_THRESHOLD) return null;
  return {
    compounds: [first.compound, second.compound],
    stintLaps: [stint1, stint2],
  };
}

/** Two-stop sandwich: fastest – durable – fastest. Used only when one-stop
 *  can't make the distance under the wear threshold. Splits roughly into
 *  thirds with the durable compound in the middle (carries the longest
 *  stint). Returns null when even the sandwich can't fit. */
function buildTwoStopShape(
  fastest: CompoundLifeStats,
  durable: CompoundLifeStats,
  totalLaps: number,
): SynthesizedStrategyShape | null {
  const fastMax = safeStintMaxLaps(fastest.avgWearRatePerLap);
  const durableMax = safeStintMaxLaps(durable.avgWearRatePerLap);
  const base = Math.floor(totalLaps / 3);
  const remainder = totalLaps - base * 3;
  // Concentrate any leftover laps on the middle (durable) stint.
  const stintLaps = [base, base + remainder, base];
  if (stintLaps.some((l) => l < 1)) return null;
  if (stintLaps[0] > fastMax) return null;
  if (stintLaps[1] > durableMax) return null;
  if (stintLaps[2] > fastMax) return null;
  return {
    compounds: [fastest.compound, durable.compound, fastest.compound],
    stintLaps,
  };
}

function suggestionFromShape(
  shape: SynthesizedStrategyShape,
  totalLaps: number,
  raceCount: number,
  fullDistanceRaceCount: number,
  fastStart?: boolean,
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
    pitWindows,
    raceCount,
    fullDistanceRaceCount,
    isEvidenceBacked: true,
    fastStart,
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

function synthesizeStrategies(
  compoundLifeStats: CompoundLifeStats[],
  totalLaps: number,
  raceCount: number,
  fullDistanceRaceCount: number,
): {
  recommended: TrackStrategySuggestion | null;
  alternative: TrackStrategySuggestion | null;
} {
  const ranked = rankDryCompoundsByPace(compoundLifeStats);
  if (ranked.length < 2) return { recommended: null, alternative: null };

  // Walk compound pairs in softness order: (0,1) → (1,2) … so the softest
  // feasible adjacent-rung pairing wins. On high-wear tracks where soft
  // wear outruns the puncture cap, Soft+Medium gets rejected and we fall
  // through to Medium+Hard (e.g. Catalunya at full distance). Soft+Hard
  // is skipped — strategists don't skip rungs in practice.
  for (let i = 0; i < ranked.length - 1; i++) {
    for (let j = i + 1; j < ranked.length; j++) {
      const softer = ranked[i];
      const harder = ranked[j];
      if (isSoftHardPair(softer, harder)) continue;
      const fastFirst = buildOneStopShape(softer, harder, totalLaps);
      const slowFirst = buildOneStopShape(harder, softer, totalLaps);
      if (fastFirst) {
        return {
          recommended: suggestionFromShape(
            fastFirst,
            totalLaps,
            raceCount,
            fullDistanceRaceCount,
            true,
          ),
          alternative: slowFirst
            ? suggestionFromShape(
                slowFirst,
                totalLaps,
                raceCount,
                fullDistanceRaceCount,
                false,
              )
            : null,
        };
      }
      if (slowFirst) {
        return {
          recommended: suggestionFromShape(
            slowFirst,
            totalLaps,
            raceCount,
            fullDistanceRaceCount,
            false,
          ),
          alternative: null,
        };
      }
    }
  }

  // One-stop infeasible across every dry pair — only then consider a two-stop
  // sandwich, anchored on the two fastest compounds (the standard F1 shape).
  const twoStop = buildTwoStopShape(ranked[0], ranked[1], totalLaps);
  if (twoStop) {
    return {
      recommended: suggestionFromShape(
        twoStop,
        totalLaps,
        raceCount,
        fullDistanceRaceCount,
      ),
      alternative: null,
    };
  }
  return { recommended: null, alternative: null };
}

/** Sum-of-best-sectors across the player's clean race laps in the bucket. */
function theoreticalBestFromCleanLaps(entries: BucketRaceEntry[]): number {
  let bestS1 = 0;
  let bestS2 = 0;
  let bestS3 = 0;
  for (const entry of entries) {
    const clean = getCleanRaceLaps(entry.player);
    if (clean.length === 0) continue;
    const s1 = bestSectorTimeMs(clean, 1);
    const s2 = bestSectorTimeMs(clean, 2);
    const s3 = bestSectorTimeMs(clean, 3);
    if (s1 > 0 && (bestS1 === 0 || s1 < bestS1)) bestS1 = s1;
    if (s2 > 0 && (bestS2 === 0 || s2 < bestS2)) bestS2 = s2;
    if (s3 > 0 && (bestS3 === 0 || s3 < bestS3)) bestS3 = s3;
  }
  return bestS1 > 0 && bestS2 > 0 && bestS3 > 0 ? bestS1 + bestS2 + bestS3 : 0;
}

interface BestCleanRaceLap {
  timeMs: number;
  compound: string | null;
}

function bestCleanRaceLapWithCompound(
  entries: BucketRaceEntry[],
): BestCleanRaceLap | null {
  let best: BestCleanRaceLap | null = null;
  for (const entry of entries) {
    const samples = getCleanRaceLapSamples(entry.player);
    for (const sample of samples) {
      if (sample.timeMs <= 0) continue;
      if (!best || sample.timeMs < best.timeMs) {
        best = { timeMs: sample.timeMs, compound: sample.compound ?? null };
      }
    }
  }
  return best;
}

/** Build the Race tab "Key Insights" recommendation for the selected race-length bucket.
 *
 *  Inputs are already-bucketed so the recommendation always tracks the
 *  SegmentedControl above the tyre-life cards. Practice/qualifying sessions are
 *  excluded by the race filter inside this function (defense in depth).
 *
 *  Returns null only when the bucket has zero race entries. The evidence gate
 *  for strategy/alternative is exposed on the result (`hasEvidence`,
 *  `recommended`, `alternative`) so the UI can render the always-on chips
 *  (best lap, fuel, ERS) even when strategy data is too thin. */
export function buildTrackRaceRecommendation(
  bucketRaceSessions: TelemetrySession[],
  bucketCompoundLifeStats: CompoundLifeStats[],
  bucketFuelStats: TrackFuelStats | null,
  options: { bestQualiLapMs?: number } = {},
): TrackRaceRecommendation | null {
  const entries = buildBucketEntries(bucketRaceSessions);
  if (entries.length === 0) return null;

  const totalLaps = entries[0].totalLaps;
  const fullDistanceEntries = entries.filter((e) => e.isFullDistance);

  // ── Best clean race lap + compound + theoretical-best gap ───────────────
  const bestLap = bestCleanRaceLapWithCompound(entries);
  const theoreticalBestMs = theoreticalBestFromCleanLaps(entries);
  const bestRaceLap: TrackBestRaceLap | null = bestLap
    ? {
        bestLapMs: bestLap.timeMs,
        compound: bestLap.compound,
        theoreticalBestMs,
        gapToTheoreticalMs:
          theoreticalBestMs > 0 && bestLap.timeMs > 0
            ? bestLap.timeMs - theoreticalBestMs
            : 0,
      }
    : null;

  // ── Race vs Quali delta (negative = race lap was faster) ────────────────
  const bestQuali = options.bestQualiLapMs ?? 0;
  const raceVsQualiDeltaMs =
    bestRaceLap && bestRaceLap.bestLapMs > 0 && bestQuali > 0
      ? bestRaceLap.bestLapMs - bestQuali
      : 0;

  // ── Avg ERS deployed (MJ/lap) across the bucket ─────────────────────────
  const ersValues = entries
    .map((e) => avgErsDeployMj(e.player))
    .filter((v) => v > 0);
  const avgErsMj =
    ersValues.length > 0
      ? ersValues.reduce((a, b) => a + b, 0) / ersValues.length
      : 0;

  // ── Recommended + alternative strategy ──────────────────────────────────
  // Synthesized from compound pace + wear stats (see synthesizeStrategies).
  // This deliberately ignores the *specific* sequences run in past races —
  // with one or two races in the bucket the most-frequent sequence is just
  // "whatever happened that one time," which produces nonsense recommendations
  // (e.g. a 4-lap stint pulled from an early-ended race in a 17-lap event).
  const { recommended, alternative } = synthesizeStrategies(
    bucketCompoundLifeStats,
    totalLaps,
    entries.length,
    fullDistanceEntries.length,
  );
  const hasEvidence = recommended != null;

  // ── Fuel target (single line) ────────────────────────────────────────────
  const fuelTarget: TrackFuelTarget | null = bucketFuelStats
    ? {
        recommendedDeltaLaps: bucketFuelStats.avgRecommendedFuelLaps,
        recommendedFuelKg: bucketFuelStats.avgRecommendedFuelKg,
        burnRateKgPerLap: bucketFuelStats.avgBurnRateKgPerLap,
        excessAtFinishLaps: bucketFuelStats.avgExcessAtFinishLaps,
        raceCount: bucketFuelStats.raceCount,
      }
    : null;

  // ── Since last race here ────────────────────────────────────────────────
  let sinceLastRace: TrackSinceLastRaceDelta | null = null;
  if (entries.length >= 2) {
    // entries follow input order (sessions are already date-sorted from the page).
    const latest = entries[entries.length - 1];
    const previous = entries[entries.length - 2];
    const latestBest = getBestLapTime(getCleanRaceLaps(latest.player));
    const prevBest = getBestLapTime(getCleanRaceLaps(previous.player));
    const latestWear = avgWearRate(latest.player);
    const prevWear = avgWearRate(previous.player);
    sinceLastRace = {
      bestLapDeltaMs:
        latestBest > 0 && prevBest > 0 ? latestBest - prevBest : 0,
      wearRateDelta: latestWear > 0 && prevWear > 0 ? latestWear - prevWear : 0,
    };
  }

  return {
    raceCount: entries.length,
    fullDistanceRaceCount: fullDistanceEntries.length,
    hasEvidence,
    bestRaceLap,
    raceVsQualiDeltaMs,
    avgErsDeployMj: avgErsMj,
    recommended,
    alternative,
    fuelTarget,
    sinceLastRace,
  };
}
