export type CompoundPaceFormulaKey = "f1-25" | "f1-26";

export interface ActualCompoundPacePrior {
  /** Fresh-tyre gap where `harder time = softer time * (1 + fraction)`. */
  adjacentStepFraction: number;
  softestCompoundNumber: number;
}

/**
 * Rounded cross-track fallbacks derived from the user's fresh Tyre Sets
 * packets. A single step per game intentionally avoids overfitting thin
 * individual edges; target-session packet deltas still take precedence.
 */
export const ACTUAL_COMPOUND_PACE_PRIORS: Record<
  CompoundPaceFormulaKey,
  ActualCompoundPacePrior
> = {
  "f1-25": { adjacentStepFraction: 0.0065, softestCompoundNumber: 6 },
  "f1-26": { adjacentStepFraction: 0.0055, softestCompoundNumber: 5 },
};

export function isCompoundPaceFormulaKey(
  formulaKey: string,
): formulaKey is CompoundPaceFormulaKey {
  return formulaKey === "f1-25" || formulaKey === "f1-26";
}

/**
 * Return lap-time multipliers relative to C1. Softer compounds have smaller
 * multipliers, and skipped physical compounds compose multiplicatively.
 */
export function getActualCompoundLapTimeMultipliers(
  formulaKey: string,
): Map<string, number> | null {
  if (!isCompoundPaceFormulaKey(formulaKey)) return null;

  const prior = ACTUAL_COMPOUND_PACE_PRIORS[formulaKey];
  const multipliers = new Map<string, number>([["C1", 1]]);
  for (
    let compoundNumber = 2;
    compoundNumber <= prior.softestCompoundNumber;
    compoundNumber++
  ) {
    const harderMultiplier = multipliers.get(`C${compoundNumber - 1}`);
    if (harderMultiplier == null) return null;
    multipliers.set(
      `C${compoundNumber}`,
      harderMultiplier / (1 + prior.adjacentStepFraction),
    );
  }
  return multipliers;
}
