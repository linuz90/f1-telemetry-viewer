import type {
  LapHistoryEntry,
  PerLapInfo,
  TyreStintBasic,
} from "../types/telemetry";
import { msToLapTime, sectorTimeMs } from "../utils/format";
import { ersDeployMjForLap, ersHarvestMjForLap } from "../utils/stats/energy";
import { hasCompleteLapTiming, isCompleteValidLap } from "../utils/stats/laps";

/**
 * Sector-level analysis for qualifying/session detail views.
 *
 * Sector views compare a driver's lap execution against both their own laps
 * and the session benchmark. The raw telemetry does not provide a ready-made
 * "best sector by driver" table, so this module performs those scans once and
 * gives the UI a stable model.
 */

export type SectorKey = "s1" | "s2" | "s3";

export interface SectorBreakdownLap {
  lap: number;
  s1: number;
  s2: number;
  s3: number;
  total: number;
  totalStr: string;
  valid: boolean;
  compound?: string;
  deployMj?: number;
  harvMj?: number;
}

export interface SectorBreakdownModel {
  laps: SectorBreakdownLap[];
  hasDeploy: boolean;
  hasHarv: boolean;
  bestTime: number | null;
  maxTotal: number;
  bestBySector: Record<SectorKey, number>;
  worstBySector: Record<SectorKey, number>;
  validLapCount: number;
}

function buildLapCompoundMap(stints: readonly TyreStintBasic[] | undefined) {
  const map = new Map<number, string>();
  if (!stints?.length) return map;

  let startLap = 1;
  for (const stint of stints) {
    const compound = stint["tyre-visual-compound"];
    for (let lap = startLap; lap <= stint["end-lap"]; lap++) {
      map.set(lap, compound);
    }
    // Basic stint exports only store each stint end lap. Carry the next start
    // forward so lap-backed compound chips remain aligned.
    startLap = stint["end-lap"] + 1;
  }
  return map;
}

function buildLapErsMap(perLapInfo: readonly PerLapInfo[] | undefined) {
  const map = new Map<number, { deployMj: number; harvMj: number }>();
  for (const info of perLapInfo ?? []) {
    map.set(info["lap-number"], {
      deployMj: ersDeployMjForLap(info),
      harvMj: ersHarvestMjForLap(info),
    });
  }
  return map;
}

/**
 * Build the qualifying lap-breakdown model.
 *
 * F1 26 qualifying telemetry often alternates deploy laps and harvest laps.
 * Keeping ERS on the sector-row model lets the UI expose those push/charge
 * patterns without rebuilding per-lap lookups beside the bars.
 */
export function buildSectorBreakdownModel({
  laps,
  stints,
  perLapInfo,
}: {
  laps: readonly LapHistoryEntry[];
  stints?: readonly TyreStintBasic[];
  perLapInfo?: readonly PerLapInfo[];
}): SectorBreakdownModel {
  const compoundByLap = buildLapCompoundMap(stints);
  const ersByLap = buildLapErsMap(perLapInfo);
  const breakdownLaps = laps
    .map((lap, index): SectorBreakdownLap | null => {
      const lapNumber = index + 1;
      if (!hasCompleteLapTiming(lap)) return null;
      const ers = ersByLap.get(lapNumber);
      return {
        lap: lapNumber,
        s1: sectorTimeMs(lap, 1) / 1000,
        s2: sectorTimeMs(lap, 2) / 1000,
        s3: sectorTimeMs(lap, 3) / 1000,
        total: lap["lap-time-in-ms"] / 1000,
        totalStr: msToLapTime(lap["lap-time-in-ms"]),
        valid: isCompleteValidLap(lap),
        compound: compoundByLap.get(lapNumber),
        deployMj: ers?.deployMj,
        harvMj: ers?.harvMj,
      };
    })
    .filter((lap): lap is SectorBreakdownLap => lap !== null);
  const validLaps = breakdownLaps.filter((lap) => lap.valid);

  const bestFor = (key: SectorKey) =>
    validLaps.length > 0
      ? Math.min(...validLaps.map((lap) => lap[key]))
      : Infinity;
  const worstFor = (key: SectorKey) =>
    validLaps.length > 0
      ? Math.max(...validLaps.map((lap) => lap[key]))
      : -Infinity;

  return {
    laps: breakdownLaps,
    hasDeploy: breakdownLaps.some(
      (lap) => lap.deployMj != null && lap.deployMj > 0,
    ),
    hasHarv: breakdownLaps.some((lap) => lap.harvMj != null && lap.harvMj > 0),
    bestTime:
      validLaps.length > 0
        ? Math.min(...validLaps.map((lap) => lap.total))
        : null,
    maxTotal:
      breakdownLaps.length > 0
        ? Math.max(...breakdownLaps.map((lap) => lap.s1 + lap.s2 + lap.s3))
        : 0,
    bestBySector: {
      s1: bestFor("s1"),
      s2: bestFor("s2"),
      s3: bestFor("s3"),
    },
    worstBySector: {
      s1: worstFor("s1"),
      s2: worstFor("s2"),
      s3: worstFor("s3"),
    },
    validLapCount: validLaps.length,
  };
}
