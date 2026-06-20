import type { SessionSummary } from "../types/telemetry";
import { isCleanRaceFinish } from "./dashboardResultStats";
import {
  isQualifyingSessionType,
  isRaceSessionType,
  isTimeTrialSessionType,
} from "../utils/sessionTypes";

/**
 * Recent-activity grouping for the dashboard.
 *
 * The sidebar lists literal saved files. The dashboard needs a calmer recap, so
 * repeated same-day attempts are grouped and represented by the most useful
 * attempt for that session kind. This module owns that editorial grouping
 * policy; result/rival analytics stay in their own analysis modules.
 */

export type DashboardActivityKind =
  | "race"
  | "qualifying"
  | "time-trial"
  | "session";

export interface DashboardActivityGroup {
  key: string;
  track: string;
  kind: DashboardActivityKind;
  modeKey: string;
  dayKey: string;
  sessions: SessionSummary[];
  representative: SessionSummary;
}

function sessionTime(session: SessionSummary): number {
  const time = new Date(session.date).getTime();
  return Number.isFinite(time) ? time : 0;
}

export function getDashboardActivityKind(
  session: SessionSummary,
): DashboardActivityKind {
  if (isRaceSessionType(session.sessionType)) return "race";
  if (isQualifyingSessionType(session.sessionType)) return "qualifying";
  if (isTimeTrialSessionType(session.sessionType)) return "time-trial";
  return "session";
}

function getActivityModeKey(session: SessionSummary): string {
  if (session.isSpectator) return "spectator";
  if (session.isOnline) return "online";
  if (session.aiDifficulty != null && session.aiDifficulty > 0) {
    return `ai-${session.aiDifficulty}`;
  }
  return "offline";
}

function getActivityDayKey(session: SessionSummary): string {
  return session.date.split("T")[0] ?? session.date;
}

function isSameActivityGroup(
  group: Pick<DashboardActivityGroup, "track" | "kind" | "modeKey" | "dayKey">,
  session: SessionSummary,
): boolean {
  return (
    group.track === session.track &&
    group.kind === getDashboardActivityKind(session) &&
    group.modeKey === getActivityModeKey(session) &&
    group.dayKey === getActivityDayKey(session)
  );
}

function pickBestLapRepresentative(sessions: SessionSummary[]): SessionSummary {
  // For quali/time-trial bursts the fastest valid lap is the story; recency is
  // only a tie-breaker so a slower auto-save does not hide the better attempt.
  return [...sessions].sort((a, b) => {
    const lapDiff =
      (a.bestLapTimeMs ?? Number.POSITIVE_INFINITY) -
      (b.bestLapTimeMs ?? Number.POSITIVE_INFINITY);
    if (lapDiff !== 0) return lapDiff;
    return sessionTime(b) - sessionTime(a);
  })[0]!;
}

function raceCompletion(session: SessionSummary): number {
  const result = session.playerRaceResult;
  return result?.playerLaps ?? session.validLapCount;
}

function pickRaceRepresentative(sessions: SessionSummary[]): SessionSummary {
  // Race recaps should prefer completed, representative runs over partial
  // saves. Lap count and lap ratio cover older summaries that may miss one of
  // those fields.
  return [...sessions].sort((a, b) => {
    const cleanDiff =
      Number(isCleanRaceFinish(b)) - Number(isCleanRaceFinish(a));
    if (cleanDiff !== 0) return cleanDiff;

    const lapDiff = raceCompletion(b) - raceCompletion(a);
    if (lapDiff !== 0) return lapDiff;

    const ratioDiff =
      (b.playerRaceResult?.lapRatio ?? 0) - (a.playerRaceResult?.lapRatio ?? 0);
    if (ratioDiff !== 0) return ratioDiff;

    return sessionTime(b) - sessionTime(a);
  })[0]!;
}

function pickRepresentative(
  kind: DashboardActivityKind,
  sessions: SessionSummary[],
): SessionSummary {
  if (kind === "race") return pickRaceRepresentative(sessions);
  if (kind === "qualifying" || kind === "time-trial") {
    return pickBestLapRepresentative(sessions);
  }
  return [...sessions].sort((a, b) => sessionTime(b) - sessionTime(a))[0]!;
}

function hasDashboardActivity(session: SessionSummary): boolean {
  return session.validLapCount > 0 || session.playerRaceResult != null;
}

/**
 * The sidebar is a literal file/session history. The dashboard is an editorial
 * recap, so repeated consecutive attempts are collapsed into the best
 * representative row. We intentionally keep the collapse to one day at a time:
 * hiding today's rough race behind yesterday's cleaner result would make the
 * dashboard feel stale instead of honest. Keeping that rule here makes the
 * product distinction easy to revisit without touching race-result analytics.
 */
export function buildDashboardActivity(
  sessions: SessionSummary[],
  maxGroups = 10,
): DashboardActivityGroup[] {
  const sorted = sessions
    .filter(hasDashboardActivity)
    .sort((a, b) => sessionTime(b) - sessionTime(a));

  const groups: Array<{
    track: string;
    kind: DashboardActivityKind;
    modeKey: string;
    dayKey: string;
    sessions: SessionSummary[];
  }> = [];

  for (const session of sorted) {
    const latest = groups.at(-1);
    if (latest && isSameActivityGroup(latest, session)) {
      latest.sessions.push(session);
      continue;
    }

    groups.push({
      track: session.track,
      kind: getDashboardActivityKind(session),
      modeKey: getActivityModeKey(session),
      dayKey: getActivityDayKey(session),
      sessions: [session],
    });
  }

  return groups.slice(0, maxGroups).map((group, index) => {
    const representative = pickRepresentative(group.kind, group.sessions);
    return {
      key: `${index}-${group.track}-${group.kind}-${group.modeKey}-${representative.slug}`,
      track: group.track,
      kind: group.kind,
      modeKey: group.modeKey,
      dayKey: group.dayKey,
      sessions: group.sessions,
      representative,
    };
  });
}
