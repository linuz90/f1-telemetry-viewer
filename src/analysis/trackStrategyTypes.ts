import type { DriverData, TelemetrySession } from "../types/telemetry";

// ─── Track-level Race "Key Insights" recommendation ──────────────────────────

export interface TrackBestRaceLap {
  /** Best race-pace lap time in ms */
  bestLapMs: number;
  /** Visual compound the lap was set on, if known */
  compound: string | null;
  /** Sum-of-best-sectors theoretical best from race-pace laps */
  theoreticalBestMs: number;
  /** Gap to theoretical best (bestLapMs - theoreticalBestMs); 0 if either side missing */
  gapToTheoreticalMs: number;
}

export interface TrackStrategySuggestion {
  /** Visual compound sequence, e.g. ["Medium", "Hard"] */
  compounds: string[];
  /** Stint lengths the recommendation is anchored on (laps). Same length as compounds */
  stintLaps: number[];
  /** Projected worst-wheel wear at the end of each stint. Same length as compounds */
  stintWearPercentages: number[];
  /** Pit-window per stop, indexed by the pit (stops between compounds[i] and compounds[i+1]).
   *  Empty for a no-stop strategy. */
  pitWindows: { earliest: number; latest: number; target: number }[];
  /** Number of races in the selected race-length bucket */
  raceCount: number;
  /** Number of bucket races that were near-full-distance */
  fullDistanceRaceCount: number;
  /** True when the shape was synthesized from usable bucket tyre data */
  isEvidenceBacked: boolean;
  /** True when the first stint is on a softer compound than the second — a
   *  "fast start, durable finish" shape. False for the mirror "durable start,
   *  fast finish" alternative. Undefined for two-stop sandwiches. */
  fastStart?: boolean;
  /** Present when a borderline one-stop exceeds the normal tyre-wear cap and
   *  should be treated as viable only with deliberate tyre management. */
  risk?: TrackStrategyRisk;
  /** Relative/absolute timing estimate used to rank strategy rows. */
  timeEstimate?: TrackStrategyTimeEstimate;
}

export interface TrackStrategyRisk {
  kind: "managed-tyres";
  projectedMaxWear: number;
  overThreshold: number;
  limitingCompound: string;
  limitingStintLaps: number;
}

export interface TrackStrategyShape {
  compounds: string[];
  stintLaps: number[];
  stintWearPercentages: number[];
  risk?: TrackStrategyRisk;
}

export interface TrackStrategyTimeEstimate {
  /** Approximate full-race time in ms, only present when anchored to a real race. */
  predictedTotalRaceMs?: number;
  /** Gap to the fastest scored strategy in this candidate set. */
  deltaToFastestMs: number;
  /** Pit-loss assumption used by the scorer, if available. */
  pitLossMs?: number;
  confidence: "high" | "medium" | "low";
  source: string;
  details?: {
    pitLossSource?: string;
    paceSource?: string;
    anchorSource?: string;
  };
}

export interface TrackFuelTarget {
  /** Recommended delta over zero-laps-remaining at lights out (in laps) */
  recommendedDeltaLaps: number;
  /** Recommended total fuel load (kg) the delta translates to */
  recommendedFuelKg: number;
  /** Pooled p75 consecutive green-flag burn rate, kg/lap */
  burnRateKgPerLap: number;
  /** Average projected excess at finish (laps). Positive = over-fueling. */
  excessAtFinishLaps: number;
  /** Number of independently eligible attempts in the sample */
  eligibleAttemptCount: number;
  /** Consecutive green-flag fuel pairs behind the p75 burn estimate. */
  consecutiveGreenPairCount: number;
  /** Contributing attempts classified as FINISHED. */
  completedRaceCount: number;
  confidence: "low" | "medium" | "high";
}

export interface TrackSinceLastRaceDelta {
  /** Best race-pace lap delta vs. previous race here (ms). Negative = improvement. 0 if either side missing */
  bestLapDeltaMs: number;
  /** Avg wear-rate delta (%/lap). Negative = gentler than before. 0 if either side missing */
  wearRateDelta: number;
}

export interface TrackRaceRecommendation {
  /** Number of races in the selected bucket */
  raceCount: number;
  /** Number of races in the bucket that finished near full distance (>= totalLaps - 1) */
  fullDistanceRaceCount: number;
  /** Whether usable bucket tyre data produced a strategy shape */
  hasEvidence: boolean;
  bestRaceLap: TrackBestRaceLap | null;
  /** Best race lap vs best quali lap (ms). Negative = race lap was faster. 0 if either side missing */
  raceVsQualiDeltaMs: number;
  /** Average ERS deployed per lap across the bucket's races (MJ). 0 if no data */
  avgErsDeployMj: number;
  recommended: TrackStrategySuggestion | null;
  alternative: TrackStrategySuggestion | null;
  fuelTarget: TrackFuelTarget | null;
  sinceLastRace: TrackSinceLastRaceDelta | null;
}

export interface TrackRaceRecommendationOptions {
  bestQualiLapMs?: number;
  /** Same-track race sessions across distances; used only for pit-loss inference. */
  pitLossRaceSessions?: TelemetrySession[];
}

export interface BucketRaceEntry {
  session: TelemetrySession;
  player: DriverData;
  totalLaps: number;
  isFullDistance: boolean;
}
