import type { DriverData, LapHistoryEntry } from "../../types/telemetry";
import { isLapValid, sectorTimeMs } from "../format";
import { median } from "./core";
import { getDriverStints, getLapCompoundMap } from "./tyres";

const LAP_SECTOR_SUM_TOLERANCE_MS = 10;

/**
 * Whether a history row contains a complete lap rather than a sector fragment.
 *
 * PnG can mark sparse online-driver rows as fully valid while copying only the
 * final recorded sector into `lap-time-in-ms`. Requiring all sectors and a
 * matching total prevents those 29–33 second fragments from becoming lap-time
 * records. Complete exports differ from their sector sum by at most 2ms, so a
 * small tolerance preserves normal packet rounding.
 */
export function hasCompleteLapTiming(lap: LapHistoryEntry): boolean {
  const lapTimeMs = lap["lap-time-in-ms"];
  if (lapTimeMs <= 0) return false;

  const sectors = [
    sectorTimeMs(lap, 1),
    sectorTimeMs(lap, 2),
    sectorTimeMs(lap, 3),
  ];
  if (sectors.some((sector) => sector <= 0)) return false;

  const sectorTotalMs = sectors.reduce((sum, sector) => sum + sector, 0);
  return Math.abs(lapTimeMs - sectorTotalMs) <= LAP_SECTOR_SUM_TOLERANCE_MS;
}

export function isCompleteValidLap(lap: LapHistoryEntry): boolean {
  return isLapValid(lap["lap-valid-bit-flags"]) && hasCompleteLapTiming(lap);
}

export function getValidLaps(
  laps: readonly LapHistoryEntry[],
): LapHistoryEntry[] {
  return laps.filter(isCompleteValidLap);
}

export function medianLapTimeMs(laps: LapHistoryEntry[]): number {
  return median(getValidLaps(laps).map((l) => l["lap-time-in-ms"])) ?? 0;
}

/**
 * Filter outlier laps from a subset using median-based filtering.
 * Any lap > 1.2× the median is excluded. Used for stint-level analysis
 * (e.g. avgPaceInRange, paceDrop, compound comparisons) where we operate
 * on a narrow range of laps and don't have full SC/pit context.
 */
export function filterOutlierLaps(laps: LapHistoryEntry[]): LapHistoryEntry[] {
  const valid = getValidLaps(laps);
  if (valid.length < 3) return valid;
  const times = valid.map((l) => l["lap-time-in-ms"]);
  const baseline = median(times);
  if (baseline == null) return valid;
  const threshold = baseline * 1.2;
  return valid.filter((l) => l["lap-time-in-ms"] <= threshold);
}

/**
 * Get pit in/out lap numbers from a driver's tyre stint history.
 * The last lap of each stint (except the final one) is the pit-in lap,
 * and the first lap of the next stint is the pit-out lap.
 */
function getPitLapNumbers(d: DriverData): Set<number> {
  const stints = getDriverStints(d);
  const pitLaps = new Set<number>();
  for (let i = 0; i < stints.length - 1; i++) {
    const endLap = stints[i]["end-lap"];
    pitLaps.add(endLap); // pit-in lap (slow entry into pits)
    pitLaps.add(endLap + 1); // pit-out lap (slow exit from pits)
  }
  return pitLaps;
}

function getLapStintKeyMap(d: DriverData): Map<number, string> {
  const byLap = new Map<number, string>();
  getDriverStints(d).forEach((stint, index) => {
    for (let lap = stint["start-lap"]; lap <= stint["end-lap"]; lap++) {
      byLap.set(lap, `stint-${index}`);
    }
  });
  return byLap;
}

export interface RacePaceLapSample {
  lapNumber: number;
  lap: LapHistoryEntry;
  timeMs: number;
  compound?: string;
}

const MAD_TO_STD_DEV = 1.4826;
const RACE_PACE_MAD_MULTIPLIER = 3;
const RACE_PACE_MIN_OUTLIER_DISTANCE_MS = 1_500;

function filterRacePaceOutliers(
  samples: RacePaceLapSample[],
  groupKey: (sample: RacePaceLapSample) => string,
): RacePaceLapSample[] {
  const groups = new Map<string, RacePaceLapSample[]>();
  for (const sample of samples) {
    const key = groupKey(sample);
    const group = groups.get(key) ?? [];
    group.push(sample);
    groups.set(key, group);
  }

  return [...groups.values()]
    .flatMap((group) => filterRacePaceOutlierGroup(group))
    .sort((a, b) => a.lapNumber - b.lapNumber);
}

function filterRacePaceOutlierGroup(
  samples: RacePaceLapSample[],
): RacePaceLapSample[] {
  if (samples.length < 3) return samples;

  const times = samples.map((sample) => sample.timeMs);
  const baseline = median(times);
  if (baseline == null) return samples;

  const mad = median(times.map((time) => Math.abs(time - baseline))) ?? 0;
  const robustSpread = mad * MAD_TO_STD_DEV;
  const outlierDistance = Math.max(
    robustSpread * RACE_PACE_MAD_MULTIPLIER,
    RACE_PACE_MIN_OUTLIER_DISTANCE_MS,
  );
  const threshold = baseline + outlierDistance;

  return samples.filter((sample) => sample.timeMs <= threshold);
}

/**
 * Get race-pace laps for computing representative race pace.
 *
 * Filtering strategy (chosen after comparing approaches on real data with
 * SC, VSC, and formation laps — see Zandvoort 2026-02-09 analysis):
 *
 *  1. Exclude lap 1 — always an outlier (formation lap / standing start).
 *  2. Exclude SC/VSC/formation laps — using `max-safety-car-status` from
 *     per-lap-info. This catches the full safety car period including the
 *     "entry" lap where the flag just came out.
 *  3. Exclude pit in/out laps — identified from tyre stint boundaries.
 *     The pit-in lap (diving into pits) and pit-out lap (rejoining) both
 *     have artificially slow times that aren't representative of race pace.
 *  4. Apply a Median Absolute Deviation safety net — catches unlabeled
 *     incidents (spins, off-tracks, rejoins) that the game still marks as
 *     green-flag. These have no telemetry flag, so statistical filtering is
 *     the only option (confirmed with ashwin_nat from Pits n' Giggles,
 *     2026-06).
 *     The MAD pass runs per stint so a slower compound is not judged against a
 *     faster stint's median.
 *
 * Damage is intentionally not an eligibility gate. Persistent unrepaired wing
 * damage and normal ICE/gearbox wear are part of the car's race state; only
 * abnormal slow laps are removed so one incident doesn't erase the whole race
 * pace column.
 *
 * Why not just use the median filter alone (previous approach)?
 *  - It included formation laps and "SC entry" laps that were close enough
 *    to the median to sneak through (e.g. 1:13.6 on a 1:12.8 median).
 *  - It included pit-in laps at long tracks where the pit entry time loss
 *    was under 20% of the median (e.g. Spa pit-in at 1:15 vs 1:12 median).
 *  - Rankings were noticeably different (and less accurate) compared to
 *    explicit SC/pit filtering on sessions with safety car periods.
 */
export function getRacePaceLapSamples(d: DriverData): RacePaceLapSample[] {
  const laps = d["session-history"]["lap-history-data"];
  const perLapInfo = d["per-lap-info"] ?? [];
  const pitLaps = getPitLapNumbers(d);
  const stintByLap = getLapStintKeyMap(d);
  const compoundByLap = getLapCompoundMap(d);

  const racePaceSamples: RacePaceLapSample[] = [];
  for (let i = 1; i < laps.length; i++) {
    const lap = laps[i];
    const lapNum = i + 1; // lap-history-data is 0-indexed, lap numbers are 1-indexed

    // The exporter can flag a sector-only fragment as valid for sparse remote
    // drivers, so eligibility must include structural lap completeness.
    if (!isCompleteValidLap(lap)) continue;

    // Exclude SC/VSC/formation laps
    const pli = perLapInfo.find((p) => p["lap-number"] === lapNum);
    const scStatus = pli?.["max-safety-car-status"] ?? "NO_SAFETY_CAR";
    if (scStatus !== "NO_SAFETY_CAR") continue;

    // Exclude pit in/out laps
    if (pitLaps.has(lapNum)) continue;

    racePaceSamples.push({
      lapNumber: lapNum,
      lap,
      timeMs: lap["lap-time-in-ms"],
      compound: compoundByLap.get(lapNum),
    });
  }

  // MAD adapts to the actual race spread better than a flat 1.2x cap. Grouping
  // by stint avoids treating a naturally slower compound as an outlier.
  return filterRacePaceOutliers(
    racePaceSamples,
    (sample) => stintByLap.get(sample.lapNumber) ?? sample.compound ?? "race",
  );
}

export function getRacePaceLaps(d: DriverData): LapHistoryEntry[] {
  return getRacePaceLapSamples(d).map((sample) => sample.lap);
}

/** Get the best lap time in ms from a set of laps */
export function getBestLapTime(laps: LapHistoryEntry[]): number {
  const valid = getValidLaps(laps);
  if (valid.length === 0) return 0;
  return Math.min(...valid.map((l) => l["lap-time-in-ms"]));
}

/** Calculate standard deviation of lap times (consistency metric) */
export function lapTimeStdDev(laps: LapHistoryEntry[]): number {
  const valid = getValidLaps(laps);
  if (valid.length < 2) return 0;

  const times = valid.map((l) => l["lap-time-in-ms"]);
  const mean = times.reduce((a, b) => a + b, 0) / times.length;
  const variance =
    times.reduce((sum, t) => sum + (t - mean) ** 2, 0) / times.length;
  return Math.sqrt(variance);
}

/** Per-lap cumulative delta entry */
export interface CumulativeDelta {
  lap: number;
  delta: number; // cumulative ms (positive = player behind)
  lapDelta: number; // per-lap ms
  s1Delta: number;
  s2Delta: number;
  s3Delta: number;
  playerPit: boolean;
  rivalPit: boolean;
}

/** Calculate cumulative time deltas between player and rival, lap by lap */
export function calculateCumulativeDeltas(
  playerLaps: LapHistoryEntry[],
  rivalLaps: LapHistoryEntry[],
  playerPitLaps: number[],
  rivalPitLaps: number[],
): CumulativeDelta[] {
  const result: CumulativeDelta[] = [];
  let cumulative = 0;
  const len = Math.min(playerLaps.length, rivalLaps.length);

  for (let i = 0; i < len; i++) {
    const pLap = playerLaps[i];
    const rLap = rivalLaps[i];
    if (pLap["lap-time-in-ms"] <= 0 || rLap["lap-time-in-ms"] <= 0) continue;

    const lapDelta = pLap["lap-time-in-ms"] - rLap["lap-time-in-ms"];
    cumulative += lapDelta;

    result.push({
      lap: i + 1,
      delta: cumulative / 1000, // convert to seconds for display
      lapDelta: lapDelta / 1000,
      s1Delta: (sectorTimeMs(pLap, 1) - sectorTimeMs(rLap, 1)) / 1000,
      s2Delta: (sectorTimeMs(pLap, 2) - sectorTimeMs(rLap, 2)) / 1000,
      s3Delta: (sectorTimeMs(pLap, 3) - sectorTimeMs(rLap, 3)) / 1000,
      playerPit: playerPitLaps.includes(i + 1),
      rivalPit: rivalPitLaps.includes(i + 1),
    });
  }

  return result;
}
