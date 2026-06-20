import type {
  LapHistoryEntry,
  PerLapInfo,
  TyreStint,
} from "../types/telemetry";
import { isLapValid, sectorTimeMs } from "../utils/format";
import { ersDeployMjForLap, ersHarvestMjForLap } from "../utils/stats/energy";
import { getWorstWheelWear } from "../utils/stats/tyres";
import {
  buildSafetyCarRanges,
  isFullSafetyCarStatus,
  isVirtualSafetyCarStatus,
  type SafetyCarRange,
} from "./safetyCar";

/**
 * Lap chart/table data model.
 *
 * This is the densest per-lap projection in the app: it joins lap history,
 * optional per-lap telemetry, stints, rival laps, pit markers, fuel burn, ERS,
 * tyre wear, and safety-car state into one model. UI components should not
 * repeat those joins, because each export source has slightly different gaps.
 */

export interface LapAnalysisRow {
  lap: number;
  timeMs: number;
  timeStr: string;
  timeSec: number;
  valid: boolean;
  s1: number;
  s2: number;
  s3: number;
  topSpeed?: number;
  rivalTimeSec?: number;
  scStatus: string;
  isSC: boolean;
  isVSC: boolean;
  ersMj?: number;
  ersHarvMj?: number;
  fuelKg?: number;
  wear?: number;
}

export interface LapStintGroup {
  stint: TyreStint;
  compound: string;
  rows: LapAnalysisRow[];
}

export interface LapAnalysisModel {
  rows: LapAnalysisRow[];
  chartRows: LapAnalysisRow[];
  stintGroups: LapStintGroup[];
  lapTicks: number[];
  maxLap: number;
  yMin: number;
  yMax: number;
  hasRival: boolean;
  hasPitOutliers: boolean;
  hasSafetyCarOutliers: boolean;
  hasCleanLapOutliers: boolean;
  hasErs: boolean;
  hasErsHarv: boolean;
  hasBattery: boolean;
  maxErsMj: number;
  hasFuel: boolean;
  hasTopSpeed: boolean;
  bestTopSpeed: number;
  chartBestTime: number;
  tableBestTime: number;
  bestS1: number;
  bestS2: number;
  bestS3: number;
  scRanges: SafetyCarRange[];
  medianGreenBurn?: number;
}

export interface BuildLapAnalysisOptions {
  laps: readonly LapHistoryEntry[];
  pitLaps?: readonly number[];
  rivalPitLaps?: readonly number[];
  rivalLaps?: readonly LapHistoryEntry[];
  perLapInfo?: readonly PerLapInfo[];
  stints?: readonly TyreStint[];
  showCleanLaps?: boolean;
}

function minOrZero(values: readonly number[]): number {
  return values.length > 0 ? Math.min(...values) : 0;
}

function maxOrZero(values: readonly number[]): number {
  return values.length > 0 ? Math.max(...values) : 0;
}

export function buildLapTicks(maxLap: number): number[] {
  if (maxLap <= 1) return [1];
  const step =
    maxLap <= 12
      ? 1
      : maxLap <= 24
        ? 2
        : maxLap <= 40
          ? 4
          : maxLap <= 60
            ? 5
            : 10;
  const ticks = [1];
  for (let lap = 1 + step; lap < maxLap; lap += step) {
    ticks.push(lap);
  }
  if (ticks[ticks.length - 1] !== maxLap) ticks.push(maxLap);
  return ticks;
}

function median(values: readonly number[]): number | undefined {
  if (values.length === 0) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1]! + sorted[mid]!) / 2
    : sorted[mid]!;
}

function buildPerLapInfoMap(perLapInfo: readonly PerLapInfo[] | undefined) {
  const map = new Map<number, PerLapInfo>();
  for (const info of perLapInfo ?? []) {
    // `per-lap-info` is already numbered by the exporter, unlike lap-history
    // arrays where we infer displayed lap numbers from timed entries.
    map.set(info["lap-number"], info);
  }
  return map;
}

/**
 * Per-lap fuel burn is computed from consecutive fuel-in-tank snapshots.
 *
 * We only use positive deltas: negative deltas can appear in aborted/glitched
 * saves and would otherwise label a lap as "saving" when the tank reading is
 * simply unreliable. The green-flag median is used by the table renderer to
 * color unusually low/high burn laps.
 */
function buildFuelBurnModel(perLapInfo: readonly PerLapInfo[] | undefined): {
  burnByLap: Map<number, number>;
  medianGreenBurn?: number;
} {
  const burnByLap = new Map<number, number>();
  const greenFlagBurns: number[] = [];
  if (!perLapInfo || perLapInfo.length < 2) return { burnByLap };

  const sortedFuel = [...perLapInfo]
    .filter((lap) => lap["car-status-data"]?.["fuel-in-tank"] > 0)
    .sort((a, b) => a["lap-number"] - b["lap-number"]);

  for (let i = 1; i < sortedFuel.length; i++) {
    const previous = sortedFuel[i - 1]!;
    const current = sortedFuel[i]!;
    const burn =
      previous["car-status-data"]["fuel-in-tank"] -
      current["car-status-data"]["fuel-in-tank"];
    if (burn <= 0) continue;

    burnByLap.set(current["lap-number"], burn);

    const previousGreen =
      (previous["max-safety-car-status"] ?? "NO_SAFETY_CAR") ===
      "NO_SAFETY_CAR";
    const currentGreen =
      (current["max-safety-car-status"] ?? "NO_SAFETY_CAR") === "NO_SAFETY_CAR";
    if (previousGreen && currentGreen) greenFlagBurns.push(burn);
  }

  return {
    burnByLap,
    medianGreenBurn: median(greenFlagBurns),
  };
}

function buildRivalLapMap(rivalLaps: readonly LapHistoryEntry[] | undefined) {
  const map = new Map<number, number>();
  let lapNumber = 0;
  for (const lap of rivalLaps ?? []) {
    if (lap["lap-time-in-ms"] > 0) {
      // Rival histories can include zero-time placeholders; count only timed
      // laps so player/rival overlays stay aligned by completed lap.
      lapNumber++;
      map.set(lapNumber, lap["lap-time-in-ms"] / 1000);
    }
  }
  return map;
}

/**
 * Tyre-wear history records the fresh incoming tyre at pit boundaries. When
 * two stints report the same lap, keep the higher value so the table shows the
 * outgoing tyre wear instead of replacing it with the incoming 0%.
 */
function buildWearMap(stints: readonly TyreStint[] | undefined) {
  const wearByLap = new Map<number, number>();
  for (const stint of stints ?? []) {
    for (const entry of stint["tyre-wear-history"] ?? []) {
      const worst = getWorstWheelWear(entry);
      const existing = wearByLap.get(entry["lap-number"]);
      if (existing == null || worst > existing) {
        wearByLap.set(entry["lap-number"], worst);
      }
    }
  }
  return wearByLap;
}

function buildPitOutlierLaps({
  stints,
  pitLaps,
  rivalPitLaps,
}: Pick<BuildLapAnalysisOptions, "stints" | "pitLaps" | "rivalPitLaps">) {
  const outliers = new Set<number>();
  const addPitOutlierLaps = (stopLaps: readonly number[] | undefined) => {
    for (const lap of stopLaps ?? []) {
      // Mark both pit-in and pit-out laps. Either one can dominate chart scale
      // and hide the actual green-flag lap-time spread.
      if (lap > 1) outliers.add(lap - 1);
      outliers.add(lap);
    }
  };

  if (stints && stints.length > 0) {
    for (let i = 1; i < stints.length; i++) {
      outliers.add(stints[i - 1]!["end-lap"]);
      outliers.add(stints[i]!["start-lap"]);
    }
  } else {
    addPitOutlierLaps(pitLaps);
  }
  addPitOutlierLaps(rivalPitLaps);

  return outliers;
}

export function buildLapAnalysis({
  laps,
  pitLaps = [],
  rivalPitLaps = [],
  rivalLaps,
  perLapInfo,
  stints,
  showCleanLaps = false,
}: BuildLapAnalysisOptions): LapAnalysisModel {
  const lapInfoByNumber = buildPerLapInfoMap(perLapInfo);
  const { burnByLap, medianGreenBurn } = buildFuelBurnModel(perLapInfo);
  const rivalByLap = buildRivalLapMap(rivalLaps);
  const wearByLap = buildWearMap(stints);

  const rows = laps
    .filter((lap) => lap["lap-time-in-ms"] > 0)
    .map((lap, index): LapAnalysisRow => {
      const lapNumber = index + 1;
      const info = lapInfoByNumber.get(lapNumber);
      const scStatus = info?.["max-safety-car-status"] ?? "NO_SAFETY_CAR";
      return {
        lap: lapNumber,
        timeMs: lap["lap-time-in-ms"],
        timeStr: lap["lap-time-str"],
        timeSec: lap["lap-time-in-ms"] / 1000,
        valid: isLapValid(lap["lap-valid-bit-flags"]),
        s1: sectorTimeMs(lap, 1) / 1000,
        s2: sectorTimeMs(lap, 2) / 1000,
        s3: sectorTimeMs(lap, 3) / 1000,
        topSpeed: info?.["top-speed-kmph"] ?? undefined,
        rivalTimeSec: rivalByLap.get(lapNumber) ?? undefined,
        scStatus,
        isSC: isFullSafetyCarStatus(scStatus),
        isVSC: isVirtualSafetyCarStatus(scStatus),
        ersMj: info ? ersDeployMjForLap(info) : undefined,
        ersHarvMj: info ? ersHarvestMjForLap(info) : undefined,
        fuelKg: burnByLap.get(lapNumber) ?? undefined,
        wear: wearByLap.get(lapNumber),
      };
    });

  const pitOutlierLaps = buildPitOutlierLaps({
    stints,
    pitLaps,
    rivalPitLaps,
  });
  const hasPitOutliers = rows.some((row) => pitOutlierLaps.has(row.lap));
  const hasSafetyCarOutliers = rows.some((row) => row.isSC || row.isVSC);
  const hasCleanLapOutliers = hasPitOutliers || hasSafetyCarOutliers;
  const cleanRows =
    hasCleanLapOutliers && showCleanLaps
      ? rows.filter(
          (row) => !pitOutlierLaps.has(row.lap) && !row.isSC && !row.isVSC,
        )
      : rows;
  // If a very short/chaotic race has no clean rows, fall back to all laps so
  // the chart never disappears just because the filter did its job too well.
  const chartRows = cleanRows.length > 0 ? cleanRows : rows;

  const allTimes = [
    ...chartRows.map((row) => row.timeSec),
    ...chartRows
      .filter((row) => row.rivalTimeSec != null)
      .map((row) => row.rivalTimeSec!),
  ];
  const minTime = allTimes.length > 0 ? Math.min(...allTimes) : 0;
  const maxTime = allTimes.length > 0 ? Math.max(...allTimes) : 0;
  const validChartRows = chartRows.filter((row) => row.valid);
  const validTableRows = rows.filter((row) => row.valid);
  const hasErs = rows.some((row) => row.ersMj != null && row.ersMj > 0);
  const hasErsHarv = rows.some(
    (row) => row.ersHarvMj != null && row.ersHarvMj > 0,
  );
  const hasBattery = hasErs || hasErsHarv;
  const hasTopSpeed = rows.some((row) => row.topSpeed != null);
  const maxLap = maxOrZero(rows.map((row) => row.lap)) || 1;

  return {
    rows,
    chartRows,
    stintGroups: (stints ?? []).map((stint) => ({
      stint,
      compound: stint["tyre-set-data"]["visual-tyre-compound"],
      rows: rows.filter(
        (row) => row.lap >= stint["start-lap"] && row.lap <= stint["end-lap"],
      ),
    })),
    lapTicks: buildLapTicks(maxLap),
    maxLap,
    yMin: Math.floor(minTime),
    yMax: Math.ceil(maxTime),
    hasRival: Boolean(rivalLaps && rivalLaps.length > 0),
    hasPitOutliers,
    hasSafetyCarOutliers,
    hasCleanLapOutliers,
    hasErs,
    hasErsHarv,
    hasBattery,
    maxErsMj: hasBattery
      ? Math.max(
          0,
          ...rows.filter((row) => row.ersMj != null).map((row) => row.ersMj!),
          ...rows
            .filter((row) => row.ersHarvMj != null)
            .map((row) => row.ersHarvMj!),
        )
      : 0,
    hasFuel: rows.some((row) => row.fuelKg != null),
    hasTopSpeed,
    bestTopSpeed: hasTopSpeed
      ? maxOrZero(
          rows
            .filter((row) => row.valid && row.topSpeed != null)
            .map((row) => row.topSpeed!),
        )
      : 0,
    // `chartBestTime` respects Clean Laps, while `tableBestTime` always marks
    // the absolute best valid lap in the full table.
    chartBestTime: minOrZero(validChartRows.map((row) => row.timeSec)),
    tableBestTime: minOrZero(validTableRows.map((row) => row.timeSec)),
    bestS1: minOrZero(validTableRows.map((row) => row.s1)),
    bestS2: minOrZero(validTableRows.map((row) => row.s2)),
    bestS3: minOrZero(validTableRows.map((row) => row.s3)),
    scRanges: buildSafetyCarRanges(chartRows),
    medianGreenBurn,
  };
}
