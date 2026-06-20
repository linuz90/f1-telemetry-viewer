import type { TelemetrySession } from "../../types/telemetry";
import { isLapValid } from "../format";
import { median } from "./core";
import { findPlayer, isRaceSession } from "./drivers";
import { collectGreenFlagBurnDeltas, fuelSafetyMarginLaps } from "./energy";
import { estimateMaxLife, stintWearRate } from "./tyres";

/** Per-compound tyre life stats aggregated across sessions */
export interface CompoundLifeStats {
  compound: string;
  avgWearRatePerLap: number;
  estMaxLife: number;
  avgStintLength: number;
  longestStint: number;
  stintCount: number;
  /** Best valid lap time in ms on this compound (0 if none) */
  bestLapMs: number;
}

/** Minimum stint length to include in aggregate compound stats */
const MIN_STINT_LAPS = 3;

/** Aggregate compound tyre life across all race sessions at a track */
export function aggregateCompoundLife(
  sessions: TelemetrySession[],
): CompoundLifeStats[] {
  const byCompound: Record<
    string,
    { rates: number[]; lengths: number[]; bestLapMs: number }
  > = {};

  for (const session of sessions) {
    if (!isRaceSession(session)) continue;
    const player = findPlayer(session);
    if (!player) continue;

    const laps = player["session-history"]["lap-history-data"];

    for (const stint of player["tyre-set-history"]) {
      if (stint["stint-length"] < MIN_STINT_LAPS) continue;

      const compound = stint["tyre-set-data"]["visual-tyre-compound"];
      const rate = stintWearRate(stint);
      if (rate <= 0) continue;

      if (!byCompound[compound])
        byCompound[compound] = { rates: [], lengths: [], bestLapMs: 0 };
      byCompound[compound].rates.push(rate);
      byCompound[compound].lengths.push(stint["stint-length"]);

      // Find best valid lap in this stint
      let lapNum = 0;
      for (const l of laps) {
        if (l["lap-time-in-ms"] > 0) {
          lapNum++;
          if (lapNum >= stint["start-lap"] && lapNum <= stint["end-lap"]) {
            if (
              isLapValid(l["lap-valid-bit-flags"]) &&
              l["lap-time-in-ms"] > 0
            ) {
              const cur = byCompound[compound].bestLapMs;
              if (cur === 0 || l["lap-time-in-ms"] < cur) {
                byCompound[compound].bestLapMs = l["lap-time-in-ms"];
              }
            }
          }
        }
      }
    }
  }

  return Object.entries(byCompound).map(
    ([compound, { rates, lengths, bestLapMs }]) => {
      const avgRate = rates.reduce((a, b) => a + b, 0) / rates.length;
      const avgLength = lengths.reduce((a, b) => a + b, 0) / lengths.length;
      return {
        compound,
        avgWearRatePerLap: avgRate,
        estMaxLife: estimateMaxLife(avgRate),
        avgStintLength: Math.round(avgLength),
        longestStint: Math.max(...lengths),
        stintCount: rates.length,
        bestLapMs,
      };
    },
  );
}

/** Fuel stats aggregated across race sessions at a track */
export interface TrackFuelStats {
  avgBurnRateKgPerLap: number;
  avgStartingFuelKg: number;
  /** Average game fuel-remaining-laps at start (matches session "Initial Fuel") */
  avgInitialFuelLaps: number;
  /** Average recommended fuel delta in laps (matches session "Recommended Fuel") */
  avgRecommendedFuelLaps: number;
  /** Average total fuel load (kg) implied by the recommendation — i.e. enough
   *  to cover the race distance at the pooled burn rate plus the safety
   *  margin. Useful for surfacing alongside the laps-based delta. */
  avgRecommendedFuelKg: number;
  /** Average laps of fuel each race had to spare assuming a clean (all
   *  green-flag) run at the pooled burn rate. Positive = over-fuel, negative
   *  = wouldn't have finished without the SC saves that actually happened. */
  avgExcessAtFinishLaps: number;
  raceCount: number;
}

/** Aggregate fuel data across all race sessions at a track.
 *
 *  Two key choices, both aimed at making the chip safe to act on:
 *
 *  1. **Pooled burn rate.** Green-flag fuel deltas from every race at the
 *     track go into a single pool, and the pooled median is the burn rate.
 *     One race rarely has enough green-flag pairs to nail this down; pooling
 *     across (e.g.) 23 Catalunya races gives a much tighter number.
 *
 *  2. **Clean-race excess, not observed leftover.** Per-race excess is
 *     `startFuelKg / pooledBurnRate − totalLaps` — i.e. what the leftover
 *     *would* be if every lap burned at the green-flag rate. We deliberately
 *     do NOT use the fuel actually left in the tank at the finish: SC/VSC
 *     laps burn ~30% less, and counting that as headroom would tell the user
 *     to under-fuel for a race that happens to run clean.
 */
export function aggregateFuelData(
  sessions: TelemetrySession[],
): TrackFuelStats | null {
  const pooledDeltas: number[] = [];
  const perRace: {
    startFuelKg: number;
    startFuelRemaining: number;
    totalLaps: number;
  }[] = [];

  for (const session of sessions) {
    if (!isRaceSession(session)) continue;
    const player = findPlayer(session);
    if (!player) continue;
    const totalLaps = session["session-info"]["total-laps"];
    if (!(totalLaps > 0)) continue;

    const perLap = player["per-lap-info"];
    const lapsWithFuel =
      perLap?.filter((l) => l["car-status-data"]?.["fuel-in-tank"] > 0) ?? [];
    if (lapsWithFuel.length < 6) continue;

    pooledDeltas.push(...collectGreenFlagBurnDeltas(player));

    const firstLap = lapsWithFuel[0];
    perRace.push({
      startFuelKg: firstLap["car-status-data"]["fuel-in-tank"],
      startFuelRemaining: firstLap["car-status-data"]["fuel-remaining-laps"],
      totalLaps,
    });
  }

  // Need a representative pool of green-flag pairs to trust the burn rate.
  // 12 ≈ four races at three pairs each; below that, one weird race could
  // swing the recommendation by a full lap.
  if (perRace.length === 0 || pooledDeltas.length < 12) return null;

  const pooledBurnRateKg = median(pooledDeltas);
  if (pooledBurnRateKg == null || pooledBurnRateKg <= 0) return null;

  const avg = (arr: number[]) => arr.reduce((a, b) => a + b, 0) / arr.length;

  // Raw clean-race excess per race (laps spare if every lap had burned at
  // the pooled green-flag rate). This is the honest "how much could we have
  // shaved" number, surfaced as-is in the tile note.
  const excessAtFinish = perRace.map(
    (r) => r.startFuelKg / pooledBurnRateKg - r.totalLaps,
  );

  // The actual recommendation keeps a small safety buffer above zero
  // leftover (unusable-fuel reserve + surplus laps) so following it doesn't
  // leave the player on fumes in a clean race. Matches the buffers PnG's
  // calculator bakes into its "Conservative" strategy.
  const safetyMarginLaps = fuelSafetyMarginLaps(pooledBurnRateKg);
  const recommendedPerRace = perRace.map(
    (r, i) => r.startFuelRemaining - (excessAtFinish[i]! - safetyMarginLaps),
  );
  // The recommendation collapses to "fuel for totalLaps + safetyMargin" at the
  // pooled burn rate — that's the kg figure the player would set in PnG.
  const recommendedKgPerRace = perRace.map(
    (r) => (r.totalLaps + safetyMarginLaps) * pooledBurnRateKg,
  );

  return {
    avgBurnRateKgPerLap: pooledBurnRateKg,
    avgStartingFuelKg: avg(perRace.map((r) => r.startFuelKg)),
    avgInitialFuelLaps: avg(perRace.map((r) => r.startFuelRemaining)),
    avgRecommendedFuelLaps: avg(recommendedPerRace),
    avgRecommendedFuelKg: avg(recommendedKgPerRace),
    avgExcessAtFinishLaps: avg(excessAtFinish),
    raceCount: perRace.length,
  };
}
