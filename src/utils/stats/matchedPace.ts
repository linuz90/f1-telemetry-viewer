import type { DriverData } from "../../types/telemetry";
import { sectorTimeMs } from "../format";
import { getRacePaceLapSamples, type RacePaceLapSample } from "./laps";
import { getRacePaceRankingSampleThreshold } from "./racePace";

const MIN_MATCHED_PACE_SAMPLES_PER_DRIVER = 3;

export interface CompoundMatchedPaceComparison {
  /** First driver's weighted pace minus the second driver's pace. */
  deltaMs: number;
  /** Shared evidence weight summed across contributing compounds. */
  evidenceWeight: number;
  firstSampleCount: number;
  secondSampleCount: number;
  compounds: string[];
  /** Same-pool first-minus-second means for S1, S2, and S3. */
  sectorDeltasMs: [number, number, number];
}

function meanMs(
  samples: readonly RacePaceLapSample[],
  value: (sample: RacePaceLapSample) => number,
): number {
  return (
    samples.reduce((sum, sample) => sum + value(sample), 0) / samples.length
  );
}

function racePaceSamplesByCompound(
  driver: DriverData,
): Map<string, RacePaceLapSample[]> {
  const byCompound = new Map<string, RacePaceLapSample[]>();
  for (const sample of getRacePaceLapSamples(driver)) {
    if (!sample.compound) continue;
    const samples = byCompound.get(sample.compound) ?? [];
    samples.push(sample);
    byCompound.set(sample.compound, samples);
  }
  return byCompound;
}

/** Compare two drivers only on compounds for which both have stint evidence. */
export function compareCompoundMatchedRacePace(
  firstDriver: DriverData,
  secondDriver: DriverData,
): CompoundMatchedPaceComparison | null {
  const firstByCompound = racePaceSamplesByCompound(firstDriver);
  const secondByCompound = racePaceSamplesByCompound(secondDriver);

  let weightedDeltaMs = 0;
  const weightedSectorDeltasMs = [0, 0, 0];
  let totalWeight = 0;
  let firstSampleCount = 0;
  let secondSampleCount = 0;
  const compounds: string[] = [];

  for (const [compound, firstSamples] of firstByCompound) {
    const secondSamples = secondByCompound.get(compound);
    if (!secondSamples) continue;

    // Matching one hot lap would only disguise a best-lap comparison. Three
    // clean laps per driver is the smallest useful stint-level pace sample;
    // the relative floor also prevents a 10-lap mean masquerading as a
    // balanced comparison against only three laps.
    const sharedEvidence = Math.min(firstSamples.length, secondSamples.length);
    const requiredEvidence = getRacePaceRankingSampleThreshold(
      Math.max(firstSamples.length, secondSamples.length),
    );
    if (
      sharedEvidence < MIN_MATCHED_PACE_SAMPLES_PER_DRIVER ||
      sharedEvidence < requiredEvidence
    ) {
      continue;
    }

    // Means, like Race Pace: the per-compound delta then equals the gap the
    // Classification table shows with that compound selected, and the three
    // sector deltas sum to the lap delta. Outliers are already removed by
    // `getRacePaceLapSamples`, which is what a median would otherwise buy.
    weightedDeltaMs +=
      (meanMs(firstSamples, (sample) => sample.timeMs) -
        meanMs(secondSamples, (sample) => sample.timeMs)) *
      sharedEvidence;
    for (const sector of [1, 2, 3] as const) {
      weightedSectorDeltasMs[sector - 1] +=
        (meanMs(firstSamples, (sample) => sectorTimeMs(sample.lap, sector)) -
          meanMs(secondSamples, (sample) => sectorTimeMs(sample.lap, sector))) *
        sharedEvidence;
    }
    totalWeight += sharedEvidence;
    firstSampleCount += firstSamples.length;
    secondSampleCount += secondSamples.length;
    compounds.push(compound);
  }

  if (totalWeight === 0) return null;
  return {
    deltaMs: weightedDeltaMs / totalWeight,
    evidenceWeight: totalWeight,
    firstSampleCount,
    secondSampleCount,
    compounds,
    sectorDeltasMs: weightedSectorDeltasMs.map(
      (delta) => delta / totalWeight,
    ) as [number, number, number],
  };
}
