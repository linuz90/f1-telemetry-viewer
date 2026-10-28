import type { SessionSummary } from "../types/telemetry";
import {
  getDashboardResultStats,
  isCleanRaceFinish,
  isDnfResultStatus,
  type DashboardResultStats,
} from "./dashboardResultStats";

/**
 * Your form across the scope's result races: the Sessions-home card (last five)
 * and the Form page (every race). Which races count is
 * `getDashboardResultStats()`'s choice (representative online races when there
 * are enough, so restarts and first-lap disconnects stay out), which keeps the
 * season numbers identical to the old dashboard's.
 */

export interface FormRace {
  session: SessionSummary;
  grid: number | null;
  /** Finishing position, or null for a DNF. */
  finish: number | null;
  /** Positive = places gained from grid to flag. */
  gain: number | null;
  /** Races of 10 laps or fewer, tagged so they don't read as full results. */
  short: boolean;
}

export interface OnlineForm {
  /** Oldest first, for the race-by-race chart. */
  races: FormRace[];
  recent: {
    count: number;
    averageGrid: number | null;
    averageFinish: number | null;
    behindGrid: number;
  };
  stats: DashboardResultStats;
}

export const FORM_RECENT_RACES = 5;
const SHORT_RACE_LAPS = 10;

function average(values: number[]): number | null {
  return values.length
    ? values.reduce((sum, value) => sum + value, 0) / values.length
    : null;
}

export function buildOnlineForm(
  sessions: SessionSummary[],
  formulaKey: string | undefined,
): OnlineForm | null {
  const stats = getDashboardResultStats(sessions, formulaKey);
  if (stats.resultSessions.length === 0) return null;

  const races = [...stats.resultSessions]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((session): FormRace => {
      const result = session.playerRaceResult!;
      const grid =
        result.gridPosition && result.gridPosition > 0
          ? result.gridPosition
          : null;
      const dnf =
        isDnfResultStatus(result.status) || !isCleanRaceFinish(session);
      const finish = dnf ? null : result.position;
      return {
        session,
        grid,
        finish,
        gain: grid != null && finish != null ? grid - finish : null,
        short:
          (result.totalLaps ?? 0) > 0 &&
          (result.totalLaps ?? 0) <= SHORT_RACE_LAPS,
      };
    });

  const last = races.slice(-FORM_RECENT_RACES);
  return {
    races,
    recent: {
      count: last.length,
      averageGrid: average(
        last.map((r) => r.grid).filter((v): v is number => v != null),
      ),
      averageFinish: average(
        last.map((r) => r.finish).filter((v): v is number => v != null),
      ),
      behindGrid: last.filter((r) => r.gain != null && r.gain < 0).length,
    },
    stats,
  };
}
