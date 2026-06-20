import type {
  DriverData,
  LapHistoryEntry,
  RaceControlEvent,
  TelemetrySession,
  TyreStint,
  TyreStintHistoryV2Entry,
} from "../types/telemetry";
import { bestSectorTimeMs, sectorTimeMs } from "../utils/format";
import { avgErsDeployMj, avgErsHarvestMj } from "../utils/stats/energy";
import { driverTopSpeed } from "../utils/stats/drivers";
import {
  filterOutlierLaps,
  getBestLapTime,
  getCleanRaceLaps,
  getValidLaps,
  medianLapTimeMs,
} from "../utils/stats/laps";
import {
  getBestDriverOnCompound,
  medianPaceInRange,
  paceDrop,
} from "../utils/stats/pace";
import {
  getCompletedStints,
  getDriverStints,
  stintWearRate,
} from "../utils/stats/tyres";

/**
 * Session-result and comparison table models.
 *
 * These helpers turn raw classification, stint, lap, ERS, and penalty telemetry
 * into sortable rows for race/quali tables. They intentionally return plain
 * data only; display formatting stays in components so table styling can evolve
 * without changing race intelligence.
 */

export type RaceResultSortKey =
  | "pos"
  | "bestLap"
  | "racePace"
  | "gap"
  | "topSpeed"
  | "ers"
  | "ersHarv";
export type SortDirection = "asc" | "desc";

export interface RaceDriverStats {
  bestLap: number;
  racePace: number;
  topSpeed: number;
  ers: number;
  ersHarv: number;
}

export interface RaceResultHighlights {
  bestLapMs: number;
  bestPaceMs: number;
  bestSpeedKmh: number;
  bestErs: number;
  bestErsHarv: number;
  hasErsHarv: boolean;
}

export interface QualifyingTableRow {
  driver: DriverData;
  bestLap: LapHistoryEntry | null;
  bestTime: number;
  allInvalid: boolean;
  position: number;
  sectorTimes: [number, number, number];
}

export interface QualifyingTableModel {
  rows: QualifyingTableRow[];
  p1Time: number;
  bestLapTime: number | null;
  bestS1: number | null;
  bestS2: number | null;
  bestS3: number | null;
}

export interface CompoundLapComparisonRow {
  compound: string;
  playerMedian: number;
  rivalMedian: number;
  playerBest: number;
  rivalBest: number;
  playerLapCount: number;
  rivalLapCount: number;
  deltaSeconds: number;
}

export interface StintComparisonRow {
  stint: TyreStint;
  stintNumber: number;
  compound: string;
  playerWearRate: number;
  playerPace: number;
  playerDrop: number;
  bestDriverName?: string;
  bestLapStart?: number;
  bestLapEnd?: number;
  paceDelta: number;
  wearDelta: number;
  dropDelta: number;
}

function minPositive(values: Iterable<number>): number {
  const positive = [...values].filter((value) => value > 0);
  return positive.length > 0 ? Math.min(...positive) : 0;
}

function maxPositive(values: Iterable<number>): number {
  const positive = [...values].filter((value) => value > 0);
  return positive.length > 0 ? Math.max(...positive) : 0;
}

export function buildRaceDriverStats(
  drivers: readonly DriverData[],
): Map<string, RaceDriverStats> {
  const map = new Map<string, RaceDriverStats>();
  for (const driver of drivers) {
    const laps = driver["session-history"]["lap-history-data"];
    const bestLap = getBestLapTime(laps);
    const cleanRaceLaps = getCleanRaceLaps(driver);
    const racePace =
      cleanRaceLaps.length > 0
        ? cleanRaceLaps.reduce((sum, lap) => sum + lap["lap-time-in-ms"], 0) /
          cleanRaceLaps.length
        : 0;

    // Race pace deliberately uses clean race laps, not all valid laps, because
    // pit in/out and neutralized laps are valid telemetry but poor pace samples.
    map.set(driver["driver-name"], {
      bestLap,
      racePace,
      topSpeed: driverTopSpeed(driver),
      ers: avgErsDeployMj(driver),
      ersHarv: avgErsHarvestMj(driver),
    });
  }
  return map;
}

export function buildRaceResultHighlights(
  driverStats: Map<string, RaceDriverStats>,
): RaceResultHighlights {
  const values = [...driverStats.values()];
  return {
    bestLapMs: minPositive(values.map((stats) => stats.bestLap)),
    bestPaceMs: minPositive(values.map((stats) => stats.racePace)),
    bestSpeedKmh: maxPositive(values.map((stats) => stats.topSpeed)),
    bestErs: maxPositive(values.map((stats) => stats.ers)),
    bestErsHarv: maxPositive(values.map((stats) => stats.ersHarv)),
    hasErsHarv: values.some((stats) => stats.ersHarv > 0),
  };
}

export function buildPenaltiesByDriver(
  raceControlEvents: readonly RaceControlEvent[],
): Map<string, RaceControlEvent[]> {
  const map = new Map<string, RaceControlEvent[]>();
  for (const event of raceControlEvents) {
    if (event["message-type"] !== "PENALTY" || !event["driver-info"]?.name) {
      continue;
    }

    const driverName = event["driver-info"].name;
    // Keep the full event objects; the table may need more than a count for
    // tooltips or future steward-context UI.
    const penalties = map.get(driverName) ?? [];
    penalties.push(event);
    map.set(driverName, penalties);
  }
  return map;
}

function compareRaceGap(
  a: TyreStintHistoryV2Entry,
  b: TyreStintHistoryV2Entry,
): number {
  const gapA =
    typeof a["delta-to-leader"] === "number" ? a["delta-to-leader"] : 0;
  const gapB =
    typeof b["delta-to-leader"] === "number" ? b["delta-to-leader"] : 0;
  return gapA - gapB;
}

export function sortRaceStintHistoryRows({
  entries,
  focusedOnly,
  focusedName,
  sortKey,
  sortDir,
  driverStats,
}: {
  entries: readonly TyreStintHistoryV2Entry[];
  focusedOnly: boolean;
  focusedName?: string;
  sortKey: RaceResultSortKey;
  sortDir: SortDirection;
  driverStats: Map<string, RaceDriverStats>;
}): TyreStintHistoryV2Entry[] {
  const filtered = focusedOnly
    ? entries.filter((entry) => entry.name === focusedName)
    : [...entries];

  return [...filtered].sort((a, b) => {
    const statsA = driverStats.get(a.name);
    const statsB = driverStats.get(b.name);
    let comparison = 0;

    switch (sortKey) {
      case "pos":
        comparison = (a.position ?? 99) - (b.position ?? 99);
        break;
      case "bestLap":
        comparison =
          (statsA?.bestLap || Infinity) - (statsB?.bestLap || Infinity);
        break;
      case "racePace":
        comparison =
          (statsA?.racePace || Infinity) - (statsB?.racePace || Infinity);
        break;
      case "topSpeed":
        comparison = (statsB?.topSpeed || 0) - (statsA?.topSpeed || 0);
        break;
      case "ers":
        comparison = (statsB?.ers || 0) - (statsA?.ers || 0);
        break;
      case "ersHarv":
        comparison = (statsB?.ersHarv || 0) - (statsA?.ersHarv || 0);
        break;
      case "gap":
        // Gap comes from the exporter summary and may be a final-classification
        // delta, so keep it separate from lap-derived pace metrics.
        comparison = compareRaceGap(a, b);
        break;
    }

    return sortDir === "desc" ? -comparison : comparison;
  });
}

export function buildFallbackRaceRows({
  drivers,
  focusedOnly,
  focusedDriverIndex,
}: {
  drivers: readonly DriverData[];
  focusedOnly: boolean;
  focusedDriverIndex: number;
}): DriverData[] {
  return [...drivers]
    .filter((driver) => driver["final-classification"])
    .filter((driver) => !focusedOnly || driver.index === focusedDriverIndex)
    .sort(
      (a, b) =>
        (a["final-classification"]?.position ?? 99) -
        (b["final-classification"]?.position ?? 99),
    );
}

export function formatRaceGap(entry: TyreStintHistoryV2Entry): string {
  const gap = entry["delta-to-leader"];
  const status = entry["result-status"];

  if (status && status !== "FINISHED") return status;
  if (gap == null || gap === 0 || gap === "") return "Leader";
  if (typeof gap === "number") return `+${(gap / 1000).toFixed(3)}s`;
  return String(gap);
}

export function formatRaceStrategy(stints: readonly TyreStint[]): string {
  const completed = getCompletedStints([...stints]);
  return completed.length > 0
    ? completed
        .map((stint) => stint["tyre-set-data"]["visual-tyre-compound"][0])
        .join("-")
    : "–";
}

function driverBestLap(driver: DriverData): LapHistoryEntry | null {
  const laps = driver["session-history"]["lap-history-data"];
  const valid = getValidLaps(laps);
  if (valid.length === 0) return null;
  return valid.reduce((best, lap) =>
    lap["lap-time-in-ms"] < best["lap-time-in-ms"] ? lap : best,
  );
}

function hasOnlyInvalidLaps(driver: DriverData): boolean {
  const laps = driver["session-history"]["lap-history-data"];
  const timed = laps.filter((lap) => lap["lap-time-in-ms"] > 0);
  return timed.length > 0 && getValidLaps(laps).length === 0;
}

/**
 * Build qualifying rows from best valid laps, while preserving "all invalid"
 * drivers. They still need a row so the user can distinguish no telemetry from
 * a session where every timed lap was invalidated.
 */
export function buildQualifyingTableModel({
  session,
  focusedOnly,
  focusedDriverIndex,
}: {
  session: TelemetrySession;
  focusedOnly: boolean;
  focusedDriverIndex: number;
}): QualifyingTableModel {
  const rows = session["classification-data"]
    .map((driver) => {
      const bestLap = driverBestLap(driver);
      return {
        driver,
        bestLap,
        bestTime: bestLap?.["lap-time-in-ms"] ?? Infinity,
        allInvalid: hasOnlyInvalidLaps(driver),
        position: 0,
        sectorTimes: bestLap
          ? ([
              sectorTimeMs(bestLap, 1),
              sectorTimeMs(bestLap, 2),
              sectorTimeMs(bestLap, 3),
            ] as [number, number, number])
          : ([0, 0, 0] as [number, number, number]),
      };
    })
    .filter((row) => row.bestLap || row.allInvalid)
    .filter((row) => !focusedOnly || row.driver.index === focusedDriverIndex)
    .sort((a, b) => a.bestTime - b.bestTime)
    .map((row, index) => ({ ...row, position: index + 1 }));

  const allBestLaps = rows
    .filter((row) => row.bestLap)
    .map((row) => row.bestLap!);

  return {
    rows,
    p1Time: rows[0]?.bestTime ?? 0,
    bestLapTime:
      allBestLaps.length > 0
        ? Math.min(...allBestLaps.map((lap) => lap["lap-time-in-ms"]))
        : null,
    bestS1:
      allBestLaps.length > 0 ? bestSectorTimeMs(allBestLaps, 1) || null : null,
    bestS2:
      allBestLaps.length > 0 ? bestSectorTimeMs(allBestLaps, 2) || null : null,
    bestS3:
      allBestLaps.length > 0 ? bestSectorTimeMs(allBestLaps, 3) || null : null,
  };
}

function getLapsForStint(
  allLaps: readonly LapHistoryEntry[],
  stint: TyreStint,
): LapHistoryEntry[] {
  return allLaps.slice(stint["start-lap"] - 1, stint["end-lap"]);
}

function groupCleanLapsByCompound({
  stints,
  laps,
}: {
  stints: readonly TyreStint[];
  laps: readonly LapHistoryEntry[];
}): Map<string, LapHistoryEntry[]> {
  const byCompound = new Map<string, LapHistoryEntry[]>();

  for (const stint of stints) {
    const compound = stint["tyre-set-data"]["visual-tyre-compound"];
    // Same-compound comparisons should describe actual running pace, not the
    // artificial time loss from stops or obvious outliers.
    const cleanLaps = filterOutlierLaps(getLapsForStint(laps, stint));
    const existing = byCompound.get(compound) ?? [];
    byCompound.set(compound, [...existing, ...cleanLaps]);
  }

  return byCompound;
}

export function buildCompoundLapComparisonRows({
  playerStints,
  playerLaps,
  rivalStints,
  rivalLaps,
}: {
  playerStints: readonly TyreStint[];
  playerLaps: readonly LapHistoryEntry[];
  rivalStints: readonly TyreStint[];
  rivalLaps: readonly LapHistoryEntry[];
}): CompoundLapComparisonRow[] {
  const playerByCompound = groupCleanLapsByCompound({
    stints: playerStints,
    laps: playerLaps,
  });
  const rivalByCompound = groupCleanLapsByCompound({
    stints: rivalStints,
    laps: rivalLaps,
  });

  return [...new Set([...playerByCompound.keys()])]
    .filter((compound) => rivalByCompound.has(compound))
    .map((compound) => {
      const playerCompoundLaps = playerByCompound.get(compound)!;
      const rivalCompoundLaps = rivalByCompound.get(compound)!;
      const playerMedian = medianLapTimeMs(playerCompoundLaps);
      const rivalMedian = medianLapTimeMs(rivalCompoundLaps);

      return {
        compound,
        playerMedian,
        rivalMedian,
        playerBest: getBestLapTime(playerCompoundLaps),
        rivalBest: getBestLapTime(rivalCompoundLaps),
        playerLapCount: playerCompoundLaps.length,
        rivalLapCount: rivalCompoundLaps.length,
        deltaSeconds: (playerMedian - rivalMedian) / 1000,
      };
    });
}

/**
 * Compare each player stint against the fastest overlapping same-compound
 * stint from the rest of the field. Overlap matters: comparing a late hard
 * stint against somebody else's opening hard stint would mix fuel load with
 * driver/tyre performance.
 */
export function buildStintComparisonRows({
  player,
  allDrivers,
}: {
  player: DriverData;
  allDrivers: readonly DriverData[];
}): StintComparisonRow[] {
  const stints = getDriverStints(player);
  const playerLaps = player["session-history"]["lap-history-data"];
  const others = allDrivers.filter((driver) => driver.index !== player.index);

  return stints.map((stint, index) => {
    const compound = stint["tyre-set-data"]["visual-tyre-compound"];
    const playerWearRate = stintWearRate(stint);
    const best = getBestDriverOnCompound(
      others,
      compound,
      stint["start-lap"],
      stint["end-lap"],
    );
    const compareStartLap = best?.lapStart ?? stint["start-lap"];
    const compareEndLap = best?.lapEnd ?? stint["end-lap"];
    const playerPace = medianPaceInRange(
      playerLaps,
      compareStartLap,
      compareEndLap,
    );
    const playerDrop = paceDrop(playerLaps, compareStartLap, compareEndLap);
    const bestPace = best?.paceMs ?? 0;
    const bestDrop = best
      ? paceDrop(
          best.driver["session-history"]["lap-history-data"],
          best.lapStart,
          best.lapEnd,
        )
      : 0;

    return {
      stint,
      stintNumber: index + 1,
      compound,
      playerWearRate,
      playerPace,
      playerDrop,
      bestDriverName: best?.driver["driver-name"],
      bestLapStart: best?.lapStart,
      bestLapEnd: best?.lapEnd,
      wearDelta:
        best && playerWearRate > 0 && best.wearRate > 0
          ? playerWearRate - best.wearRate
          : 0,
      paceDelta: playerPace > 0 && bestPace > 0 ? playerPace - bestPace : 0,
      dropDelta: playerDrop !== 0 && bestDrop !== 0 ? playerDrop - bestDrop : 0,
    };
  });
}
