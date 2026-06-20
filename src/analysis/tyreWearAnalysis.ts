import type { PerLapInfo, TyreStint } from "../types/telemetry";
import { getWorstWheelWear } from "../utils/stats/tyres";
import {
  buildSafetyCarRangesFromPerLapInfo,
  type SafetyCarRange,
} from "./safetyCar";

/**
 * Tyre-wear chart model.
 *
 * Wear telemetry is stint-scoped, while the chart is lap-scoped. This module
 * flattens stint histories, overlays optional rival wear, and adds pit/SC
 * markers so the chart does not invent continuity where the car changed tyres.
 */

export interface TyreWearPoint {
  lap: number;
  wear: number | undefined;
  compound: string;
  rivalWear?: number;
}

export interface TyreWearAnalysis {
  hasAnyWearData: boolean;
  data: TyreWearPoint[];
  pitLaps: number[];
  lapTicks: number[];
  scStatusByLap: Map<number, string>;
  scRanges: SafetyCarRange[];
  maxWear: number;
  hasRival: boolean;
}

function buildWearMap(stints: readonly TyreStint[] | undefined) {
  const map = new Map<number, number>();
  for (const stint of stints ?? []) {
    for (const entry of stint["tyre-wear-history"]) {
      map.set(entry["lap-number"], +getWorstWheelWear(entry).toFixed(1));
    }
  }
  return map;
}

/**
 * Build the Recharts-ready tyre-wear series.
 *
 * We insert a half-lap point with undefined wear between stints so Recharts
 * breaks the player's line at pit stops instead of drawing a fake diagonal
 * from worn tyres to a fresh set.
 */
export function buildTyreWearAnalysis({
  stints,
  rivalStints,
  perLapInfo,
}: {
  stints: readonly TyreStint[];
  rivalStints?: readonly TyreStint[];
  perLapInfo?: readonly PerLapInfo[];
}): TyreWearAnalysis {
  const hasAnyWearData = stints.some(
    (stint) => stint["tyre-wear-history"].length > 0,
  );
  const rivalWearByLap = buildWearMap(rivalStints);
  const data: TyreWearPoint[] = [];

  stints.forEach((stint, index) => {
    const wearHistory = stint["tyre-wear-history"];
    if (index > 0 && wearHistory.length > 0) {
      data.push({
        lap: wearHistory[0]!["lap-number"] - 0.5,
        wear: undefined,
        compound: "",
      });
    }

    for (const wear of wearHistory) {
      data.push({
        lap: wear["lap-number"],
        wear: +getWorstWheelWear(wear).toFixed(1),
        compound: stint["tyre-set-data"]["visual-tyre-compound"],
        rivalWear: rivalWearByLap.get(wear["lap-number"]) ?? undefined,
      });
    }
  });

  const scStatusByLap = new Map<number, string>();
  for (const lap of perLapInfo ?? []) {
    const status = lap["max-safety-car-status"] ?? "NO_SAFETY_CAR";
    if (status !== "NO_SAFETY_CAR") {
      scStatusByLap.set(lap["lap-number"], status);
    }
  }

  return {
    hasAnyWearData,
    data,
    pitLaps: stints.slice(1).map((stint) => stint["start-lap"]),
    lapTicks: data
      .filter((point) => Number.isInteger(point.lap))
      .map((point) => point.lap),
    scStatusByLap,
    scRanges: buildSafetyCarRangesFromPerLapInfo(perLapInfo),
    maxWear: Math.max(...data.map((point) => point.wear ?? 0), 50),
    hasRival: Boolean(rivalStints && rivalStints.length > 0),
  };
}
