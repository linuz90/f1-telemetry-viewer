import type {
  DriverData,
  FinalClassification,
  TelemetrySession,
} from "../../types/telemetry";
import {
  isRaceSession as isRaceTelemetrySession,
  isTimeTrialSessionType,
} from "../sessionTypes";
import { getBestLapTime } from "./laps";

export function classificationBestLapTimeMs(
  classification: FinalClassification | null | undefined,
): number {
  const newerField = classification?.["best-lap-time-ms"];
  if (typeof newerField === "number" && newerField > 0) return newerField;

  const legacyField = classification?.["best-lap-time-in-ms"];
  return typeof legacyField === "number" && legacyField > 0 ? legacyField : 0;
}

/** Prefer the official race/quali result because remote histories may be sparse. */
export function driverBestLapTimeMs(driver: DriverData): number {
  return (
    classificationBestLapTimeMs(driver["final-classification"]) ||
    getBestLapTime(driver["session-history"]["lap-history-data"])
  );
}

/**
 * Session-aware best lap for current-run UI.
 *
 * Time Trial final classification can contain the game's persistent PB/ghost
 * rather than a lap completed in this save, so only its complete history can
 * establish a current-run time. Race and qualifying classification remains the
 * authoritative fallback for sparse remote drivers.
 */
export function sessionDriverBestLapTimeMs(
  session: TelemetrySession,
  driver: DriverData,
): number {
  return isTimeTrialSessionType(session["session-info"]["session-type"])
    ? getBestLapTime(driver["session-history"]["lap-history-data"])
    : driverBestLapTimeMs(driver);
}

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
