import type { SessionSummary } from "../types/telemetry";
import {
  F1_25_TRACK_CALENDAR_IDS,
  F1_26_TRACK_CALENDAR_IDS,
} from "../constants/tracks";
import { getTrackId, sortTracksByCalendar } from "../utils/tracks";
import { summaryKind } from "./sessionKind";
import { sessionBestLapMs } from "./sessionLog";

/** One card on the Tracks page: what a driver checks before picking a track. */
export interface TrackIndexEntry {
  trackId: string;
  /** Exporter label, for display-name and flag lookups. */
  track: string;
  sessionCount: number;
  lastDate: string;
  /** Best qualifying-style lap (quali sessions only, not time trial). */
  qualiPbMs: number | null;
  timeTrialPbMs: number | null;
  /** Latest online race result here. */
  lastRace: { position: number; date: string; dnf: boolean } | null;
}

export interface TrackIndex {
  /** Calendar order. */
  entries: TrackIndexEntry[];
  /** Calendar circuits with no session in scope. */
  notDriven: string[];
}

export function buildTrackIndex(
  scopedSessions: SessionSummary[],
  formulaKey: string | undefined,
): TrackIndex {
  const byTrack = new Map<string, TrackIndexEntry>();
  for (const session of scopedSessions) {
    if (session.isSpectator) continue;
    const trackId = getTrackId(session.track);
    if (!trackId) continue;
    const entry = byTrack.get(trackId) ?? {
      trackId,
      track: session.track,
      sessionCount: 0,
      lastDate: session.date,
      qualiPbMs: null,
      timeTrialPbMs: null,
      lastRace: null,
    };
    entry.sessionCount += 1;
    if (session.date > entry.lastDate) entry.lastDate = session.date;
    const kind = summaryKind(session);
    const best = sessionBestLapMs(session);
    if (
      kind === "qualifying" &&
      best &&
      (entry.qualiPbMs == null || best < entry.qualiPbMs)
    ) {
      entry.qualiPbMs = best;
    }
    if (
      kind === "time-trial" &&
      best &&
      (entry.timeTrialPbMs == null || best < entry.timeTrialPbMs)
    ) {
      entry.timeTrialPbMs = best;
    }
    const result = session.playerRaceResult;
    if (
      kind === "race" &&
      session.isOnline &&
      // Two-car lobbies and restarts are not results.
      (session.classifiedDriverCount ?? 0) >= 10 &&
      result?.position &&
      (!entry.lastRace || session.date > entry.lastRace.date)
    ) {
      const status = (result.status ?? "").toUpperCase();
      entry.lastRace = {
        position: result.position,
        date: session.date,
        dnf: status !== "" && status !== "FINISHED",
      };
    }
    byTrack.set(trackId, entry);
  }

  const order = sortTracksByCalendar([...byTrack.keys()], formulaKey);
  const calendar: readonly string[] =
    formulaKey === "f1-26"
      ? F1_26_TRACK_CALENDAR_IDS
      : F1_25_TRACK_CALENDAR_IDS;
  return {
    entries: order.map((id) => byTrack.get(id)!),
    notDriven: calendar.filter((id) => !byTrack.has(id)),
  };
}

/** The tracks driven most recently, newest first. */
export function recentTracks(
  index: TrackIndex,
  count: number,
): TrackIndexEntry[] {
  return [...index.entries]
    .sort((a, b) => b.lastDate.localeCompare(a.lastDate))
    .slice(0, count);
}
