import type { LapHistoryEntry, TyreStint } from "../types/telemetry";
import { isLapValid } from "../utils/format";
import {
  estimateMaxLife,
  getWorstWheelWear,
  stintWearRate,
} from "../utils/stats/tyres";

/**
 * Stint timeline/detail models for race-session views.
 *
 * Stints mix two very different concepts: race structure (compound blocks) and
 * performance evidence (pace/wear inside each block). This module prepares both
 * so timeline/table components do not need to know pit-lap caveats.
 */

export interface StintTimelineSegment {
  stint: TyreStint;
  compound: string;
  widthPct: number;
  isFirst: boolean;
  isLast: boolean;
  isLastUnfinished: boolean;
}

export interface StintDetail {
  stint: TyreStint;
  compound: string;
  peakWear: number;
  wearRate: number;
  estimatedLife: number;
  bestTimeMs: number;
  averageTimeMs: number;
  averageDeviationMs: number;
}

export function buildStintTimelineSegments(
  stints: readonly TyreStint[],
  totalLaps: number,
): StintTimelineSegment[] {
  const effectiveTotal =
    totalLaps || stints.reduce((sum, stint) => sum + stint["stint-length"], 0);

  return stints.map((stint, index) => ({
    stint,
    compound: stint["tyre-set-data"]["visual-tyre-compound"],
    widthPct:
      effectiveTotal > 0 ? (stint["stint-length"] / effectiveTotal) * 100 : 0,
    isFirst: index === 0,
    isLast: index === stints.length - 1,
    // In-progress or early-ended sessions leave the final stint shorter than
    // the configured race distance; flag it so the UI can avoid implying it was
    // a planned stop.
    isLastUnfinished:
      index === stints.length - 1 && stint["end-lap"] < totalLaps,
  }));
}

function buildValidLapTimesByNumber(laps: readonly LapHistoryEntry[]) {
  const validLapTimes = new Map<number, number>();
  let lapNumber = 0;
  for (const lap of laps) {
    if (lap["lap-time-in-ms"] <= 0) continue;
    lapNumber++;
    if (isLapValid(lap["lap-valid-bit-flags"])) {
      validLapTimes.set(lapNumber, lap["lap-time-in-ms"]);
    }
  }
  return validLapTimes;
}

/**
 * Summarize each stint with valid-lap pace and wear data.
 *
 * For non-opening stints the first lap is normally a pit-out lap, so it is
 * skipped for pace unless that would leave the stint with no usable laps. This
 * matches the old UI logic while making the policy explicit and reusable.
 */
export function buildStintDetails(
  stints: readonly TyreStint[],
  laps: readonly LapHistoryEntry[],
): StintDetail[] {
  const validLapTimes = buildValidLapTimesByNumber(laps);

  return stints.map((stint, index) => {
    const compound = stint["tyre-set-data"]["visual-tyre-compound"];
    const wearHistory = stint["tyre-wear-history"];
    const peakWear =
      wearHistory.length > 0
        ? getWorstWheelWear(wearHistory[wearHistory.length - 1]!)
        : 0;
    const wearRate = stintWearRate(stint);
    const stintTimes: number[] = [];
    const stintTimesWithOutlap: number[] = [];

    for (let lap = stint["start-lap"]; lap <= stint["end-lap"]; lap++) {
      const timeMs = validLapTimes.get(lap);
      if (timeMs == null) continue;
      stintTimesWithOutlap.push(timeMs);
      if (index > 0 && lap === stint["start-lap"]) continue;
      stintTimes.push(timeMs);
    }

    const effectiveTimes =
      stintTimes.length > 0 ? stintTimes : stintTimesWithOutlap;
    const averageTimeMs =
      effectiveTimes.length > 0
        ? effectiveTimes.reduce((sum, time) => sum + time, 0) /
          effectiveTimes.length
        : 0;

    return {
      stint,
      compound,
      peakWear,
      wearRate,
      estimatedLife: estimateMaxLife(wearRate),
      bestTimeMs: effectiveTimes.length > 0 ? Math.min(...effectiveTimes) : 0,
      averageTimeMs,
      averageDeviationMs:
        effectiveTimes.length > 1
          ? effectiveTimes.reduce(
              (sum, time) => sum + Math.abs(time - averageTimeMs),
              0,
            ) / effectiveTimes.length
          : 0,
    };
  });
}
