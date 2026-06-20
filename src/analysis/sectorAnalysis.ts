import type {
  LapHistoryEntry,
  PerLapInfo,
  TelemetrySession,
  TyreStintBasic,
} from "../types/telemetry";
import { bestSectorTimeMs, isLapValid, sectorTimeMs } from "../utils/format";
import { ersDeployMjForLap, ersHarvestMjForLap } from "../utils/stats/energy";
import { getValidLaps } from "../utils/stats/laps";

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

export interface SectorVsBestEntry {
  label: "S1" | "S2" | "S3";
  focusedBest: number | null;
  sessionBest: number;
  sessionBestDriver: string;
  sessionBestTeam: string;
  isFocusedBest: boolean;
  deltaMs: number | null;
}

export interface SectorVsBestModel {
  focusedBestLap: number | null;
  sessionBestLap: number;
  sessionBestLapDriver: string;
  sessionBestLapTeam: string;
  isFocusedBestLap: boolean;
  lapDeltaMs: number | null;
  sectors: SectorVsBestEntry[];
}

const SECTOR_DEFS = [
  { sector: 1, key: "s1", label: "S1" },
  { sector: 2, key: "s2", label: "S2" },
  { sector: 3, key: "s3", label: "S3" },
] as const;

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
    .filter((lap) => lap["lap-time-in-ms"] > 0)
    .map((lap, index): SectorBreakdownLap => {
      const lapNumber = index + 1;
      const ers = ersByLap.get(lapNumber);
      return {
        lap: lapNumber,
        s1: sectorTimeMs(lap, 1) / 1000,
        s2: sectorTimeMs(lap, 2) / 1000,
        s3: sectorTimeMs(lap, 3) / 1000,
        total: lap["lap-time-in-ms"] / 1000,
        totalStr: lap["lap-time-str"],
        valid: isLapValid(lap["lap-valid-bit-flags"]),
        compound: compoundByLap.get(lapNumber),
        deployMj: ers?.deployMj,
        harvMj: ers?.harvMj,
      };
    });
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

export function buildSectorVsBestModel({
  session,
  focusedDriverIndex,
}: {
  session: TelemetrySession;
  focusedDriverIndex: number;
}): SectorVsBestModel | null {
  const drivers = session["classification-data"];
  const focused = drivers.find((driver) => driver.index === focusedDriverIndex);
  if (!focused) return null;

  const focusedValid = getValidLaps(
    focused["session-history"]["lap-history-data"],
  );
  const focusedBestLap =
    focusedValid.length > 0
      ? Math.min(...focusedValid.map((lap) => lap["lap-time-in-ms"]))
      : null;

  let sessionBestLap = Infinity;
  let sessionBestLapDriver = "";
  let sessionBestLapTeam = "";
  // Scan all valid laps instead of trusting classification order. Some debug
  // exports have partial final classification but complete lap histories.
  for (const driver of drivers) {
    for (const lap of getValidLaps(
      driver["session-history"]["lap-history-data"],
    )) {
      if (lap["lap-time-in-ms"] < sessionBestLap) {
        sessionBestLap = lap["lap-time-in-ms"];
        sessionBestLapDriver = driver["driver-name"];
        sessionBestLapTeam = driver.team;
      }
    }
  }
  if (sessionBestLap === Infinity) sessionBestLap = 0;

  const isFocusedBestLap =
    focusedBestLap !== null &&
    sessionBestLap > 0 &&
    Math.abs(focusedBestLap - sessionBestLap) < 1;
  const lapDeltaMs =
    focusedBestLap !== null && sessionBestLap > 0
      ? focusedBestLap - sessionBestLap
      : null;

  return {
    focusedBestLap,
    sessionBestLap,
    sessionBestLapDriver,
    sessionBestLapTeam,
    isFocusedBestLap,
    lapDeltaMs,
    sectors: SECTOR_DEFS.map(({ sector, label }) => {
      const focusedBestMs = bestSectorTimeMs(focusedValid, sector);
      const focusedBest = focusedBestMs > 0 ? focusedBestMs : null;
      let sessionBest = Infinity;
      let sessionBestDriver = "";
      let sessionBestTeam = "";

      for (const driver of drivers) {
        for (const lap of getValidLaps(
          driver["session-history"]["lap-history-data"],
        )) {
          const lapSectorTime = sectorTimeMs(lap, sector);
          if (lapSectorTime > 0 && lapSectorTime < sessionBest) {
            sessionBest = lapSectorTime;
            sessionBestDriver = driver["driver-name"];
            sessionBestTeam = driver.team;
          }
        }
      }
      if (sessionBest === Infinity) sessionBest = 0;

      const isFocusedBest =
        focusedBest !== null &&
        sessionBest > 0 &&
        Math.abs(focusedBest - sessionBest) < 1;
      const deltaMs =
        focusedBest !== null && sessionBest > 0
          ? focusedBest - sessionBest
          : null;

      return {
        label,
        focusedBest,
        sessionBest,
        sessionBestDriver,
        sessionBestTeam,
        isFocusedBest,
        deltaMs,
      };
    }),
  };
}
