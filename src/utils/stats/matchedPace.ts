import type { DriverData } from "../../types/telemetry";
import { sectorTimeMs } from "../format";
import { median } from "./core";
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
  /** Same-pool first-minus-second medians for S1, S2, and S3. */
  sectorDeltasMs: [number, number, number];
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
    // the relative floor also prevents a 10-lap median masquerading as a
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

    const firstMedian = median(firstSamples.map((sample) => sample.timeMs));
    const secondMedian = median(secondSamples.map((sample) => sample.timeMs));
    if (firstMedian == null || secondMedian == null) continue;

    weightedDeltaMs += (firstMedian - secondMedian) * sharedEvidence;
    for (const sector of [1, 2, 3] as const) {
      const firstSectorMedian = median(
        firstSamples.map((sample) => sectorTimeMs(sample.lap, sector)),
      );
      const secondSectorMedian = median(
        secondSamples.map((sample) => sectorTimeMs(sample.lap, sector)),
      );
      // Race-pace samples are structurally complete, so all three medians are
      // present; keeping the guard makes this helper robust to future sources.
      if (firstSectorMedian == null || secondSectorMedian == null) continue;
      weightedSectorDeltasMs[sector - 1] +=
        (firstSectorMedian - secondSectorMedian) * sharedEvidence;
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
