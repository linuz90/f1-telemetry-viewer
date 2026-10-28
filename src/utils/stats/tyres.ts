import type {
  DriverData,
  PerLapInfo,
  TyreStint,
  TyreStintBasic,
  TyreWearEntry,
} from "../../types/telemetry";
import { median } from "./core";
import { isGreenFlagLap } from "./energy";

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

/** Green-flag wear per lap across the driver's completed stints. */
export function avgWearRate(player: DriverData): number {
  const stints = getCompletedStints(getDriverStints(player));
  const neutralisedLaps = getNeutralisedLaps(player["per-lap-info"]);

  let totalWear = 0;
  let totalLaps = 0;
  for (const stint of stints) {
    const green = getGreenFlagWear(stint, neutralisedLaps);
    totalWear += green.wear;
    totalLaps += green.laps;
  }

  return totalLaps > 0 && totalWear > 0 ? totalWear / totalLaps : 0;
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

/** Laps a Safety Car or VSC touched. `max-safety-car-status` is the worst
 *  state over the lap, so the deployment and restart laps count too. */
export function getNeutralisedLaps(
  perLapInfo: readonly PerLapInfo[] | undefined,
): Set<number> {
  const laps = new Set<number>();
  for (const lap of perLapInfo ?? []) {
    if (!isGreenFlagLap(lap)) laps.add(lap["lap-number"]);
  }
  return laps;
}

export interface GreenFlagWear {
  /** Worst-wheel wear accumulated by green laps only. `stintLap` counts green
   *  laps, so a projection along it reads "after N laps of racing". */
  curve: StintWearCurvePoint[];
  laps: number;
  wear: number;
}

/** Wear a stint's green-flag laps added. A tyre behind the Safety Car or VSC
 *  barely wears, so counting those laps as racing laps flattens the rate: the
 *  Sakhir 26 Oct Soft, fitted under the SC, read 4.6%/lap over its seven laps
 *  but wore 6.3%/lap once racing. */
export function getGreenFlagWear(
  stint: TyreStint,
  neutralisedLaps: ReadonlySet<number>,
): GreenFlagWear {
  const curve: StintWearCurvePoint[] = [];
  let laps = 0;
  let wear = 0;
  const observed = getStintWearCurve(stint);
  let previousLap = stint["start-lap"] - 1;
  let previousWear = getFittedWear(stint, observed[0]);

  for (const point of observed) {
    // A snapshot can span skipped laps; it still measures green wear as long
    // as none of them was neutralised.
    let isGreen = true;
    for (let lap = previousLap + 1; lap <= point.lapNumber; lap++) {
      if (neutralisedLaps.has(lap)) isGreen = false;
    }
    if (isGreen) {
      const delta = point.worstWear - previousWear;
      // A racing lap always wears the tyres, so a dip or a flat lap is a bad
      // snapshot (F2 Losail logs pit-in laps at zero): measure the next one
      // from the last good one.
      if (delta <= 0) continue;
      laps += point.lapNumber - previousLap;
      wear += delta;
      curve.push({
        lapNumber: point.lapNumber,
        stintLap: laps,
        worstWear: wear,
      });
    }
    previousLap = point.lapNumber;
    // Wear never heals, so a dip behind the Safety Car cannot lower the
    // baseline the next green lap is measured from.
    previousWear = Math.max(previousWear, point.worstWear);
  }

  return { curve, laps, wear };
}

/** Worst-wheel wear when the set went on: PnG's snapshot on the lap before
 *  the stint (the formation lap for the opening stint, the incoming set on a
 *  pit lap), else a new set. Measuring from it keeps the formation lap and a
 *  used set's earlier wear out of the first green lap. */
function getFittedWear(
  stint: TyreStint,
  firstPoint: StintWearCurvePoint | undefined,
): number {
  const snapshots = (stint["tyre-wear-history"] ?? [])
    .filter((entry) => entry["lap-number"] === stint["start-lap"] - 1)
    .map(getWorstWheelWear);
  if (snapshots.length === 0 || !firstPoint) return 0;
  const fitted = Math.min(...snapshots);
  // Above the first lap's wear it is the outgoing set, not this one.
  return fitted <= firstPoint.worstWear ? fitted : 0;
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

/** Stint laps until worst-wheel wear reaches `threshold` along one curve:
 *  read off the curve when the stint got there, otherwise projected past its
 *  end the way `projectWearFromCurve` does (late-stint rate, never gentler
 *  than the average). Null without any recorded wear. */
export function projectLapsToWear(
  curve: readonly StintWearCurvePoint[],
  threshold: number,
): number | null {
  const last = curve.at(-1);
  if (!last || last.worstWear <= 0 || last.stintLap <= 0) return null;
  return lapsToReachWear(
    (laps) => projectWearFromCurve(curve, laps),
    threshold,
  );
}

/** Worst-wheel wear after `laps` green laps on a compound: the median of each
 *  stint's own curve projection. Tyre Life and the strategy's projected
 *  stints both read this, so a planned stint reaches the threshold on the lap
 *  the Tyre Life card names. */
export function projectCompoundWear(
  curves: readonly (readonly StintWearCurvePoint[])[],
  laps: number,
): number | null {
  return (
    median(
      curves
        .map((curve) => projectWearFromCurve(curve, laps))
        .filter((wear): wear is number => wear != null),
    ) ?? null
  );
}

export function projectCompoundLapsToWear(
  curves: readonly (readonly StintWearCurvePoint[])[],
  threshold: number,
): number | null {
  return lapsToReachWear(
    (laps) => projectCompoundWear(curves, laps),
    threshold,
  );
}

/** Longest stint worth projecting to. A compound that would outlast it has
 *  too little wear to project from; callers fall back to a linear rate. */
const MAX_PROJECTED_STINT_LAPS = 200;

/** First lap a non-decreasing wear projection reaches `threshold`, with the
 *  crossing interpolated inside that lap and rounded. */
function lapsToReachWear(
  project: (laps: number) => number | null,
  threshold: number,
): number | null {
  let previousWear = 0;
  for (let laps = 1; laps <= MAX_PROJECTED_STINT_LAPS; laps++) {
    const wear = project(laps);
    if (wear == null) return null;
    if (wear >= threshold) {
      const lapFraction =
        wear > previousWear
          ? (threshold - previousWear) / (wear - previousWear)
          : 1;
      return Math.round(laps - 1 + lapFraction);
    }
    previousWear = wear;
  }
  return null;
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

/** Worst-wheel wear per green-flag lap for one stint (`getGreenFlagWear`). */
export function stintWearRate(
  stint: TyreStint,
  neutralisedLaps: ReadonlySet<number>,
): number {
  const green = getGreenFlagWear(stint, neutralisedLaps);
  return green.laps > 0 ? green.wear / green.laps : 0;
}

/** Worst-wheel wear % at which puncture risk starts */
export const PUNCTURE_THRESHOLD = 75;

/** Estimate max tyre life (laps) before hitting puncture threshold */
export function estimateMaxLife(wearRatePerLap: number): number {
  return wearRatePerLap > 0
    ? Math.round(PUNCTURE_THRESHOLD / wearRatePerLap)
    : 0;
}
