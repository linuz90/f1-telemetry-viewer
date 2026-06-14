import type { SessionSummary } from "../types/telemetry";
import {
  compareFormulaComparisonKeys,
  getFormulaComparisonAliases,
  getFormulaComparisonKey,
  getFormulaLabel,
  isRaceSessionType,
  shouldShowFormulaLabel,
} from "./sessionTypes";

export interface FormulaScopeOption {
  key: string;
  label: string;
  sessionCount: number;
  latestTime: number;
  showLabel: boolean;
}

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

export function getFormulaScopeOptions(sessions: SessionSummary[]): FormulaScopeOption[] {
  const options = new Map<string, FormulaScopeOption>();

  for (const session of sessions) {
    const key = getFormulaComparisonKey(session.formula, session.gameYear);
    const existing = options.get(key);
    const latestTime = new Date(session.date).getTime();

    if (existing) {
      existing.sessionCount += 1;
      existing.latestTime = Math.max(existing.latestTime, latestTime);
      existing.showLabel =
        existing.showLabel ||
        shouldShowFormulaLabel(session.formula, session.gameYear);
    } else {
      options.set(key, {
        key,
        label: getFormulaLabel(session.formula, session.gameYear),
        sessionCount: 1,
        latestTime,
        showLabel: shouldShowFormulaLabel(session.formula, session.gameYear),
      });
    }
  }

  return [...options.values()].sort((a, b) => {
    const formulaOrder = compareFormulaComparisonKeys(a.key, b.key);
    if (formulaOrder !== 0) return formulaOrder;
    if (a.latestTime !== b.latestTime) return b.latestTime - a.latestTime;
    return a.label.localeCompare(b.label);
  });
}

export function getSessionFormulaScopeKey(session: SessionSummary): string {
  return getFormulaComparisonKey(session.formula, session.gameYear);
}

export function resolveFormulaScopeKey(
  sessions: SessionSummary[],
  requestedKey: string | null | undefined,
): string | undefined {
  const options = getFormulaScopeOptions(sessions);
  if (options.length === 0) return undefined;

  if (requestedKey) {
    const optionKeys = new Set(options.map((option) => option.key));
    if (optionKeys.has(requestedKey)) return requestedKey;

    for (const session of sessions) {
      const key = getSessionFormulaScopeKey(session);
      if (
        optionKeys.has(key) &&
        getFormulaComparisonAliases(session.formula, session.gameYear).includes(
          requestedKey,
        )
      ) {
        return key;
      }
    }
  }

  return options[0]?.key;
}

export function resolveFormulaScopeAlias(
  sessions: SessionSummary[],
  requestedKey: string | null | undefined,
): string | undefined {
  if (!requestedKey) return undefined;

  const options = getFormulaScopeOptions(sessions);
  const optionKeys = new Set(options.map((option) => option.key));
  if (optionKeys.has(requestedKey)) return requestedKey;

  for (const session of sessions) {
    const key = getSessionFormulaScopeKey(session);
    if (
      optionKeys.has(key) &&
      getFormulaComparisonAliases(session.formula, session.gameYear).includes(
        requestedKey,
      )
    ) {
      return key;
    }
  }

  return undefined;
}

export function getDefaultFormulaScopeKey(sessions: SessionSummary[]): string | undefined {
  return getFormulaScopeOptions(sessions)[0]?.key;
}

export function isRepresentativeOnlineRace(session: SessionSummary): boolean {
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
    session.playerRaceResult != null &&
    session.playerRaceResult.playerLaps > 0
  );
}

function isFinishedStatus(status: string | undefined): boolean {
  if (!status) return true;
  const normalized = status.toUpperCase().replace(/[\s-]+/g, "_");
  return normalized === "FINISHED";
}

function isDnfStatus(status: string | undefined): boolean {
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
    return result.playerLaps >= result.totalLaps - 2 || (result.lapRatio ?? 0) >= 0.9;
  }

  return result.playerLaps > 0;
}

function average(values: number[]): number | undefined {
  if (values.length === 0) return undefined;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function getGridGain(session: SessionSummary): number | undefined {
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

function buildTrackResults(cleanFinishSessions: SessionSummary[]): TrackResultSummary[] {
  const groups = new Map<string, SessionSummary[]>();
  for (const session of cleanFinishSessions) {
    const group = groups.get(session.track) ?? [];
    group.push(session);
    groups.set(session.track, group);
  }

  return [...groups.entries()]
    .filter(([, sessions]) => sessions.length >= 2)
    .map(([track, sessions]) => {
      const positions = sessions.map((session) => session.playerRaceResult?.position ?? 0);
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
      if (a.averageFinish !== b.averageFinish) return a.averageFinish - b.averageFinish;
      return b.races - a.races;
    });
}

export type InsightScope = "online" | "race" | "quali";

export type InsightKind =
  | "best-track"
  | "toughest-track"
  | "best-qualifier"
  | "toughest-qualifier"
  | "race-craft"
  | "most-improved"
  | "most-consistent"
  | "hot-streak"
  | "comeback-drive"
  | "podium-specialist"
  | "penalty-magnet"
  | "wet-weather"
  | "race-consistency"
  | "fastest-lap-king"
  | "lap-one-starter"
  | "top-speed-king"
  | "tyre-whisperer"
  | "sector-specialist"
  | "net-overtakes";

export interface TrackInsight {
  kind: InsightKind;
  track: string;
  formulaKey: string;
  scope: InsightScope;
  headline: string;
  detail: string;
  /** Single-session highlights use this as their primary destination. */
  sessionSlug?: string;
  /** Underlying data depth — used to rank insights when more than 9 qualify. */
  sampleSize: number;
}

function groupBy<T>(items: T[], key: (item: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const k = key(item);
    const arr = map.get(k) ?? [];
    arr.push(item);
    map.set(k, arr);
  }
  return map;
}

function stddev(values: number[]): number {
  const n = values.length;
  if (n < 2) return 0;
  const mean = values.reduce((sum, value) => sum + value, 0) / n;
  const variance =
    values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (n - 1);
  return Math.sqrt(variance);
}

function getRaceInsightScope(mode: ResultDataMode): InsightScope {
  return mode === "representative-online" || mode === "online" ? "online" : "race";
}

function pickRepresentativeFormulaKey(sessions: SessionSummary[]): string {
  return getSessionFormulaScopeKey(sessions[0]);
}

function buildBestTrackInsight(
  result: TrackResultSummary,
  cleanFinishSessions: SessionSummary[],
  scope: InsightScope,
): TrackInsight {
  const sessions = cleanFinishSessions.filter((s) => s.track === result.track);
  return {
    kind: "best-track",
    track: result.track,
    formulaKey: pickRepresentativeFormulaKey(sessions),
    scope,
    headline: `P${result.averageFinish.toFixed(1)}`,
    detail: `${result.races} clean races · best P${result.bestFinish}`,
    sampleSize: result.races,
  };
}

function buildToughestTrackInsight(
  result: TrackResultSummary,
  cleanFinishSessions: SessionSummary[],
  scope: InsightScope,
): TrackInsight {
  const sessions = cleanFinishSessions.filter((s) => s.track === result.track);
  return {
    kind: "toughest-track",
    track: result.track,
    formulaKey: pickRepresentativeFormulaKey(sessions),
    scope,
    headline: `P${result.averageFinish.toFixed(1)}`,
    detail: `${result.races} clean races · best P${result.bestFinish}`,
    sampleSize: result.races,
  };
}

function buildQualifierInsights(
  resultSessions: SessionSummary[],
  scope: InsightScope,
): TrackInsight[] {
  const withGrid = resultSessions.filter(
    (s) =>
      s.playerRaceResult?.gridPosition != null &&
      s.playerRaceResult.gridPosition > 0,
  );
  const byTrack = groupBy(withGrid, (s) => s.track);
  const candidates = [...byTrack.entries()]
    .filter(([, sessions]) => sessions.length >= 2)
    .map(([track, sessions]) => {
      const grids = sessions.map((s) => s.playerRaceResult!.gridPosition!);
      return {
        track,
        sessions,
        avg: grids.reduce((a, b) => a + b, 0) / grids.length,
        best: Math.min(...grids),
      };
    });
  if (candidates.length < 2) return [];
  candidates.sort((a, b) => a.avg - b.avg);
  const best = candidates[0]!;
  const worst = candidates.at(-1)!;
  if (worst.avg - best.avg < 1.0) return [];

  return [
    {
      kind: "best-qualifier",
      track: best.track,
      formulaKey: pickRepresentativeFormulaKey(best.sessions),
      scope,
      headline: `P${best.avg.toFixed(1)}`,
      detail: `${best.sessions.length} races · best P${best.best} on grid`,
      sampleSize: best.sessions.length,
    },
    {
      kind: "toughest-qualifier",
      track: worst.track,
      formulaKey: pickRepresentativeFormulaKey(worst.sessions),
      scope,
      headline: `P${worst.avg.toFixed(1)}`,
      detail: `${worst.sessions.length} races · best P${worst.best} on grid`,
      sampleSize: worst.sessions.length,
    },
  ];
}

function buildRaceCraftInsight(
  resultSessions: SessionSummary[],
  scope: InsightScope,
): TrackInsight | undefined {
  const withGain = resultSessions.filter(
    (s) =>
      s.playerRaceResult?.gridPosition != null &&
      s.playerRaceResult.gridPosition > 0 &&
      s.playerRaceResult?.position != null,
  );
  const byTrack = groupBy(withGain, (s) => s.track);
  const candidates = [...byTrack.entries()]
    .filter(([, sessions]) => sessions.length >= 2)
    .map(([track, sessions]) => {
      const gains = sessions.map(
        (s) => s.playerRaceResult!.gridPosition! - s.playerRaceResult!.position,
      );
      return {
        track,
        sessions,
        avgGain: gains.reduce((a, b) => a + b, 0) / gains.length,
      };
    });
  if (candidates.length < 2) return undefined;
  const winner = candidates.sort((a, b) => b.avgGain - a.avgGain)[0]!;
  if (winner.avgGain < 1.0) return undefined;
  return {
    kind: "race-craft",
    track: winner.track,
    formulaKey: pickRepresentativeFormulaKey(winner.sessions),
    scope,
    headline: `+${winner.avgGain.toFixed(1)}`,
    detail: `${winner.sessions.length} races · avg positions gained`,
    sampleSize: winner.sessions.length,
  };
}

function buildMostImprovedInsight(
  cleanFinishSessions: SessionSummary[],
  scope: InsightScope,
): TrackInsight | undefined {
  const byTrack = groupBy(cleanFinishSessions, (s) => s.track);
  const candidates = [...byTrack.entries()]
    .filter(([, sessions]) => sessions.length >= 4)
    .map(([track, sessions]) => {
      const sorted = [...sessions].sort(
        (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime(),
      );
      const half = Math.floor(sorted.length / 2);
      const olderPos = sorted
        .slice(0, half)
        .map((s) => s.playerRaceResult!.position);
      const newerPos = sorted
        .slice(-half)
        .map((s) => s.playerRaceResult!.position);
      const oldAvg = olderPos.reduce((a, b) => a + b, 0) / olderPos.length;
      const newAvg = newerPos.reduce((a, b) => a + b, 0) / newerPos.length;
      return {
        track,
        sessions: sorted,
        oldAvg,
        newAvg,
        improvement: oldAvg - newAvg,
      };
    });
  if (candidates.length === 0) return undefined;
  const winner = candidates.sort((a, b) => b.improvement - a.improvement)[0]!;
  if (winner.improvement < 1.5) return undefined;
  return {
    kind: "most-improved",
    track: winner.track,
    formulaKey: pickRepresentativeFormulaKey(winner.sessions),
    scope,
    headline: `▲ ${winner.improvement.toFixed(1)}`,
    detail: `P${winner.oldAvg.toFixed(1)} → P${winner.newAvg.toFixed(1)} recently`,
    sampleSize: winner.sessions.length,
  };
}

function buildMostConsistentInsight(
  scopedSessions: SessionSummary[],
): TrackInsight | undefined {
  const qualiSessions = scopedSessions.filter(
    (s) =>
      !isRaceSessionType(s.sessionType) &&
      s.bestLapTimeMs != null &&
      s.bestLapTimeMs > 0,
  );
  const byKey = groupBy(
    qualiSessions,
    (s) => `${s.track}::${getSessionFormulaScopeKey(s)}`,
  );
  const candidates = [...byKey.entries()]
    .filter(([, sessions]) => sessions.length >= 3)
    .map(([, sessions]) => {
      const times = sessions.map((s) => s.bestLapTimeMs!);
      const mean = times.reduce((a, b) => a + b, 0) / times.length;
      const std = stddev(times);
      return {
        track: sessions[0]!.track,
        formulaKey: getSessionFormulaScopeKey(sessions[0]!),
        sessions,
        std,
        cv: std / mean,
      };
    });
  if (candidates.length < 2) return undefined;
  const winner = candidates.sort((a, b) => a.cv - b.cv)[0]!;
  return {
    kind: "most-consistent",
    track: winner.track,
    formulaKey: winner.formulaKey,
    scope: "quali",
    headline: `±${(winner.std / 1000).toFixed(2)}s`,
    detail: `${winner.sessions.length} sessions · best lap spread`,
    sampleSize: winner.sessions.length,
  };
}

function isWetWeather(weather: string | undefined): boolean {
  if (!weather) return false;
  return /rain|storm|thunder|wet/i.test(weather);
}

function formatShortDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString("en-GB", {
    month: "short",
    day: "numeric",
  });
}

function buildHotStreakInsight(
  resultSessions: SessionSummary[],
  scope: InsightScope,
): TrackInsight | undefined {
  const sorted = [...resultSessions].sort(
    (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime(),
  );
  let streak = 0;
  let mostRecent: SessionSummary | undefined;
  for (const session of sorted) {
    const result = session.playerRaceResult;
    const inPoints = (result?.points ?? 0) > 0 && !isDnfStatus(result?.status);
    if (!inPoints) break;
    streak++;
    if (!mostRecent) mostRecent = session;
  }
  if (streak < 2 || !mostRecent) return undefined;
  const pos = mostRecent.playerRaceResult?.position;
  return {
    kind: "hot-streak",
    track: mostRecent.track,
    formulaKey: getSessionFormulaScopeKey(mostRecent),
    scope,
    headline: `${streak}`,
    detail: `consecutive points finishes · last P${pos ?? "?"}`,
    sessionSlug: mostRecent.slug,
    sampleSize: streak,
  };
}

function buildComebackInsight(
  resultSessions: SessionSummary[],
  scope: InsightScope,
): TrackInsight | undefined {
  const withGain = resultSessions
    .map((session) => {
      const gain = getGridGain(session);
      return gain != null ? { session, gain } : undefined;
    })
    .filter((entry): entry is { session: SessionSummary; gain: number } => entry != null);
  if (withGain.length < 2) return undefined;
  const winner = withGain.sort((a, b) => b.gain - a.gain)[0]!;
  if (winner.gain < 3) return undefined;
  const result = winner.session.playerRaceResult!;
  return {
    kind: "comeback-drive",
    track: winner.session.track,
    formulaKey: getSessionFormulaScopeKey(winner.session),
    scope,
    headline: `+${winner.gain}`,
    detail: `P${result.gridPosition} → P${result.position} · ${formatShortDate(winner.session.date)}`,
    sessionSlug: winner.session.slug,
    sampleSize: withGain.length,
  };
}

function buildPodiumSpecialistInsight(
  cleanFinishSessions: SessionSummary[],
  scope: InsightScope,
): TrackInsight | undefined {
  const byTrack = groupBy(cleanFinishSessions, (s) => s.track);
  const candidates = [...byTrack.entries()]
    .filter(([, sessions]) => sessions.length >= 2)
    .map(([track, sessions]) => {
      const podiums = sessions.filter(
        (s) => (s.playerRaceResult?.position ?? 99) <= 3,
      ).length;
      return { track, sessions, podiums, rate: podiums / sessions.length };
    })
    .filter((c) => c.podiums >= 2);
  if (candidates.length === 0) return undefined;
  const winner = candidates.sort((a, b) => {
    if (b.rate !== a.rate) return b.rate - a.rate;
    return b.sessions.length - a.sessions.length;
  })[0]!;
  return {
    kind: "podium-specialist",
    track: winner.track,
    formulaKey: pickRepresentativeFormulaKey(winner.sessions),
    scope,
    headline: `${Math.round(winner.rate * 100)}%`,
    detail: `${winner.podiums} of ${winner.sessions.length} races on podium`,
    sampleSize: winner.sessions.length,
  };
}

function buildPenaltyMagnetInsight(
  resultSessions: SessionSummary[],
  scope: InsightScope,
): TrackInsight | undefined {
  const withPenalty = resultSessions.filter(
    (s) => s.playerRaceResult?.penaltyCount != null,
  );
  const byTrack = groupBy(withPenalty, (s) => s.track);
  const candidates = [...byTrack.entries()]
    .filter(([, sessions]) => sessions.length >= 2)
    .map(([track, sessions]) => {
      const counts = sessions.map((s) => s.playerRaceResult!.penaltyCount ?? 0);
      const avg = counts.reduce((a, b) => a + b, 0) / counts.length;
      return { track, sessions, avg };
    })
    // 1 penalty/race is normal racing — only flag when the user is meaningfully
    // accumulating penalties at a track (≥2 avg).
    .filter((c) => c.avg >= 2);
  if (candidates.length === 0) return undefined;
  const winner = candidates.sort((a, b) => b.avg - a.avg)[0]!;
  return {
    kind: "penalty-magnet",
    track: winner.track,
    formulaKey: pickRepresentativeFormulaKey(winner.sessions),
    scope,
    headline: winner.avg.toFixed(1),
    detail: `avg penalties · ${winner.sessions.length} races`,
    sampleSize: winner.sessions.length,
  };
}

function buildWetWeatherInsight(
  resultSessions: SessionSummary[],
  scope: InsightScope,
): TrackInsight | undefined {
  const wet = resultSessions.filter((s) => isWetWeather(s.weather));
  const dry = resultSessions.filter((s) => s.weather && !isWetWeather(s.weather));
  if (wet.length < 2 || dry.length < 2) return undefined;
  const wetAvg =
    wet.reduce((sum, s) => sum + (s.playerRaceResult?.position ?? 0), 0) /
    wet.length;
  const dryAvg =
    dry.reduce((sum, s) => sum + (s.playerRaceResult?.position ?? 0), 0) /
    dry.length;
  // Need a meaningful delta (≥1.5 positions) so we don't surface noise
  if (Math.abs(dryAvg - wetAvg) < 1.5) return undefined;
  const wetIsBetter = wetAvg < dryAvg;
  const representative = [...wet].sort(
    (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime(),
  )[0]!;
  const arrow = wetIsBetter ? "▼" : "▲";
  return {
    kind: "wet-weather",
    track: representative.track,
    formulaKey: getSessionFormulaScopeKey(representative),
    scope,
    headline: `P${wetAvg.toFixed(1)}`,
    detail: `${wet.length} wet races · ${arrow} ${Math.abs(dryAvg - wetAvg).toFixed(1)} vs dry`,
    sampleSize: wet.length,
  };
}

function buildRaceConsistencyInsight(
  cleanFinishSessions: SessionSummary[],
  scope: InsightScope,
): TrackInsight | undefined {
  const byTrack = groupBy(cleanFinishSessions, (s) => s.track);
  const candidates = [...byTrack.entries()]
    .filter(([, sessions]) => sessions.length >= 3)
    .map(([track, sessions]) => {
      const positions = sessions.map((s) => s.playerRaceResult!.position);
      return { track, sessions, std: stddev(positions) };
    });
  if (candidates.length < 2) return undefined;
  const winner = candidates.sort((a, b) => a.std - b.std)[0]!;
  return {
    kind: "race-consistency",
    track: winner.track,
    formulaKey: pickRepresentativeFormulaKey(winner.sessions),
    scope,
    headline: `±${winner.std.toFixed(1)}`,
    detail: `${winner.sessions.length} races · most stable finishes`,
    sampleSize: winner.sessions.length,
  };
}

function buildFastestLapKingInsight(
  resultSessions: SessionSummary[],
  scope: InsightScope,
): TrackInsight | undefined {
  const flSessions = resultSessions.filter((s) => s.playerSetFastestLap === true);
  if (flSessions.length === 0) return undefined;
  // Need at least 2 FLs OR at least 1 FL across 4+ races to be noteworthy
  if (flSessions.length < 2 && resultSessions.length < 4) return undefined;
  const mostRecent = [...flSessions].sort(
    (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime(),
  )[0]!;
  return {
    kind: "fastest-lap-king",
    track: mostRecent.track,
    formulaKey: getSessionFormulaScopeKey(mostRecent),
    scope,
    headline: `${flSessions.length}`,
    detail: `races with fastest lap · last at ${mostRecent.track}`,
    sessionSlug: mostRecent.slug,
    sampleSize: flSessions.length,
  };
}

function pickMostRecentSession(sessions: SessionSummary[]): SessionSummary {
  return [...sessions].sort(
    (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime(),
  )[0]!;
}

function buildLapOneStarterInsight(
  resultSessions: SessionSummary[],
  scope: InsightScope,
): TrackInsight | undefined {
  const entries = resultSessions
    .map((session) => {
      const grid = session.playerRaceResult?.gridPosition;
      const lapOne = session.lapOnePosition;
      if (!grid || grid <= 0 || !lapOne || lapOne <= 0) return undefined;
      return { session, gained: grid - lapOne };
    })
    .filter((entry): entry is { session: SessionSummary; gained: number } => entry != null);
  if (entries.length < 3) return undefined;
  const avg = entries.reduce((sum, entry) => sum + entry.gained, 0) / entries.length;
  // Gaining < 0.5 positions on lap 1 is noise — only highlight a meaningful trend.
  if (avg < 0.5) return undefined;
  const mostRecent = pickMostRecentSession(entries.map((entry) => entry.session));
  return {
    kind: "lap-one-starter",
    track: mostRecent.track,
    formulaKey: getSessionFormulaScopeKey(mostRecent),
    scope,
    headline: `+${avg.toFixed(1)}`,
    detail: `avg lap-1 positions gained · ${entries.length} races`,
    sampleSize: entries.length,
  };
}

function buildTopSpeedKingInsight(
  resultSessions: SessionSummary[],
  scope: InsightScope,
): TrackInsight | undefined {
  const entries = resultSessions.filter(
    (session) =>
      typeof session.topSpeedTrapRank === "number" && session.topSpeedTrapRank > 0,
  );
  if (entries.length < 3) return undefined;
  const avgRank =
    entries.reduce((sum, session) => sum + (session.topSpeedTrapRank ?? 0), 0) /
    entries.length;
  // Only celebrate top-half results.
  if (avgRank > 8) return undefined;
  const mostRecent = pickMostRecentSession(entries);
  return {
    kind: "top-speed-king",
    track: mostRecent.track,
    formulaKey: getSessionFormulaScopeKey(mostRecent),
    scope,
    headline: `P${avgRank.toFixed(1)}`,
    detail: `avg speed-trap rank · ${entries.length} races`,
    sampleSize: entries.length,
  };
}

// Compounds worth aggregating across — exclude unknown / development tyres.
const TYRE_COMPOUNDS = new Set(["Soft", "Medium", "Hard", "Intermediate", "Wet"]);

function buildTyreWhispererInsight(
  resultSessions: SessionSummary[],
  scope: InsightScope,
): TrackInsight | undefined {
  const byCompound = new Map<
    string,
    { totalLaps: number; totalWear: number; stints: number; sessions: SessionSummary[] }
  >();
  for (const session of resultSessions) {
    for (const stint of session.stints ?? []) {
      // Drop very short stints — typically formation, SC restart, in-laps — they distort the wear/lap rate.
      if (stint.laps < 3) continue;
      if (!TYRE_COMPOUNDS.has(stint.compound)) continue;
      const entry = byCompound.get(stint.compound) ?? {
        totalLaps: 0,
        totalWear: 0,
        stints: 0,
        sessions: [],
      };
      entry.totalLaps += stint.laps;
      entry.totalWear += stint.endWearAvg;
      entry.stints += 1;
      entry.sessions.push(session);
      byCompound.set(stint.compound, entry);
    }
  }
  const candidates = [...byCompound.entries()]
    .filter(([, data]) => data.stints >= 3 && data.totalLaps > 0)
    .map(([compound, data]) => ({
      compound,
      stints: data.stints,
      wearPerLap: data.totalWear / data.totalLaps,
      sessions: data.sessions,
    }));
  if (candidates.length === 0) return undefined;
  const winner = candidates.sort((a, b) => a.wearPerLap - b.wearPerLap)[0]!;
  const mostRecent = pickMostRecentSession(winner.sessions);
  return {
    kind: "tyre-whisperer",
    track: mostRecent.track,
    formulaKey: getSessionFormulaScopeKey(mostRecent),
    scope,
    headline: `${winner.wearPerLap.toFixed(2)}%/lap`,
    detail: `${winner.compound}s · ${winner.stints} stints`,
    sampleSize: winner.stints,
  };
}

function buildSectorSpecialistInsight(
  resultSessions: SessionSummary[],
  scope: InsightScope,
): TrackInsight | undefined {
  const eligible = resultSessions.filter((session) => session.purpleSectors != null);
  if (eligible.length < 3) return undefined;
  const counts = [1, 2, 3].map((idx) => {
    const sessions = eligible.filter(
      (session) => session.purpleSectors?.[`s${idx}` as "s1" | "s2" | "s3"],
    );
    return { idx, count: sessions.length, sessions };
  });
  const top = counts.sort((a, b) => b.count - a.count)[0]!;
  // Need to own the sector in ≥2 races AND ≥30% of eligible races to call it "your sector".
  if (top.count < 2 || top.count / eligible.length < 0.3) return undefined;
  const mostRecent = pickMostRecentSession(top.sessions);
  return {
    kind: "sector-specialist",
    track: mostRecent.track,
    formulaKey: getSessionFormulaScopeKey(mostRecent),
    scope,
    headline: `S${top.idx}`,
    detail: `purple in ${top.count} of ${eligible.length} races`,
    sampleSize: top.count,
  };
}

function buildNetOvertakesInsight(
  resultSessions: SessionSummary[],
  scope: InsightScope,
): TrackInsight | undefined {
  const entries = resultSessions.filter(
    (session) =>
      typeof session.overtakesMade === "number" &&
      typeof session.overtakesTaken === "number",
  );
  if (entries.length < 3) return undefined;
  const totalMade = entries.reduce((sum, s) => sum + (s.overtakesMade ?? 0), 0);
  const totalTaken = entries.reduce((sum, s) => sum + (s.overtakesTaken ?? 0), 0);
  const net = totalMade - totalTaken;
  if (net < 5) return undefined;
  const mostRecent = pickMostRecentSession(entries);
  return {
    kind: "net-overtakes",
    track: mostRecent.track,
    formulaKey: getSessionFormulaScopeKey(mostRecent),
    scope,
    headline: `+${net}`,
    detail: `${totalMade} made, ${totalTaken} taken · ${entries.length} races`,
    sampleSize: entries.length,
  };
}

// Ranking tiebreaker — when two insights have equal sampleSize, keep this stable order.
const INSIGHT_KIND_PRIORITY: Record<InsightKind, number> = {
  "best-track": 0,
  "toughest-track": 1,
  "best-qualifier": 2,
  "toughest-qualifier": 3,
  "race-craft": 4,
  "podium-specialist": 5,
  "hot-streak": 6,
  "comeback-drive": 7,
  "most-improved": 8,
  "race-consistency": 9,
  "most-consistent": 10,
  "tyre-whisperer": 11,
  "sector-specialist": 12,
  "net-overtakes": 13,
  "lap-one-starter": 14,
  "top-speed-king": 15,
  "fastest-lap-king": 16,
  "wet-weather": 17,
  "penalty-magnet": 18,
};

const MAX_INSIGHTS = 9;

export function buildTrackInsights(stats: DashboardResultStats): TrackInsight[] {
  const raceScope = getRaceInsightScope(stats.mode);
  const insights: TrackInsight[] = [];

  if (stats.trackResults.length >= 2) {
    const best = stats.trackResults[0]!;
    const worst = stats.trackResults.at(-1)!;
    if (best.track !== worst.track) {
      insights.push(buildBestTrackInsight(best, stats.cleanFinishSessions, raceScope));
      insights.push(
        buildToughestTrackInsight(worst, stats.cleanFinishSessions, raceScope),
      );
    }
  }

  insights.push(...buildQualifierInsights(stats.resultSessions, raceScope));

  const raceCraft = buildRaceCraftInsight(stats.resultSessions, raceScope);
  if (raceCraft) insights.push(raceCraft);

  const improved = buildMostImprovedInsight(stats.cleanFinishSessions, raceScope);
  if (improved) insights.push(improved);

  const consistent = buildMostConsistentInsight(stats.scopedSessions);
  if (consistent) insights.push(consistent);

  const hotStreak = buildHotStreakInsight(stats.resultSessions, raceScope);
  if (hotStreak) insights.push(hotStreak);

  const comeback = buildComebackInsight(stats.resultSessions, raceScope);
  if (comeback) insights.push(comeback);

  const podium = buildPodiumSpecialistInsight(stats.cleanFinishSessions, raceScope);
  if (podium) insights.push(podium);

  const penalty = buildPenaltyMagnetInsight(stats.resultSessions, raceScope);
  if (penalty) insights.push(penalty);

  const wet = buildWetWeatherInsight(stats.resultSessions, raceScope);
  if (wet) insights.push(wet);

  const raceConsistency = buildRaceConsistencyInsight(
    stats.cleanFinishSessions,
    raceScope,
  );
  if (raceConsistency) insights.push(raceConsistency);

  const flKing = buildFastestLapKingInsight(stats.resultSessions, raceScope);
  if (flKing) insights.push(flKing);

  const lapOne = buildLapOneStarterInsight(stats.resultSessions, raceScope);
  if (lapOne) insights.push(lapOne);

  const topSpeed = buildTopSpeedKingInsight(stats.resultSessions, raceScope);
  if (topSpeed) insights.push(topSpeed);

  const tyres = buildTyreWhispererInsight(stats.resultSessions, raceScope);
  if (tyres) insights.push(tyres);

  const sectors = buildSectorSpecialistInsight(stats.resultSessions, raceScope);
  if (sectors) insights.push(sectors);

  const overtakes = buildNetOvertakesInsight(stats.resultSessions, raceScope);
  if (overtakes) insights.push(overtakes);

  // Rank by data depth, then by kind priority for stable tiebreaks, then cap at MAX_INSIGHTS.
  // Keeps strong-data insights visible when many qualify; weaker ones drop off the bottom.
  return insights
    .sort((a, b) => {
      if (b.sampleSize !== a.sampleSize) return b.sampleSize - a.sampleSize;
      return INSIGHT_KIND_PRIORITY[a.kind] - INSIGHT_KIND_PRIORITY[b.kind];
    })
    .slice(0, MAX_INSIGHTS);
}

export function getDashboardResultStats(
  sessions: SessionSummary[],
  formulaKey: string | undefined,
): DashboardResultStats {
  const scopedSessions = formulaKey
    ? sessions.filter((session) => getSessionFormulaScopeKey(session) === formulaKey)
    : sessions;
  const { mode, sessions: resultSessions } = chooseResultSessions(scopedSessions);
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
    .filter((gridPosition): gridPosition is number => gridPosition != null && gridPosition > 0);
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
    totalLaps: scopedSessions.reduce((sum, session) => sum + session.validLapCount, 0),
    trackCount: new Set(scopedSessions.map((session) => session.track)).size,
    sessionCount: scopedSessions.length,
    starts: resultSessions.length,
    wins: positions.filter((position) => position === 1).length,
    p2: positions.filter((position) => position === 2).length,
    p3: positions.filter((position) => position === 3).length,
    topFive: positions.filter((position) => position <= 5).length,
    dnfCount: resultSessions.filter((session) =>
      isDnfStatus(session.playerRaceResult?.status),
    ).length,
    pointsScored,
    polePositions: gridPositions.filter((gridPosition) => gridPosition === 1).length,
    frontRowStarts: gridPositions.filter((gridPosition) => gridPosition <= 2).length,
    gridStarts: gridPositions.length,
    averageFinish: average(cleanPositions),
    averageGridGain: average(gridGains),
  };
}
