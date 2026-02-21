import type {
  TelemetrySession,
  DriverData,
  LapHistoryEntry,
  PerLapInfo,
  TyreStint,
  TyreWearEntry,
} from "../types/telemetry";
import { isLapValid } from "./format";

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
  const sorted = [...times].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  const threshold = median * 1.2;
  return valid.filter((l) => l["lap-time-in-ms"] <= threshold);
}

/**
 * Get pit in/out lap numbers from a driver's tyre stint history.
 * The last lap of each stint (except the final one) is the pit-in lap,
 * and the first lap of the next stint is the pit-out lap.
 */
function getPitLapNumbers(d: DriverData): Set<number> {
  const stints = d["tyre-set-history"] ?? [];
  const pitLaps = new Set<number>();
  for (let i = 0; i < stints.length - 1; i++) {
    const endLap = stints[i]["end-lap"];
    pitLaps.add(endLap);     // pit-in lap (slow entry into pits)
    pitLaps.add(endLap + 1); // pit-out lap (slow exit from pits)
  }
  return pitLaps;
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
 *  4. Apply 1.2× median safety net — catches unlabeled incidents (spins,
 *     off-tracks, rejoins) that the game still marks as green-flag. These
 *     have no telemetry flag, so statistical filtering is the only option
 *     (confirmed with ashwin_nat from Pits n' Giggles, 2026-02).
 *
 * Why not just use the median filter alone (previous approach)?
 *  - It included formation laps and "SC entry" laps that were close enough
 *    to the median to sneak through (e.g. 1:13.6 on a 1:12.8 median).
 *  - It included pit-in laps at long tracks where the pit entry time loss
 *    was under 20% of the median (e.g. Spa pit-in at 1:15 vs 1:12 median).
 *  - Rankings were noticeably different (and less accurate) compared to
 *    explicit SC/pit filtering on sessions with safety car periods.
 */
export function getCleanRaceLaps(d: DriverData): LapHistoryEntry[] {
  const laps = d["session-history"]["lap-history-data"];
  const perLapInfo = d["per-lap-info"] ?? [];
  const pitLaps = getPitLapNumbers(d);

  const clean: LapHistoryEntry[] = [];
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

    clean.push(lap);
  }

  if (clean.length < 3) return clean;

  // Final safety net: 1.2× median catches unlabeled incidents (spins, off-tracks)
  const times = clean.map((l) => l["lap-time-in-ms"]);
  const sorted = [...times].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  const threshold = median * 1.2;
  return clean.filter((l) => l["lap-time-in-ms"] <= threshold);
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
  return session["session-info"]["session-type"] === "Race";
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

/** Find the best driver on a given compound within an overlapping lap range */
export function getBestDriverOnCompound(
  drivers: DriverData[],
  compound: string,
  lapStart: number,
  lapEnd: number,
): { driver: DriverData; stint: TyreStint; wearRate: number } | undefined {
  let best:
    | { driver: DriverData; stint: TyreStint; wearRate: number }
    | undefined;

  for (const driver of drivers) {
    for (const stint of driver["tyre-set-history"]) {
      if (stint["tyre-set-data"]["visual-tyre-compound"] !== compound) continue;
      // Check overlap
      if (stint["end-lap"] < lapStart || stint["start-lap"] > lapEnd) continue;
      const rate = stintWearRate(stint);
      if (rate > 0 && (!best || rate < best.wearRate)) {
        best = { driver, stint, wearRate: rate };
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
      s1Delta:
        (pLap["sector-1-time-in-ms"] - rLap["sector-1-time-in-ms"]) / 1000,
      s2Delta:
        (pLap["sector-2-time-in-ms"] - rLap["sector-2-time-in-ms"]) / 1000,
      s3Delta:
        (pLap["sector-3-time-in-ms"] - rLap["sector-3-time-in-ms"]) / 1000,
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
        { key: "sector-1-time-in-ms" as const, label: "S1" },
        { key: "sector-2-time-in-ms" as const, label: "S2" },
        { key: "sector-3-time-in-ms" as const, label: "S3" },
      ];

      const parts: string[] = [];
      let gains = 0;
      let losses = 0;
      for (const { key, label } of sectorKeys) {
        const pAvg = playerCleanLaps.reduce((s, l) => s + l[key], 0) / playerCleanLaps.length;
        const rAvg = rivalCleanLaps.reduce((s, l) => s + l[key], 0) / rivalCleanLaps.length;
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
    const playerErs = avgErsDeployPct(player);
    const rivalErs = avgErsDeployPct(rival);
    if (playerErs > 0 && rivalErs > 0) {
      const delta = playerErs - rivalErs;
      insights.push({
        type: "ers",
        label: "ERS Deploy",
        value: `${delta <= 0 ? "" : "+"}${delta.toFixed(1)}%`,
        detail: `avg per lap vs ${rivalName} (${playerErs.toFixed(1)}% vs ${rivalErs.toFixed(1)}%)`,
        tooltip:
          "Average % of ERS battery deployed per lap (green-flag laps only, excluding first and last lap). Higher deployment = less energy wasted.",
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
      const avg = avgErsDeployPct(d);
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
        detail: `of ${ersRanking.length} — ${playerErs.toFixed(1)}% avg per lap`,
        tooltip:
          "Average % of ERS battery deployed per lap (green-flag laps only, excluding first and last lap). Higher deployment = better rank — deploying more means less energy left on the table.",
        rank: ersPos,
        rankTotal: ersRanking.length,
      });
    }

    // 5. Weakest & strongest sector (avg vs avg across all drivers, clean laps)
    const playerCleanLaps2 = getCleanRaceLaps(player);
    if (playerCleanLaps2.length > 0) {
      const sectorKeys = [
        { key: "sector-1-time-in-ms" as const, label: "S1" },
        { key: "sector-2-time-in-ms" as const, label: "S2" },
        { key: "sector-3-time-in-ms" as const, label: "S3" },
      ];

      const sectorRankings: {
        label: string;
        pos: number;
        total: number;
        delta: number;
        bestDriver: string;
        deltaToP2: number;
        p2Driver: string;
      }[] = [];

      for (const { key, label } of sectorKeys) {
        const ranking: { driver: DriverData; avg: number }[] = [];
        for (const d of allDrivers) {
          const clean = getCleanRaceLaps(d);
          if (!clean.length) continue;
          const avg =
            clean.reduce((s, l) => s + l[key], 0) / clean.length;
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
  suggestedKg: number;
  suggestedLaps: number;
}

/** True when a lap ran under normal green-flag racing conditions */
function isGreenFlagLap(lap: PerLapInfo): boolean {
  return (lap["max-safety-car-status"] ?? "NO_SAFETY_CAR") === "NO_SAFETY_CAR";
}

/**
 * Average ERS deployment % per lap for a driver (green-flag laps only,
 * excluding first and last lap).
 * Returns 0 if insufficient data.
 *
 * Known ERS telemetry issue (confirmed by ashwin_nat): ERS deployed/harvested
 * reset to 0 at the start of every lap (CAR_STATUS packet), but the lap number
 * change comes from a separate LAP_DATA packet. There's no guarantee CAR_STATUS
 * arrives after LAP_DATA, so some laps get captured with the post-reset value.
 * Fuel doesn't have this issue because it only decreases (no reset).
 * We exclude laps below 5% as these are capture artifacts, not real data.
 */
export function avgErsDeployPct(d: DriverData): number {
  const perLap = d["per-lap-info"] ?? [];
  if (perLap.length < 3) return 0;
  // Exclude first lap (index 0), last lap, and SC/VSC laps
  const eligible = perLap.slice(1, -1).filter(isGreenFlagLap);
  const pcts: number[] = [];
  for (const lap of eligible) {
    const cs = lap["car-status-data"];
    const deployed = cs?.["ers-deployed-this-lap"] ?? 0;
    const cap = cs?.["ers-max-capacity"] ?? 0;
    if (cap > 0) {
      const pct = (deployed / cap) * 100;
      // Skip near-zero laps — telemetry capture gap, not real data
      if (pct >= 5) pcts.push(pct);
    }
  }
  if (pcts.length === 0) return 0;
  return pcts.reduce((a, b) => a + b, 0) / pcts.length;
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

  // Build per-lap fuel deltas, keeping only consecutive green-flag pairs
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

  if (deltas.length < 3) return null;

  // Median is more robust than mean against pit-in/out laps or one-off spikes
  deltas.sort((a, b) => a - b);
  const mid = Math.floor(deltas.length / 2);
  const burnRateKg =
    deltas.length % 2 === 0
      ? (deltas[mid - 1] + deltas[mid]) / 2
      : deltas[mid];

  if (burnRateKg <= 0) return null;

  const firstLap = lapsWithFuel[0];
  const lastLap = lapsWithFuel[lapsWithFuel.length - 1];

  const startFuelKg = firstLap["car-status-data"]["fuel-in-tank"];
  const startFuelLaps = startFuelKg / burnRateKg;
  const startFuelRemaining = firstLap["car-status-data"]["fuel-remaining-laps"];
  const endFuelKg = lastLap["car-status-data"]["fuel-in-tank"];
  const fuelRemainingLaps = lastLap["car-status-data"]["fuel-remaining-laps"];
  const lastLapNumber = lastLap["lap-number"] as number;
  const suggestedLaps = startFuelLaps - fuelRemainingLaps;
  const suggestedKg = suggestedLaps * burnRateKg;

  return {
    burnRateKg,
    greenFlagLapCount: deltas.length,
    startFuelKg,
    startFuelLaps,
    startFuelRemaining,
    endFuelKg,
    fuelRemainingLaps,
    lastLapNumber,
    suggestedKg,
    suggestedLaps,
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
  if (!result) return [];

  const {
    burnRateKg, greenFlagLapCount, startFuelRemaining, lastLapNumber,
  } = result;

  const insights: StrategyInsight[] = [];

  // Row 1: Fuel Load — always shown
  insights.push({
    type: "fuel",
    label: "Initial Fuel",
    value: `${formatLapDelta(startFuelRemaining)} laps`,
    detail: `${Math.round(result.startFuelKg)} kg — ${burnRateKg.toFixed(2)} kg/lap avg`,
  });

  // Row 2: Fuel Recommendation — always uses our green-flag burn rate
  // (avoids SC/VSC laps inflating the excess and skewing the recommendation)
  if (greenFlagLapCount >= 5) {
    const endFuelRemaining = result.endFuelKg / burnRateKg;
    const raceComplete = lastLapNumber >= totalRaceLaps - 2;
    if (!raceComplete) {
      const lapsToGo = totalRaceLaps - lastLapNumber;
      const projectedKg = result.endFuelKg - burnRateKg * lapsToGo;
      const projectedRemaining = projectedKg / burnRateKg;
      const recommended = startFuelRemaining - projectedRemaining;
      let detail: string;
      if (Math.abs(projectedRemaining) < 0.3) {
        detail = "fuel load was spot on";
      } else if (projectedRemaining > 0) {
        detail = `projected ${formatLapDelta(projectedRemaining)} excess (${greenFlagLapCount} green laps)`;
      } else {
        detail = `projected ${formatLapDelta(projectedRemaining)} short (${greenFlagLapCount} green laps)`;
      }
      insights.push({
        type: "fuel",
        label: "Recommended Fuel",
        value: `${formatLapDelta(recommended)} laps`,
        detail,
      });
    } else {
      const recommended = startFuelRemaining - endFuelRemaining;
      let detail: string;
      if (Math.abs(endFuelRemaining) < 0.3) {
        detail = "fuel load was spot on";
      } else if (endFuelRemaining > 0) {
        detail = `${formatLapDelta(endFuelRemaining)} excess at finish (green-flag pace)`;
      } else {
        detail = `${formatLapDelta(endFuelRemaining)} short at finish (green-flag pace)`;
      }
      insights.push({
        type: "fuel",
        label: "Recommended Fuel",
        value: `${formatLapDelta(recommended)} laps`,
        detail,
      });
    }
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
      { key: "sector-1-time-in-ms" as const, label: "S1" },
      { key: "sector-2-time-in-ms" as const, label: "S2" },
      { key: "sector-3-time-in-ms" as const, label: "S3" },
    ];

    const sectorRankings: {
      label: string;
      pos: number;
      total: number;
      delta: number;
      bestDriver: string;
      deltaToP2: number;
      p2Driver: string;
    }[] = [];

    for (const { key, label } of sectorKeys) {
      const ranking: { driver: DriverData; best: number }[] = [];
      for (const d of allDrivers) {
        const valid = getValidLaps(d["session-history"]["lap-history-data"]);
        if (!valid.length) continue;
        const best = Math.min(...valid.map((l) => l[key]));
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
    const bestS1 = Math.min(...playerValid.map((l) => l["sector-1-time-in-ms"]));
    const bestS2 = Math.min(...playerValid.map((l) => l["sector-2-time-in-ms"]));
    const bestS3 = Math.min(...playerValid.map((l) => l["sector-3-time-in-ms"]));
    const theoretical = bestS1 + bestS2 + bestS3;
    const actualBest = getBestLapTime(player["session-history"]["lap-history-data"]);
    if (actualBest > 0 && theoretical < actualBest) {
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

  return insights;
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
  const currentS1 = Math.min(
    ...valid.map((l) => l["sector-1-time-in-ms"]).filter((v) => v > 0),
  );
  const currentS2 = Math.min(
    ...valid.map((l) => l["sector-2-time-in-ms"]).filter((v) => v > 0),
  );
  const currentS3 = Math.min(
    ...valid.map((l) => l["sector-3-time-in-ms"]).filter((v) => v > 0),
  );

  if (pbs.bestS1Ms > 0 && pbs.bestS2Ms > 0 && pbs.bestS3Ms > 0) {
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
  avgFuelRemainingLaps: number;
  suggestedFuelKg: number;
  suggestedFuelLaps: number;
  raceCount: number;
}

/** Aggregate fuel data across all race sessions at a track */
export function aggregateFuelData(
  sessions: TelemetrySession[],
): TrackFuelStats | null {
  const results: FuelCalcResult[] = [];

  for (const session of sessions) {
    if (!isRaceSession(session)) continue;
    const player = findPlayer(session);
    if (!player) continue;
    const result = calculateBurnRate(player);
    if (result) results.push(result);
  }

  if (results.length === 0) return null;

  const avg = (arr: number[]) => arr.reduce((a, b) => a + b, 0) / arr.length;

  return {
    avgBurnRateKgPerLap: avg(results.map((r) => r.burnRateKg)),
    avgStartingFuelKg: avg(results.map((r) => r.startFuelKg)),
    avgFuelRemainingLaps: avg(results.map((r) => r.fuelRemainingLaps)),
    suggestedFuelKg: avg(results.map((r) => r.suggestedKg)),
    suggestedFuelLaps: avg(results.map((r) => r.suggestedLaps)),
    raceCount: results.length,
  };
}
