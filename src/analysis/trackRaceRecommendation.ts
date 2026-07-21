import type { DriverData, TelemetrySession } from "../types/telemetry";
import { bestSectorTimeMs } from "../utils/format";
import { getFormulaComparisonKey } from "../utils/sessionTypes";
import { isSameTrack } from "../utils/tracks";
import { findPlayer, isRaceSession } from "../utils/stats/drivers";
import { avgErsDeployMj } from "../utils/stats/energy";
import type {
  CompoundLifeStats,
  TrackFuelStats,
} from "../utils/stats/trackAggregates";
import { aggregateCompoundLife } from "../utils/stats/trackAggregates";
import {
  getBestLapTime,
  getRacePaceLapSamples,
  getRacePaceLaps,
} from "../utils/stats/laps";
import { avgWearRate } from "../utils/stats/tyres";
import { synthesizeStrategies } from "./trackStrategySynthesis";
import type {
  BucketRaceEntry,
  TrackBestRaceLap,
  TrackFuelTarget,
  TrackRaceRecommendation,
  TrackRaceRecommendationOptions,
  TrackSinceLastRaceDelta,
} from "./trackStrategyTypes";

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

/** Sum-of-best-sectors across the player's race-pace laps in the bucket. */
function theoreticalBestFromRacePaceLaps(entries: BucketRaceEntry[]): number {
  let bestS1 = 0;
  let bestS2 = 0;
  let bestS3 = 0;
  for (const entry of entries) {
    const racePaceLaps = getRacePaceLaps(entry.player);
    if (racePaceLaps.length === 0) continue;
    const s1 = bestSectorTimeMs(racePaceLaps, 1);
    const s2 = bestSectorTimeMs(racePaceLaps, 2);
    const s3 = bestSectorTimeMs(racePaceLaps, 3);
    if (s1 > 0 && (bestS1 === 0 || s1 < bestS1)) bestS1 = s1;
    if (s2 > 0 && (bestS2 === 0 || s2 < bestS2)) bestS2 = s2;
    if (s3 > 0 && (bestS3 === 0 || s3 < bestS3)) bestS3 = s3;
  }
  return bestS1 > 0 && bestS2 > 0 && bestS3 > 0 ? bestS1 + bestS2 + bestS3 : 0;
}

interface BestRacePaceLap {
  timeMs: number;
  compound: string | null;
}

function bestRacePaceLapWithCompound(
  entries: BucketRaceEntry[],
): BestRacePaceLap | null {
  let best: BestRacePaceLap | null = null;
  for (const entry of entries) {
    const samples = getRacePaceLapSamples(entry.player);
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
  options: TrackRaceRecommendationOptions = {},
): TrackRaceRecommendation | null {
  const allEntries = buildBucketEntries(bucketRaceSessions);
  if (allEntries.length === 0) return null;

  const totalLaps = allEntries[0].totalLaps;
  const entries = allEntries.filter((entry) => entry.totalLaps === totalLaps);
  // Strategy timing is race-distance sensitive in the F1 games: 25% and 50%
  // races scale tyre wear differently. Defensively re-bucket here so a broad
  // caller cannot leak tyre pace/wear evidence across distances.
  const strategyCompoundLifeStats =
    entries.length === allEntries.length
      ? bucketCompoundLifeStats
      : aggregateCompoundLife(entries.map((entry) => entry.session));
  const fullDistanceEntries = entries.filter((e) => e.isFullDistance);
  const representative = entries[0];
  const representativeTrackId =
    representative.session["session-info"]["track-id"];
  const representativeFormulaKey = getFormulaComparisonKey(
    representative.session["session-info"].formula,
    representative.session["game-year"],
  );
  const sameTrackPitLossEntries = buildBucketEntries(
    options.pitLossRaceSessions ?? bucketRaceSessions,
  ).filter((entry) => {
    if (
      !isSameTrack(
        entry.session["session-info"]["track-id"],
        representativeTrackId,
      )
    ) {
      return false;
    }
    return (
      getFormulaComparisonKey(
        entry.session["session-info"].formula,
        entry.session["game-year"],
      ) === representativeFormulaKey
    );
  });
  const pitLossEntries =
    sameTrackPitLossEntries.length > 0 ? sameTrackPitLossEntries : entries;

  // ── Best race-pace lap + compound + theoretical-best gap ────────────────
  const bestLap = bestRacePaceLapWithCompound(entries);
  const theoreticalBestMs = theoreticalBestFromRacePaceLaps(entries);
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
  // We don't replay the most common sequence, but projected wear does prefer
  // long-enough real stints from the same sequence slot when available. That
  // lets a Hard-Medium alternative use Hard-opening evidence without letting
  // one weird historical strategy dictate the whole recommendation shape.
  const { recommended, alternative } = synthesizeStrategies(
    strategyCompoundLifeStats,
    totalLaps,
    entries.length,
    fullDistanceEntries.length,
    entries,
    pitLossEntries,
  );
  const hasEvidence = recommended != null;

  // ── Fuel target (single line) ────────────────────────────────────────────
  const fuelTarget: TrackFuelTarget | null = bucketFuelStats
    ? {
        recommendedDeltaLaps: bucketFuelStats.avgRecommendedFuelLaps,
        recommendedFuelKg: bucketFuelStats.avgRecommendedFuelKg,
        burnRateKgPerLap: bucketFuelStats.p75BurnRateKgPerLap,
        excessAtFinishLaps: bucketFuelStats.avgExcessAtFinishLaps,
        eligibleAttemptCount: bucketFuelStats.eligibleAttemptCount,
        consecutiveGreenPairCount: bucketFuelStats.consecutiveGreenPairCount,
        completedRaceCount: bucketFuelStats.completedRaceCount,
        confidence: bucketFuelStats.confidence,
      }
    : null;

  // ── Since last race here ────────────────────────────────────────────────
  let sinceLastRace: TrackSinceLastRaceDelta | null = null;
  if (entries.length >= 2) {
    // entries follow input order (sessions are already date-sorted from the page).
    const latest = entries[entries.length - 1];
    const previous = entries[entries.length - 2];
    const latestBest = getBestLapTime(getRacePaceLaps(latest.player));
    const prevBest = getBestLapTime(getRacePaceLaps(previous.player));
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
