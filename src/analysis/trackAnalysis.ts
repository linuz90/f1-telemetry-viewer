import type {
  CarSetup,
  SessionSummary,
  TelemetrySession,
} from "../types/telemetry";
import type { TrackSessionTab } from "../constants/routes";
import {
  findPlayer,
  isRaceSession,
  sessionDriverBestLapTimeMs,
} from "../utils/stats/drivers";
import {
  getValidLaps,
  hasCompleteLapTiming,
  isCompleteValidLap,
  lapTimeStdDev,
} from "../utils/stats/laps";
import {
  aggregateCompoundLife,
  aggregateFuelData,
  type CompoundLifeStats,
  type TrackFuelStats,
} from "../utils/stats/trackAggregates";
import { avgWearRate } from "../utils/stats/tyres";
import {
  bestSectorTimeMs,
  formatDate,
  formatSessionType,
  formatShortDate,
  formatTime,
  joinMetaParts,
} from "../utils/format";
import {
  buildTrackQualifyingInsights,
  type TrackQualifyingInsights,
} from "./trackQualifyingInsights";
import { buildSessionSpeedAnalysis, type SpeedQuality } from "./speedAnalysis";

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
  sessionPeakKmh: number;
  sessionPeakQuality: SpeedQuality | null;
  attemptCount: number;
}

export interface RaceAnalysisBucket {
  totalLaps: number;
  value: string;
  label: string;
  raceData: TrackSessionData[];
  sessions: TelemetrySession[];
  compoundLifeStats: CompoundLifeStats[];
  tyreEvidenceCount: number;
  setupSampleCount: number;
  fuelStats: TrackFuelStats | null;
  raceCount: number;
}

/** One timed lap on the lap-times chart, at its session's column. */
export interface LapTimePoint {
  idx: number;
  timeSec: number;
}

/** One session column of the lap-times chart, oldest first. */
export interface SessionLapTimes {
  /** 1-based column, shared with the session's laps. */
  idx: number;
  /** Axis tick: the day on that day's first session, its clock time after. */
  tick: string;
  /** Tooltip heading, e.g. "Short Quali · Sat, 17 Oct 2026 · 11:28". */
  label: string;
  /** Null without a complete valid lap, so the best-lap line skips it. */
  bestLapSec: number | null;
  validLapCount: number;
  invalidLapCount: number;
  /** Standard deviation of the valid laps; null below two of them. */
  stdDevSec: number | null;
}

/**
 * Every timed lap plus each session's best and spread, so one chart answers
 * what separate best-lap, all-laps and consistency charts used to.
 */
export interface LapTimesBySession {
  sessions: SessionLapTimes[];
  validLaps: LapTimePoint[];
  invalidLaps: LapTimePoint[];
}

export interface SectorCardModel {
  label: string;
  bestMs: number;
  latestMs: number;
  /** Each session's best time in this sector, oldest first. */
  trendMs: number[];
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
  lapTimes: LapTimesBySession;
  sectorCards: SectorCardModel[];
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
  const speedProfile = buildSessionSpeedAnalysis(session).profiles.get(
    player.index,
  );

  return {
    summary,
    session,
    kind,
    isRace: kind === "race",
    bestLapMs: sessionDriverBestLapTimeMs(session, player),
    bestS1: bestSectorTimeMs(valid, 1),
    bestS2: bestSectorTimeMs(valid, 2),
    bestS3: bestSectorTimeMs(valid, 3),
    stdDevMs: lapTimeStdDev(laps),
    wearRate: avgWearRate(player),
    allLaps: laps
      // Preserve the historical positive-time ordinal before dropping partial
      // rows, or a later complete lap can inherit the wrong lap number.
      .filter((lap) => lap["lap-time-in-ms"] > 0)
      .map((lap, index) => ({ lap, lapNum: index + 1 }))
      .filter(({ lap }) => hasCompleteLapTiming(lap))
      .map(({ lap, lapNum }) => ({
        timeSec: lap["lap-time-in-ms"] / 1000,
        valid: isCompleteValidLap(lap),
        lapNum,
      })),
    weather: info.weather,
    trackTemp: info["track-temperature"],
    airTemp: info["air-temperature"],
    aiDifficulty: info["ai-difficulty"],
    sessionPeakKmh: speedProfile?.sessionPeak?.kmh ?? 0,
    sessionPeakQuality: speedProfile?.sessionPeak?.quality ?? null,
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
      const fuelStats = aggregateFuelData(sessions);
      const tyreEvidenceCount = compoundLifeStats.reduce(
        (sum, compound) => sum + compound.stintCount,
        0,
      );
      // Races that carry your setup still make a length worth offering when
      // its tyre and fuel evidence is thin.
      const setupSampleCount = raceData.filter(
        (race) => findPlayer(race.session)?.["car-setup"]?.["is-valid"],
      ).length;

      return {
        totalLaps,
        value: String(totalLaps),
        label: `${totalLaps} laps`,
        raceData,
        sessions,
        compoundLifeStats,
        tyreEvidenceCount,
        setupSampleCount,
        fuelStats,
        raceCount: raceData.length,
      };
    })
    .filter(
      (bucket) =>
        bucket.tyreEvidenceCount > 0 ||
        bucket.setupSampleCount > 0 ||
        bucket.fuelStats !== null,
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

function getValidSetupFromSession(
  session: TrackSessionData | null,
): CarSetup | null {
  if (!session) return null;
  const player = findPlayer(session.session);
  const setup = player?.["car-setup"];
  return setup?.["is-valid"] ? setup : null;
}

function buildLapTimesBySession(
  sessions: readonly TrackSessionData[],
): LapTimesBySession {
  const validLaps: LapTimePoint[] = [];
  const invalidLaps: LapTimePoint[] = [];
  let previousDay = "";

  const columns = sessions.map((session, index): SessionLapTimes => {
    const idx = index + 1;
    const { date } = session.summary;
    let validLapCount = 0;
    for (const lap of session.allLaps) {
      if (lap.valid) {
        validLapCount += 1;
        validLaps.push({ idx, timeSec: lap.timeSec });
      } else {
        invalidLaps.push({ idx, timeSec: lap.timeSec });
      }
    }
    // Several sessions a day are common, so only a day's first column names
    // the day; the rest show their clock time.
    const day = new Date(date).toDateString();
    const tick = day === previousDay ? formatTime(date) : formatShortDate(date);
    previousDay = day;

    return {
      idx,
      tick,
      label: joinMetaParts([
        formatSessionType(session.summary.sessionType, session.summary.formula),
        formatDate(date),
        formatTime(date),
      ]),
      bestLapSec: session.bestLapMs > 0 ? session.bestLapMs / 1000 : null,
      validLapCount,
      invalidLapCount: session.allLaps.length - validLapCount,
      stdDevSec: session.stdDevMs > 0 ? session.stdDevMs / 1000 : null,
    };
  });

  return { sessions: columns, validLaps, invalidLaps };
}

function sectorTrendMs(
  sessions: readonly TrackSessionData[],
  sector: "bestS1" | "bestS2" | "bestS3",
): number[] {
  return sessions.map((session) => session[sector]).filter((ms) => ms > 0);
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
    lapTimes: buildLapTimesBySession(sessions),
    sectorCards: [
      {
        label: "S1",
        bestMs: theoreticalS1,
        latestMs: latest?.bestS1 ?? 0,
        trendMs: sectorTrendMs(sessions, "bestS1"),
      },
      {
        label: "S2",
        bestMs: theoreticalS2,
        latestMs: latest?.bestS2 ?? 0,
        trendMs: sectorTrendMs(sessions, "bestS2"),
      },
      {
        label: "S3",
        bestMs: theoreticalS3,
        latestMs: latest?.bestS3 ?? 0,
        trendMs: sectorTrendMs(sessions, "bestS3"),
      },
    ],
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
