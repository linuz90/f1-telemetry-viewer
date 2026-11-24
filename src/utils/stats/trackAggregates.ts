import { compoundDisplayRank } from "../../constants/compounds";
import type { TelemetrySession } from "../../types/telemetry";
import { median } from "./core";
import { findPlayer, isRaceSession } from "./drivers";
import {
  FUEL_RESERVE_KG,
  collectRaceFuelBurn,
  type FuelConditions,
} from "./energy";
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
  /** Median green-lap burn after lap 1, kg/lap. */
  burnRateKgPerLap: number;
  /** Lap-1 burn from the grid, kg: the median over races that measured it,
   *  else the green burn. */
  startLapBurnKg: number;
  /** Average game fuel-slider target implied by the track recommendation. */
  avgRecommendedFuelLaps: number;
  /** Total fuel load (kg) the recommendation stands for: lap 1, every later
   *  lap at the median burn, the thin-sample allowance and the unburnable
   *  reserve. */
  avgRecommendedFuelKg: number;
  /** Average laps (on the game's slider) each race started above the
   *  recommendation. Positive = over-fuelled for a clean race. */
  avgExcessAtFinishLaps: number;
  /** Independent attempts that contributed enough consecutive fuel pairs. */
  eligibleAttemptCount: number;
  /** Green laps behind the median burn estimate. */
  consecutiveGreenPairCount: number;
  /** Contributing attempts classified as FINISHED. */
  completedRaceCount: number;
  /** Confidence is intentionally session-based; laps within one run correlate. */
  confidence: "low" | "medium" | "high";
}

/** Burn at one circuit drifts by several percent between months (patches,
 *  setups, pace: Jeddah ran ~1.30 kg/lap in July and ~1.39 in November, as
 *  far apart as slicks and Inters), so the fuel plan reads the runs within
 *  this long of the newest one. */
const FUEL_RECENT_WINDOW_MS = 30 * 24 * 3600_000;

/** How far one run's median burn sits from another's at the same circuit
 *  inside a month, as a share of the burn: 1.5% over 60 F1 26 runs. */
const FUEL_RUN_SPREAD = 0.015;
/** Runs from which the plan carries no thin-sample allowance. */
const FUEL_FULL_SAMPLE_RUNS = 6;

/** Extra share of the race's fuel a thin sample carries: one standard
 *  deviation of the error it has beyond a full sample's. 1.4% with one run
 *  (0.44 laps over 35), 0.9% with two, 0.6% with three, nothing from six.
 *  Sized on partial data: plans from any one or two sessions at a circuit
 *  then fell over half a lap short of the full data's estimate 2-5% of the
 *  time, about as often as the full data fell short of a real race. */
function thinSampleAllowance(runCount: number): number {
  if (runCount >= FUEL_FULL_SAMPLE_RUNS) return 0;
  return FUEL_RUN_SPREAD * Math.sqrt(1 / runCount - 1 / FUEL_FULL_SAMPLE_RUNS);
}

interface EligibleFuelAttempt {
  /** Save instant from the file name, ms; NaN when the session carries none. */
  at: number;
  deltas: number[];
  startLapKg: number | null;
  fuelSnapshotCount: number;
  recordedLapCount: number;
  startFuelKg: number;
  startFuelRemaining: number;
  /** kg per lap of the game's fuel slider at the first snapshot. */
  gameKgPerLap: number;
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

/** Aggregate fuel data across all race sessions at a track, on dry or wet
 *  laps (the race plan is dry; Inters burn ~7% more per lap, so a wet race
 *  would talk the dry plan into over-fuelling and the reverse runs dry).
 *
 *  The target is the load that reaches the flag on the unburnable reserve in
 *  a clean race, with no surplus on top: the player would rather lift and
 *  coast on the last laps of a heavy race than carry spare fuel in every one.
 *
 *  1. **Median burn, lap 1 apart.** Green laps after lap 1 from every
 *     eligible attempt go into one pool and its median is the per-lap burn.
 *     Planned from the earlier runs at their circuit alone, 15 finished dry
 *     F1 26 races reached the line 0.3 laps above the reserve on average
 *     (0.5 short to 1.7 over), where the earlier P75 plus PnG's Conservative
 *     surplus carried 1.1 laps. Lap 1 burns more from the standing start,
 *     so it adds its own median.
 *
 *  2. **The game's own slider units.** The slider counts laps at the game's
 *     burn estimate, 3-11% above the real one in F1 26, so kg turn into slider
 *     laps at `startFuelKg / (laps left + startFuelRemaining)`, not at the
 *     measured burn.
 *
 *  3. **This month's runs.** Only attempts within 30 days of the newest
 *     count once they pass the evidence gate (FUEL_RECENT_WINDOW_MS).
 *
 *  4. **One long run is enough, with more fuel on a thin sample**
 *     (thinSampleAllowance), the only margin above the reserve. Burn is flat
 *     through a race (every tenth of the distance within 0.7% of the run's
 *     median once lap 1 is out), so short runs stand in for a full one; 12
 *     green laps are needed, from one run or several.
 *
 *  It never reads the fuel left at the flag: SC/VSC laps burn less, and
 *  counting that as headroom would under-fuel a race that runs clean. Online
 *  that reading is also taken after the flag (see collectRaceFuelBurn).
 */
export function aggregateFuelData(
  sessions: TelemetrySession[],
  conditions: FuelConditions = "dry",
): TrackFuelStats | null {
  const minimumPairsPerSession = 3;
  const minimumFuelSnapshotsPerSession = 6;
  const minimumSessionCount = 1;
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
    const burn = collectRaceFuelBurn(player, conditions, totalLaps);
    const deltas = burn.greenLapsKg;
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
    const gameKgPerLap =
      startFuelKg /
      (totalLaps - (firstLap["lap-number"] ?? 0) + startFuelRemaining);
    if (!(gameKgPerLap > 0) || !Number.isFinite(gameKgPerLap)) continue;

    const attempt: EligibleFuelAttempt = {
      at: parseSessionSortKey(session, Number.NaN),
      deltas,
      startLapKg: burn.startLapKg,
      fuelSnapshotCount: lapsWithFuel.length,
      recordedLapCount: player["per-lap-info"]?.length ?? 0,
      startFuelKg,
      startFuelRemaining,
      gameKgPerLap,
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

  // Laps within one run share fuel load, tyres, weather, and driving intent,
  // so raw pair count alone cannot establish an actionable recommendation.
  const hasEvidence = (attempts: EligibleFuelAttempt[]) =>
    attempts.length >= minimumSessionCount &&
    attempts.reduce((pairs, race) => pairs + race.deltas.length, 0) >=
      minimumPooledPairCount;

  // Recent runs alone once they pass the gate (see FUEL_RECENT_WINDOW_MS);
  // until then, and for undated sessions, every run counts.
  const allAttempts = [...unkeyedAttempts, ...attemptsByUid.values()];
  const newest = Math.max(
    ...allAttempts.map((race) => race.at).filter(Number.isFinite),
  );
  const recent = allAttempts.filter(
    (race) => !(newest - race.at > FUEL_RECENT_WINDOW_MS),
  );
  const perRace = hasEvidence(recent) ? recent : allAttempts;
  if (!hasEvidence(perRace)) return null;
  const pooledDeltas = perRace.flatMap((race) => race.deltas);

  const burnRateKg = median(pooledDeltas);
  if (burnRateKg == null || burnRateKg <= 0) return null;
  const startLapBurnKg =
    median(
      perRace
        .map((race) => race.startLapKg)
        .filter((kg): kg is number => kg != null),
    ) ?? burnRateKg;

  const avg = (arr: number[]) => arr.reduce((a, b) => a + b, 0) / arr.length;

  // Every race in the bucket has the same distance, so one load fits them all.
  const totalLaps = perRace[0]!.totalLaps;
  const recommendedKg =
    (startLapBurnKg + (totalLaps - 1) * burnRateKg) *
      (1 + thinSampleAllowance(perRace.length)) +
    FUEL_RESERVE_KG;
  const recommendedPerRace = perRace.map(
    (r) => recommendedKg / r.gameKgPerLap - r.totalLaps,
  );
  const completedRaceCount = perRace.filter((r) => r.isCompleted).length;
  const confidence =
    completedRaceCount >= 2
      ? "high"
      : completedRaceCount === 1
        ? "medium"
        : "low";

  return {
    burnRateKgPerLap: burnRateKg,
    startLapBurnKg,
    avgRecommendedFuelLaps: avg(recommendedPerRace),
    avgRecommendedFuelKg: recommendedKg,
    avgExcessAtFinishLaps: avg(
      perRace.map((r, i) => r.startFuelRemaining - recommendedPerRace[i]!),
    ),
    eligibleAttemptCount: perRace.length,
    consecutiveGreenPairCount: pooledDeltas.length,
    completedRaceCount,
    confidence,
  };
}
