import type { SessionHistory, TelemetrySession } from "../types/telemetry";

/**
 * Pits n' Giggles writes `"session-history": null` for any driver the game
 * never sent a history packet for — spectator saves, drivers who joined late,
 * and sparse remote cars in online lobbies. Almost every analysis path reads
 * lap history, so fill the hole once at load instead of guarding every reader.
 */
function emptySessionHistory(): SessionHistory {
  return {
    "num-laps": 0,
    "num-tyre-stints": 0,
    "best-lap-time-lap-num": 0,
    "best-sector-1-lap-num": 0,
    "best-sector-2-lap-num": 0,
    "best-sector-3-lap-num": 0,
    "lap-history-data": [],
    "tyre-stints-history-data": [],
  };
}

/**
 * Patch known holes in freshly parsed session JSON so the rest of the app can
 * trust the declared `TelemetrySession` shape. Mutates in place: the caller
 * just parsed the value and nothing else references it yet.
 */
export function normalizeSession(session: TelemetrySession): TelemetrySession {
  for (const driver of session["classification-data"] ?? []) {
    if (driver["session-history"] == null) {
      driver["session-history"] = emptySessionHistory();
    }
  }
  return session;
}
