import type {
  CarSetup,
  SessionSummary,
  TelemetrySession,
} from "../types/telemetry";
import type { RaceSetupCandidate, RaceSetupRunInput } from "./setupComparison";
import { buildRaceSetupComparison } from "./setupComparison";
import type { TrackSessionTab } from "../constants/routes";
import { findPlayer, isRaceSession } from "../utils/stats/drivers";
import {
  getBestLapTime,
  getValidLaps,
  lapTimeStdDev,
} from "../utils/stats/laps";
import {
  aggregateCompoundLife,
  type CompoundLifeStats,
} from "../utils/stats/trackAggregates";
import { avgWearRate } from "../utils/stats/tyres";
import {
  bestSectorTimeMs,
  formatDate,
  formatSessionType,
  formatTime,
  isLapValid,
} from "../utils/format";
import {
  buildTrackQualifyingInsights,
  type TrackQualifyingInsights,
} from "./trackQualifyingInsights";

/**
 * Track-page analysis pipeline.
 *
 * A track page combines many saved sessions into progress charts, race strategy
 * evidence, qualifying insights, setup candidates, and history rows. This file
 * owns the cross-session aggregation rules so `TrackProgressPage` can stay a
 * page composer instead of a telemetry analyst.
 */

export interface LapPoint {
  timeSec: number;
  valid: boolean;
  lapNum: number;
}

export type TrackSessionKind = TrackSessionTab;

export interface TrackSessionData {
  summary: SessionSummary;
  session: TelemetrySession;
  kind: TrackSessionKind;
  isRace: boolean;
  bestLapMs: number;
  bestS1: number;
  bestS2: number;
  bestS3: number;
  stdDevMs: number;
  wearRate: number;
  allLaps: LapPoint[];
  weather: string;
  trackTemp: number;
  airTemp: number;
  aiDifficulty: number;
  topSpeed: number;
  attemptCount: number;
}

export interface RaceAnalysisBucket {
  totalLaps: number;
  value: string;
  label: string;
  raceData: TrackSessionData[];
  sessions: TelemetrySession[];
  compoundLifeStats: CompoundLifeStats[];
  setupCandidates: RaceSetupCandidate[];
  tyreEvidenceCount: number;
  setupSampleCount: number;
  raceCount: number;
}

export interface LapTrendPoint {
  day: string;
  bestLap: number;
  fullDate: string;
}

export interface SectorTrendPoint {
  idx: number;
  S1: number;
  S2: number;
  S3: number;
}

export interface ConsistencyTrendPoint {
  idx: number;
  stdDev: number;
  label: string;
}

export interface SectorCardModel {
  label: string;
  bestMs: number;
  latestMs: number;
}

export interface LapScatterPoint {
  idx: number;
  timeSec: number;
  label: string;
}

export interface LapScatterSeries {
  validPoints: LapScatterPoint[];
  invalidPoints: LapScatterPoint[];
  bestPoints: LapScatterPoint[];
  allPoints: LapScatterPoint[];
}

export interface TrackPaceAnalysis {
  sessions: TrackSessionData[];
  theoreticalS1: number;
  theoreticalS2: number;
  theoreticalS3: number;
  theoreticalBestMs: number;
  bestLapMs: number;
  gapToTheoreticalMs: number;
  latest: TrackSessionData | null;
  bestSession: TrackSessionData | null;
  bestSetup: CarSetup | null;
  lapTrend: LapTrendPoint[];
  sectorTrend: SectorTrendPoint[];
  consistencyTrend: ConsistencyTrendPoint[];
  sectorCards: SectorCardModel[];
  scatter: LapScatterSeries;
}

export interface TrackAnalysisData {
  qualifying: TrackPaceAnalysis;
  timeTrial: TrackPaceAnalysis;
  raceData: TrackSessionData[];
  raceSessions: TelemetrySession[];
  bestRaceLapMs: number;
  sessionHistory: TrackSessionData[];
  availableTabs: TrackSessionKind[];
  qualifyingInsights: TrackQualifyingInsights | null;
}

export function getTrackSessionKind(
  session: TelemetrySession,
): TrackSessionKind {
  if (isRaceSession(session)) return "race";
  if (session["session-info"]["session-type"] === "Time Trial") {
    return "time-trial";
  }
  return "qualifying";
}

export function getPreferredTrackTab(
  availableTabs: readonly TrackSessionKind[],
): TrackSessionKind {
  // Race is the deepest analysis on this page, so keep it as the default when
  // available. Otherwise fall back to the first scoped data bucket that exists.
  return availableTabs.includes("race")
    ? "race"
    : (availableTabs[0] ?? "qualifying");
}

export function buildTrackSessionData(
  summary: SessionSummary,
  session: TelemetrySession,
): TrackSessionData | null {
  const player = findPlayer(session);
  if (!player) return null;

  const laps = player["session-history"]["lap-history-data"];
  const valid = getValidLaps(laps);
  const info = session["session-info"];
  const kind = getTrackSessionKind(session);

  return {
    summary,
    session,
    kind,
    isRace: kind === "race",
    bestLapMs: getBestLapTime(laps),
    bestS1: bestSectorTimeMs(valid, 1),
    bestS2: bestSectorTimeMs(valid, 2),
    bestS3: bestSectorTimeMs(valid, 3),
    stdDevMs: lapTimeStdDev(laps),
    wearRate: avgWearRate(player),
    allLaps: laps
      .filter((lap) => lap["lap-time-in-ms"] > 0)
      .map((lap, index) => ({
        // Track trend charts only need timed laps; zero-time placeholders from
        // aborted exports would otherwise compress the scatter scale.
        timeSec: lap["lap-time-in-ms"] / 1000,
        valid: isLapValid(lap["lap-valid-bit-flags"]),
        lapNum: index + 1,
      })),
    weather: info.weather,
    trackTemp: info["track-temperature"],
    airTemp: info["air-temperature"],
    aiDifficulty: info["ai-difficulty"],
    topSpeed: player["top-speed-kmph"],
    attemptCount: 1,
  };
}

/**
 * Detect consecutive qualifying sessions that share identical early laps
 * (from mid-session saves) and merge them, keeping the best-performing attempt.
 */
export function deduplicateTrackRuns(
  sessions: readonly TrackSessionData[],
): TrackSessionData[] {
  if (sessions.length === 0) return [];

  const getLapTimesMs = (session: TrackSessionData): number[] => {
    const player = findPlayer(session.session);
    if (!player) return [];
    return player["session-history"]["lap-history-data"]
      .map((lap) => lap["lap-time-in-ms"])
      .filter((ms) => ms > 0);
  };

  const isFromSameRun = (
    earlier: TrackSessionData,
    later: TrackSessionData,
  ): boolean => {
    // Only deduplicate qualifying attempts. Time Trial sessions are continuous
    // lap programmes rather than mid-session qualifying snapshots, so merging
    // them would hide useful practice volume.
    if (earlier.kind !== "qualifying" || later.kind !== "qualifying") {
      return false;
    }

    const earlierLaps = getLapTimesMs(earlier);
    const laterLaps = getLapTimesMs(later);
    if (earlierLaps.length < 1 || laterLaps.length < 1) return false;

    // The later session's early laps (all but last) must match the earlier
    // session's corresponding laps. This catches Pits n' Giggles mid-session
    // saves without hiding a genuinely separate qualifying run.
    const laterPrefix = laterLaps.slice(0, -1);
    if (laterPrefix.length === 0 || laterPrefix.length > earlierLaps.length) {
      return false;
    }
    return laterPrefix.every((ms, index) => ms === earlierLaps[index]);
  };

  const groups: TrackSessionData[][] = [[sessions[0]!]];
  for (let index = 1; index < sessions.length; index++) {
    const currentGroup = groups[groups.length - 1]!;
    const previous = currentGroup[currentGroup.length - 1]!;

    if (isFromSameRun(previous, sessions[index]!)) {
      currentGroup.push(sessions[index]!);
    } else {
      groups.push([sessions[index]!]);
    }
  }

  return groups.map((group) => {
    if (group.length === 1) return group[0]!;

    const withValidLaps = group.filter((session) => session.bestLapMs > 0);
    const best =
      withValidLaps.length > 0
        ? withValidLaps.reduce((a, b) => (a.bestLapMs < b.bestLapMs ? a : b))
        : group[group.length - 1]!; // fallback: latest session

    return { ...best, attemptCount: group.length };
  });
}

function getRaceTotalLaps(session: TelemetrySession): number | null {
  const totalLaps = session["session-info"]["total-laps"];
  if (!Number.isFinite(totalLaps) || totalLaps <= 0) return null;
  return Math.round(totalLaps);
}

function toRaceSetupRuns(
  races: readonly TrackSessionData[],
): RaceSetupRunInput[] {
  return races.map((race) => ({
    summary: race.summary,
    session: race.session,
  }));
}

export function buildRaceSetupCandidates(
  races: readonly TrackSessionData[],
): RaceSetupCandidate[] {
  return buildRaceSetupComparison(toRaceSetupRuns(races));
}

export function buildRaceAnalysisBuckets(
  races: readonly TrackSessionData[],
): RaceAnalysisBucket[] {
  // Race strategy evidence is only comparable within the same distance. A
  // 5-lap sprint and a 33-lap race should not share tyre-life/setup buckets.
  const byTotalLaps = new Map<number, TrackSessionData[]>();

  for (const race of races) {
    const totalLaps = getRaceTotalLaps(race.session);
    if (totalLaps === null) continue;

    const bucket = byTotalLaps.get(totalLaps);
    if (bucket) {
      bucket.push(race);
    } else {
      byTotalLaps.set(totalLaps, [race]);
    }
  }

  return [...byTotalLaps.entries()]
    .map(([totalLaps, raceData]) => {
      const sessions = raceData.map((race) => race.session);
      const compoundLifeStats = aggregateCompoundLife(sessions);
      const setupCandidates = buildRaceSetupCandidates(raceData);
      const tyreEvidenceCount = compoundLifeStats.reduce(
        (sum, compound) => sum + compound.stintCount,
        0,
      );
      const setupSampleCount = setupCandidates.reduce(
        (sum, setup) => sum + setup.sampleCount,
        0,
      );

      return {
        totalLaps,
        value: String(totalLaps),
        label: `${totalLaps} laps`,
        raceData,
        sessions,
        compoundLifeStats,
        setupCandidates,
        tyreEvidenceCount,
        setupSampleCount,
        raceCount: raceData.length,
      };
    })
    .filter(
      (bucket) => bucket.tyreEvidenceCount > 0 || bucket.setupSampleCount > 0,
    )
    .sort((a, b) => a.totalLaps - b.totalLaps);
}

export function getDefaultRaceAnalysisBucket(
  buckets: readonly RaceAnalysisBucket[],
): RaceAnalysisBucket | null {
  return (
    [...buckets].sort((a, b) => {
      if (a.tyreEvidenceCount !== b.tyreEvidenceCount) {
        return b.tyreEvidenceCount - a.tyreEvidenceCount;
      }
      if (a.setupSampleCount !== b.setupSampleCount) {
        return b.setupSampleCount - a.setupSampleCount;
      }
      if (a.raceCount !== b.raceCount) return b.raceCount - a.raceCount;
      return b.totalLaps - a.totalLaps;
    })[0] ?? null
  );
}

function minPositive(values: readonly number[]): number {
  const positive = values.filter((value) => value > 0);
  return positive.length > 0 ? Math.min(...positive) : 0;
}

function buildLapTrend(sessions: readonly TrackSessionData[]): LapTrendPoint[] {
  const byDay: Record<string, { bestLapMs: number; date: string }> = {};
  for (const session of sessions) {
    if (session.bestLapMs <= 0) continue;
    const dayKey = session.summary.date.split("T")[0]!;
    const previous = byDay[dayKey];
    if (!previous || session.bestLapMs < previous.bestLapMs) {
      byDay[dayKey] = {
        bestLapMs: session.bestLapMs,
        date: session.summary.date,
      };
    }
  }

  return Object.entries(byDay)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([dayKey, { bestLapMs, date }]) => ({
      day: new Date(dayKey).toLocaleDateString("en-GB", {
        day: "numeric",
        month: "short",
      }),
      bestLap: bestLapMs / 1000,
      fullDate: formatDate(date),
    }));
}

function buildSectorTrend(
  sessions: readonly TrackSessionData[],
): SectorTrendPoint[] {
  return sessions
    .filter((session) => session.bestS1 > 0)
    .map((session, index) => ({
      idx: index + 1,
      S1: session.bestS1 / 1000,
      S2: session.bestS2 / 1000,
      S3: session.bestS3 / 1000,
    }));
}

function buildConsistencyTrend(
  sessions: readonly TrackSessionData[],
): ConsistencyTrendPoint[] {
  return sessions
    .filter((session) => session.stdDevMs > 0)
    .map((session, index) => ({
      idx: index + 1,
      stdDev: +(session.stdDevMs / 1000).toFixed(3),
      label: `${formatSessionType(
        session.summary.sessionType,
        session.summary.formula,
      )} · ${formatTime(session.summary.date)}`,
    }));
}

function getValidSetupFromSession(
  session: TrackSessionData | null,
): CarSetup | null {
  if (!session) return null;
  const player = findPlayer(session.session);
  const setup = player?.["car-setup"];
  return setup?.["is-valid"] ? setup : null;
}

function buildLapScatterSeries(
  sessions: readonly TrackSessionData[],
): LapScatterSeries {
  const validPoints: LapScatterPoint[] = [];
  const invalidPoints: LapScatterPoint[] = [];
  const bestPoints: LapScatterPoint[] = [];

  sessions.forEach((session, index) => {
    const sessionIndex = index + 1;
    const sessionLabel = `${formatSessionType(
      session.summary.sessionType,
      session.summary.formula,
    )} · ${formatTime(session.summary.date)}`;
    const bestSec = session.bestLapMs > 0 ? session.bestLapMs / 1000 : null;

    for (const lap of session.allLaps) {
      const point = {
        idx: sessionIndex,
        timeSec: lap.timeSec,
        label: `${sessionLabel} Lap ${lap.lapNum}`,
      };
      if (lap.valid) {
        validPoints.push(point);
        if (bestSec !== null && Math.abs(lap.timeSec - bestSec) < 0.001) {
          bestPoints.push(point);
        }
      } else {
        invalidPoints.push(point);
      }
    }
  });

  return {
    validPoints,
    invalidPoints,
    bestPoints,
    allPoints: [...validPoints, ...invalidPoints],
  };
}

function buildPaceAnalysis(
  sessions: readonly TrackSessionData[],
): TrackPaceAnalysis {
  // Theoretical best is intentionally cross-session: it answers "what have I
  // already proven possible at this track if I join my best sectors?"
  const theoreticalS1 = minPositive(sessions.map((session) => session.bestS1));
  const theoreticalS2 = minPositive(sessions.map((session) => session.bestS2));
  const theoreticalS3 = minPositive(sessions.map((session) => session.bestS3));
  const theoreticalBestMs =
    theoreticalS1 > 0 && theoreticalS2 > 0 && theoreticalS3 > 0
      ? theoreticalS1 + theoreticalS2 + theoreticalS3
      : 0;
  const bestLapMs = minPositive(sessions.map((session) => session.bestLapMs));
  const latest = sessions.length > 0 ? sessions[sessions.length - 1]! : null;
  const bestSession =
    sessions.find(
      (session) => session.bestLapMs > 0 && session.bestLapMs === bestLapMs,
    ) ?? null;

  return {
    sessions: [...sessions],
    theoreticalS1,
    theoreticalS2,
    theoreticalS3,
    theoreticalBestMs,
    bestLapMs,
    gapToTheoreticalMs:
      bestLapMs > 0 && theoreticalBestMs > 0
        ? bestLapMs - theoreticalBestMs
        : 0,
    latest,
    bestSession,
    bestSetup: getValidSetupFromSession(bestSession),
    lapTrend: buildLapTrend(sessions),
    sectorTrend: buildSectorTrend(sessions),
    consistencyTrend: buildConsistencyTrend(sessions),
    sectorCards: [
      {
        label: "S1",
        bestMs: theoreticalS1,
        latestMs: latest?.bestS1 ?? 0,
      },
      {
        label: "S2",
        bestMs: theoreticalS2,
        latestMs: latest?.bestS2 ?? 0,
      },
      {
        label: "S3",
        bestMs: theoreticalS3,
        latestMs: latest?.bestS3 ?? 0,
      },
    ],
    scatter: buildLapScatterSeries(sessions),
  };
}

export function buildTrackAnalysisData(
  sessions: readonly TrackSessionData[],
): TrackAnalysisData {
  const qualifyingSessions = sessions.filter(
    (session) => session.kind === "qualifying",
  );
  const raceData = sessions.filter((session) => session.kind === "race");
  const timeTrialSessions = sessions.filter(
    (session) => session.kind === "time-trial",
  );
  const qualifying = buildPaceAnalysis(qualifyingSessions);
  const timeTrial = buildPaceAnalysis(timeTrialSessions);

  return {
    qualifying,
    timeTrial,
    raceData,
    raceSessions: raceData.map((session) => session.session),
    bestRaceLapMs: minPositive(raceData.map((session) => session.bestLapMs)),
    sessionHistory: [...sessions].reverse(),
    availableTabs: [
      // Keep the visible tab order stable even when the data arrives from file
      // scanning in a different order.
      ...(qualifyingSessions.length > 0 ? (["qualifying"] as const) : []),
      ...(raceData.length > 0 ? (["race"] as const) : []),
      ...(timeTrialSessions.length > 0 ? (["time-trial"] as const) : []),
    ],
    qualifyingInsights:
      qualifyingSessions.length > 0
        ? buildTrackQualifyingInsights(
            qualifyingSessions.map((session) => ({
              bestLapMs: session.bestLapMs,
              bestS1: session.bestS1,
              bestS2: session.bestS2,
              bestS3: session.bestS3,
              date: session.summary.date,
              isOnline: session.summary.isOnline,
              poleLapTimeMs: session.summary.poleLapTimeMs,
              qualifyingPosition: session.summary.qualifyingPosition,
            })),
          )
        : null,
  };
}
