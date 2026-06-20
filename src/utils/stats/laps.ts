import type {
  CarDamage,
  DriverData,
  LapHistoryEntry,
} from "../../types/telemetry";
import { isLapValid, sectorTimeMs } from "../format";
import { median } from "./core";
import { getDriverStints, getLapCompoundMap } from "./tyres";

export function getValidLaps(laps: LapHistoryEntry[]): LapHistoryEntry[] {
  return laps.filter(
    (l) => isLapValid(l["lap-valid-bit-flags"]) && l["lap-time-in-ms"] > 0,
  );
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

export interface CleanRaceLapSample {
  lapNumber: number;
  lap: LapHistoryEntry;
  timeMs: number;
  compound?: string;
}

/**
 * Per-component damage thresholds (in % of full destruction) above which a lap
 * is considered "damaged" and dropped from race-pace samples.
 *
 * Damage is read from `per-lap-info[].car-damage-data`, which is the damage
 * state at the END of that lap. So a lap that BEGINS clean but ends with a
 * smashed front wing is excluded (the slow time came from the incident, not
 * driver pace), and the lap after — driven with the same damage if not
 * pitted — is also excluded (its slow pace reflects the broken car, not the
 * driver). A pit-stop repair clears the flag for subsequent laps.
 *
 * Thresholds are intentionally conservative — a couple of percent of front
 * wing damage barely shows up in lap time, so excluding those would throw
 * away good evidence. Floor / diffuser / sidepod have lower bars because
 * they affect aero across the whole lap. Engine / gearbox sit higher because
 * they degrade gradually over a race and routinely sit at 5–10% on a normal
 * stint without meaningfully slowing the car.
 */
const LAP_DAMAGE_THRESHOLDS = {
  frontWing: 15,
  rearWing: 15,
  floor: 5,
  diffuser: 5,
  sidepod: 5,
  engine: 25,
  gearbox: 25,
} as const;

function isLapDamaged(damage: CarDamage | undefined): boolean {
  if (!damage) return false;
  if (damage["front-left-wing-damage"] > LAP_DAMAGE_THRESHOLDS.frontWing)
    return true;
  if (damage["front-right-wing-damage"] > LAP_DAMAGE_THRESHOLDS.frontWing)
    return true;
  if (damage["rear-wing-damage"] > LAP_DAMAGE_THRESHOLDS.rearWing) return true;
  if (damage["floor-damage"] > LAP_DAMAGE_THRESHOLDS.floor) return true;
  if (damage["diffuser-damage"] > LAP_DAMAGE_THRESHOLDS.diffuser) return true;
  if (damage["sidepod-damage"] > LAP_DAMAGE_THRESHOLDS.sidepod) return true;
  if (
    damage["engine-damage"] != null &&
    damage["engine-damage"] > LAP_DAMAGE_THRESHOLDS.engine
  )
    return true;
  if (
    damage["gear-box-damage"] != null &&
    damage["gear-box-damage"] > LAP_DAMAGE_THRESHOLDS.gearbox
  )
    return true;
  return false;
}

/**
 * Get "clean" race laps for computing race pace.
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
 *  4. Exclude laps run with significant damage — per-lap damage state from
 *     `per-lap-info[].car-damage-data`. A lap with a broken front wing or
 *     ripped floor is not representative pace; including it would inflate
 *     pace deltas vs. healthier rivals (especially relevant for the
 *     same-compound rival benchmark on the Track page and the dashboard
 *     Rivals & Teammates cards).
 *  5. Apply 1.2× median safety net — catches unlabeled incidents (spins,
 *     off-tracks, rejoins) that the game still marks as green-flag. These
 *     have no telemetry flag, so statistical filtering is the only option
 *     (confirmed with ashwin_nat from Pits n' Giggles, 2026-02).
 *
 * Why not just use the median filter alone (previous approach)?
 *  - It included formation laps and "SC entry" laps that were close enough
 *    to the median to sneak through (e.g. 1:13.6 on a 1:12.8 median).
 *  - It included pit-in laps at long tracks where the pit entry time loss
 *    was under 20% of the median (e.g. Spa pit-in at 1:15 vs 1:12 median).
 *  - It included laps with light damage where pace dropped just enough to
 *    skew rival pace deltas without tripping the 20% safety net.
 *  - Rankings were noticeably different (and less accurate) compared to
 *    explicit SC/pit filtering on sessions with safety car periods.
 */
export function getCleanRaceLapSamples(d: DriverData): CleanRaceLapSample[] {
  const laps = d["session-history"]["lap-history-data"];
  const perLapInfo = d["per-lap-info"] ?? [];
  const pitLaps = getPitLapNumbers(d);
  const compoundByLap = getLapCompoundMap(d);

  const clean: CleanRaceLapSample[] = [];
  for (let i = 1; i < laps.length; i++) {
    const lap = laps[i];
    const lapNum = i + 1; // lap-history-data is 0-indexed, lap numbers are 1-indexed

    // Must be a valid lap with a recorded time
    if (!isLapValid(lap["lap-valid-bit-flags"]) || lap["lap-time-in-ms"] <= 0)
      continue;

    // Exclude SC/VSC/formation laps
    const pli = perLapInfo.find((p) => p["lap-number"] === lapNum);
    const scStatus = pli?.["max-safety-car-status"] ?? "NO_SAFETY_CAR";
    if (scStatus !== "NO_SAFETY_CAR") continue;

    // Exclude pit in/out laps
    if (pitLaps.has(lapNum)) continue;

    // Exclude laps where the car ended the lap with meaningful damage. This
    // catches the incident lap itself AND any subsequent laps driven with
    // the same damage (until a pit repair clears it).
    if (isLapDamaged(pli?.["car-damage-data"])) continue;

    clean.push({
      lapNumber: lapNum,
      lap,
      timeMs: lap["lap-time-in-ms"],
      compound: compoundByLap.get(lapNum),
    });
  }

  if (clean.length < 3) return clean;

  // Final safety net: 1.2× median catches unlabeled incidents (spins, off-tracks)
  const baseline = median(clean.map((sample) => sample.timeMs));
  if (baseline == null) return clean;
  const threshold = baseline * 1.2;
  return clean.filter((sample) => sample.timeMs <= threshold);
}

export function getCleanRaceLaps(d: DriverData): LapHistoryEntry[] {
  return getCleanRaceLapSamples(d).map((sample) => sample.lap);
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
