import type { DriverData, PerLapInfo } from "../../types/telemetry";
import { formatLapDelta, median } from "./core";
import type { StrategyInsight } from "./insightTypes";

// ─── Fuel safety knobs ───────────────────────────────────────────────────────
//
// We frame the fuel recommendation as "what slider value would *just* finish
// the race assuming every lap is green-flag" and then add two small safety
// buffers on top, so a literal reading of the chip in a clean race doesn't
// leave you crossing the line on fumes (or DSQ-risk territory).
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

/** Result of a fuel burn-rate calculation for a single race session */
export interface FuelCalcResult {
  burnRateKg: number;
  greenFlagLapCount: number;
  startFuelKg: number;
  startFuelLaps: number;
  /** Game's fuel-remaining-laps at lap 0 — what the player loaded */
  startFuelRemaining: number;
  /** Fuel in tank (kg) at last recorded lap */
  endFuelKg: number;
  /** Game's fuel-remaining-laps at last recorded lap */
  fuelRemainingLaps: number;
  lastLapNumber: number;
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
    (l) => l["car-status-data"]?.["fuel-in-tank"] > 0,
  );
  if (lapsWithFuel.length < 2) return [];
  const deltas: number[] = [];
  for (let i = 1; i < lapsWithFuel.length; i++) {
    const prev = lapsWithFuel[i - 1];
    const curr = lapsWithFuel[i];
    if (!isGreenFlagLap(prev) || !isGreenFlagLap(curr)) continue;
    const delta =
      prev["car-status-data"]["fuel-in-tank"] -
      curr["car-status-data"]["fuel-in-tank"];
    if (delta > 0) deltas.push(delta);
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

/**
 * Average ERS deployment in MJ per lap (green-flag laps only, excluding first
 * and last lap). Pits n' Giggles' per-lap `ers-stats` is more reliable than
 * the end-of-lap car-status snapshot for F1 26 and remains optional for older
 * exports.
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

/** Average ERS harvested in MJ per lap (green-flag laps only, excluding first
 *  and last lap). In F1 26 this is the key signal for lift-and-coast usage. */
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

/** Calculate fuel burn rate and related metrics for a player in a race.
 *  Uses the median of per-lap fuel deltas (green-flag laps only) for a burn
 *  rate that's robust against outliers and not skewed by SC/VSC/formation laps. */
export function calculateBurnRate(player: DriverData): FuelCalcResult | null {
  const perLap = player["per-lap-info"];
  if (!perLap?.length) return null;

  const lapsWithFuel = perLap.filter(
    (l) => l["car-status-data"]?.["fuel-in-tank"] > 0,
  );
  if (lapsWithFuel.length < 6) return null;

  const deltas = collectGreenFlagBurnDeltas(player);
  if (deltas.length < 3) return null;

  const burnRateKg = median(deltas);
  if (burnRateKg == null || burnRateKg <= 0) return null;

  const firstLap = lapsWithFuel[0];
  const lastLap = lapsWithFuel[lapsWithFuel.length - 1];

  const startFuelKg = firstLap["car-status-data"]["fuel-in-tank"];
  const startFuelLaps = startFuelKg / burnRateKg;
  const startFuelRemaining = firstLap["car-status-data"]["fuel-remaining-laps"];
  const endFuelKg = lastLap["car-status-data"]["fuel-in-tank"];
  const fuelRemainingLaps = lastLap["car-status-data"]["fuel-remaining-laps"];
  const lastLapNumber = lastLap["lap-number"] as number;

  return {
    burnRateKg,
    greenFlagLapCount: deltas.length,
    startFuelKg,
    startFuelLaps,
    startFuelRemaining,
    endFuelKg,
    fuelRemainingLaps,
    lastLapNumber,
  };
}

/** Generate fuel insights for race sessions */
export function generateFuelInsights(
  player: DriverData,
  totalRaceLaps: number,
): StrategyInsight[] {
  const result = calculateBurnRate(player);

  // Not enough data — show placeholder rows explaining why
  if (!result) {
    const perLap = player["per-lap-info"];
    const lapsWithFuel =
      perLap?.filter((l) => l["car-status-data"]?.["fuel-in-tank"] > 0)
        .length ?? 0;
    const detail =
      lapsWithFuel < 6
        ? `need 6+ laps with fuel data, got ${lapsWithFuel}`
        : "need 3+ green-flag lap pairs";
    return [
      { type: "fuel", label: "Initial Fuel", value: "—", detail },
      { type: "fuel", label: "Recommended Fuel", value: "—", detail },
    ];
  }

  const { burnRateKg, greenFlagLapCount, startFuelRemaining } = result;

  const insights: StrategyInsight[] = [];

  // Row 1: Fuel Load — always shown
  insights.push({
    type: "fuel",
    label: "Initial Fuel",
    value: `${formatLapDelta(startFuelRemaining)} laps`,
    detail: `${Math.round(result.startFuelKg)} kg — ${burnRateKg.toFixed(2)} kg/lap avg`,
  });

  // Row 2: Fuel Recommendation — clean-race projection.
  //
  // We deliberately ignore the actual fuel remaining at the chequered flag.
  // Safety-car / VSC laps burn much less than green-flag laps (this race at
  // Catalunya: ~0.7 kg/lap under FSC vs ~1.05 kg/lap green), so any real
  // leftover at the line bakes in fuel saved by SCs that the *next* race
  // probably won't have. The recommendation assumes a worst-case all-green
  // race at the measured green-flag burn rate, then keeps a small safety
  // margin on top (see MIN_FUEL_LEVEL_KG + FUEL_SURPLUS_LAPS) so following
  // it never leaves you stranded in a clean race.
  if (greenFlagLapCount >= 5) {
    // Raw "clean race" excess — what would be left over if every lap burned
    // at the measured green-flag rate. Shown verbatim in the detail line.
    const rawExcessLaps = result.startFuelKg / burnRateKg - totalRaceLaps;
    // Recommendation bakes in a small safety buffer above the bare minimum.
    const recommended =
      startFuelRemaining - (rawExcessLaps - fuelSafetyMarginLaps(burnRateKg));
    let detail: string;
    if (Math.abs(rawExcessLaps) < 0.3) {
      detail = `clean-race fuel load was spot on (${greenFlagLapCount} green laps)`;
    } else if (rawExcessLaps > 0) {
      detail = `${formatLapDelta(rawExcessLaps)} laps spare in a clean race (${greenFlagLapCount} green laps)`;
    } else {
      detail = `${formatLapDelta(rawExcessLaps)} laps short in a clean race (${greenFlagLapCount} green laps)`;
    }
    insights.push({
      type: "fuel",
      label: "Recommended Fuel",
      value: `${formatLapDelta(recommended)} laps`,
      detail,
    });
  } else {
    insights.push({
      type: "fuel",
      label: "Recommended Fuel",
      value: "—",
      detail: `need 5+ green-flag laps, got ${greenFlagLapCount}`,
    });
  }

  return insights;
}
