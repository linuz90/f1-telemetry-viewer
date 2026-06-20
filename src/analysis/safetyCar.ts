import type { PerLapInfo } from "../types/telemetry";

/**
 * Shared Safety Car / VSC helpers.
 *
 * Several charts need the same interpretation of race-neutralization state.
 * Centralizing the status checks and range collapse keeps highlights aligned
 * across lap time, tyre wear, and any future per-lap view.
 */

export interface SafetyCarRange {
  x1: number;
  x2: number;
  status: string;
}

export function isSafetyCarStatus(status: string | undefined): boolean {
  return (
    status === "SAFETY_CAR" ||
    status === "FULL_SAFETY_CAR" ||
    status === "VIRTUAL_SAFETY_CAR"
  );
}

export function isFullSafetyCarStatus(status: string | undefined): boolean {
  return status === "SAFETY_CAR" || status === "FULL_SAFETY_CAR";
}

export function isVirtualSafetyCarStatus(status: string | undefined): boolean {
  return status === "VIRTUAL_SAFETY_CAR";
}

/**
 * Collapse adjacent SC/VSC laps into chart reference ranges.
 *
 * Multiple charts need the same highlighted bands. Keeping this range builder
 * outside the chart components prevents small off-by-one differences from
 * creeping in between lap time and tyre-wear views.
 */
export function buildSafetyCarRanges(
  laps: readonly { lap: number; scStatus: string }[],
): SafetyCarRange[] {
  const ranges: SafetyCarRange[] = [];

  for (const lap of laps) {
    if (!isSafetyCarStatus(lap.scStatus)) continue;

    const previous = ranges[ranges.length - 1];
    if (
      previous &&
      previous.status === lap.scStatus &&
      previous.x2 === lap.lap - 1
    ) {
      previous.x2 = lap.lap;
    } else {
      ranges.push({ x1: lap.lap, x2: lap.lap, status: lap.scStatus });
    }
  }

  return ranges;
}

export function buildSafetyCarRangesFromPerLapInfo(
  perLapInfo: readonly PerLapInfo[] | undefined,
): SafetyCarRange[] {
  return buildSafetyCarRanges(
    (perLapInfo ?? []).map((lap) => ({
      lap: lap["lap-number"],
      scStatus: lap["max-safety-car-status"] ?? "NO_SAFETY_CAR",
    })),
  );
}
