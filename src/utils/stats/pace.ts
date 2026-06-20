import type {
  DriverData,
  LapHistoryEntry,
  TyreStint,
} from "../../types/telemetry";
import { filterOutlierLaps, medianLapTimeMs } from "./laps";
import { getDriverStints, stintWearRate } from "./tyres";

/** Find the fastest same-compound driver within an overlapping lap range. */
export function getBestDriverOnCompound(
  drivers: DriverData[],
  compound: string,
  lapStart: number,
  lapEnd: number,
):
  | {
      driver: DriverData;
      stint: TyreStint;
      wearRate: number;
      paceMs: number;
      lapStart: number;
      lapEnd: number;
    }
  | undefined {
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
