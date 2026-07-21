import type { CompoundLifeStats } from "../utils/stats/trackAggregates";

export const DEFAULT_COMPOUND_STEP_MS = 180;

export const DRY_COMPOUND_PRIORITY: Record<string, number> = {
  Soft: 0,
  Medium: 1,
  Hard: 2,
  C5: 0,
  C4: 0.5,
  C3: 1,
  C2: 1.5,
  C1: 2,
};

export function isDryCompound(compound: string): boolean {
  return compound in DRY_COMPOUND_PRIORITY;
}

/** Sort dry compound stats by relative softness (Soft → Medium → Hard).
 *  Observed best-lap order isn't trustworthy here because fuel load and
 *  driver effort confound it — a player's best Hard lap can easily beat
 *  their best Medium lap simply because the Hard stint ran on lower fuel.
 *  The compound names are themselves relative-pace labels for the track,
 *  so the priority ordering matches F1 fresh-lap pace assumptions directly. */
export function rankDryCompoundsByPace<T extends CompoundLifeStats>(
  compoundLifeStats: T[],
): T[] {
  const dry = compoundLifeStats.filter(
    (c) => isDryCompound(c.compound) && c.avgWearRatePerLap > 0,
  );
  return dry.sort((a, b) => {
    const aPri = DRY_COMPOUND_PRIORITY[a.compound] ?? Number.POSITIVE_INFINITY;
    const bPri = DRY_COMPOUND_PRIORITY[b.compound] ?? Number.POSITIVE_INFINITY;
    if (aPri !== bPri) return aPri - bPri;
    // Tie-break by stint sample size so real evidence wins over inferred rows.
    return b.stintCount - a.stintCount;
  });
}
