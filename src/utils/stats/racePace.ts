import type { DriverData } from "../../types/telemetry";
import { getRacePaceLapSamples, type RacePaceLapSample } from "./laps";

export const MIN_RACE_PACE_SAMPLE_COUNT = 3;
export const MEDIUM_RACE_PACE_SAMPLE_COUNT = 5;
export const HIGH_RACE_PACE_SAMPLE_COUNT = 8;
export const RACE_PACE_RANKING_REFERENCE_FRACTION = 0.5;

export type RacePaceConfidence = "low" | "medium" | "high";

export interface RacePaceEstimate {
  /** Arithmetic mean of every eligible race-pace lap, or null without enough evidence. */
  timeMs: number | null;
  /** Eligible samples, including sub-threshold evidence retained for UI messaging. */
  sampleCount: number;
  confidence: RacePaceConfidence | null;
}

function confidenceForSampleCount(
  sampleCount: number,
): RacePaceConfidence | null {
  if (sampleCount < MIN_RACE_PACE_SAMPLE_COUNT) return null;
  if (sampleCount < MEDIUM_RACE_PACE_SAMPLE_COUNT) return "low";
  if (sampleCount < HIGH_RACE_PACE_SAMPLE_COUNT) return "medium";
  return "high";
}

export function calculateRacePaceEstimate(
  samples: readonly RacePaceLapSample[],
): RacePaceEstimate {
  const sampleCount = samples.length;
  const confidence = confidenceForSampleCount(sampleCount);

  if (confidence == null) {
    return { timeMs: null, sampleCount, confidence };
  }

  const totalTimeMs = samples.reduce(
    (total, sample) => total + sample.timeMs,
    0,
  );
  return {
    timeMs: totalTimeMs / sampleCount,
    sampleCount,
    confidence,
  };
}

export function getRacePaceEstimate(driver: DriverData): RacePaceEstimate {
  return calculateRacePaceEstimate(getRacePaceLapSamples(driver));
}

export function getRacePaceReferenceSampleCount(
  estimates: Iterable<RacePaceEstimate>,
): number {
  let referenceSampleCount = 0;
  for (const estimate of estimates) {
    referenceSampleCount = Math.max(referenceSampleCount, estimate.sampleCount);
  }
  return referenceSampleCount;
}

export function getRacePaceRankingSampleThreshold(
  referenceEligibleCount: number,
): number {
  const safeReferenceCount =
    Number.isFinite(referenceEligibleCount) && referenceEligibleCount > 0
      ? referenceEligibleCount
      : 0;

  // A relative floor avoids ranking a short fragment against a complete race,
  // while preserving far more short-session evidence than a fixed 5/10-lap gate.
  return Math.max(
    MIN_RACE_PACE_SAMPLE_COUNT,
    Math.ceil(safeReferenceCount * RACE_PACE_RANKING_REFERENCE_FRACTION),
  );
}

export function isRacePaceRankEligible(
  estimate: RacePaceEstimate,
  referenceEligibleCount: number,
): boolean {
  return (
    estimate.timeMs != null &&
    estimate.sampleCount >=
      getRacePaceRankingSampleThreshold(referenceEligibleCount)
  );
}

export function hasSufficientRacePaceCompletion(
  driver: DriverData,
  totalLaps: number,
): boolean {
  if (!Number.isFinite(totalLaps) || totalLaps <= 0) return false;

  const classification = driver["final-classification"];
  if (classification) {
    const resultStatus = classification["result-status"]
      ?.toUpperCase()
      .replace(/[\s-]+/g, "_");
    // Lap count alone cannot distinguish a finish from a late retirement or
    // disqualification, neither of which should establish a historical PB.
    if (resultStatus !== "FINISHED") return false;
  }

  const completedLaps =
    classification?.["num-laps"] ?? driver["session-history"]["num-laps"];
  // Permit the usual one-lap classification offset, but never let a partial
  // mid-race save establish a deceptively fast historical pace benchmark.
  return completedLaps >= totalLaps - 1;
}
