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
    const startLap =
      i === 0 ? 1 : synthesizedBasicEndLap(basics, i - 1, numLaps) + 1;
    const endLap = synthesizedBasicEndLap(basics, i, numLaps);
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

function synthesizedBasicEndLap(
  basics: TyreStintBasic[],
  index: number,
  numLaps: number,
): number {
  if (index < 0) return 0;
  const basic = basics[index];
  if (!basic) return 0;

  // In compact Codemasters/PnG stint history, non-final `end-lap` is the lap
  // before the pit-in lap. Detailed tyre-set history includes the pit-in lap in
  // the outgoing stint, which is the boundary every pace/pit filter expects.
  const isFinal = index === basics.length - 1;
  const rawEndLap = basic["end-lap"] === 255 ? numLaps : basic["end-lap"];
  const adjustedEndLap = isFinal ? rawEndLap : rawEndLap + 1;
  return Math.max(0, Math.min(numLaps, adjustedEndLap));
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
  const stints = getCompletedStints(getDriverStints(player));
  if (!stints.length) return 0;

  let totalWear = 0;
  let totalLaps = 0;

  for (const stint of stints) {
    const endWear = getWorstStintEndWear(stint);
    if (endWear <= 0) continue;
    totalWear += endWear;
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

export interface StintWearCurvePoint {
  lapNumber: number;
  stintLap: number;
  worstWear: number;
}

/** Worst-wheel wear per completed stint lap, excluding incoming fresh-tyre
 *  snapshots that PnG records on the previous pit boundary lap. */
export function getStintWearCurve(stint: TyreStint): StintWearCurvePoint[] {
  const byStintLap = new Map<number, StintWearCurvePoint>();

  for (const entry of stint["tyre-wear-history"] ?? []) {
    const lapNumber = entry["lap-number"];
    if (lapNumber < stint["start-lap"] || lapNumber > stint["end-lap"]) {
      continue;
    }

    const stintLap = lapNumber - stint["start-lap"] + 1;
    if (stintLap < 1 || stintLap > stint["stint-length"]) continue;

    const worstWear = getWorstWheelWear(entry);
    const existing = byStintLap.get(stintLap);
    if (!existing || worstWear > existing.worstWear) {
      byStintLap.set(stintLap, { lapNumber, stintLap, worstWear });
    }
  }

  return [...byStintLap.values()].sort((a, b) => a.stintLap - b.stintLap);
}

export function getWorstStintEndWear(stint: TyreStint): number {
  return getStintWearCurve(stint).at(-1)?.worstWear ?? 0;
}

export function buildWorstWearByLap(
  stints: readonly TyreStint[] | undefined,
): Map<number, number> {
  const wearByLap = new Map<number, number>();
  for (const stint of stints ?? []) {
    for (const point of getStintWearCurve(stint)) {
      const existing = wearByLap.get(point.lapNumber);
      if (existing == null || point.worstWear > existing) {
        wearByLap.set(point.lapNumber, point.worstWear);
      }
    }
  }
  return wearByLap;
}

export function projectWearFromCurve(
  curve: readonly StintWearCurvePoint[],
  plannedLaps: number,
): number | null {
  if (plannedLaps <= 0 || curve.length === 0) return null;

  const exact = curve.find((point) => point.stintLap === plannedLaps);
  if (exact) return exact.worstWear;

  const before = [...curve]
    .reverse()
    .find((point) => point.stintLap < plannedLaps);
  const after = curve.find((point) => point.stintLap > plannedLaps);

  if (before && after) {
    const progress =
      (plannedLaps - before.stintLap) / (after.stintLap - before.stintLap);
    return before.worstWear + (after.worstWear - before.worstWear) * progress;
  }

  if (!before) {
    const first = curve[0]!;
    return first.stintLap > 0
      ? (first.worstWear / first.stintLap) * plannedLaps
      : first.worstWear;
  }

  const lateWindow = curve.slice(-Math.min(curve.length, 4));
  const lateStart = lateWindow[0]!;
  const lateEnd = lateWindow[lateWindow.length - 1]!;
  const lateRate =
    lateEnd.stintLap > lateStart.stintLap
      ? (lateEnd.worstWear - lateStart.worstWear) /
        (lateEnd.stintLap - lateStart.stintLap)
      : 0;
  const averageRate =
    lateEnd.stintLap > 0 ? lateEnd.worstWear / lateEnd.stintLap : 0;
  // When extrapolating beyond observed laps, use at least the late-stint rate:
  // wear usually accelerates as tyres overheat and slide more near stint end.
  const projectedRate = Math.max(averageRate, lateRate, 0);
  return before.worstWear + (plannedLaps - before.stintLap) * projectedRate;
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
  const playerSeq = getCompoundSequence(getDriverStints(player)).join(",");
  return drivers.filter((d) => {
    if (d.index === player.index) return false;
    const seq = getCompoundSequence(getDriverStints(d)).join(",");
    return seq === playerSeq;
  });
}

/** Calculate avg wear rate (%/lap) for a single stint using worst-wheel metric */
export function stintWearRate(stint: TyreStint): number {
  const lastWear = getWorstStintEndWear(stint);
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
