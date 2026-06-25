import type {
  DriverData,
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
  focusedBestLapNumber: number | null;
  sessionBest: number;
  sessionBestLapNumber: number | null;
  sessionBestDriver: string;
  sessionBestTeam: string;
  isFocusedBest: boolean;
  deltaMs: number | null;
}

export interface SectorVsBestModel {
  focusedBestLap: number | null;
  focusedBestLapNumber: number | null;
  sessionBestLap: number;
  sessionBestLapNumber: number | null;
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

interface ValidLapSample {
  driver: DriverData;
  lap: LapHistoryEntry;
  lapNumber: number;
}

interface BestLapSample {
  value: number;
  lapNumber: number;
  driverName: string;
  team: string;
}

function validLapSamples(driver: DriverData): ValidLapSample[] {
  return driver["session-history"]["lap-history-data"]
    .map((lap, index) => ({ driver, lap, lapNumber: index + 1 }))
    .filter(
      (sample) =>
        isLapValid(sample.lap["lap-valid-bit-flags"]) &&
        sample.lap["lap-time-in-ms"] > 0,
    );
}

function findBestSample(
  samples: readonly ValidLapSample[],
  valueFor: (lap: LapHistoryEntry) => number,
): BestLapSample | null {
  let best: BestLapSample | null = null;

  for (const sample of samples) {
    const value = valueFor(sample.lap);
    if (value <= 0) continue;
    if (!best || value < best.value) {
      best = {
        value,
        lapNumber: sample.lapNumber,
        driverName: sample.driver["driver-name"],
        team: sample.driver.team,
      };
    }
  }

  return best;
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
      if (lap["lap-time-in-ms"] <= 0) return null;
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
  const focusedSamples = validLapSamples(focused);
  const focusedBestLapSample = findBestSample(
    focusedSamples,
    (lap) => lap["lap-time-in-ms"],
  );
  const sessionSamples = drivers.flatMap(validLapSamples);

  // Scan all valid laps instead of trusting classification order. Some debug
  // exports have partial final classification but complete lap histories.
  const sessionBestLapSample = findBestSample(
    sessionSamples,
    (lap) => lap["lap-time-in-ms"],
  );
  const focusedBestLap = focusedBestLapSample?.value ?? null;
  const sessionBestLap = sessionBestLapSample?.value ?? 0;

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
    focusedBestLapNumber: focusedBestLapSample?.lapNumber ?? null,
    sessionBestLap,
    sessionBestLapNumber: sessionBestLapSample?.lapNumber ?? null,
    sessionBestLapDriver: sessionBestLapSample?.driverName ?? "",
    sessionBestLapTeam: sessionBestLapSample?.team ?? "",
    isFocusedBestLap,
    lapDeltaMs,
    sectors: SECTOR_DEFS.map(({ sector, label }) => {
      const focusedBestMs = bestSectorTimeMs(focusedValid, sector);
      const focusedBest = focusedBestMs > 0 ? focusedBestMs : null;
      const focusedBestSample = findBestSample(focusedSamples, (lap) =>
        sectorTimeMs(lap, sector),
      );
      const sessionBestSample = findBestSample(sessionSamples, (lap) =>
        sectorTimeMs(lap, sector),
      );
      const sessionBest = sessionBestSample?.value ?? 0;

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
        focusedBestLapNumber: focusedBestSample?.lapNumber ?? null,
        sessionBest,
        sessionBestLapNumber: sessionBestSample?.lapNumber ?? null,
        sessionBestDriver: sessionBestSample?.driverName ?? "",
        sessionBestTeam: sessionBestSample?.team ?? "",
        isFocusedBest,
        deltaMs,
      };
    }),
  };
}
