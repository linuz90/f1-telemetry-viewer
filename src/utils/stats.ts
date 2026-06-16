import type {
  CarDamage,
  TelemetrySession,
  DriverData,
  LapHistoryEntry,
  PerLapInfo,
  TyreStint,
  TyreStintBasic,
  TyreWearEntry,
} from "../types/telemetry";
import { bestSectorTimeMs, isLapValid, sectorTimeMs } from "./format";
import { isRaceSession as isRaceTelemetrySession } from "./sessionTypes";

/** Find the player driver in a session */
export function findPlayer(session: TelemetrySession): DriverData | undefined {
  return session["classification-data"]?.find((d) => d["is-player"]);
}

/** Find the default focused driver: player > P1 finisher > driver with most laps */
export function findFocusedDriver(session: TelemetrySession): DriverData | undefined {
  const drivers = session["classification-data"] ?? [];

  // 1. Player
  const player = drivers.find((d) => d["is-player"]);
  if (player) return player;

  // 2. P1 finisher
  const p1 = drivers.find((d) => d["final-classification"]?.position === 1);
  if (p1) return p1;

  // 3. Driver with most valid laps
  let best: DriverData | undefined;
  let maxLaps = 0;
  for (const d of drivers) {
    const count = d["session-history"]["lap-history-data"]
      .filter((l) => l["lap-time-in-ms"] > 0).length;
    if (count > maxLaps) {
      maxLaps = count;
      best = d;
    }
  }
  return best;
}

/**
 * Build TyreStint[] from the basic tyre-stints-history-data when
 * the detailed tyre-set-history is missing (short/incomplete sessions).
 */
export function synthesizeStints(
  basics: TyreStintBasic[],
  numLaps: number,
): TyreStint[] {
  return basics.map((b, i) => {
    const startLap = i === 0 ? 1 : basics[i - 1]["end-lap"] + 1;
    // end-lap 255 means "still running" — clamp to actual lap count
    const endLap = b["end-lap"] === 255 ? numLaps : b["end-lap"];
    const stintLength = endLap - startLap + 1;
    return {
      "start-lap": startLap,
      "end-lap": endLap,
      "stint-length": stintLength,
      "fitted-index": i,
      "tyre-set-key": "",
      "tyre-set-data": {
        "actual-tyre-compound": b["tyre-actual-compound"],
        "visual-tyre-compound": b["tyre-visual-compound"],
        wear: 0,
        available: false,
        "recommended-session": "",
        "life-span": stintLength,
        "usable-life": stintLength,
        "lap-delta-time": 0,
        fitted: true,
      },
      "tyre-wear-history": [],
    };
  });
}

/** Get stints for a driver, falling back to basic stint data when detailed history is missing */
export function getDriverStints(driver: DriverData): TyreStint[] {
  if (driver["tyre-set-history"]?.length) return driver["tyre-set-history"];
  const basics = driver["session-history"]["tyre-stints-history-data"];
  if (!basics?.length) return [];
  return synthesizeStints(basics, driver["session-history"]["num-laps"]);
}

/** Build a lap-number → visual compound lookup from the driver's stint history. */
export function getLapCompoundMap(driver: DriverData): Map<number, string> {
  const map = new Map<number, string>();
  for (const stint of getDriverStints(driver)) {
    const compound = stint["tyre-set-data"]["visual-tyre-compound"];
    for (let lap = stint["start-lap"]; lap <= stint["end-lap"]; lap++) {
      map.set(lap, compound);
    }
  }
  return map;
}

/** Drop the last stint if it's a single incomplete lap (e.g. DNF retirement) */
export function getCompletedStints(stints: TyreStint[]): TyreStint[] {
  if (stints.length <= 1) return stints;
  const last = stints[stints.length - 1];
  if (last["stint-length"] <= 1) return stints.slice(0, -1);
  return stints;
}

/** Get valid laps for a driver */
export function getValidLaps(laps: LapHistoryEntry[]): LapHistoryEntry[] {
  return laps.filter(
    (l) => isLapValid(l["lap-valid-bit-flags"]) && l["lap-time-in-ms"] > 0,
  );
}

function median(values: number[]): number | undefined {
  if (values.length === 0) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1]! + sorted[mid]!) / 2
    : sorted[mid];
}

/** Median lap time in ms. Returns 0 for empty inputs to match existing pace helpers. */
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
    pitLaps.add(endLap);     // pit-in lap (slow entry into pits)
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

/** Calculate average tyre wear rate (% per lap) across all stints */
export function avgWearRate(player: DriverData): number {
  const stints = getCompletedStints(player["tyre-set-history"] ?? []);
  if (!stints.length) return 0;

  let totalWear = 0;
  let totalLaps = 0;

  for (const stint of stints) {
    const history = stint["tyre-wear-history"];
    if (history.length < 2) continue;

    const lastEntry = history[history.length - 1];
    totalWear += lastEntry.average;
    totalLaps += stint["stint-length"];
  }

  return totalLaps > 0 ? totalWear / totalLaps : 0;
}

/** Check if a session is a race (vs qualifying) */
export function isRaceSession(session: TelemetrySession): boolean {
  return isRaceTelemetrySession(session);
}

// --- Comparison utilities ---

/** Find the race winner (P1 finisher) */
export function findRaceWinner(
  session: TelemetrySession,
): DriverData | undefined {
  return session["classification-data"]?.find(
    (d) => d["final-classification"]?.position === 1,
  );
}

/** Find the closest rival (±1 position from player) */
export function findClosestRival(
  session: TelemetrySession,
  playerPosition: number,
): DriverData | undefined {
  const drivers = session["classification-data"] ?? [];
  // Prefer the driver just ahead (position - 1), fall back to behind
  return (
    drivers.find(
      (d) => d["final-classification"]?.position === playerPosition - 1,
    ) ??
    drivers.find(
      (d) => d["final-classification"]?.position === playerPosition + 1,
    )
  );
}

/** Find the driver who set the fastest lap (from session records) */
export function findFastestLapDriver(
  session: TelemetrySession,
): DriverData | undefined {
  const driverIndex = session.records?.fastest?.lap?.["driver-index"];
  if (driverIndex == null) return undefined;
  return session["classification-data"]?.find((d) => d.index === driverIndex);
}

/** Get the worst (max) wheel wear from a single TyreWearEntry */
export function getWorstWheelWear(entry: TyreWearEntry): number {
  return Math.max(
    entry["front-left-wear"],
    entry["front-right-wear"],
    entry["rear-left-wear"],
    entry["rear-right-wear"],
  );
}

/** Get the compound sequence for a driver's stints */
function getCompoundSequence(stints: TyreStint[]): string[] {
  return stints.map((s) => s["tyre-set-data"]["visual-tyre-compound"]);
}

/** Find drivers who used the same tyre strategy (same compound sequence) */
export function findSameStrategyDrivers(
  drivers: DriverData[],
  player: DriverData,
): DriverData[] {
  const playerSeq = getCompoundSequence(player["tyre-set-history"]).join(",");
  return drivers.filter((d) => {
    if (d.index === player.index) return false;
    const seq = getCompoundSequence(d["tyre-set-history"]).join(",");
    return seq === playerSeq;
  });
}

/** Calculate avg wear rate (%/lap) for a single stint using worst-wheel metric */
export function stintWearRate(stint: TyreStint): number {
  const history = stint["tyre-wear-history"];
  if (history.length < 2) return 0;
  const lastWear = getWorstWheelWear(history[history.length - 1]);
  return stint["stint-length"] > 0 ? lastWear / stint["stint-length"] : 0;
}

/** Find the fastest same-compound driver within an overlapping lap range. */
export function getBestDriverOnCompound(
  drivers: DriverData[],
  compound: string,
  lapStart: number,
  lapEnd: number,
): {
  driver: DriverData;
  stint: TyreStint;
  wearRate: number;
  paceMs: number;
  lapStart: number;
  lapEnd: number;
} | undefined {
  let best:
    | {
        driver: DriverData;
        stint: TyreStint;
        wearRate: number;
        paceMs: number;
        lapStart: number;
        lapEnd: number;
      }
    | undefined;

  for (const driver of drivers) {
    const laps = driver["session-history"]["lap-history-data"];
    for (const stint of getDriverStints(driver)) {
      if (stint["tyre-set-data"]["visual-tyre-compound"] !== compound) continue;
      if (stint["end-lap"] < lapStart || stint["start-lap"] > lapEnd) continue;
      const overlapStart = Math.max(stint["start-lap"], lapStart);
      const overlapEnd = Math.min(stint["end-lap"], lapEnd);
      if (overlapEnd - overlapStart + 1 < 3) continue;
      const paceMs = medianPaceInRange(laps, overlapStart, overlapEnd);
      if (paceMs <= 0) continue;
      const rate = stintWearRate(stint);
      if (!best || paceMs < best.paceMs) {
        best = {
          driver,
          stint,
          wearRate: rate,
          paceMs,
          lapStart: overlapStart,
          lapEnd: overlapEnd,
        };
      }
    }
  }

  return best;
}

/** Calculate average pace (ms) for a driver's laps in a range, excluding outliers */
export function avgPaceInRange(
  laps: LapHistoryEntry[],
  startLap: number,
  endLap: number,
): number {
  const clean = filterOutlierLaps(laps.slice(startLap - 1, endLap));
  if (clean.length === 0) return 0;
  return clean.reduce((sum, l) => sum + l["lap-time-in-ms"], 0) / clean.length;
}

/** Calculate median pace (ms) for a driver's laps in a range, excluding outliers. */
export function medianPaceInRange(
  laps: LapHistoryEntry[],
  startLap: number,
  endLap: number,
): number {
  return medianLapTimeMs(filterOutlierLaps(laps.slice(startLap - 1, endLap)));
}

/** Calculate pace drop: avg of last N laps minus avg of first N laps (ms) */
export function paceDrop(
  laps: LapHistoryEntry[],
  startLap: number,
  endLap: number,
  n = 5,
): number {
  const clean = filterOutlierLaps(laps.slice(startLap - 1, endLap));
  if (clean.length < n * 2) return 0;
  const firstN = clean.slice(0, n);
  const lastN = clean.slice(-n);
  const avgFirst =
    firstN.reduce((s, l) => s + l["lap-time-in-ms"], 0) / firstN.length;
  const avgLast =
    lastN.reduce((s, l) => s + l["lap-time-in-ms"], 0) / lastN.length;
  return avgLast - avgFirst;
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

// --- Insight generation ---

export interface StrategyInsight {
  type: "tyre" | "sector" | "pit" | "pace" | "history" | "fuel" | "speed" | "ers";
  /** Short label shown above the value */
  label: string;
  /** The big prominent value (e.g. "3rd", "1:42.891", "+0.8%/lap") */
  value: string;
  /** Smaller context line below the value */
  detail: string;
  /** Tooltip shown on hover — explains how the value was calculated */
  tooltip?: string;
  /** Ranking position (0-indexed) — used for color coding. undefined = neutral. */
  rank?: number;
  /** Total drivers in ranking — used alongside rank */
  rankTotal?: number;
}

export const RACE_PACE_TOOLTIP =
  "Average lap time excluding lap 1, pit in/out laps, safety car periods, and incident outliers";

/**
 * Top speed for a driver — highest between session-level and per-lap values,
 * with glitch filtering (per-lap speeds > 1.15× the driver's own median are excluded).
 *
 * Known Pits n' Giggles telemetry quirks (reported to ashwin_nat, 2026-02):
 *  1. Session-level "top-speed-kmph" logic is flawed (confirmed by ashwin_nat).
 *     Null for most drivers, wrong for others (e.g. 60 km/h when per-lap says
 *     336). Will be fixed in a future Pits n' Giggles release to use max of
 *     all laps' top speed.
 *  2. Per-lap "top-speed-kmph" is a simple max(current, incoming) per lap, but
 *     the F1 game's UDP export has bugs that can produce glitched values —
 *     e.g. two drivers both showing 486 km/h on the same lap while their other
 *     ~35 laps average ~310.
 *  3. Per-lap values may understate actual top speed due to capture granularity.
 *     The speed trap is at the end of the main straight (Zandvoort speed trap
 *     record: 311.37 km/h, so a 313 max there is reasonable).
 *
 * Workaround: take the highest of session-level and per-lap max, filtering
 * both against 1.15× the driver's per-lap median to exclude glitches.
 */
export function driverTopSpeed(d: DriverData): number {
  const sessionSpeed = d["top-speed-kmph"] ?? 0;
  const perLap = d["per-lap-info"] ?? [];
  const lapSpeeds = perLap
    .map((l) => l["top-speed-kmph"] ?? 0)
    .filter((s) => s > 0);
  if (lapSpeeds.length === 0) return sessionSpeed;
  const sorted = [...lapSpeeds].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  const cap = median * 1.15;
  const clean = lapSpeeds.filter((s) => s <= cap);
  const bestLapSpeed = clean.length > 0 ? Math.max(...clean) : Math.max(...lapSpeeds);
  // Also cap the session-level field against the same threshold
  const safeSessionSpeed = sessionSpeed > 0 && sessionSpeed <= cap ? sessionSpeed : 0;
  return Math.max(bestLapSpeed, safeSessionSpeed);
}

function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

/** Helper: format ms to lap time string */
function msToLapTimeLocal(ms: number): string {
  if (ms <= 0) return "-";
  const minutes = Math.floor(ms / 60000);
  const seconds = ((ms % 60000) / 1000).toFixed(3);
  return minutes > 0 ? `${minutes}:${seconds.padStart(6, "0")}` : seconds;
}

/** Generate strategy insights for the player (race) */
export function generateInsights(
  session: TelemetrySession,
  player: DriverData,
  rival?: DriverData,
): StrategyInsight[] {
  const insights: StrategyInsight[] = [];
  const allDrivers = session["classification-data"] ?? [];

  if (rival) {
    // --- Head-to-head mode ---
    const rivalName = rival["driver-name"];

    // 1. Pace delta vs rival (clean laps — SC/pit/incident excluded)
    const playerClean = getCleanRaceLaps(player);
    const rivalClean = getCleanRaceLaps(rival);
    if (playerClean.length > 0 && rivalClean.length > 0) {
      const playerAvg =
        playerClean.reduce((s, l) => s + l["lap-time-in-ms"], 0) / playerClean.length;
      const rivalAvg =
        rivalClean.reduce((s, l) => s + l["lap-time-in-ms"], 0) / rivalClean.length;
      const delta = (playerAvg - rivalAvg) / 1000;
      insights.push({
        type: "pace",
        label: "Race Pace",
        value: `${delta <= 0 ? "" : "+"}${delta.toFixed(3)}s`,
        detail: delta <= 0
          ? `faster per lap on average vs ${rivalName}`
          : `slower per lap on average vs ${rivalName}`,
        tooltip: RACE_PACE_TOOLTIP,
      });
    }

    // 2. Tyre wear delta vs rival
    const playerRates = getCompletedStints(player["tyre-set-history"])
      .map((s) => stintWearRate(s))
      .filter((r) => r > 0);
    const rivalRates = getCompletedStints(rival["tyre-set-history"])
      .map((s) => stintWearRate(s))
      .filter((r) => r > 0);
    if (playerRates.length > 0 && rivalRates.length > 0) {
      const playerAvgRate = playerRates.reduce((a, b) => a + b, 0) / playerRates.length;
      const rivalAvgRate = rivalRates.reduce((a, b) => a + b, 0) / rivalRates.length;
      const diff = playerAvgRate - rivalAvgRate;
      insights.push({
        type: "tyre",
        label: "Tyre Management",
        value: `${diff <= 0 ? "" : "+"}${diff.toFixed(1)}%/lap`,
        detail: diff <= 0
          ? `less wear per lap vs ${rivalName}`
          : `more wear per lap vs ${rivalName}`,
      });
    }

    // 3. Sector deltas vs rival (all 3 sectors, clean laps only)
    const playerCleanLaps = getCleanRaceLaps(player);
    const rivalCleanLaps = getCleanRaceLaps(rival);
    if (playerCleanLaps.length > 0 && rivalCleanLaps.length > 0) {
      const sectorKeys = [
        { sector: 1, label: "S1" },
        { sector: 2, label: "S2" },
        { sector: 3, label: "S3" },
      ] as const;

      const parts: string[] = [];
      let gains = 0;
      let losses = 0;
      for (const { sector, label } of sectorKeys) {
        const pAvg = playerCleanLaps.reduce((s, l) => s + sectorTimeMs(l, sector), 0) / playerCleanLaps.length;
        const rAvg = rivalCleanLaps.reduce((s, l) => s + sectorTimeMs(l, sector), 0) / rivalCleanLaps.length;
        const d = (pAvg - rAvg) / 1000;
        parts.push(`${label}: ${d <= 0 ? "" : "+"}${d.toFixed(3)}s`);
        if (d < -0.001) gains++;
        if (d > 0.001) losses++;
      }

      insights.push({
        type: "sector",
        label: "Sector Analysis",
        value: parts.join("  "),
        detail: gains > 0 && losses > 0
          ? `gaining in ${gains}, losing in ${losses} vs ${rivalName}`
          : gains === 3
            ? `faster in all sectors vs ${rivalName}`
            : losses === 3
              ? `slower in all sectors vs ${rivalName}`
              : `vs ${rivalName}`,
      });
    }

    // 4. Top speed delta vs rival
    const playerTopSpeed = driverTopSpeed(player);
    const rivalTopSpeed = driverTopSpeed(rival);
    if (playerTopSpeed > 0 && rivalTopSpeed > 0) {
      const delta = Math.round(playerTopSpeed) - Math.round(rivalTopSpeed);
      insights.push({
        type: "speed",
        label: "Top Speed",
        value: `${delta <= 0 ? "" : "+"}${delta} km/h`,
        detail: delta < 0
          ? `slower than ${rivalName} (${Math.round(playerTopSpeed)} vs ${Math.round(rivalTopSpeed)})`
          : delta > 0
            ? `faster than ${rivalName} (${Math.round(playerTopSpeed)} vs ${Math.round(rivalTopSpeed)})`
            : `same as ${rivalName} (${Math.round(playerTopSpeed)} km/h)`,
      });
    }

    // 5. ERS deployment delta vs rival
    const playerErs = avgErsDeployMj(player);
    const rivalErs = avgErsDeployMj(rival);
    if (playerErs > 0 && rivalErs > 0) {
      const delta = playerErs - rivalErs;
      insights.push({
        type: "ers",
        label: "ERS Deploy",
        value: `${delta <= 0 ? "" : "+"}${delta.toFixed(1)} MJ`,
        detail: `avg per lap vs ${rivalName} (${playerErs.toFixed(1)} vs ${rivalErs.toFixed(1)} MJ)`,
        tooltip:
          "Average ERS energy deployed per lap (green-flag laps only, excluding first and last lap).",
      });
    }

    // 6. ERS harvest delta vs rival (lift-and-coast signal in F1 26)
    const playerHarv = avgErsHarvestMj(player);
    const rivalHarv = avgErsHarvestMj(rival);
    if (playerHarv > 0 && rivalHarv > 0) {
      const delta = playerHarv - rivalHarv;
      insights.push({
        type: "ers",
        label: "ERS Harv",
        value: `${delta <= 0 ? "" : "+"}${delta.toFixed(1)} MJ`,
        detail: `avg per lap vs ${rivalName} (${playerHarv.toFixed(1)} vs ${rivalHarv.toFixed(1)} MJ)`,
        tooltip:
          "Average ERS energy harvested per lap, MGU-K + MGU-H combined. Higher values indicate more lift-and-coast.",
      });
    }
  } else {
    // --- Field ranking mode (original behavior) ---

    // 1. Pace ranking (clean laps — SC/pit/incident excluded)
    const paceRanking: { driver: DriverData; avgPace: number }[] = [];
    for (const d of allDrivers) {
      const clean = getCleanRaceLaps(d);
      if (clean.length === 0) continue;
      const avg =
        clean.reduce((s, l) => s + l["lap-time-in-ms"], 0) / clean.length;
      paceRanking.push({ driver: d, avgPace: avg });
    }
    paceRanking.sort((a, b) => a.avgPace - b.avgPace);
    const pacePos = paceRanking.findIndex((r) => r.driver.index === player.index);
    if (pacePos >= 0 && paceRanking.length > 1) {
      const delta = paceRanking[pacePos].avgPace - paceRanking[0].avgPace;
      insights.push({
        type: "pace",
        label: "Race Pace",
        value: ordinal(pacePos + 1),
        detail:
          delta < 10
            ? `of ${paceRanking.length}`
            : `of ${paceRanking.length} — +${(delta / 1000).toFixed(3)}s vs P1`,
        tooltip: RACE_PACE_TOOLTIP,
        rank: pacePos,
        rankTotal: paceRanking.length,
      });
    }

    // 2. Tyre wear ranking
    const wearRanking: { driver: DriverData; avgRate: number }[] = [];
    for (const d of allDrivers) {
      const stints = getCompletedStints(d["tyre-set-history"] ?? []);
      if (!stints.length) continue;
      const rates = stints.map((s) => stintWearRate(s)).filter((r) => r > 0);
      if (rates.length === 0) continue;
      const avg = rates.reduce((a, b) => a + b, 0) / rates.length;
      wearRanking.push({ driver: d, avgRate: avg });
    }
    wearRanking.sort((a, b) => a.avgRate - b.avgRate);
    const wearPos = wearRanking.findIndex(
      (r) => r.driver.index === player.index,
    );
    if (wearPos >= 0 && wearRanking.length > 1) {
      const playerRate = wearRanking[wearPos].avgRate;
      const bestRate = wearRanking[0].avgRate;
      const diff = playerRate - bestRate;
      insights.push({
        type: "tyre",
        label: "Tyre Management",
        value: ordinal(wearPos + 1),
        detail:
          diff < 0.05
            ? `of ${wearRanking.length}`
            : `of ${wearRanking.length} — +${diff.toFixed(1)}%/lap vs best`,
        rank: wearPos,
        rankTotal: wearRanking.length,
      });
    }

    // 3. Top speed ranking
    const speedRanking: { driver: DriverData; topSpeed: number }[] = [];
    for (const d of allDrivers) {
      const spd = driverTopSpeed(d);
      if (spd > 0) speedRanking.push({ driver: d, topSpeed: spd });
    }
    speedRanking.sort((a, b) => b.topSpeed - a.topSpeed);
    const speedPos = speedRanking.findIndex(
      (r) => r.driver.index === player.index,
    );
    if (speedPos >= 0 && speedRanking.length > 1) {
      const playerSpd = speedRanking[speedPos].topSpeed;
      const delta = speedRanking[0].topSpeed - playerSpd;
      insights.push({
        type: "speed",
        label: "Top Speed",
        value: ordinal(speedPos + 1),
        detail:
          delta < 1
            ? `of ${speedRanking.length} — ${Math.round(playerSpd)} km/h`
            : `of ${speedRanking.length} — ${Math.round(playerSpd)} km/h (${Math.round(delta)} off P1)`,
        tooltip:
          "Session top speed ranking across all drivers",
        rank: speedPos,
        rankTotal: speedRanking.length,
      });
    }

    // 4. ERS deployment ranking
    const ersRanking: { driver: DriverData; avgErs: number }[] = [];
    for (const d of allDrivers) {
      const avg = avgErsDeployMj(d);
      if (avg > 0) ersRanking.push({ driver: d, avgErs: avg });
    }
    ersRanking.sort((a, b) => b.avgErs - a.avgErs); // highest first
    const ersPos = ersRanking.findIndex(
      (r) => r.driver.index === player.index,
    );
    if (ersPos >= 0 && ersRanking.length > 1) {
      const playerErs = ersRanking[ersPos].avgErs;
      insights.push({
        type: "ers",
        label: "ERS Deploy",
        value: ordinal(ersPos + 1),
        detail: `of ${ersRanking.length} — ${playerErs.toFixed(1)} MJ/lap`,
        tooltip:
          "Average ERS energy deployed per lap (green-flag laps only, excluding first and last lap).",
        rank: ersPos,
        rankTotal: ersRanking.length,
      });
    }

    // 5. ERS harvest ranking (lift-and-coast signal in F1 26)
    const harvRanking: { driver: DriverData; avgHarv: number }[] = [];
    for (const d of allDrivers) {
      const avg = avgErsHarvestMj(d);
      if (avg > 0) harvRanking.push({ driver: d, avgHarv: avg });
    }
    harvRanking.sort((a, b) => b.avgHarv - a.avgHarv); // highest first
    const harvPos = harvRanking.findIndex(
      (r) => r.driver.index === player.index,
    );
    if (harvPos >= 0 && harvRanking.length > 1) {
      const playerHarv = harvRanking[harvPos].avgHarv;
      insights.push({
        type: "ers",
        label: "ERS Harv",
        value: ordinal(harvPos + 1),
        detail: `of ${harvRanking.length} — ${playerHarv.toFixed(1)} MJ/lap`,
        tooltip:
          "Average ERS energy harvested per lap, MGU-K + MGU-H combined. Higher values indicate more lift-and-coast.",
        rank: harvPos,
        rankTotal: harvRanking.length,
      });
    }

    // 6. Weakest & strongest sector (avg vs avg across all drivers, clean laps)
    const playerCleanLaps2 = getCleanRaceLaps(player);
    if (playerCleanLaps2.length > 0) {
      const sectorKeys = [
        { sector: 1, label: "S1" },
        { sector: 2, label: "S2" },
        { sector: 3, label: "S3" },
      ] as const;

      const sectorRankings: {
        label: string;
        pos: number;
        total: number;
        delta: number;
        bestDriver: string;
        deltaToP2: number;
        p2Driver: string;
      }[] = [];

      for (const { sector, label } of sectorKeys) {
        const ranking: { driver: DriverData; avg: number }[] = [];
        for (const d of allDrivers) {
          const clean = getCleanRaceLaps(d);
          if (!clean.length) continue;
          const avg =
            clean.reduce((s, l) => s + sectorTimeMs(l, sector), 0) / clean.length;
          if (avg > 0) ranking.push({ driver: d, avg });
        }
        ranking.sort((a, b) => a.avg - b.avg);

        const pos = ranking.findIndex((r) => r.driver.index === player.index);
        if (pos >= 0 && ranking.length > 1) {
          sectorRankings.push({
            label,
            pos,
            total: ranking.length,
            delta: ranking[pos].avg - ranking[0].avg,
            bestDriver: ranking[0].driver["driver-name"],
            deltaToP2: ranking.length > 1 ? ranking[1].avg - ranking[0].avg : 0,
            p2Driver: ranking.length > 1 ? ranking[1].driver["driver-name"] : "",
          });
        }
      }

      if (sectorRankings.length > 0) {
        const worst = [...sectorRankings].sort((a, b) => b.pos - a.pos)[0];
        const best = [...sectorRankings].sort((a, b) => a.pos - b.pos)[0];

        if (worst.pos > 0) {
          insights.push({
            type: "sector",
            label: `Weakest — ${worst.label}`,
            value: ordinal(worst.pos + 1),
            detail:
              worst.delta < 1
                ? `of ${worst.total}`
                : `of ${worst.total} — +${(worst.delta / 1000).toFixed(3)}s vs ${worst.bestDriver}`,
            rank: worst.pos,
            rankTotal: worst.total,
          });
        }

        if (best.pos < worst.pos) {
          const isP1 = best.pos === 0;
          insights.push({
            type: "sector",
            label: `Strongest — ${best.label}`,
            value: ordinal(best.pos + 1),
            detail: isP1
              ? best.deltaToP2 < 1
                ? `of ${best.total}`
                : `of ${best.total} — ${(best.deltaToP2 / 1000).toFixed(3)}s ahead of ${best.p2Driver}`
              : best.delta < 1
                ? `of ${best.total}`
                : `of ${best.total} — +${(best.delta / 1000).toFixed(3)}s vs ${best.bestDriver}`,
            rank: best.pos,
            rankTotal: best.total,
          });
        }
      }
    }
  }

  // 4. Pit timing vs rival
  if (rival) {
    const playerPits = getCompletedStints(player["tyre-set-history"])
      .slice(1)
      .map((s) => s["start-lap"]);
    const rivalPits = getCompletedStints(rival["tyre-set-history"])
      .slice(1)
      .map((s) => s["start-lap"]);

    if (playerPits.length > 0 && rivalPits.length > 0) {
      const diff = playerPits[0] - rivalPits[0];
      if (diff !== 0) {
        const timing = diff > 0 ? "later" : "earlier";
        insights.push({
          type: "pit",
          label: "First Pit Stop",
          value: `Lap ${playerPits[0]}`,
          detail: `${Math.abs(diff)} lap${Math.abs(diff) > 1 ? "s" : ""} ${timing} than ${rival["driver-name"]}`,
        });
      }
    }
  }

  return insights;
}

/** Worst-wheel wear % at which puncture risk starts */
export const PUNCTURE_THRESHOLD = 75;

/** Estimate max tyre life (laps) before hitting puncture threshold */
export function estimateMaxLife(wearRatePerLap: number): number {
  return wearRatePerLap > 0 ? Math.round(PUNCTURE_THRESHOLD / wearRatePerLap) : 0;
}

// ─── Fuel safety knobs ───────────────────────────────────────────────────────
//
// We frame the fuel recommendation as "what slider value would *just* finish
// the race assuming every lap is green-flag" and then add two small safety
// buffers on top, so a literal reading of the chip in a clean race doesn't
// leave you crossing the line on fumes (or DSQ-risk territory).
//
// Both buffers mirror the Pits n' Giggles in-app Fuel Strategy Calculator:
//   https://github.com/ashwin-nat/pits-n-giggles/blob/hotfix-v4.3.0/apps/frontend/js/fuelCalculator.js
// where they appear as `MIN_FUEL_LEVEL` (0.2 kg) and the default `surplusLaps`
// input (0.25 laps), both folded into the "Conservative" strategy output.

/** Unusable fuel that physically can't be burned (F1 cars leave a small
 *  reserve at the bottom of the tank). Matches PnG's `MIN_FUEL_LEVEL`. */
const MIN_FUEL_LEVEL_KG = 0.2;

/** Extra laps of fuel kept as a safety buffer above the "clean-race"
 *  requirement. Matches the default `surplusLaps` input in PnG's
 *  conservative-strategy calculator. */
const FUEL_SURPLUS_LAPS = 0.25;

/** Total safety margin (in laps) to subtract from any "clean-race" excess
 *  projection before turning it into a slider recommendation. Combines the
 *  unusable-fuel reserve (converted to laps at the green-flag burn rate)
 *  and the surplus-laps buffer. */
function fuelSafetyMarginLaps(burnRateKg: number): number {
  return FUEL_SURPLUS_LAPS + MIN_FUEL_LEVEL_KG / burnRateKg;
}

/** Result of a fuel burn-rate calculation for a single race session */
export interface FuelCalcResult {
  burnRateKg: number;
  greenFlagLapCount: number;
  startFuelKg: number;
  startFuelLaps: number;
  /** Game's fuel-remaining-laps at lap 0 — what the player loaded */
  startFuelRemaining: number;
  /** Fuel in tank (kg) at last recorded lap */
  endFuelKg: number;
  /** Game's fuel-remaining-laps at last recorded lap */
  fuelRemainingLaps: number;
  lastLapNumber: number;
}

/** True when a lap ran under normal green-flag racing conditions */
function isGreenFlagLap(lap: PerLapInfo): boolean {
  return (lap["max-safety-car-status"] ?? "NO_SAFETY_CAR") === "NO_SAFETY_CAR";
}

/** Collect per-lap fuel burn deltas (kg) from consecutive green-flag lap
 *  pairs only. Skips SC/VSC/formation laps so the deltas reflect actual
 *  racing burn — the conservative quantity for any fuel-load recommendation. */
function collectGreenFlagBurnDeltas(player: DriverData): number[] {
  const perLap = player["per-lap-info"];
  if (!perLap?.length) return [];
  const lapsWithFuel = perLap.filter(
    (l) => l["car-status-data"]?.["fuel-in-tank"] > 0,
  );
  if (lapsWithFuel.length < 2) return [];
  const deltas: number[] = [];
  for (let i = 1; i < lapsWithFuel.length; i++) {
    const prev = lapsWithFuel[i - 1];
    const curr = lapsWithFuel[i];
    if (!isGreenFlagLap(prev) || !isGreenFlagLap(curr)) continue;
    const delta =
      prev["car-status-data"]["fuel-in-tank"] -
      curr["car-status-data"]["fuel-in-tank"];
    if (delta > 0) deltas.push(delta);
  }
  return deltas;
}

/** ERS energy deployed on a lap, preferring Pits n' Giggles' saved lap aggregate. */
export function ersDeployJForLap(lap: PerLapInfo): number {
  return lap["ers-stats"]?.["ers-deployed-j"] ?? lap["car-status-data"]?.["ers-deployed-this-lap"] ?? 0;
}

export function ersDeployMjForLap(lap: PerLapInfo): number {
  return ersDeployJForLap(lap) / 1_000_000;
}

/** Total ERS energy harvested on a lap (MGU-K + MGU-H combined), in joules.
 *  Prefers Pits n' Giggles' per-lap `ers-stats`; falls back to end-of-lap
 *  car-status snapshots from older exports. Useful for analyzing lift-and-coast
 *  efficiency in F1 26, where harvested energy isn't deploy-capped. */
export function ersHarvestJForLap(lap: PerLapInfo): number {
  const stats = lap["ers-stats"];
  if (stats?.["ers-harv-mguk-j"] != null || stats?.["ers-harv-mguh-j"] != null) {
    return (stats["ers-harv-mguk-j"] ?? 0) + (stats["ers-harv-mguh-j"] ?? 0);
  }
  const car = lap["car-status-data"];
  const mguk = car?.["ers-harvested-this-lap-mguk"] ?? 0;
  const mguh = car?.["ers-harvested-this-lap-mguh"] ?? 0;
  return mguk + mguh;
}

export function ersHarvestMjForLap(lap: PerLapInfo): number {
  return ersHarvestJForLap(lap) / 1_000_000;
}

/**
 * Average ERS deployment in MJ per lap (green-flag laps only, excluding first
 * and last lap). Pits n' Giggles' per-lap `ers-stats` is more reliable than
 * the end-of-lap car-status snapshot for F1 26 and remains optional for older
 * exports.
 */
export function avgErsDeployMj(d: DriverData): number {
  const perLap = d["per-lap-info"] ?? [];
  if (perLap.length < 3) return 0;
  // Exclude first lap (index 0), last lap, and SC/VSC laps
  const eligible = perLap.slice(1, -1).filter(isGreenFlagLap);
  const deployMj: number[] = [];
  for (const lap of eligible) {
    const deployedMj = ersDeployMjForLap(lap);
    // Skip near-zero laps; with car-status fallback these are usually capture
    // gaps around the lap reset rather than useful deployment data.
    if (deployedMj >= 0.2) deployMj.push(deployedMj);
  }
  if (deployMj.length === 0) return 0;
  return deployMj.reduce((a, b) => a + b, 0) / deployMj.length;
}

/** Average ERS harvested in MJ per lap (green-flag laps only, excluding first
 *  and last lap). In F1 26 this is the key signal for lift-and-coast usage. */
export function avgErsHarvestMj(d: DriverData): number {
  const perLap = d["per-lap-info"] ?? [];
  if (perLap.length < 3) return 0;
  const eligible = perLap.slice(1, -1).filter(isGreenFlagLap);
  const harvMj: number[] = [];
  for (const lap of eligible) {
    const mj = ersHarvestMjForLap(lap);
    if (mj >= 0.2) harvMj.push(mj);
  }
  if (harvMj.length === 0) return 0;
  return harvMj.reduce((a, b) => a + b, 0) / harvMj.length;
}

/** Calculate fuel burn rate and related metrics for a player in a race.
 *  Uses the median of per-lap fuel deltas (green-flag laps only) for a burn
 *  rate that's robust against outliers and not skewed by SC/VSC/formation laps. */
export function calculateBurnRate(
  player: DriverData,
): FuelCalcResult | null {
  const perLap = player["per-lap-info"];
  if (!perLap?.length) return null;

  const lapsWithFuel = perLap.filter(
    (l) => l["car-status-data"]?.["fuel-in-tank"] > 0,
  );
  if (lapsWithFuel.length < 6) return null;

  const deltas = collectGreenFlagBurnDeltas(player);
  if (deltas.length < 3) return null;

  const burnRateKg = median(deltas);
  if (burnRateKg == null || burnRateKg <= 0) return null;

  const firstLap = lapsWithFuel[0];
  const lastLap = lapsWithFuel[lapsWithFuel.length - 1];

  const startFuelKg = firstLap["car-status-data"]["fuel-in-tank"];
  const startFuelLaps = startFuelKg / burnRateKg;
  const startFuelRemaining = firstLap["car-status-data"]["fuel-remaining-laps"];
  const endFuelKg = lastLap["car-status-data"]["fuel-in-tank"];
  const fuelRemainingLaps = lastLap["car-status-data"]["fuel-remaining-laps"];
  const lastLapNumber = lastLap["lap-number"] as number;

  return {
    burnRateKg,
    greenFlagLapCount: deltas.length,
    startFuelKg,
    startFuelLaps,
    startFuelRemaining,
    endFuelKg,
    fuelRemainingLaps,
    lastLapNumber,
  };
}

/** Format a lap delta as "+X.X" or "-X.X" */
function formatLapDelta(delta: number): string {
  return delta >= 0 ? `+${delta.toFixed(1)}` : delta.toFixed(1);
}

/** Generate fuel insights for race sessions */
export function generateFuelInsights(
  player: DriverData,
  totalRaceLaps: number,
): StrategyInsight[] {
  const result = calculateBurnRate(player);

  // Not enough data — show placeholder rows explaining why
  if (!result) {
    const perLap = player["per-lap-info"];
    const lapsWithFuel = perLap?.filter(
      (l) => l["car-status-data"]?.["fuel-in-tank"] > 0,
    ).length ?? 0;
    const detail = lapsWithFuel < 6
      ? `need 6+ laps with fuel data, got ${lapsWithFuel}`
      : "need 3+ green-flag lap pairs";
    return [
      { type: "fuel", label: "Initial Fuel", value: "—", detail },
      { type: "fuel", label: "Recommended Fuel", value: "—", detail },
    ];
  }

  const { burnRateKg, greenFlagLapCount, startFuelRemaining } = result;

  const insights: StrategyInsight[] = [];

  // Row 1: Fuel Load — always shown
  insights.push({
    type: "fuel",
    label: "Initial Fuel",
    value: `${formatLapDelta(startFuelRemaining)} laps`,
    detail: `${Math.round(result.startFuelKg)} kg — ${burnRateKg.toFixed(2)} kg/lap avg`,
  });

  // Row 2: Fuel Recommendation — clean-race projection.
  //
  // We deliberately ignore the actual fuel remaining at the chequered flag.
  // Safety-car / VSC laps burn much less than green-flag laps (this race at
  // Catalunya: ~0.7 kg/lap under FSC vs ~1.05 kg/lap green), so any real
  // leftover at the line bakes in fuel saved by SCs that the *next* race
  // probably won't have. The recommendation assumes a worst-case all-green
  // race at the measured green-flag burn rate, then keeps a small safety
  // margin on top (see MIN_FUEL_LEVEL_KG + FUEL_SURPLUS_LAPS) so following
  // it never leaves you stranded in a clean race.
  if (greenFlagLapCount >= 5) {
    // Raw "clean race" excess — what would be left over if every lap burned
    // at the measured green-flag rate. Shown verbatim in the detail line.
    const rawExcessLaps = result.startFuelKg / burnRateKg - totalRaceLaps;
    // Recommendation bakes in a small safety buffer above the bare minimum.
    const recommended =
      startFuelRemaining - (rawExcessLaps - fuelSafetyMarginLaps(burnRateKg));
    let detail: string;
    if (Math.abs(rawExcessLaps) < 0.3) {
      detail = `clean-race fuel load was spot on (${greenFlagLapCount} green laps)`;
    } else if (rawExcessLaps > 0) {
      detail = `${formatLapDelta(rawExcessLaps)} laps spare in a clean race (${greenFlagLapCount} green laps)`;
    } else {
      detail = `${formatLapDelta(rawExcessLaps)} laps short in a clean race (${greenFlagLapCount} green laps)`;
    }
    insights.push({
      type: "fuel",
      label: "Recommended Fuel",
      value: `${formatLapDelta(recommended)} laps`,
      detail,
    });
  } else {
    insights.push({
      type: "fuel",
      label: "Recommended Fuel",
      value: "—",
      detail: `need 5+ green-flag laps, got ${greenFlagLapCount}`,
    });
  }

  return insights;
}

/** Generate qualifying-specific insights for the player */
export function generateQualiInsights(
  session: TelemetrySession,
  player: DriverData,
): StrategyInsight[] {
  const insights: StrategyInsight[] = [];
  const allDrivers = session["classification-data"] ?? [];

  // 1. Best lap ranking
  const lapRanking: { driver: DriverData; bestTime: number }[] = [];
  for (const d of allDrivers) {
    const best = getBestLapTime(d["session-history"]["lap-history-data"]);
    if (best > 0) lapRanking.push({ driver: d, bestTime: best });
  }
  lapRanking.sort((a, b) => a.bestTime - b.bestTime);

  const lapPos = lapRanking.findIndex((r) => r.driver.index === player.index);
  if (lapPos >= 0 && lapRanking.length > 1) {
    const delta = lapRanking[lapPos].bestTime - lapRanking[0].bestTime;
    insights.push({
      type: "pace",
      label: "Qualifying",
      value: ordinal(lapPos + 1),
      detail:
        delta < 1
          ? `of ${lapRanking.length}`
          : `of ${lapRanking.length} — +${(delta / 1000).toFixed(3)}s vs P1`,
      rank: lapPos,
      rankTotal: lapRanking.length,
    });
  }

  // 2. Top speed ranking
  const qualiSpeedRanking: { driver: DriverData; topSpeed: number }[] = [];
  for (const d of allDrivers) {
    const spd = driverTopSpeed(d);
    if (spd > 0) qualiSpeedRanking.push({ driver: d, topSpeed: spd });
  }
  qualiSpeedRanking.sort((a, b) => b.topSpeed - a.topSpeed);
  const qualiSpeedPos = qualiSpeedRanking.findIndex(
    (r) => r.driver.index === player.index,
  );
  if (qualiSpeedPos >= 0 && qualiSpeedRanking.length > 1) {
    const playerSpd = qualiSpeedRanking[qualiSpeedPos].topSpeed;
    const delta = qualiSpeedRanking[0].topSpeed - playerSpd;
    insights.push({
      type: "speed",
      label: "Top Speed",
      value: ordinal(qualiSpeedPos + 1),
      detail:
        delta < 1
          ? `of ${qualiSpeedRanking.length} — ${Math.round(playerSpd)} km/h`
          : `of ${qualiSpeedRanking.length} — ${Math.round(playerSpd)} km/h (${Math.round(delta)} off P1)`,
      tooltip:
        "Session top speed ranking across all drivers",
      rank: qualiSpeedPos,
      rankTotal: qualiSpeedRanking.length,
    });
  }

  // 3. Sector rankings
  const playerValid = getValidLaps(player["session-history"]["lap-history-data"]);
  if (playerValid.length > 0) {
    const sectorKeys = [
      { sector: 1, label: "S1" },
      { sector: 2, label: "S2" },
      { sector: 3, label: "S3" },
    ] as const;

    const sectorRankings: {
      label: string;
      pos: number;
      total: number;
      delta: number;
      bestDriver: string;
      deltaToP2: number;
      p2Driver: string;
    }[] = [];

    for (const { sector, label } of sectorKeys) {
      const ranking: { driver: DriverData; best: number }[] = [];
      for (const d of allDrivers) {
        const valid = getValidLaps(d["session-history"]["lap-history-data"]);
        if (!valid.length) continue;
        const best = bestSectorTimeMs(valid, sector);
        if (best > 0) ranking.push({ driver: d, best });
      }
      ranking.sort((a, b) => a.best - b.best);

      const pos = ranking.findIndex((r) => r.driver.index === player.index);
      if (pos >= 0 && ranking.length > 1) {
        sectorRankings.push({
          label,
          pos,
          total: ranking.length,
          delta: ranking[pos].best - ranking[0].best,
          bestDriver: ranking[0].driver["driver-name"],
          deltaToP2: ranking.length > 1 ? ranking[1].best - ranking[0].best : 0,
          p2Driver: ranking.length > 1 ? ranking[1].driver["driver-name"] : "",
        });
      }
    }

    if (sectorRankings.length > 0) {
      const worst = [...sectorRankings].sort((a, b) => b.pos - a.pos)[0];
      const best = [...sectorRankings].sort((a, b) => a.pos - b.pos)[0];

      if (worst.pos > 0) {
        insights.push({
          type: "sector",
          label: `Weakest — ${worst.label}`,
          value: ordinal(worst.pos + 1),
          detail:
            worst.delta < 1
              ? `of ${worst.total}`
              : `of ${worst.total} — +${(worst.delta / 1000).toFixed(3)}s vs ${worst.bestDriver}`,
          rank: worst.pos,
          rankTotal: worst.total,
        });
      }

      if (best.pos < worst.pos) {
        const isP1 = best.pos === 0;
        insights.push({
          type: "sector",
          label: `Strongest — ${best.label}`,
          value: ordinal(best.pos + 1),
          detail: isP1
            ? best.deltaToP2 < 1
              ? `of ${best.total}`
              : `of ${best.total} — ${(best.deltaToP2 / 1000).toFixed(3)}s ahead of ${best.p2Driver}`
            : best.delta < 1
              ? `of ${best.total}`
              : `of ${best.total} — +${(best.delta / 1000).toFixed(3)}s vs ${best.bestDriver}`,
          rank: best.pos,
          rankTotal: best.total,
        });
      }
    }

    // 4. Theoretical best lap
    const bestS1 = bestSectorTimeMs(playerValid, 1);
    const bestS2 = bestSectorTimeMs(playerValid, 2);
    const bestS3 = bestSectorTimeMs(playerValid, 3);
    const theoretical = bestS1 + bestS2 + bestS3;
    const actualBest = getBestLapTime(player["session-history"]["lap-history-data"]);
    if (bestS1 > 0 && bestS2 > 0 && bestS3 > 0 && actualBest > 0 && theoretical < actualBest) {
      const gap = actualBest - theoretical;
      if (gap >= 10) {
        insights.push({
          type: "pace",
          label: "Theoretical Best",
          value: msToLapTimeLocal(theoretical),
          detail: `${(gap / 1000).toFixed(3)}s left on the table`,
        });
      }
    }
  }

  // 5. Consistency
  if (playerValid.length > 1) {
    const stdDev = lapTimeStdDev(playerValid);
    if (stdDev > 0) {
      const consistencyRanking: { driver: DriverData; stdDev: number }[] = [];
      for (const d of allDrivers) {
        const valid = getValidLaps(d["session-history"]["lap-history-data"]);
        if (valid.length < 2) continue;
        consistencyRanking.push({ driver: d, stdDev: lapTimeStdDev(valid) });
      }
      consistencyRanking.sort((a, b) => a.stdDev - b.stdDev);

      const pos = consistencyRanking.findIndex(
        (r) => r.driver.index === player.index,
      );
      if (pos >= 0 && consistencyRanking.length > 1) {
        insights.push({
          type: "pace",
          label: "Consistency",
          value: ordinal(pos + 1),
          detail: `of ${consistencyRanking.length} — \u00B1${(stdDev / 1000).toFixed(3)}s`,
          rank: pos,
          rankTotal: consistencyRanking.length,
        });
      }
    }
  }

  // 6. ERS harvest ranking — in quali, signals out-lap charging discipline (F1 26)
  const qualiHarv = qualiAvgErsHarvestMj(player);
  if (qualiHarv > 0) {
    const harvRanking: { driver: DriverData; avgHarv: number }[] = [];
    for (const d of allDrivers) {
      const avg = qualiAvgErsHarvestMj(d);
      if (avg > 0) harvRanking.push({ driver: d, avgHarv: avg });
    }
    harvRanking.sort((a, b) => b.avgHarv - a.avgHarv);
    const pos = harvRanking.findIndex((r) => r.driver.index === player.index);
    if (pos >= 0 && harvRanking.length > 1) {
      insights.push({
        type: "ers",
        label: "ERS Harv",
        value: ordinal(pos + 1),
        detail: `of ${harvRanking.length} — ${qualiHarv.toFixed(1)} MJ/lap`,
        tooltip:
          "Average ERS energy harvested per lap, MGU-K + MGU-H combined. In quali this reflects out-lap charging — higher values give more push-lap deploy.",
        rank: pos,
        rankTotal: harvRanking.length,
      });
    }
  }

  return insights;
}

/** Quali variant of avgErsHarvestMj: no SC filtering, no first/last exclusion.
 *  Quali laps are short and structured (out/push/in); averaging every lap with
 *  meaningful harvest captures the driver's overall charging discipline. */
function qualiAvgErsHarvestMj(d: DriverData): number {
  const perLap = d["per-lap-info"] ?? [];
  if (perLap.length === 0) return 0;
  const values: number[] = [];
  for (const lap of perLap) {
    const mj = ersHarvestMjForLap(lap);
    if (mj >= 0.2) values.push(mj);
  }
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/** Historical PB data for a track */
export interface TrackPBData {
  bestQualiLapMs: number;
  bestS1Ms: number;
  bestS2Ms: number;
  bestS3Ms: number;
  bestRaceLapMs: number;
  bestRacePaceMs: number;
  sessionCount: number;
}

/** Generate qualifying insights comparing to personal bests on this track */
export function generateQualiHistoryInsights(
  player: DriverData,
  pbs: TrackPBData,
): StrategyInsight[] {
  const insights: StrategyInsight[] = [];
  const laps = player["session-history"]["lap-history-data"];
  const valid = getValidLaps(laps);
  if (valid.length === 0) return insights;

  const currentBest = getBestLapTime(laps);

  // 1. vs Personal Best lap
  if (currentBest > 0 && pbs.bestQualiLapMs > 0) {
    const delta = currentBest - pbs.bestQualiLapMs;
    if (delta <= 0) {
      insights.push({
        type: "history",
        label: "vs Personal Best",
        value: "New PB!",
        detail:
          delta < 0
            ? `-${(Math.abs(delta) / 1000).toFixed(3)}s improvement`
            : "matched your best",
      });
    } else {
      insights.push({
        type: "history",
        label: "vs Personal Best",
        value: `+${(delta / 1000).toFixed(3)}s`,
        detail: `off your PB of ${msToLapTimeLocal(pbs.bestQualiLapMs)}`,
      });
    }
  }

  // 2. Sector vs PB sectors — show the sector furthest from PB
  const currentS1 = bestSectorTimeMs(valid, 1);
  const currentS2 = bestSectorTimeMs(valid, 2);
  const currentS3 = bestSectorTimeMs(valid, 3);

  if (
    currentS1 > 0 &&
    currentS2 > 0 &&
    currentS3 > 0 &&
    pbs.bestS1Ms > 0 &&
    pbs.bestS2Ms > 0 &&
    pbs.bestS3Ms > 0
  ) {
    const deltas = [
      { sector: "S1", delta: currentS1 - pbs.bestS1Ms },
      { sector: "S2", delta: currentS2 - pbs.bestS2Ms },
      { sector: "S3", delta: currentS3 - pbs.bestS3Ms },
    ].filter((d) => d.delta > 0);

    if (deltas.length > 0) {
      const worst = deltas.sort((a, b) => b.delta - a.delta)[0];
      insights.push({
        type: "history",
        label: "vs PB Sectors",
        value: worst.sector,
        detail: `+${(worst.delta / 1000).toFixed(3)}s vs your all-time best`,
      });
    } else {
      // All sectors matched or beat PB
      const totalGain =
        (pbs.bestS1Ms - currentS1) +
        (pbs.bestS2Ms - currentS2) +
        (pbs.bestS3Ms - currentS3);
      if (totalGain > 0) {
        insights.push({
          type: "history",
          label: "vs PB Sectors",
          value: "All-time bests!",
          detail: `${(totalGain / 1000).toFixed(3)}s gained across sectors`,
        });
      }
    }
  }

  return insights;
}

/** Generate race insights comparing to historical data on this track */
export function generateRaceHistoryInsights(
  player: DriverData,
  pbs: TrackPBData,
): StrategyInsight[] {
  const insights: StrategyInsight[] = [];
  const laps = player["session-history"]["lap-history-data"];
  const clean = getCleanRaceLaps(player);
  if (clean.length === 0) return insights;

  const bestRaceLap = getBestLapTime(laps);

  // 1. Best race lap vs all-time best race lap
  if (bestRaceLap > 0 && pbs.bestRaceLapMs > 0) {
    const delta = bestRaceLap - pbs.bestRaceLapMs;
    if (delta <= 0) {
      insights.push({
        type: "history",
        label: "vs Best Race Lap",
        value: "New PB!",
        detail:
          delta < 0
            ? `-${(Math.abs(delta) / 1000).toFixed(3)}s improvement`
            : "matched your best",
      });
    } else {
      insights.push({
        type: "history",
        label: "vs Best Race Lap",
        value: `+${(delta / 1000).toFixed(3)}s`,
        detail: `off your PB of ${msToLapTimeLocal(pbs.bestRaceLapMs)}`,
      });
    }
  }

  // 2. Race pace vs best-ever race pace (clean laps only)
  if (pbs.bestRacePaceMs > 0) {
    const avgPace =
      clean.reduce((s, l) => s + l["lap-time-in-ms"], 0) / clean.length;
    const delta = avgPace - pbs.bestRacePaceMs;
    if (delta <= 0) {
      insights.push({
        type: "history",
        label: "Race Pace vs Best",
        value: "New best!",
        detail:
          delta < 0
            ? `-${(Math.abs(delta) / 1000).toFixed(3)}s/lap improvement`
            : "matched your best pace",
        tooltip: RACE_PACE_TOOLTIP,
      });
    } else {
      insights.push({
        type: "history",
        label: "Race Pace vs Best",
        value: `+${(delta / 1000).toFixed(3)}s/lap`,
        detail: "off your best average pace",
        tooltip: RACE_PACE_TOOLTIP,
      });
    }
  }

  return insights;
}

// --- Track-level aggregation ---

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
}

/** Minimum stint length to include in aggregate compound stats */
const MIN_STINT_LAPS = 3;

/** Aggregate compound tyre life across all race sessions at a track */
export function aggregateCompoundLife(
  sessions: TelemetrySession[],
): CompoundLifeStats[] {
  const byCompound: Record<string, { rates: number[]; lengths: number[]; bestLapMs: number }> = {};

  for (const session of sessions) {
    if (!isRaceSession(session)) continue;
    const player = findPlayer(session);
    if (!player) continue;

    const laps = player["session-history"]["lap-history-data"];

    for (const stint of player["tyre-set-history"]) {
      if (stint["stint-length"] < MIN_STINT_LAPS) continue;

      const compound = stint["tyre-set-data"]["visual-tyre-compound"];
      const rate = stintWearRate(stint);
      if (rate <= 0) continue;

      if (!byCompound[compound]) byCompound[compound] = { rates: [], lengths: [], bestLapMs: 0 };
      byCompound[compound].rates.push(rate);
      byCompound[compound].lengths.push(stint["stint-length"]);

      // Find best valid lap in this stint
      let lapNum = 0;
      for (const l of laps) {
        if (l["lap-time-in-ms"] > 0) {
          lapNum++;
          if (lapNum >= stint["start-lap"] && lapNum <= stint["end-lap"]) {
            if (isLapValid(l["lap-valid-bit-flags"]) && l["lap-time-in-ms"] > 0) {
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

  return Object.entries(byCompound).map(([compound, { rates, lengths, bestLapMs }]) => {
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
    };
  });
}

/** Fuel stats aggregated across race sessions at a track */
export interface TrackFuelStats {
  avgBurnRateKgPerLap: number;
  avgStartingFuelKg: number;
  /** Average game fuel-remaining-laps at start (matches session "Initial Fuel") */
  avgInitialFuelLaps: number;
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
  raceCount: number;
}

/** Aggregate fuel data across all race sessions at a track.
 *
 *  Two key choices, both aimed at making the chip safe to act on:
 *
 *  1. **Pooled burn rate.** Green-flag fuel deltas from every race at the
 *     track go into a single pool, and the pooled median is the burn rate.
 *     One race rarely has enough green-flag pairs to nail this down; pooling
 *     across (e.g.) 23 Catalunya races gives a much tighter number.
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
  const pooledDeltas: number[] = [];
  const perRace: {
    startFuelKg: number;
    startFuelRemaining: number;
    totalLaps: number;
  }[] = [];

  for (const session of sessions) {
    if (!isRaceSession(session)) continue;
    const player = findPlayer(session);
    if (!player) continue;
    const totalLaps = session["session-info"]["total-laps"];
    if (!(totalLaps > 0)) continue;

    const perLap = player["per-lap-info"];
    const lapsWithFuel = perLap?.filter(
      (l) => l["car-status-data"]?.["fuel-in-tank"] > 0,
    ) ?? [];
    if (lapsWithFuel.length < 6) continue;

    pooledDeltas.push(...collectGreenFlagBurnDeltas(player));

    const firstLap = lapsWithFuel[0];
    perRace.push({
      startFuelKg: firstLap["car-status-data"]["fuel-in-tank"],
      startFuelRemaining: firstLap["car-status-data"]["fuel-remaining-laps"],
      totalLaps,
    });
  }

  // Need a representative pool of green-flag pairs to trust the burn rate.
  // 12 ≈ four races at three pairs each; below that, one weird race could
  // swing the recommendation by a full lap.
  if (perRace.length === 0 || pooledDeltas.length < 12) return null;

  const pooledBurnRateKg = median(pooledDeltas);
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
    (r, i) =>
      r.startFuelRemaining - (excessAtFinish[i]! - safetyMarginLaps),
  );
  // The recommendation collapses to "fuel for totalLaps + safetyMargin" at the
  // pooled burn rate — that's the kg figure the player would set in PnG.
  const recommendedKgPerRace = perRace.map(
    (r) => (r.totalLaps + safetyMarginLaps) * pooledBurnRateKg,
  );

  return {
    avgBurnRateKgPerLap: pooledBurnRateKg,
    avgStartingFuelKg: avg(perRace.map((r) => r.startFuelKg)),
    avgInitialFuelLaps: avg(perRace.map((r) => r.startFuelRemaining)),
    avgRecommendedFuelLaps: avg(recommendedPerRace),
    avgRecommendedFuelKg: avg(recommendedKgPerRace),
    avgExcessAtFinishLaps: avg(excessAtFinish),
    raceCount: perRace.length,
  };
}

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
function isNearFullDistanceRace(session: TelemetrySession, player: DriverData): boolean {
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
    (c) => isDryCompound(c.compound) && c.stintCount > 0 && c.avgWearRatePerLap > 0,
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

function bestCleanRaceLapWithCompound(entries: BucketRaceEntry[]): BestCleanRaceLap | null {
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
      wearRateDelta:
        latestWear > 0 && prevWear > 0 ? latestWear - prevWear : 0,
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

// ────────────────────────────────────────────────────────────────────────────
// Pace Evolution — race-on-race representative pace per compound at one track.
//
// Why "best window" pace (not median, not best lap):
//   • A median across a whole stint is biased against long stints — tyre
//     degradation in the tail drags the number down, so a 5-lap stint looks
//     faster than a 25-lap stint even when the long stint's best window is
//     actually quicker. Unfair race-to-race comparison.
//   • A single best lap is too sensitive to slipstream and one-off flyers.
//   • Averaging the FASTEST N clean laps on that compound treats short and
//     long stints fairly (both contribute their best N-lap window) and
//     filters single-lap noise.
//
// N = REPRESENTATIVE_PACE_WINDOW. 3 is the standard F1-strategy choice for a
// "best representative pace" window: small enough that a 5-lap stint still
// contributes meaningfully, large enough to defang single-flyer slipstream.
//
// Pit/SC/incident laps are already filtered by `getCleanRaceLapSamples`.
// `minLapsPerCompound` gates noisy single-lap samples (default 3).
// ────────────────────────────────────────────────────────────────────────────

const REPRESENTATIVE_PACE_WINDOW = 3;

/**
 * Race context. Distinguishes "clean air" runs from "full grid" runs because
 * the underlying physics differs (dirty air, defensive lines, overtake
 * attempts) and pace numbers aren't directly comparable across them.
 *
 * The split is on EFFECTIVE TRAFFIC, not online/offline: a 2-car online
 * sparring session and a 20-car AI race where the player led the whole way
 * both behave as clean air, while a 20-car AI race fought mid-pack behaves
 * as traffic.
 *
 * Driver count is the first signal; if the player led ≥ LEADER_SHARE_OVERRIDE
 * of their clean laps, the kind is upgraded to "clean-air" regardless of
 * field size (e.g. low-AI grand prix where the user practices in P1).
 */
export type RaceContextKind = "clean-air" | "small-field" | "full-grid";

export interface RaceContext {
  /** Bucket used by the chart filter. */
  kind: RaceContextKind;
  /** Total driver count in the classification list (player + opponents). */
  driverCount: number;
  /** True when `network-game === 1`. */
  isOnline: boolean;
  /** Share of player's clean laps spent in P1 (0..1). 0 when no position data. */
  leaderShare: number;
}

const LEADER_SHARE_OVERRIDE = 0.7;

/**
 * Classify a session's context using only the session-level signals (field
 * size + online flag). Returns leaderShare=0 since per-lap positions aren't
 * inspected here. For the lap-aware variant used by the Pace Evolution chart,
 * see the inline computation in `buildPaceEvolution`.
 */
export function classifyRaceContext(session: TelemetrySession): RaceContext {
  const driverCount = session["classification-data"]?.length ?? 0;
  const isOnline = session["session-info"]?.["network-game"] === 1;
  // Thresholds: ≤3 = clean air (player + 1-2 sparring partners); ≥10 = full
  // grid (the AI/online setup actually creates traffic); the in-between band
  // is real but rare in this app's data.
  const kind: RaceContextKind =
    driverCount <= 3 ? "clean-air" : driverCount >= 10 ? "full-grid" : "small-field";
  return { kind, driverCount, isOnline, leaderShare: 0 };
}

export interface PaceEvolutionPoint {
  /** 1-based session index in chronological order. */
  idx: number;
  /** Tooltip label, e.g. "Race · 14:32". */
  label: string;
  /** Pre-formatted date, e.g. "Sat, 13 Jun 2026". */
  date: string;
  /** Session context (clean air / traffic / online vs offline). */
  context: RaceContext;
  /**
   * Compound → average of the fastest N clean laps on that compound (ms),
   * where N = REPRESENTATIVE_PACE_WINDOW (3). Only compounds with at least
   * `minLapsPerCompound` clean laps are present.
   */
  paces: Record<string, number>;
  /** Compound → total clean-lap count for that compound this session. */
  counts: Record<string, number>;
}

export function buildPaceEvolution(
  inputs: { session: TelemetrySession; date: string | Date }[],
  minLapsPerCompound = 3,
): PaceEvolutionPoint[] {
  return inputs
    .map(({ session, date: rawDate }, i): PaceEvolutionPoint | null => {
      const player = findPlayer(session);
      if (!player) return null;
      const samples = getCleanRaceLapSamples(player);
      const groups = new Map<string, number[]>();
      for (const s of samples) {
        if (!s.compound) continue;
        const arr = groups.get(s.compound) ?? [];
        arr.push(s.timeMs);
        groups.set(s.compound, arr);
      }
      const paces: Record<string, number> = {};
      const counts: Record<string, number> = {};
      for (const [compound, times] of groups) {
        if (times.length < minLapsPerCompound) continue;
        // Mean of the fastest N — see header comment for rationale.
        const sorted = [...times].sort((a, b) => a - b);
        const window = sorted.slice(0, REPRESENTATIVE_PACE_WINDOW);
        const sum = window.reduce((a, b) => a + b, 0);
        paces[compound] = sum / window.length;
        counts[compound] = times.length;
      }
      // Skip sessions that yielded no qualifying compound — keeps the X axis
      // honest about how many sessions actually contribute a data point.
      if (Object.keys(paces).length === 0) return null;
      const date = rawDate instanceof Date ? rawDate : new Date(rawDate);

      // Compute leader share over the player's clean laps. A 20-car AI race
      // where the user led the whole way is effectively clean air — same as a
      // 2-car sparring session. We override `kind` to "clean-air" when the
      // leader share crosses the threshold so the chart filter groups these
      // sessions correctly.
      const perLapInfo = player["per-lap-info"] ?? [];
      const positionByLap = new Map<number, number>();
      for (const pli of perLapInfo) {
        const pos = pli["track-position"];
        if (typeof pos === "number" && pos > 0) {
          positionByLap.set(pli["lap-number"], pos);
        }
      }
      let leaderLaps = 0;
      let positionedLaps = 0;
      for (const s of samples) {
        const pos = positionByLap.get(s.lapNumber);
        if (pos == null) continue;
        positionedLaps++;
        if (pos === 1) leaderLaps++;
      }
      const leaderShare =
        positionedLaps > 0 ? leaderLaps / positionedLaps : 0;

      const baseContext = classifyRaceContext(session);
      const context: RaceContext = {
        ...baseContext,
        leaderShare,
        kind:
          leaderShare >= LEADER_SHARE_OVERRIDE && baseContext.kind !== "clean-air"
            ? "clean-air"
            : baseContext.kind,
      };
      return {
        idx: i + 1,
        context,
        label: `Race · ${date.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}`,
        date: date.toLocaleDateString("en-GB", {
          weekday: "short",
          day: "numeric",
          month: "short",
          year: "numeric",
        }),
        paces,
        counts,
      };
    })
    .filter((p): p is PaceEvolutionPoint => p !== null);
}
