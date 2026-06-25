import type { DriverData } from "../../types/telemetry";
import { bestSectorTimeMs } from "../format";
import { msToLapTimeLocal } from "./core";
import type { StrategyInsight } from "./insightTypes";
import { RACE_PACE_TOOLTIP } from "./insightTypes";
import { getBestLapTime, getRacePaceLaps, getValidLaps } from "./laps";

/** Historical PB data for a track */
export interface TrackPBData {
  bestQualiLapMs: number;
  bestS1Ms: number;
  bestS2Ms: number;
  bestS3Ms: number;
  bestTimeTrialLapMs?: number;
  bestTimeTrialS1Ms?: number;
  bestTimeTrialS2Ms?: number;
  bestTimeTrialS3Ms?: number;
  timeTrialSessionCount?: number;
  bestRaceLapMs: number;
  bestRacePaceMs: number;
  sessionCount: number;
}

function minPositive(values: readonly number[]): number {
  const positive = values.filter((value) => value > 0);
  return positive.length > 0 ? Math.min(...positive) : 0;
}

/** Generate qualifying insights comparing to personal bests on this track */
export function generateQualiHistoryInsights(
  player: DriverData,
  pbs: TrackPBData,
): StrategyInsight[] {
  const insights: StrategyInsight[] = [];
  const laps = player["session-history"]["lap-history-data"];
  const valid = getValidLaps(laps);
  if (valid.length === 0) return insights;

  const currentBest = getBestLapTime(laps);

  // 1. vs Personal Best lap
  if (currentBest > 0 && pbs.bestQualiLapMs > 0) {
    const delta = currentBest - pbs.bestQualiLapMs;
    if (delta < 0) {
      insights.push({
        type: "history",
        label: "vs Personal Best",
        value: "New PB!",
        detail: `-${(Math.abs(delta) / 1000).toFixed(3)}s improvement`,
      });
    } else if (delta === 0) {
      insights.push({
        type: "history",
        label: "vs Personal Best",
        value: "Matched PB",
        detail: "matched your best",
      });
    } else {
      insights.push({
        type: "history",
        label: "vs Personal Best",
        value: `+${(delta / 1000).toFixed(3)}s`,
        detail: `PB ${msToLapTimeLocal(pbs.bestQualiLapMs)}`,
      });
    }
  }

  // 2. Sector vs PB sectors — show the sector furthest from PB
  const currentS1 = bestSectorTimeMs(valid, 1);
  const currentS2 = bestSectorTimeMs(valid, 2);
  const currentS3 = bestSectorTimeMs(valid, 3);

  if (
    currentS1 > 0 &&
    currentS2 > 0 &&
    currentS3 > 0 &&
    pbs.bestS1Ms > 0 &&
    pbs.bestS2Ms > 0 &&
    pbs.bestS3Ms > 0
  ) {
    const deltas = [
      { sector: "S1", delta: currentS1 - pbs.bestS1Ms },
      { sector: "S2", delta: currentS2 - pbs.bestS2Ms },
      { sector: "S3", delta: currentS3 - pbs.bestS3Ms },
    ].filter((d) => d.delta > 0);

    if (deltas.length > 0) {
      const worst = deltas.sort((a, b) => b.delta - a.delta)[0];
      insights.push({
        type: "history",
        label: "vs PB Sectors",
        value: worst.sector,
        detail: `+${(worst.delta / 1000).toFixed(3)}s vs PB`,
      });
    } else {
      // All sectors matched or beat PB
      const totalGain =
        pbs.bestS1Ms -
        currentS1 +
        (pbs.bestS2Ms - currentS2) +
        (pbs.bestS3Ms - currentS3);
      if (totalGain > 0) {
        insights.push({
          type: "history",
          label: "vs PB Sectors",
          value: "All-time bests!",
          detail: `${(totalGain / 1000).toFixed(3)}s gained across sectors`,
        });
      }
    }
  }

  return insights;
}

/** Generate Time Trial history insights without mixing in qualifying sessions. */
export function generateTimeTrialHistoryInsights(
  player: DriverData,
  pbs: TrackPBData,
): StrategyInsight[] {
  return generateQualiHistoryInsights(player, {
    ...pbs,
    bestQualiLapMs: pbs.bestTimeTrialLapMs ?? 0,
    bestS1Ms: pbs.bestTimeTrialS1Ms ?? 0,
    bestS2Ms: pbs.bestTimeTrialS2Ms ?? 0,
    bestS3Ms: pbs.bestTimeTrialS3Ms ?? 0,
  });
}

function signedDelta(seconds: number): string {
  if (Math.abs(seconds) < 0.001) return "matched";
  return `${seconds > 0 ? "+" : "-"}${Math.abs(seconds).toFixed(3)}s`;
}

function timeTrialTheoreticalMs(player: DriverData): number {
  const valid = getValidLaps(player["session-history"]["lap-history-data"]);
  if (valid.length === 0) return 0;

  const currentS1 = bestSectorTimeMs(valid, 1);
  const currentS2 = bestSectorTimeMs(valid, 2);
  const currentS3 = bestSectorTimeMs(valid, 3);
  return currentS1 > 0 && currentS2 > 0 && currentS3 > 0
    ? currentS1 + currentS2 + currentS3
    : 0;
}

function absoluteTimeTrialTheoreticalMs(
  player: DriverData,
  pbs: TrackPBData,
): number {
  const valid = getValidLaps(player["session-history"]["lap-history-data"]);
  if (valid.length === 0) return 0;

  const currentS1 = bestSectorTimeMs(valid, 1);
  const currentS2 = bestSectorTimeMs(valid, 2);
  const currentS3 = bestSectorTimeMs(valid, 3);
  if (currentS1 <= 0 || currentS2 <= 0 || currentS3 <= 0) return 0;

  // The current run is part of the absolute answer; historical TT sectors only
  // improve the line when they beat one of this run's best sectors.
  return (
    minPositive([currentS1, pbs.bestTimeTrialS1Ms ?? 0]) +
    minPositive([currentS2, pbs.bestTimeTrialS2Ms ?? 0]) +
    minPositive([currentS3, pbs.bestTimeTrialS3Ms ?? 0])
  );
}

export function generateTimeTrialTrackPbInsight(
  player: DriverData,
  pbs: TrackPBData,
): StrategyInsight[] {
  if ((pbs.timeTrialSessionCount ?? 0) === 0 || !pbs.bestTimeTrialLapMs) {
    return [];
  }

  const laps = player["session-history"]["lap-history-data"];
  const currentBestMs = getBestLapTime(laps);
  if (currentBestMs <= 0) return [];

  const previousPbMs = pbs.bestTimeTrialLapMs;
  const trackPbMs = Math.min(previousPbMs, currentBestMs);
  const currentDeltaMs = currentBestMs - previousPbMs;
  const sessionTheoreticalMs = timeTrialTheoreticalMs(player);
  const absoluteTheoreticalMs = absoluteTimeTrialTheoreticalMs(player, pbs);

  const detail =
    currentDeltaMs < -1
      ? `${signedDelta(currentDeltaMs / 1000)} improvement`
      : Math.abs(currentDeltaMs) < 1
        ? "matched in this run"
        : `this run ${signedDelta(currentDeltaMs / 1000)}`;

  const theoreticalDeltaMs =
    sessionTheoreticalMs > 0 ? sessionTheoreticalMs - trackPbMs : undefined;
  const absoluteDeltaMs =
    absoluteTheoreticalMs > 0 ? absoluteTheoreticalMs - trackPbMs : undefined;

  return [
    {
      type: "history",
      label: "Track PB",
      value: msToLapTimeLocal(trackPbMs),
      detail,
      tooltip:
        "Track PB is your fastest valid Time Trial lap on this track/formula. Absolute theoretical is your best valid S1 + S2 + S3 across this run and prior TT sessions.",
      extraDetails: [
        theoreticalDeltaMs == null
          ? undefined
          : `This theoretical ${signedDelta(theoreticalDeltaMs / 1000)}`,
        absoluteDeltaMs == null || Math.abs(absoluteDeltaMs) < 1
          ? undefined
          : `Absolute theoretical ${msToLapTimeLocal(absoluteTheoreticalMs)} · ${signedDelta(absoluteDeltaMs / 1000)}`,
      ].filter((line): line is string => Boolean(line)),
    },
  ];
}

/** Generate race insights comparing to historical data on this track */
export function generateRaceHistoryInsights(
  player: DriverData,
  pbs: TrackPBData,
): StrategyInsight[] {
  const insights: StrategyInsight[] = [];
  const laps = player["session-history"]["lap-history-data"];
  const racePaceLaps = getRacePaceLaps(player);
  if (racePaceLaps.length === 0) return insights;

  const bestRaceLap = getBestLapTime(laps);

  // 1. Best race lap vs all-time best race lap
  if (bestRaceLap > 0 && pbs.bestRaceLapMs > 0) {
    const delta = bestRaceLap - pbs.bestRaceLapMs;
    if (delta <= 0) {
      insights.push({
        type: "history",
        label: "vs Best Race Lap",
        value: "New PB!",
        detail:
          delta < 0
            ? `-${(Math.abs(delta) / 1000).toFixed(3)}s improvement`
            : "matched your best",
      });
    } else {
      insights.push({
        type: "history",
        label: "vs Best Race Lap",
        value: `+${(delta / 1000).toFixed(3)}s`,
        detail: `off your PB of ${msToLapTimeLocal(pbs.bestRaceLapMs)}`,
      });
    }
  }

  // 2. Race pace vs best-ever race pace (race-pace laps only)
  if (pbs.bestRacePaceMs > 0) {
    const avgPace =
      racePaceLaps.reduce((s, l) => s + l["lap-time-in-ms"], 0) /
      racePaceLaps.length;
    const delta = avgPace - pbs.bestRacePaceMs;
    if (delta <= 0) {
      insights.push({
        type: "history",
        label: "Race Pace vs Best",
        value: "New best!",
        detail:
          delta < 0
            ? `-${(Math.abs(delta) / 1000).toFixed(3)}s/lap improvement`
            : "matched your best pace",
        tooltip: RACE_PACE_TOOLTIP,
      });
    } else {
      insights.push({
        type: "history",
        label: "Race Pace vs Best",
        value: `+${(delta / 1000).toFixed(3)}s/lap`,
        detail: "off your best average pace",
        tooltip: RACE_PACE_TOOLTIP,
      });
    }
  }

  return insights;
}
