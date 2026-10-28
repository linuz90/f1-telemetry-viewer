import type { SessionSummary, TelemetrySession } from "../types/telemetry";
import { findPlayer } from "../utils/stats/drivers";
import {
  isRaceSessionType,
  isTimeTrialSessionType,
} from "../utils/sessionTypes";

/**
 * What a session *was* for the driver, which picks its page and its row in the
 * session log. The exporter's session type is not enough: most offline "Race"
 * saves are practice long runs, quit and saved before the flag, and reading
 * them as races produced "Result P1 · Race pace 1st" for a 9-lap stint vs AI.
 */
export type SessionKind = "race" | "long-run" | "qualifying" | "time-trial";

/**
 * An offline race whose player has no final classification status was saved
 * before the finish (manual or periodic save): a long run. Offline races with
 * a status are real results, finished or retired; online races always are.
 */
function isLongRunResult(isOnline: boolean, status: string | undefined) {
  return !isOnline && !status;
}

export function summaryKind(summary: SessionSummary): SessionKind {
  const type = summary.sessionType;
  if (isTimeTrialSessionType(type)) return "time-trial";
  if (isRaceSessionType(type)) {
    return isLongRunResult(
      summary.isOnline === true,
      summary.playerRaceResult?.status,
    ) && summary.isSpectator !== true
      ? "long-run"
      : "race";
  }
  return "qualifying";
}

export function sessionKind(session: TelemetrySession): SessionKind {
  const info = session["session-info"];
  const type = info["session-type"];
  if (isTimeTrialSessionType(type)) return "time-trial";
  if (isRaceSessionType(type)) {
    const player = findPlayer(session);
    // Spectator saves have no player to have run a long run.
    if (!player) return "race";
    return isLongRunResult(
      Boolean(info["network-game"]),
      player["final-classification"]?.["result-status"] || undefined,
    )
      ? "long-run"
      : "race";
  }
  return "qualifying";
}

const KIND_LABEL: Record<SessionKind, string> = {
  race: "Race",
  "long-run": "Long run",
  qualifying: "Qualifying",
  "time-trial": "Time trial",
};

export function sessionKindLabel(kind: SessionKind): string {
  return KIND_LABEL[kind];
}

/** Short row label for a session: "Short quali", "Race", "Long run". */
export function sessionRowLabel(summary: SessionSummary): string {
  const kind = summaryKind(summary);
  if (kind !== "qualifying") {
    if (kind === "race" && /2$/.test(summary.sessionType)) {
      return /^\s*(formula\s+)?f2\b/i.test(summary.formula ?? "")
        ? "Feature race"
        : "Race 2";
    }
    if (
      kind === "race" &&
      /^\s*(formula\s+)?f2\b/i.test(summary.formula ?? "")
    ) {
      return "Sprint";
    }
    return KIND_LABEL[kind];
  }
  switch (summary.sessionType) {
    case "Short Qualifying":
      return "Short quali";
    case "One Shot Qualifying":
      return "One-shot quali";
    case "Short Sprint Shootout":
      return "Sprint shootout";
    case "Short Session Shootout":
      return "Session shootout";
    default:
      return summary.sessionType.replace("Qualifying", "Quali");
  }
}
