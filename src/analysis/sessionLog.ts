import type { SessionSummary } from "../types/telemetry";
import { getTrackId } from "../utils/tracks";
import { summaryKind, type SessionKind } from "./sessionKind";

/**
 * The session log groups saves the way a driver remembers them: by day and
 * circuit, the online event (quali → race) as one block, everything offline
 * (practice quali runs, long runs, time trials) folded into one group with a
 * summary line. Pure model; `SessionLog` renders it.
 */

export interface SessionLogDay {
  /** YYYY-MM-DD from the save timestamp (local game-PC time, no zone). */
  key: string;
  groups: SessionLogGroup[];
}

export interface SessionLogGroup {
  key: string;
  dayKey: string;
  trackId: string;
  track: string;
  /** Online event block or the offline practice group. */
  online: boolean;
  /** Newest first. */
  sessions: SessionSummary[];
  /** Largest classified field in the group (online events only). */
  driverCount?: number;
  /** "AI 110", "Time trial", or "Offline" for mixed difficulties. */
  offlineLabel?: string;
  counts: Record<SessionKind, number>;
  /** Best lap per kind, for the folded summary line. */
  bestMs: Partial<Record<SessionKind, number>>;
}

export function sessionDayKey(session: SessionSummary): string {
  return session.date.split("T")[0];
}

/** Best lap a log row shows: quali/TT best, or the race/long-run best lap. */
export function sessionBestLapMs(session: SessionSummary): number | undefined {
  const ms = session.bestLapTimeMs ?? session.playerRaceResult?.bestLapTimeMs;
  return ms && ms > 0 ? ms : undefined;
}

function offlineLabel(sessions: SessionSummary[]): string {
  const difficulties = new Set(
    sessions
      .filter((s) => summaryKind(s) !== "time-trial")
      .map((s) => s.aiDifficulty)
      .filter((d): d is number => typeof d === "number" && d > 0),
  );
  if (difficulties.size === 0) {
    return sessions.every((s) => summaryKind(s) === "time-trial")
      ? "Time trial"
      : "Offline";
  }
  return difficulties.size === 1 ? `AI ${[...difficulties][0]}` : "Offline";
}

function emptyCounts(): Record<SessionKind, number> {
  return { race: 0, "long-run": 0, qualifying: 0, "time-trial": 0 };
}

/** Sessions must already be scoped and filtered; any order. */
export function buildSessionLog(sessions: SessionSummary[]): SessionLogDay[] {
  const sorted = [...sessions].sort((a, b) => b.date.localeCompare(a.date));
  const days = new Map<string, Map<string, SessionLogGroup>>();

  for (const session of sorted) {
    const dayKey = sessionDayKey(session);
    const trackId = getTrackId(session.track);
    const online = session.isOnline === true;
    const groupKey = `${dayKey}::${trackId}::${online ? "online" : "offline"}`;
    let groups = days.get(dayKey);
    if (!groups) {
      groups = new Map();
      days.set(dayKey, groups);
    }
    let group = groups.get(groupKey);
    if (!group) {
      group = {
        key: groupKey,
        dayKey,
        trackId,
        track: session.track,
        online,
        sessions: [],
        counts: emptyCounts(),
        bestMs: {},
      };
      groups.set(groupKey, group);
    }
    group.sessions.push(session);
    const kind = summaryKind(session);
    group.counts[kind] += 1;
    const best = sessionBestLapMs(session);
    if (best && (group.bestMs[kind] == null || best < group.bestMs[kind]!)) {
      group.bestMs[kind] = best;
    }
    if (online) {
      group.driverCount = Math.max(
        group.driverCount ?? 0,
        session.classifiedDriverCount ?? 0,
      );
    }
  }

  return [...days.entries()].map(([key, groups]) => {
    const list = [...groups.values()];
    for (const group of list) {
      if (!group.online) group.offlineLabel = offlineLabel(group.sessions);
    }
    // Online events lead their day; within each half, the most recent first.
    list.sort((a, b) => {
      if (a.online !== b.online) return a.online ? -1 : 1;
      return b.sessions[0].date.localeCompare(a.sessions[0].date);
    });
    return { key, groups: list };
  });
}

/** The log flattened in display order, for ‹ › stepping on session pages. */
export function sessionLogOrder(days: SessionLogDay[]): SessionSummary[] {
  return days.flatMap((day) => day.groups.flatMap((group) => group.sessions));
}
