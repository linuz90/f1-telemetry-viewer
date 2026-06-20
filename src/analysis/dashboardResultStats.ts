import type { SessionSummary } from "../types/telemetry";
import { getSessionFormulaScopeKey } from "../utils/formulaScope";
import { isRaceSessionType } from "../utils/sessionTypes";

/**
 * Formula-scoped dashboard result aggregates: hero numbers, recent result rows,
 * and per-track finish summaries. Editorial "insight card" mining lives in
 * `dashboardInsights.ts` so ranking thresholds stay separate from raw stats.
 */

export type ResultDataMode =
  | "representative-online"
  | "online"
  | "available-races"
  | "session-history";

export interface TrackResultSummary {
  track: string;
  races: number;
  averageFinish: number;
  bestFinish: number;
  worstFinish: number;
  podiums: number;
  averageGridGain?: number;
}

export interface DashboardResultStats {
  scopedSessions: SessionSummary[];
  resultSessions: SessionSummary[];
  cleanFinishSessions: SessionSummary[];
  recentResults: SessionSummary[];
  trackResults: TrackResultSummary[];
  mode: ResultDataMode;
  modeLabel: string;
  modeDetail: string;
  totalLaps: number;
  trackCount: number;
  sessionCount: number;
  starts: number;
  wins: number;
  p2: number;
  p3: number;
  topFive: number;
  dnfCount: number;
  pointsScored: number;
  polePositions: number;
  frontRowStarts: number;
  gridStarts: number;
  averageFinish?: number;
  averageGridGain?: number;
}

export function isRepresentativeOnlineRace(session: SessionSummary): boolean {
  // Representative online races are the dashboard's best signal for real form:
  // enough human-grid data, not spectator mode, and at least one player lap.
  // Smaller online lobbies fall back to the broader online bucket.
  const result = session.playerRaceResult;
  return (
    Boolean(result) &&
    isRaceSessionType(session.sessionType) &&
    session.isOnline === true &&
    session.isSpectator !== true &&
    (session.onlineDriverCount ?? 0) >= 8 &&
    (session.classifiedDriverCount ?? 0) >= 10 &&
    (result?.playerLaps ?? 0) > 0
  );
}

function isRaceWithResult(session: SessionSummary): boolean {
  return (
    isRaceSessionType(session.sessionType) &&
    session.isSpectator !== true &&
    session.playerRaceResult != null
  );
}

function isFinishedStatus(status: string | undefined): boolean {
  if (!status) return true;
  const normalized = status.toUpperCase().replace(/[\s-]+/g, "_");
  return normalized === "FINISHED";
}

export function isDnfResultStatus(status: string | undefined): boolean {
  if (!status) return false;
  const normalized = status.toUpperCase().replace(/[\s-]+/g, "_");
  return (
    normalized === "DNF" ||
    normalized === "DID_NOT_FINISH" ||
    normalized === "RETIRED" ||
    normalized === "DISQUALIFIED" ||
    normalized === "DSQ"
  );
}

export function isCleanRaceFinish(session: SessionSummary): boolean {
  const result = session.playerRaceResult;
  if (!result) return false;
  if (!isFinishedStatus(result.status)) return false;

  if (result.totalLaps && result.totalLaps > 0) {
    // Some exports miss the final lap or classify the player one lap down.
    // Treat a finish within two laps / 90% race distance as usable for average
    // finish stats, while the status gate above still keeps DNFs out.
    return (
      result.playerLaps >= result.totalLaps - 2 || (result.lapRatio ?? 0) >= 0.9
    );
  }

  return result.playerLaps > 0;
}

function average(values: number[]): number | undefined {
  if (values.length === 0) return undefined;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function getGridGain(session: SessionSummary): number | undefined {
  const result = session.playerRaceResult;
  if (!result?.gridPosition) return undefined;
  return result.gridPosition - result.position;
}

function getModeLabel(mode: ResultDataMode): string {
  switch (mode) {
    case "representative-online":
      return "Your online races";
    case "online":
      return "Online race results";
    case "available-races":
      return "Available race results";
    case "session-history":
      return "Session history";
  }
}

function getModeDetail(mode: ResultDataMode): string {
  switch (mode) {
    case "representative-online":
      return "Online races with enough human-grid data to compare your real results.";
    case "online":
      return "No representative online grid yet, so this uses every online race result in this scope.";
    case "available-races":
      return "No online race results yet, so this uses the AI/local race results available in this scope.";
    case "session-history":
      return "No race result data yet, so this shows session activity for the selected scope.";
  }
}

function chooseResultSessions(scopedSessions: SessionSummary[]): {
  mode: ResultDataMode;
  sessions: SessionSummary[];
} {
  // Prefer the most comparable result pool, then gracefully widen the data.
  // This keeps mature online-race histories honest without making new/offline
  // scopes look empty.
  const raceResults = scopedSessions.filter(isRaceWithResult);
  const representativeOnline = raceResults.filter(isRepresentativeOnlineRace);
  if (representativeOnline.length > 0) {
    return { mode: "representative-online", sessions: representativeOnline };
  }

  const onlineResults = raceResults.filter((session) => session.isOnline);
  if (onlineResults.length > 0) {
    return { mode: "online", sessions: onlineResults };
  }

  if (raceResults.length > 0) {
    return { mode: "available-races", sessions: raceResults };
  }

  return { mode: "session-history", sessions: [] };
}

function buildTrackResults(
  cleanFinishSessions: SessionSummary[],
): TrackResultSummary[] {
  const groups = new Map<string, SessionSummary[]>();
  for (const session of cleanFinishSessions) {
    const group = groups.get(session.track) ?? [];
    group.push(session);
    groups.set(session.track, group);
  }

  return [...groups.entries()]
    .filter(([, sessions]) => sessions.length >= 2)
    .map(([track, sessions]) => {
      const positions = sessions.map(
        (session) => session.playerRaceResult?.position ?? 0,
      );
      const gridGains = sessions
        .map(getGridGain)
        .filter((gain): gain is number => gain != null);
      return {
        track,
        races: sessions.length,
        averageFinish: average(positions) ?? 0,
        bestFinish: Math.min(...positions),
        worstFinish: Math.max(...positions),
        podiums: positions.filter((position) => position <= 3).length,
        averageGridGain: average(gridGains),
      };
    })
    .sort((a, b) => {
      if (a.averageFinish !== b.averageFinish)
        return a.averageFinish - b.averageFinish;
      return b.races - a.races;
    });
}

export function getDashboardResultStats(
  sessions: SessionSummary[],
  formulaKey: string | undefined,
): DashboardResultStats {
  const scopedSessions = formulaKey
    ? sessions.filter(
        (session) => getSessionFormulaScopeKey(session) === formulaKey,
      )
    : sessions;
  const { mode, sessions: resultSessions } =
    chooseResultSessions(scopedSessions);
  const cleanFinishSessions = resultSessions.filter(isCleanRaceFinish);
  const positions = resultSessions
    .map((session) => session.playerRaceResult?.position)
    .filter((position): position is number => position != null);
  const cleanPositions = cleanFinishSessions
    .map((session) => session.playerRaceResult?.position)
    .filter((position): position is number => position != null);
  const gridGains = resultSessions
    .map(getGridGain)
    .filter((gain): gain is number => gain != null);
  const gridPositions = resultSessions
    .map((session) => session.playerRaceResult?.gridPosition)
    .filter(
      (gridPosition): gridPosition is number =>
        gridPosition != null && gridPosition > 0,
    );
  const pointsScored = resultSessions.reduce(
    (sum, session) => sum + (session.playerRaceResult?.points ?? 0),
    0,
  );

  return {
    scopedSessions,
    resultSessions,
    cleanFinishSessions,
    recentResults: [...resultSessions]
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
      .slice(0, 10),
    trackResults: buildTrackResults(cleanFinishSessions),
    mode,
    modeLabel: getModeLabel(mode),
    modeDetail: getModeDetail(mode),
    totalLaps: scopedSessions.reduce(
      (sum, session) => sum + session.validLapCount,
      0,
    ),
    trackCount: new Set(scopedSessions.map((session) => session.track)).size,
    sessionCount: scopedSessions.length,
    starts: resultSessions.length,
    wins: positions.filter((position) => position === 1).length,
    p2: positions.filter((position) => position === 2).length,
    p3: positions.filter((position) => position === 3).length,
    topFive: positions.filter((position) => position <= 5).length,
    dnfCount: resultSessions.filter((session) =>
      isDnfResultStatus(session.playerRaceResult?.status),
    ).length,
    pointsScored,
    polePositions: gridPositions.filter((gridPosition) => gridPosition === 1)
      .length,
    frontRowStarts: gridPositions.filter((gridPosition) => gridPosition <= 2)
      .length,
    gridStarts: gridPositions.length,
    averageFinish: average(cleanPositions),
    averageGridGain: average(gridGains),
  };
}
