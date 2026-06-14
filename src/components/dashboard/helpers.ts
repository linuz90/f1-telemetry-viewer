import { Medal, Trophy, type LucideIcon } from "lucide-react";
import {
  ACCENT_TOKENS,
  type AccentColor,
  accentCardClass,
} from "../Card";
import type { SessionSummary } from "../../types/telemetry";
import {
  getFormulaComparisonKey,
  getFormulaLabel,
  isQualifyingSessionType,
  isRaceSessionType,
  isTimeTrialSessionType,
} from "../../utils/sessionTypes";
import { trackPath } from "../../utils/routes";

export interface SessionStats {
  summary: SessionSummary;
  isRace: boolean;
  bestLapMs: number;
  validLapCount: number;
}

export interface TrackGroup {
  key: string;
  track: string;
  formulaKey: string;
  formulaLabel: string;
  stats: SessionStats[];
}

export interface TrackLapRecord {
  session: SessionSummary;
  time: string;
  timeMs: number;
}

export interface TrackRaceRecord {
  session: SessionSummary;
  position: number;
  status?: string;
  gridGain?: number;
}

export interface TrackRecords {
  race?: TrackRaceRecord;
  onlineQualifying?: TrackLapRecord;
  offlineQualifying?: TrackLapRecord;
  timeTrial?: TrackLapRecord;
}

export function trackFormulaPath(track: string, formulaKey: string): string {
  return trackPath(formulaKey, track);
}

export function positionLabel(position: number | undefined): string {
  return position ? `P${position}` : "—";
}

export function averagePositionLabel(value: number | undefined): string {
  return value == null ? "—" : `P${value.toFixed(1)}`;
}

export function signedNumber(value: number | undefined): string {
  if (value == null) return "—";
  if (Math.abs(value) < 0.05) return "0.0";
  return `${value > 0 ? "+" : ""}${value.toFixed(1)}`;
}

export function gridGainTone(value: number | undefined): string {
  if (value == null || Math.abs(value) < 0.05) return "text-zinc-300";
  return value > 0 ? "text-emerald-400" : "text-red-400";
}

export function dnfRate(dnfCount: number, starts: number): string {
  if (starts === 0) return "—";
  return `${Math.round((dnfCount / starts) * 100)}%`;
}

export function resultStatusLabel(status: string | undefined): string {
  if (!status) return "Finished";
  const normalized = status.toUpperCase().replace(/[\s-]+/g, "_");
  if (normalized === "DID_NOT_FINISH") return "DNF";
  if (normalized === "DISQUALIFIED") return "DSQ";
  if (normalized === "FINISHED") return "Finished";
  return status.replace(/_/g, " ");
}

export function isProblemStatus(status: string | undefined): boolean {
  const normalized = status?.toUpperCase().replace(/[\s-]+/g, "_");
  return (
    normalized === "DNF" ||
    normalized === "DID_NOT_FINISH" ||
    normalized === "RETIRED" ||
    normalized === "DISQUALIFIED" ||
    normalized === "DSQ"
  );
}

function sessionTimestamp(session: SessionSummary): number {
  const time = new Date(session.date).getTime();
  return Number.isFinite(time) ? time : 0;
}

function bestLapRecord(session: SessionSummary): TrackLapRecord | undefined {
  if (!session.bestLapTime || !session.bestLapTimeMs || session.bestLapTimeMs <= 0) {
    return undefined;
  }

  return {
    session,
    time: session.bestLapTime,
    timeMs: session.bestLapTimeMs,
  };
}

function pickBestLapRecord(sessions: SessionSummary[]): TrackLapRecord | undefined {
  return sessions
    .map(bestLapRecord)
    .filter((record): record is TrackLapRecord => Boolean(record))
    .sort((a, b) => {
      const lapDiff = a.timeMs - b.timeMs;
      if (lapDiff !== 0) return lapDiff;
      return sessionTimestamp(b.session) - sessionTimestamp(a.session);
    })[0];
}

function raceRecord(session: SessionSummary): TrackRaceRecord | undefined {
  const result = session.playerRaceResult;
  if (!result || result.position <= 0) return undefined;

  return {
    session,
    position: result.position,
    status: result.status,
    gridGain: result.gridPosition ? result.gridPosition - result.position : undefined,
  };
}

function actualOnlineDriverCount(session: SessionSummary): number {
  return session.activeHumanDriverCount ?? session.onlineDriverCount ?? 0;
}

function isActualOnlineRace(record: TrackRaceRecord): boolean {
  return record.session.isOnline === true && actualOnlineDriverCount(record.session) > 3;
}

function compareRaceRecords(a: TrackRaceRecord, b: TrackRaceRecord): number {
  // A classified finish is a better "best result" than a DNF/DSQ at the
  // same track. If every result is a problem status, the best classified
  // position still gives the user the most truthful compact summary.
  const cleanDiff =
    Number(isProblemStatus(a.status)) - Number(isProblemStatus(b.status));
  if (cleanDiff !== 0) return cleanDiff;

  const positionDiff = a.position - b.position;
  if (positionDiff !== 0) return positionDiff;

  if (a.gridGain != null || b.gridGain != null) {
    const gridDiff =
      (b.gridGain ?? Number.NEGATIVE_INFINITY) -
      (a.gridGain ?? Number.NEGATIVE_INFINITY);
    if (gridDiff !== 0) return gridDiff;
  }

  return sessionTimestamp(b.session) - sessionTimestamp(a.session);
}

function bestRaceWithinTier(records: TrackRaceRecord[]): TrackRaceRecord | undefined {
  return [...records].sort(compareRaceRecords)[0];
}

function pickBestRaceRecord(sessions: SessionSummary[]): TrackRaceRecord | undefined {
  const records = sessions
    .map(raceRecord)
    .filter((record): record is TrackRaceRecord => Boolean(record));

  const actualOnline = records.filter(isActualOnlineRace);
  const otherOnline = records.filter(
    (record) => record.session.isOnline === true && !isActualOnlineRace(record),
  );
  const offline = records.filter((record) => record.session.isOnline !== true);

  // Online race results are the most useful track-card signal because they
  // reflect real competitive context. Prefer lobbies with 4+ actual humans,
  // then weaker online evidence, and only then fall back to AI/offline races.
  return (
    bestRaceWithinTier(actualOnline) ??
    bestRaceWithinTier(otherOnline) ??
    bestRaceWithinTier(offline)
  );
}

export function buildTrackRecords(sessions: SessionSummary[]): TrackRecords {
  // Spectator saves are useful history entries, but their fallback focused
  // driver is not the user. Keep them out of compact PB/result records so
  // dashboard and track cards don't present someone else's lap as "your" best.
  const playerSessions = sessions.filter((session) => session.isSpectator !== true);

  return {
    race: pickBestRaceRecord(
      playerSessions.filter((session) => isRaceSessionType(session.sessionType)),
    ),
    onlineQualifying: pickBestLapRecord(
      playerSessions.filter(
        (session) =>
          isQualifyingSessionType(session.sessionType) &&
          session.isOnline === true,
      ),
    ),
    offlineQualifying: pickBestLapRecord(
      playerSessions.filter(
        (session) =>
          isQualifyingSessionType(session.sessionType) &&
          session.isOnline !== true,
      ),
    ),
    timeTrial: pickBestLapRecord(
      playerSessions.filter((session) => isTimeTrialSessionType(session.sessionType)),
    ),
  };
}

// Shared podium convention: gold/Trophy for P1, silver/Medal for P2, bronze/Medal
// for P3. Used by the hero podium chips, the Recent Activity row badge, and the
// hero "Best" microstat tone — keep these in sync if tweaking. Tiles share the
// app-wide accent recipe from Card.tsx so podium chips look identical in shape
// to insight cards / stint cards / best-lap highlights.
export function positionBadgeClasses(position: number | undefined): string {
  const accent: AccentColor | null =
    position === 1 ? "amber"
    : position === 2 ? "zinc"
    : position === 3 ? "orange"
    : null;
  if (accent) return `${accentCardClass(accent)} ${ACCENT_TOKENS[accent].accent}`;
  return "ring-1 ring-inset ring-white/[0.06] bg-zinc-900/70 text-zinc-100";
}

export function positionTone(position: number | undefined): string {
  if (position === 1) return "text-amber-300";
  if (position === 2) return "text-zinc-200";
  if (position === 3) return "text-orange-300";
  return "text-zinc-100";
}

export function podiumIcon(position: number | undefined): LucideIcon | null {
  if (position === 1) return Trophy;
  if (position === 2 || position === 3) return Medal;
  return null;
}

/** Daily best-quali points per track-group, ready to feed QualifyingPaceCard.
 *  Groups with fewer than 3 distinct days are dropped (no useful trend). */
export function buildQualifyingPaceData(
  trackGroups: Record<string, TrackGroup>,
): Record<
  string,
  TrackGroup & { points: { day: string; bestLap: number }[]; pbMs: number }
> {
  const out: Record<
    string,
    TrackGroup & { points: { day: string; bestLap: number }[]; pbMs: number }
  > = {};
  for (const [key, group] of Object.entries(trackGroups)) {
    const qualiSessions = group.stats.filter(
      (session) =>
        isQualifyingSessionType(session.summary.sessionType) &&
        session.bestLapMs > 0,
    );
    const byDay: Record<string, number> = {};
    for (const session of qualiSessions) {
      const dayKey = session.summary.date.split("T")[0];
      const prev = byDay[dayKey];
      if (!prev || session.bestLapMs < prev) {
        byDay[dayKey] = session.bestLapMs;
      }
    }
    const dayEntries = Object.entries(byDay).sort(([a], [b]) =>
      a.localeCompare(b),
    );
    if (dayEntries.length < 3) continue;
    out[key] = {
      ...group,
      points: dayEntries.map(([dayKey, ms]) => ({
        day: new Date(dayKey).toLocaleDateString("en-GB", {
          day: "numeric",
          month: "short",
        }),
        bestLap: ms / 1000,
      })),
      pbMs: Math.min(...Object.values(byDay)),
    };
  }
  return out;
}

export function buildTrackGroups(
  sessions: SessionStats[],
): Record<string, TrackGroup> {
  const trackGroups: Record<string, TrackGroup> = {};
  for (const session of sessions) {
    const formulaKey = getFormulaComparisonKey(
      session.summary.formula,
      session.summary.gameYear,
    );
    const key = `${session.summary.track}::${formulaKey}`;
    if (!trackGroups[key]) {
      trackGroups[key] = {
        key,
        track: session.summary.track,
        formulaKey,
        formulaLabel: getFormulaLabel(
          session.summary.formula,
          session.summary.gameYear,
        ),
        stats: [],
      };
    }
    trackGroups[key].stats.push(session);
  }
  return trackGroups;
}
