import { PNG_TURN_FIXES } from "../constants/pngTurnFixes";
import type {
  RaceControlEvent,
  RaceControlSegmentInfo,
  SessionHistory,
  TelemetrySession,
} from "../types/telemetry";
import { getTrackId } from "./tracks";

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

/** The segment with its turn numbers replaced, keeping the exporter's name. */
function withTurns(
  segment: RaceControlSegmentInfo,
  turns: readonly number[],
): RaceControlSegmentInfo {
  const {
    corner_number: _single,
    corner_numbers: _sequence,
    ...rest
  } = segment;
  return turns.length === 1
    ? { ...rest, corner_number: turns[0] }
    : { ...rest, corner_numbers: [...turns] };
}

/**
 * Relabel race-control turns where Pits n' Giggles numbers them differently
 * from the official numbering the lap tips use (see `PNG_TURN_FIXES`), so
 * locations match the tips and pool across exports made before and after
 * its fix. Idempotent: the same event may sit in more than one list.
 */
function fixRaceControlTurns(session: TelemetrySession): void {
  const info = session["session-info"];
  const table = info
    ? PNG_TURN_FIXES[getTrackId(String(info["track-id"]))]
    : undefined;
  // Ranges are game metres on one layout; a different length is another layout.
  if (
    !table ||
    Math.abs(Number(info?.["track-length"]) - table.trackLengthM) > 10
  ) {
    return;
  }
  const relabel = (event: RaceControlEvent) => {
    const segment = event["segment-info"];
    const distance = event["lap-distance"];
    if (
      !segment ||
      segment.type === "straight" ||
      typeof distance !== "number"
    ) {
      return;
    }
    const fix = table.fixes.find(
      ({ fromM, toM }) => distance >= fromM && distance < toM,
    );
    if (!fix) return;
    event["segment-info"] = fix.turns ? withTurns(segment, fix.turns) : null;
  };
  session["race-control"]?.forEach(relabel);
  for (const driver of session["classification-data"] ?? []) {
    driver["race-control"]?.forEach(relabel);
  }
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
  fixRaceControlTurns(session);
  return session;
}
