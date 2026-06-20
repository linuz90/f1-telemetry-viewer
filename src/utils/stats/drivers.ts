import type { DriverData, TelemetrySession } from "../../types/telemetry";
import { isRaceSession as isRaceTelemetrySession } from "../sessionTypes";

export function findPlayer(session: TelemetrySession): DriverData | undefined {
  return session["classification-data"]?.find((d) => d["is-player"]);
}

/** Find the default focused driver: player > P1 finisher > driver with most laps */
export function findFocusedDriver(
  session: TelemetrySession,
): DriverData | undefined {
  const drivers = session["classification-data"] ?? [];

  // 1. Player
  const player = drivers.find((d) => d["is-player"]);
  if (player) return player;

  // 2. P1 finisher
  const p1 = drivers.find((d) => d["final-classification"]?.position === 1);
  if (p1) return p1;

  // 3. Driver with most valid laps
  let best: DriverData | undefined;
  let maxLaps = 0;
  for (const d of drivers) {
    const count = d["session-history"]["lap-history-data"].filter(
      (l) => l["lap-time-in-ms"] > 0,
    ).length;
    if (count > maxLaps) {
      maxLaps = count;
      best = d;
    }
  }
  return best;
}

/** Check if a session is a race (vs qualifying) */
export function isRaceSession(session: TelemetrySession): boolean {
  return isRaceTelemetrySession(session);
}

/** Find the race winner (P1 finisher) */
export function findRaceWinner(
  session: TelemetrySession,
): DriverData | undefined {
  return session["classification-data"]?.find(
    (d) => d["final-classification"]?.position === 1,
  );
}

/** Find the closest rival (±1 position from player) */
export function findClosestRival(
  session: TelemetrySession,
  playerPosition: number,
): DriverData | undefined {
  const drivers = session["classification-data"] ?? [];
  // Prefer the driver just ahead (position - 1), fall back to behind
  return (
    drivers.find(
      (d) => d["final-classification"]?.position === playerPosition - 1,
    ) ??
    drivers.find(
      (d) => d["final-classification"]?.position === playerPosition + 1,
    )
  );
}

/** Find the driver who set the fastest lap (from session records) */
export function findFastestLapDriver(
  session: TelemetrySession,
): DriverData | undefined {
  const driverIndex = session.records?.fastest?.lap?.["driver-index"];
  if (driverIndex == null) return undefined;
  return session["classification-data"]?.find((d) => d.index === driverIndex);
}

/**
 * Top speed for a driver — highest between session-level and per-lap values,
 * with glitch filtering (per-lap speeds > 1.15× the driver's own median are excluded).
 *
 * Known Pits n' Giggles telemetry quirks (reported to ashwin_nat, 2026-02):
 *  1. Session-level "top-speed-kmph" logic is flawed (confirmed by ashwin_nat).
 *     Null for most drivers, wrong for others (e.g. 60 km/h when per-lap says
 *     336). Will be fixed in a future Pits n' Giggles release to use max of
 *     all laps' top speed.
 *  2. Per-lap "top-speed-kmph" is a simple max(current, incoming) per lap, but
 *     the F1 game's UDP export has bugs that can produce glitched values —
 *     e.g. two drivers both showing 486 km/h on the same lap while their other
 *     ~35 laps average ~310.
 *  3. Per-lap values may understate actual top speed due to capture granularity.
 *     The speed trap is at the end of the main straight (Zandvoort speed trap
 *     record: 311.37 km/h, so a 313 max there is reasonable).
 *
 * Workaround: take the highest of session-level and per-lap max, filtering
 * both against 1.15× the driver's per-lap median to exclude glitches.
 */
export function driverTopSpeed(d: DriverData): number {
  const sessionSpeed = d["top-speed-kmph"] ?? 0;
  const perLap = d["per-lap-info"] ?? [];
  const lapSpeeds = perLap
    .map((l) => l["top-speed-kmph"] ?? 0)
    .filter((s) => s > 0);
  if (lapSpeeds.length === 0) return sessionSpeed;
  const sorted = [...lapSpeeds].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  const cap = median * 1.15;
  const clean = lapSpeeds.filter((s) => s <= cap);
  const bestLapSpeed =
    clean.length > 0 ? Math.max(...clean) : Math.max(...lapSpeeds);
  // Also cap the session-level field against the same threshold
  const safeSessionSpeed =
    sessionSpeed > 0 && sessionSpeed <= cap ? sessionSpeed : 0;
  return Math.max(bestLapSpeed, safeSessionSpeed);
}
