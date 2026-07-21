import type { TelemetrySession } from "../../types/telemetry";
import { quantile } from "./core";
import { findPlayer, isRaceSession } from "./drivers";
import { collectGreenFlagBurnDeltas, fuelSafetyMarginLaps } from "./energy";
import { isCompleteValidLap } from "./laps";
import type { StintWearCurvePoint } from "./tyres";
import { estimateMaxLife, getStintWearCurve, stintWearRate } from "./tyres";

/** One observed player stint kept for strategy-specific wear projections. */
export interface CompoundLifeSample {
  compound: string;
  wearRatePerLap: number;
  stintLength: number;
  /** Zero-based position in the tyre sequence: 0 = opening stint. */
  stintIndex: number;
  /** Number of pit stops in the source strategy shape. */
  strategyStopCount: number;
  startLap: number;
  endLap: number;
  /** Worst-wheel wear by completed stint lap. Strategy projections use this
   *  when a real stint is longer than the candidate stint, so late-stint wear
   *  acceleration is not flattened into a full-stint average. */
  wearCurve: StintWearCurvePoint[];
  /** True only when this stint reached the race finish, not just a DNF export. */
  isFinalStint: boolean;
  /**
   * Higher means newer. Prefer the parsed export timestamp when present, with
   * input order as a fallback because track pages already sort sessions by date.
   */
  sessionSortKey: number;
}

/** Per-compound tyre life stats aggregated across sessions */
export interface CompoundLifeStats {
  compound: string;
  avgWearRatePerLap: number;
  estMaxLife: number;
  avgStintLength: number;
  longestStint: number;
  stintCount: number;
  /** Best valid lap time in ms on this compound (0 if none) */
  bestLapMs: number;
  /** Raw stint samples retained so strategy projections can prefer matching
   *  stint-position evidence without changing the aggregate tyre-life cards. */
  samples: CompoundLifeSample[];
}

/** Minimum stint length to include in aggregate compound stats */
const MIN_STINT_LAPS = 3;

function parseSessionSortKey(
  session: TelemetrySession,
  fallbackIndex: number,
): number {
  const raw = `${session.debug?.["file-name"] ?? ""} ${session.debug?.timestamp ?? ""}`;
  const match = raw.match(
    /(\d{4})[_-](\d{2})[_-](\d{2})[_\s-](\d{2})[_:](\d{2})[_:](\d{2})/,
  );
  if (!match) return fallbackIndex;

  const [, year, month, day, hour, minute, second] = match;
  const value = Date.UTC(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    Number(second),
  );
  return Number.isFinite(value) ? value : fallbackIndex;
}

/** Aggregate compound tyre life across all race sessions at a track */
export function aggregateCompoundLife(
  sessions: TelemetrySession[],
): CompoundLifeStats[] {
  const byCompound: Record<
    string,
    {
      rates: number[];
      lengths: number[];
      bestLapMs: number;
      samples: CompoundLifeSample[];
    }
  > = {};

  for (const [sessionIndex, session] of sessions.entries()) {
    if (!isRaceSession(session)) continue;
    const player = findPlayer(session);
    if (!player) continue;

    const laps = player["session-history"]["lap-history-data"];
    const stints = player["tyre-set-history"] ?? [];
    const sessionSortKey = parseSessionSortKey(session, sessionIndex);
    const totalLaps = session["session-info"]["total-laps"];
    const lapsCompleted = player["session-history"]["num-laps"] ?? 0;
    const reachedRaceFinish =
      Number.isFinite(totalLaps) &&
      totalLaps > 0 &&
      lapsCompleted >= totalLaps - 1;

    for (const [stintIndex, stint] of stints.entries()) {
      if (stint["stint-length"] < MIN_STINT_LAPS) continue;

      const compound = stint["tyre-set-data"]["visual-tyre-compound"];
      const rate = stintWearRate(stint);
      if (rate <= 0) continue;
      const wearCurve = getStintWearCurve(stint);

      if (!byCompound[compound])
        byCompound[compound] = {
          rates: [],
          lengths: [],
          bestLapMs: 0,
          samples: [],
        };
      byCompound[compound].rates.push(rate);
      byCompound[compound].lengths.push(stint["stint-length"]);
      byCompound[compound].samples.push({
        compound,
        wearRatePerLap: rate,
        stintLength: stint["stint-length"],
        stintIndex,
        strategyStopCount: Math.max(0, stints.length - 1),
        startLap: stint["start-lap"],
        endLap: stint["end-lap"],
        wearCurve,
        isFinalStint:
          stintIndex === stints.length - 1 &&
          reachedRaceFinish &&
          stint["end-lap"] >= totalLaps - 1,
        sessionSortKey,
      });

      // Find best valid lap in this stint
      let lapNum = 0;
      for (const l of laps) {
        if (l["lap-time-in-ms"] > 0) {
          lapNum++;
          if (lapNum >= stint["start-lap"] && lapNum <= stint["end-lap"]) {
            if (isCompleteValidLap(l)) {
              const cur = byCompound[compound].bestLapMs;
              if (cur === 0 || l["lap-time-in-ms"] < cur) {
                byCompound[compound].bestLapMs = l["lap-time-in-ms"];
              }
            }
          }
        }
      }
    }
  }

  return Object.entries(byCompound).map(
    ([compound, { rates, lengths, bestLapMs, samples }]) => {
      const avgRate = rates.reduce((a, b) => a + b, 0) / rates.length;
      const avgLength = lengths.reduce((a, b) => a + b, 0) / lengths.length;
      return {
        compound,
        avgWearRatePerLap: avgRate,
        estMaxLife: estimateMaxLife(avgRate),
        avgStintLength: Math.round(avgLength),
        longestStint: Math.max(...lengths),
        stintCount: rates.length,
        bestLapMs,
        samples,
      };
    },
  );
}

/** Fuel stats aggregated across race sessions at a track */
export interface TrackFuelStats {
  p75BurnRateKgPerLap: number;
  /** Average recommended fuel delta in laps (matches session "Recommended Fuel") */
  avgRecommendedFuelLaps: number;
  /** Average total fuel load (kg) implied by the recommendation — i.e. enough
   *  to cover the race distance at the pooled burn rate plus the safety
   *  margin. Useful for surfacing alongside the laps-based delta. */
  avgRecommendedFuelKg: number;
  /** Average laps of fuel each race had to spare assuming a clean (all
   *  green-flag) run at the pooled burn rate. Positive = over-fuel, negative
   *  = wouldn't have finished without the SC saves that actually happened. */
  avgExcessAtFinishLaps: number;
  /** Independent attempts that contributed enough consecutive fuel pairs. */
  eligibleAttemptCount: number;
  /** Consecutive green-flag fuel pairs behind the p75 burn estimate. */
  consecutiveGreenPairCount: number;
  /** Contributing attempts classified as FINISHED. */
  completedRaceCount: number;
  /** Confidence is intentionally session-based; laps within one run correlate. */
  confidence: "low" | "medium" | "high";
}

interface EligibleFuelAttempt {
  deltas: number[];
  fuelSnapshotCount: number;
  recordedLapCount: number;
  startFuelKg: number;
  startFuelRemaining: number;
  totalLaps: number;
  isCompleted: boolean;
}

function isMoreCompleteFuelAttempt(
  candidate: EligibleFuelAttempt,
  current: EligibleFuelAttempt,
): boolean {
  if (candidate.deltas.length !== current.deltas.length) {
    return candidate.deltas.length > current.deltas.length;
  }
  if (candidate.fuelSnapshotCount !== current.fuelSnapshotCount) {
    return candidate.fuelSnapshotCount > current.fuelSnapshotCount;
  }
  if (candidate.recordedLapCount !== current.recordedLapCount) {
    return candidate.recordedLapCount > current.recordedLapCount;
  }
  return candidate.isCompleted && !current.isCompleted;
}

/** Aggregate fuel data across all race sessions at a track.
 *
 *  Two key choices, both aimed at making the chip safe to act on:
 *
 *  1. **Conservative pooled burn rate.** Consecutive green-flag fuel deltas
 *     from every eligible attempt go into one pool. The 75th percentile is
 *     deliberate: the median missed sustained push phases often enough to be
 *     unsafe as an actionable initial-fuel target.
 *
 *  2. **Clean-race excess, not observed leftover.** Per-race excess is
 *     `startFuelKg / pooledBurnRate − totalLaps` — i.e. what the leftover
 *     *would* be if every lap burned at the green-flag rate. We deliberately
 *     do NOT use the fuel actually left in the tank at the finish: SC/VSC
 *     laps burn ~30% less, and counting that as headroom would tell the user
 *     to under-fuel for a race that happens to run clean.
 */
export function aggregateFuelData(
  sessions: TelemetrySession[],
): TrackFuelStats | null {
  const minimumPairsPerSession = 3;
  const minimumFuelSnapshotsPerSession = 6;
  const minimumSessionCount = 2;
  const minimumPooledPairCount = 12;
  const attemptsByUid = new Map<string, EligibleFuelAttempt>();
  const unkeyedAttempts: EligibleFuelAttempt[] = [];

  for (const session of sessions) {
    if (!isRaceSession(session)) continue;
    const player = findPlayer(session);
    if (!player) continue;
    const totalLaps = session["session-info"]["total-laps"];
    if (!(totalLaps > 0)) continue;

    const lapsWithFuel =
      player["per-lap-info"]?.filter(
        (l) =>
          Number.isFinite(l["car-status-data"]?.["fuel-in-tank"]) &&
          l["car-status-data"]["fuel-in-tank"] > 0,
      ) ?? [];
    const deltas = collectGreenFlagBurnDeltas(player);
    // A second session only improves confidence when it contributes a usable
    // run of its own; one stray pair should not satisfy the independent-run
    // evidence gate.
    if (
      lapsWithFuel.length < minimumFuelSnapshotsPerSession ||
      deltas.length < minimumPairsPerSession
    ) {
      continue;
    }

    const firstLap = lapsWithFuel[0];
    const startFuelKg = firstLap["car-status-data"]["fuel-in-tank"];
    const startFuelRemaining =
      firstLap["car-status-data"]["fuel-remaining-laps"];
    if (!Number.isFinite(startFuelRemaining)) continue;

    const attempt: EligibleFuelAttempt = {
      deltas,
      fuelSnapshotCount: lapsWithFuel.length,
      recordedLapCount: player["per-lap-info"]?.length ?? 0,
      startFuelKg,
      startFuelRemaining,
      totalLaps,
      isCompleted:
        player["final-classification"]?.["result-status"] === "FINISHED",
    };

    const sessionUid = session.debug?.["session-uid"];
    if (sessionUid == null) {
      unkeyedAttempts.push(attempt);
      continue;
    }

    // Summary deduplication intentionally preserves manual saves outside its
    // short time window. Fuel confidence needs a stricter independence rule:
    // one on-track session can contribute at most one attempt, so keep only
    // its most complete eligible snapshot.
    const key = String(sessionUid);
    const current = attemptsByUid.get(key);
    if (!current || isMoreCompleteFuelAttempt(attempt, current)) {
      attemptsByUid.set(key, attempt);
    }
  }

  const perRace = [...unkeyedAttempts, ...attemptsByUid.values()];
  const pooledDeltas = perRace.flatMap((race) => race.deltas);

  // Laps within one run share fuel load, tyres, weather, and driving intent,
  // so raw pair count alone cannot establish an actionable recommendation.
  if (
    perRace.length < minimumSessionCount ||
    pooledDeltas.length < minimumPooledPairCount
  ) {
    return null;
  }

  const pooledBurnRateKg = quantile(pooledDeltas, 0.75);
  if (pooledBurnRateKg == null || pooledBurnRateKg <= 0) return null;

  const avg = (arr: number[]) => arr.reduce((a, b) => a + b, 0) / arr.length;

  // Raw clean-race excess per race (laps spare if every lap had burned at
  // the pooled green-flag rate). This is the honest "how much could we have
  // shaved" number, surfaced as-is in the tile note.
  const excessAtFinish = perRace.map(
    (r) => r.startFuelKg / pooledBurnRateKg - r.totalLaps,
  );

  // The actual recommendation keeps a small safety buffer above zero
  // leftover (unusable-fuel reserve + surplus laps) so following it doesn't
  // leave the player on fumes in a clean race. Matches the buffers PnG's
  // calculator bakes into its "Conservative" strategy.
  const safetyMarginLaps = fuelSafetyMarginLaps(pooledBurnRateKg);
  const recommendedPerRace = perRace.map(
    (r, i) => r.startFuelRemaining - (excessAtFinish[i]! - safetyMarginLaps),
  );
  // The recommendation collapses to "fuel for totalLaps + safetyMargin" at the
  // pooled burn rate — that's the kg figure the player would set in PnG.
  const recommendedKgPerRace = perRace.map(
    (r) => (r.totalLaps + safetyMarginLaps) * pooledBurnRateKg,
  );
  const completedRaceCount = perRace.filter((r) => r.isCompleted).length;
  const confidence =
    completedRaceCount >= 2
      ? "high"
      : completedRaceCount === 1
        ? "medium"
        : "low";

  return {
    p75BurnRateKgPerLap: pooledBurnRateKg,
    avgRecommendedFuelLaps: avg(recommendedPerRace),
    avgRecommendedFuelKg: avg(recommendedKgPerRace),
    avgExcessAtFinishLaps: avg(excessAtFinish),
    eligibleAttemptCount: perRace.length,
    consecutiveGreenPairCount: pooledDeltas.length,
    completedRaceCount,
    confidence,
  };
}
