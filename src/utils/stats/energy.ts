import type { DriverData, PerLapInfo } from "../../types/telemetry";
import {
  formatFuelKg,
  formatKgPerLap,
  joinMetaParts,
  pluralize,
} from "../format";
import { formatLapDelta, median } from "./core";
import type { StrategyInsight } from "./insightTypes";

// ─── Fuel safety knobs ───────────────────────────────────────────────────────
//
// Track Progress frames its fuel recommendation as "what slider value would
// *just* finish the race assuming every lap is green-flag" and then adds two
// small safety buffers on top. These knobs do not apply to the retrospective
// Fuel Margin shown on a single session.
//
// Both buffers mirror the Pits n' Giggles in-app Fuel Strategy Calculator:
//   https://github.com/ashwin-nat/pits-n-giggles/blob/hotfix-v4.3.0/apps/frontend/js/fuelCalculator.js
// where they appear as `MIN_FUEL_LEVEL` (0.2 kg) and the default `surplusLaps`
// input (0.25 laps), both folded into the "Conservative" strategy output.

/** Unusable fuel that physically can't be burned (F1 cars leave a small
 *  reserve at the bottom of the tank). Matches PnG's `MIN_FUEL_LEVEL`. */
const MIN_FUEL_LEVEL_KG = 0.2;

/** Extra laps of fuel kept as a safety buffer above the "clean-race"
 *  requirement. Matches the default `surplusLaps` input in PnG's
 *  conservative-strategy calculator. */
const FUEL_SURPLUS_LAPS = 0.25;

/** Total safety margin (in laps) to subtract from any "clean-race" excess
 *  projection before turning it into a slider recommendation. Combines the
 *  unusable-fuel reserve (converted to laps at the green-flag burn rate)
 *  and the surplus-laps buffer. */
export function fuelSafetyMarginLaps(burnRateKg: number): number {
  return FUEL_SURPLUS_LAPS + MIN_FUEL_LEVEL_KG / burnRateKg;
}

/** True when a lap ran under normal green-flag racing conditions */
export function isGreenFlagLap(lap: PerLapInfo): boolean {
  return (lap["max-safety-car-status"] ?? "NO_SAFETY_CAR") === "NO_SAFETY_CAR";
}

/** Collect per-lap fuel burn deltas (kg) from consecutive green-flag lap
 *  pairs only. Skips SC/VSC/formation laps so the deltas reflect actual
 *  racing burn — the conservative quantity for any fuel-load recommendation. */
export function collectGreenFlagBurnDeltas(player: DriverData): number[] {
  const perLap = player["per-lap-info"];
  if (!perLap?.length) return [];
  const lapsWithFuel = perLap.filter(
    (l) =>
      Number.isFinite(l["car-status-data"]?.["fuel-in-tank"]) &&
      l["car-status-data"]["fuel-in-tank"] > 0,
  );
  if (lapsWithFuel.length < 2) return [];
  const deltas: number[] = [];
  for (let i = 1; i < lapsWithFuel.length; i++) {
    const prev = lapsWithFuel[i - 1];
    const curr = lapsWithFuel[i];
    // Filtering out unusable snapshots can make adjacent array entries span
    // multiple laps. Treating that gap as one lap's burn would inflate both
    // the sample count and the conservative fuel target.
    if (
      !Number.isFinite(prev["lap-number"]) ||
      !Number.isFinite(curr["lap-number"]) ||
      curr["lap-number"] !== prev["lap-number"] + 1
    ) {
      continue;
    }
    if (!isGreenFlagLap(prev) || !isGreenFlagLap(curr)) continue;
    const delta =
      prev["car-status-data"]["fuel-in-tank"] -
      curr["car-status-data"]["fuel-in-tank"];
    if (Number.isFinite(delta) && delta > 0) deltas.push(delta);
  }
  return deltas;
}

/** ERS energy deployed on a lap, preferring Pits n' Giggles' saved lap aggregate. */
export function ersDeployJForLap(lap: PerLapInfo): number {
  return (
    lap["ers-stats"]?.["ers-deployed-j"] ??
    lap["car-status-data"]?.["ers-deployed-this-lap"] ??
    0
  );
}

export function ersDeployMjForLap(lap: PerLapInfo): number {
  return ersDeployJForLap(lap) / 1_000_000;
}

/** Total ERS energy harvested on a lap (MGU-K + MGU-H combined), in joules.
 *  Prefers Pits n' Giggles' per-lap `ers-stats`; falls back to end-of-lap
 *  car-status snapshots from older exports. Useful for analyzing lift-and-coast
 *  efficiency in F1 26, where harvested energy isn't deploy-capped. */
export function ersHarvestJForLap(lap: PerLapInfo): number {
  const stats = lap["ers-stats"];
  if (
    stats?.["ers-harv-mguk-j"] != null ||
    stats?.["ers-harv-mguh-j"] != null
  ) {
    return (stats["ers-harv-mguk-j"] ?? 0) + (stats["ers-harv-mguh-j"] ?? 0);
  }
  const car = lap["car-status-data"];
  const mguk = car?.["ers-harvested-this-lap-mguk"] ?? 0;
  const mguh = car?.["ers-harvested-this-lap-mguh"] ?? 0;
  return mguk + mguh;
}

export function ersHarvestMjForLap(lap: PerLapInfo): number {
  return ersHarvestJForLap(lap) / 1_000_000;
}

/** MGU-K energy harvested on a lap, in joules. The utilization denominator is
 *  specifically an MGU-K limit, so including MGU-H would inflate older cars. */
function ersHarvestMgukJForLap(lap: PerLapInfo): number {
  return (
    lap["ers-stats"]?.["ers-harv-mguk-j"] ??
    lap["car-status-data"]?.["ers-harvested-this-lap-mguk"] ??
    0
  );
}

/** Recorded per-lap MGU-K harvest allowance, in joules. */
export function ersHarvestLimitJForLap(lap: PerLapInfo): number {
  return (
    lap["ers-stats"]?.["ers-harv-limit-mguk-j"] ??
    lap["car-status-data"]?.["ers-harvested-limit-per-lap"] ??
    0
  );
}

function hasMgukHarvestReading(lap: PerLapInfo): boolean {
  const stats = lap["ers-stats"];
  if (stats?.["ers-harv-mguk-j"] != null) {
    return true;
  }

  return lap["car-status-data"]?.["ers-harvested-this-lap-mguk"] != null;
}

function hasMeaningfulErsTelemetry(laps: readonly PerLapInfo[]): boolean {
  return laps.some(
    (lap) =>
      ersDeployJForLap(lap) >= 200_000 || ersHarvestJForLap(lap) >= 200_000,
  );
}

/**
 * Average share of the recorded per-lap MGU-K harvest allowance recovered.
 * Explicit zero-harvest laps remain in the sample; dropping them would make the
 * percentage look artificially high. Values can be slightly above 100% when
 * the saved cumulative counter and limit snapshot straddle a packet boundary.
 */
export function avgErsHarvestUtilization(d: DriverData): number | null {
  const perLap = d["per-lap-info"] ?? [];
  if (perLap.length < 3) return null;

  // Entry 0 is the pre-race baseline and the final entry can contain a reset.
  const eligible = perLap.slice(1, -1).filter(isGreenFlagLap);
  if (!hasMeaningfulErsTelemetry(eligible)) return null;

  const utilization: number[] = [];
  for (const lap of eligible) {
    if (!hasMgukHarvestReading(lap)) continue;

    const harvestedJ = ersHarvestMgukJForLap(lap);
    const limitJ = ersHarvestLimitJForLap(lap);
    if (
      !Number.isFinite(harvestedJ) ||
      harvestedJ < 0 ||
      !Number.isFinite(limitJ) ||
      limitJ < 200_000
    ) {
      continue;
    }
    utilization.push(harvestedJ / limitJ);
  }

  if (utilization.length === 0) return null;
  return (
    utilization.reduce((sum, value) => sum + value, 0) / utilization.length
  );
}

/**
 * Average ERS deployment in MJ per lap. Uses green-flag entries after the
 * pre-race baseline and before the final reset snapshot. Pits n' Giggles'
 * per-lap `ers-stats` is more reliable than the end-of-lap car-status snapshot
 * for F1 26 and remains optional for older exports.
 */
export function avgErsDeployMj(d: DriverData): number {
  const perLap = d["per-lap-info"] ?? [];
  if (perLap.length < 3) return 0;
  // Exclude first lap (index 0), last lap, and SC/VSC laps
  const eligible = perLap.slice(1, -1).filter(isGreenFlagLap);
  const deployMj: number[] = [];
  for (const lap of eligible) {
    const deployedMj = ersDeployMjForLap(lap);
    // Skip near-zero laps; with car-status fallback these are usually capture
    // gaps around the lap reset rather than useful deployment data.
    if (deployedMj >= 0.2) deployMj.push(deployedMj);
  }
  if (deployMj.length === 0) return 0;
  return deployMj.reduce((a, b) => a + b, 0) / deployMj.length;
}

/** Average ERS harvested in MJ per lap. Uses green-flag entries after the
 *  pre-race baseline and before the final reset snapshot. */
export function avgErsHarvestMj(d: DriverData): number {
  const perLap = d["per-lap-info"] ?? [];
  if (perLap.length < 3) return 0;
  const eligible = perLap.slice(1, -1).filter(isGreenFlagLap);
  const harvMj: number[] = [];
  for (const lap of eligible) {
    const mj = ersHarvestMjForLap(lap);
    if (mj >= 0.2) harvMj.push(mj);
  }
  if (harvMj.length === 0) return 0;
  return harvMj.reduce((a, b) => a + b, 0) / harvMj.length;
}

/** Build a factual fuel summary for one race session.
 *
 * A single run cannot reliably distinguish deliberate saving from normal burn,
 * so it must not produce an initial-fuel recommendation. The same-distance
 * Track Progress model owns that decision; this summary only reports what the
 * telemetry actually recorded.
 */
export function generateFuelMarginInsight(
  player: DriverData,
  totalRaceLaps: number,
): StrategyInsight | null {
  const perLap = player["per-lap-info"];
  if (!perLap?.length) return null;

  const statusSnapshots = perLap.filter(
    (lap) =>
      Number.isFinite(lap["lap-number"]) && lap["car-status-data"] != null,
  );
  // Lap 0 alone only describes the starting state. A later snapshot is needed
  // before the session can say anything about the resulting fuel margin.
  const firstLap = statusSnapshots.find((lap) => lap["lap-number"] === 0);
  const lastLap = statusSnapshots.reduce<PerLapInfo | undefined>(
    (latest, lap) =>
      lap["lap-number"] > 0 &&
      (!latest || lap["lap-number"] >= latest["lap-number"])
        ? lap
        : latest,
    undefined,
  );
  if (!lastLap) return null;

  const startFuelKg = firstLap?.["car-status-data"]?.["fuel-in-tank"];
  const endFuelKg = lastLap["car-status-data"]?.["fuel-in-tank"];
  // This signed value is the game's MFD estimate at the recorded snapshot. It
  // is useful outcome evidence, but is neither physical tank range nor a fuel
  // recommendation derived by the viewer.
  const fuelMarginLaps = lastLap["car-status-data"]?.["fuel-remaining-laps"];
  const lastLapNumber = lastLap["lap-number"] as number;
  const classification = player["final-classification"];
  const classifiedLaps = classification?.["num-laps"];
  // Lapped finishers and shortened races legitimately complete fewer than the
  // scheduled distance, so official completed laps define the finish when set.
  const finishLap =
    typeof classifiedLaps === "number" &&
    Number.isFinite(classifiedLaps) &&
    classifiedLaps > 0
      ? classifiedLaps
      : totalRaceLaps;
  const isFinished =
    classification?.["result-status"] === "FINISHED" &&
    lastLapNumber >= finishLap;
  const deltas = collectGreenFlagBurnDeltas(player);
  const burnRateKg = deltas.length >= 3 ? median(deltas) : undefined;
  const fuelTelemetry = joinMetaParts([
    Number.isFinite(endFuelKg) && endFuelKg! >= 0
      ? `${formatFuelKg(endFuelKg!)} in tank`
      : undefined,
    Number.isFinite(startFuelKg) && startFuelKg! >= 0
      ? `${formatFuelKg(startFuelKg!)} at start`
      : undefined,
  ]);
  const burnTelemetry =
    burnRateKg != null && burnRateKg > 0
      ? joinMetaParts([
          `Median green burn ${formatKgPerLap(burnRateKg)}`,
          pluralize(deltas.length, "green pair"),
        ])
      : undefined;
  const extraDetails = [fuelTelemetry, burnTelemetry].filter(
    (detail): detail is string => Boolean(detail),
  );
  const hasFuelMargin = Number.isFinite(fuelMarginLaps);
  if (!hasFuelMargin && extraDetails.length === 0) return null;

  return {
    type: "fuel",
    label: "Fuel Margin",
    value: hasFuelMargin ? `${formatLapDelta(fuelMarginLaps!)} laps` : "—",
    detail: hasFuelMargin
      ? isFinished
        ? "game estimate at finish"
        : `game projection from lap ${lastLapNumber}/${totalRaceLaps}`
      : isFinished
        ? "finish estimate unavailable"
        : `projection unavailable from lap ${lastLapNumber}/${totalRaceLaps}`,
    extraDetails,
  };
}
