import type {
  DriverData,
  TyreStint,
  TyreStintBasic,
  TyreWearEntry,
} from "../../types/telemetry";

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

/** Worst-wheel wear % at which puncture risk starts */
export const PUNCTURE_THRESHOLD = 75;

/** Estimate max tyre life (laps) before hitting puncture threshold */
export function estimateMaxLife(wearRatePerLap: number): number {
  return wearRatePerLap > 0
    ? Math.round(PUNCTURE_THRESHOLD / wearRatePerLap)
    : 0;
}
