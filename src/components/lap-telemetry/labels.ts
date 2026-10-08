import { TEAM_COLORS } from "../../constants/colors";
import {
  formatSessionType,
  formatShortDate,
  formatTime,
  titleCaseName,
} from "../../utils/format";
import type { LapRecordingSummary } from "../../utils/lapRecording/types";

export function driverLabel(name: string, isPlayer: boolean): string {
  return isPlayer ? "You" : titleCaseName(name);
}

/** "Short Quali · 5 Oct 20:49" */
export function recordingLabel(
  recording: Pick<LapRecordingSummary, "sessionType" | "formula" | "date">,
): string {
  return `${formatSessionType(recording.sessionType, recording.formula)} · ${formatShortDate(recording.date)} ${formatTime(recording.date)}`;
}

/**
 * Recordings name teams with a season suffix ("Mercedes '26") and short
 * forms ("RB"), unlike session JSON; match them onto the shared team colours.
 */
export function recordingTeamColor(team: string | undefined): string {
  if (!team) return "#a1a1aa";
  const base = team.replace(/\s*'\d{2}$/, "").trim();
  if (TEAM_COLORS[base]) return TEAM_COLORS[base];
  const match = Object.keys(TEAM_COLORS).find(
    (key) =>
      Number.isNaN(Number(key)) &&
      (key.startsWith(base) || base.startsWith(key)),
  );
  return match ? TEAM_COLORS[match] : "#a1a1aa";
}
