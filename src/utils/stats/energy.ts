import type { DriverData, PerLapInfo } from "../../types/telemetry";
import {
  formatFuelKg,
  formatKgPerLap,
  joinMetaParts,
  pluralize,
} from "../format";
import { formatLapDelta, median } from "./core";
import type { StrategyInsight } from "./insightTypes";

// ─── Fuel plan knobs ─────────────────────────────────────────────────────────
//
// Track Progress frames its fuel recommendation as "what slider value would
// finish the race on the reserve below": no surplus laps on top. The player
// wants to reach the flag at about zero and lifts and coasts on the last laps
// when a race runs heavy, so Pits n' Giggles' "Conservative" surplus
// (`surplusLaps`, 0.25 laps in its Fuel Strategy Calculator) is gone. These
// knobs do not apply to the retrospective Fuel Margin shown on a single session.

/** Fuel the car can't burn, kept in the tank at the flag. Matches PnG's
 *  `MIN_FUEL_LEVEL`:
 *  https://github.com/ashwin-nat/pits-n-giggles/blob/hotfix-v4.3.0/apps/frontend/js/fuelCalculator.js */
export const FUEL_RESERVE_KG = 0.2;

/** Dry and wet races burn differently (Inters ~7% more per lap than slicks
 *  in F1 26), so each gets its own fuel plan. */
export type FuelConditions = "dry" | "wet";

/** Same set as analysis/trackStrategyCompounds.ts isWetCompound(), kept here
 *  so stats primitives don't import the product layer. */
const WET_TYRES = new Set(["Inters", "Intermediate", "Wet", "Wets"]);

/** The tyres a lap's end-of-lap snapshot shows: dry on slicks, wet on Inters or Wets. */
export function lapFuelConditions(lap: PerLapInfo): FuelConditions {
  return WET_TYRES.has(lap["car-status-data"]?.["visual-tyre-compound"] ?? "")
    ? "wet"
    : "dry";
}

/** Safety car or VSC. `FORMATION_LAP` is not one: online races tag lap 1 with
 *  it, yet that lap burns like any other start. */
function isNeutralisedFuelLap(lap: PerLapInfo): boolean {
  const status = lap["max-safety-car-status"] ?? "NO_SAFETY_CAR";
  return status !== "NO_SAFETY_CAR" && status !== "FORMATION_LAP";
}

export interface RaceFuelBurn {
  /** Fuel burned from the grid to the end of lap 1, kg; null when lap 1 ran
   *  under a safety car, on the other tyre type, or lacks a snapshot. */
  startLapKg: number | null;
  /** Fuel burned on each later green lap on this tyre type, kg. */
  greenLapsKg: number[];
}

/** One race's fuel burn on dry or wet laps, for the track fuel plan.
 *
 *  Lap 1 stands apart: the standing start burns ~0.05-0.08 kg more than a
 *  green lap, and only one lap per race does it. The formation lap shows no
 *  burn at all: the lap-0 snapshot holds the load set in the menu, to the
 *  0.1 kg, and lap 1 burns the same with or without a formation lap.
 *  Later laps count when they and the lap before ran green (the lap after a
 *  restart is still slow) on the same tyre type, so a pit lap that swaps
 *  slicks for Inters counts for neither, and a lap still in progress when
 *  the save was made never does. The race's last lap never counts:
 *  online its snapshot is taken after the flag, 0.3-0.7 kg of cool-down burn
 *  late. */
export function collectRaceFuelBurn(
  player: DriverData,
  conditions: FuelConditions,
  totalLaps: number,
): RaceFuelBurn {
  // A save made mid-race records the lap in progress too: its fuel is read
  // part-way round, so only laps the game timed as finished count. Exports
  // without lap history keep every snapshot.
  const history = player["session-history"]?.["lap-history-data"] ?? [];
  let lastTimedLap = 0;
  history.forEach((lap, index) => {
    if (lap["lap-time-in-ms"] > 0) lastTimedLap = index + 1;
  });
  const lastLap = lastTimedLap > 0 ? lastTimedLap : Number.POSITIVE_INFINITY;
  const byLap = new Map<number, PerLapInfo>();
  for (const lap of player["per-lap-info"] ?? []) {
    const fuel = lap["car-status-data"]?.["fuel-in-tank"];
    if (
      Number.isFinite(lap["lap-number"]) &&
      lap["lap-number"] <= lastLap &&
      Number.isFinite(fuel) &&
      fuel > 0
    )
      byLap.set(lap["lap-number"], lap);
  }
  const fuelOf = (lap: PerLapInfo) => lap["car-status-data"]["fuel-in-tank"];
  const counts = (lap: PerLapInfo) =>
    !isNeutralisedFuelLap(lap) && lapFuelConditions(lap) === conditions;

  const grid = byLap.get(0);
  const first = byLap.get(1);
  const startBurn =
    grid && first && counts(first) && lapFuelConditions(grid) === conditions
      ? fuelOf(grid) - fuelOf(first)
      : null;

  const greenLapsKg: number[] = [];
  for (const [lapNumber, lap] of byLap) {
    if (lapNumber < 2 || lapNumber >= totalLaps) continue;
    const prev = byLap.get(lapNumber - 1);
    if (!prev || !counts(prev) || !counts(lap)) continue;
    const delta = fuelOf(prev) - fuelOf(lap);
    if (delta > 0) greenLapsKg.push(delta);
  }
  return {
    startLapKg: startBurn != null && startBurn > 0 ? startBurn : null,
    greenLapsKg,
  };
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
  // Restricted spectator telemetry is exported as plausible-looking rows whose
  // fuel fields are all zero. Require one positive tank or capacity reading so
  // those placeholders cannot become a fake +0.0-lap outcome. Earlier positive
  // readings still allow a legitimate car that reaches zero fuel at the line.
  const hasRealFuelTelemetry = statusSnapshots.some((lap) => {
    const status = lap["car-status-data"];
    if (!status) return false;
    return (
      (Number.isFinite(status["fuel-in-tank"]) && status["fuel-in-tank"] > 0) ||
      (Number.isFinite(status["fuel-capacity"]) && status["fuel-capacity"]! > 0)
    );
  });
  if (!hasRealFuelTelemetry) return null;

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
