import { compoundDisplayRank } from "../../constants/compounds";
import type { TelemetrySession } from "../../types/telemetry";
import { quantile } from "./core";
import { findPlayer, isRaceSession } from "./drivers";
import { collectGreenFlagBurnDeltas, fuelSafetyMarginLaps } from "./energy";
import {
  getRacePaceLapSamples,
  isCompleteValidLap,
  type RacePaceLapSample,
} from "./laps";
import { calculatePeakPace } from "./peakPace";
import type { StintWearCurvePoint } from "./tyres";
import {
  PUNCTURE_THRESHOLD,
  estimateMaxLife,
  getGreenFlagWear,
  getNeutralisedLaps,
  projectCompoundLapsToWear,
} from "./tyres";

/** One observed player stint kept for strategy-specific wear projections. */
export interface CompoundLifeSample {
  compound: string;
  /** Green-flag wear per lap (`getGreenFlagWear`). */
  wearRatePerLap: number;
  /** Green-flag laps behind `wearCurve`: how far the evidence reaches before
   *  a projection has to extrapolate. */
  greenLaps: number;
  /** Zero-based position in the tyre sequence: 0 = opening stint. */
  stintIndex: number;
  /** Number of pit stops in the source strategy shape. */
  strategyStopCount: number;
  startLap: number;
  endLap: number;
  /** Green-flag wear curve (`getGreenFlagWear`). Strategy projections read
   *  it when a real stint covered the candidate stint, so late-stint wear
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

/** Per-compound tyre life stats aggregated across sessions, softest first. */
export interface CompoundLifeStats {
  compound: string;
  avgWearRatePerLap: number;
  /** Green-flag laps until worst-wheel wear reaches PUNCTURE_THRESHOLD along
   *  the median of the stints' own curve projections
   *  (`projectCompoundLapsToWear`), so late-stint acceleration counts and one
   *  odd stint cannot set the number. The strategy projects with the same
   *  median, so its stints run out where this says. */
  estMaxLife: number;
  avgStintLength: number;
  /** Most green-flag laps one stint ran on this compound and the worst-wheel
   *  wear they added: how far real racing went before `estMaxLife` and the
   *  strategy start extrapolating. */
  longestGreenRun: number;
  longestGreenRunWear: number;
  stintCount: number;
  /** Best valid lap time in ms on this compound across every stint, wear
   *  evidence or not (0 if none) */
  bestLapMs: number;
  /** Peak pace on this compound pooled across the races (`calculatePeakPace`);
   *  0 when fewer than three eligible laps exist. */
  peakPaceMs: number;
  peakPaceLapCount: number;
  /** Raw stint samples retained so strategy projections can prefer matching
   *  stint-position evidence without changing the aggregate tyre-life cards. */
  samples: CompoundLifeSample[];
}

/** Minimum green-flag laps for a stint to count as tyre-life evidence */
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
      longestGreenRun: { laps: number; wear: number } | null;
      samples: CompoundLifeSample[];
    }
  > = {};
  const bestLapByCompound = new Map<string, number>();
  const paceSamplesByCompound = new Map<string, RacePaceLapSample[]>();

  for (const [sessionIndex, session] of sessions.entries()) {
    if (!isRaceSession(session)) continue;
    const player = findPlayer(session);
    if (!player) continue;

    for (const sample of getRacePaceLapSamples(player)) {
      if (!sample.compound) continue;
      const list = paceSamplesByCompound.get(sample.compound) ?? [];
      list.push(sample);
      paceSamplesByCompound.set(sample.compound, list);
    }

    const laps = player["session-history"]["lap-history-data"];
    const stints = player["tyre-set-history"] ?? [];
    const neutralisedLaps = getNeutralisedLaps(player["per-lap-info"]);
    const sessionSortKey = parseSessionSortKey(session, sessionIndex);
    const totalLaps = session["session-info"]["total-laps"];
    const lapsCompleted = player["session-history"]["num-laps"] ?? 0;
    const reachedRaceFinish =
      Number.isFinite(totalLaps) &&
      totalLaps > 0 &&
      lapsCompleted >= totalLaps - 1;

    for (const [stintIndex, stint] of stints.entries()) {
      const compound = stint["tyre-set-data"]["visual-tyre-compound"];

      // Best lap pools every stint: a lap time needs no wear evidence.
      let lapNum = 0;
      for (const l of laps) {
        if (l["lap-time-in-ms"] > 0) {
          lapNum++;
          if (lapNum >= stint["start-lap"] && lapNum <= stint["end-lap"]) {
            if (isCompleteValidLap(l)) {
              const cur = bestLapByCompound.get(compound) ?? 0;
              if (cur === 0 || l["lap-time-in-ms"] < cur) {
                bestLapByCompound.set(compound, l["lap-time-in-ms"]);
              }
            }
          }
        }
      }

      const green = getGreenFlagWear(stint, neutralisedLaps);
      if (green.laps < MIN_STINT_LAPS || green.wear <= 0) continue;
      const rate = green.wear / green.laps;

      if (!byCompound[compound])
        byCompound[compound] = {
          rates: [],
          lengths: [],
          longestGreenRun: null,
          samples: [],
        };
      byCompound[compound].rates.push(rate);
      byCompound[compound].lengths.push(stint["stint-length"]);
      const longest = byCompound[compound].longestGreenRun;
      if (!longest || green.laps > longest.laps) {
        byCompound[compound].longestGreenRun = {
          laps: green.laps,
          wear: green.wear,
        };
      }
      byCompound[compound].samples.push({
        compound,
        wearRatePerLap: rate,
        greenLaps: green.laps,
        stintIndex,
        strategyStopCount: Math.max(0, stints.length - 1),
        startLap: stint["start-lap"],
        endLap: stint["end-lap"],
        wearCurve: green.curve,
        isFinalStint:
          stintIndex === stints.length - 1 &&
          reachedRaceFinish &&
          stint["end-lap"] >= totalLaps - 1,
        sessionSortKey,
      });
    }
  }

  return Object.entries(byCompound)
    .map(([compound, { rates, lengths, longestGreenRun, samples }]) => {
      const avgRate = rates.reduce((a, b) => a + b, 0) / rates.length;
      const avgLength = lengths.reduce((a, b) => a + b, 0) / lengths.length;
      const projectedLife = projectCompoundLapsToWear(
        samples.map((sample) => sample.wearCurve),
        PUNCTURE_THRESHOLD,
      );
      const peak = calculatePeakPace(paceSamplesByCompound.get(compound) ?? []);
      return {
        compound,
        avgWearRatePerLap: avgRate,
        // A compound too gentle to reach the threshold within a projectable
        // stint falls back to the pooled linear rate.
        estMaxLife: projectedLife ?? estimateMaxLife(avgRate),
        avgStintLength: Math.round(avgLength),
        longestGreenRun: longestGreenRun?.laps ?? 0,
        longestGreenRunWear: longestGreenRun?.wear ?? 0,
        stintCount: rates.length,
        bestLapMs: bestLapByCompound.get(compound) ?? 0,
        peakPaceMs: peak?.timeMs ?? 0,
        peakPaceLapCount: peak?.sampleCount ?? 0,
        samples,
      };
    })
    .sort(
      (a, b) =>
        compoundDisplayRank(a.compound) - compoundDisplayRank(b.compound),
    );
}

/** Fuel stats aggregated across race sessions at a track */
export interface TrackFuelStats {
  p75BurnRateKgPerLap: number;
  /** Average game fuel-slider target implied by the track recommendation. */
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
