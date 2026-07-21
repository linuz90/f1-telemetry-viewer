import type { CompoundPaceFormulaKey } from "./compoundPace";
import { isCompoundPaceFormulaKey } from "./compoundPace";

interface ActualCompoundWearCalibrationEdge {
  harder: string;
  softer: string;
  /** Correction applied after the game's usable-life ratio. */
  factor: number;
}

/**
 * Low-confidence corrections fitted from paired worst-wheel wear in the user
 * corpus. Raw usable-life scaling systematically overpredicted harder-compound
 * wear; these deliberately rounded edge factors retain a small safety bias.
 */
const ACTUAL_COMPOUND_WEAR_CALIBRATION_EDGES: Record<
  CompoundPaceFormulaKey,
  readonly ActualCompoundWearCalibrationEdge[]
> = {
  "f1-25": [
    { harder: "C1", softer: "C2", factor: 0.8 },
    { harder: "C2", softer: "C3", factor: 0.84 },
    { harder: "C3", softer: "C4", factor: 0.78 },
    { harder: "C4", softer: "C5", factor: 0.8 },
    { harder: "C5", softer: "C6", factor: 0.8 },
  ],
  "f1-26": [
    { harder: "C1", softer: "C2", factor: 0.88 },
    { harder: "C2", softer: "C3", factor: 0.88 },
    { harder: "C3", softer: "C4", factor: 0.9 },
    { harder: "C4", softer: "C5", factor: 0.9 },
  ],
};

function compoundNumber(compound: string): number | null {
  const match = compound.match(/^C(\d+)$/);
  return match ? Number(match[1]) : null;
}

/**
 * Compose calibration edges when the race allocation skips a physical rung.
 * Softer or equal targets abstain because that direction is not validated.
 */
export function getHarderCompoundWearCalibration(
  formulaKey: string,
  observedCompound: string,
  targetCompound: string,
): number | null {
  if (!isCompoundPaceFormulaKey(formulaKey)) return null;
  const observedNumber = compoundNumber(observedCompound);
  const targetNumber = compoundNumber(targetCompound);
  if (observedNumber == null || targetNumber == null) return null;
  if (targetNumber >= observedNumber) return null;

  let factor = 1;
  let currentSofter = observedCompound;
  while (currentSofter !== targetCompound) {
    const edge = ACTUAL_COMPOUND_WEAR_CALIBRATION_EDGES[formulaKey].find(
      (candidate) => candidate.softer === currentSofter,
    );
    if (!edge) return null;
    factor *= edge.factor;
    currentSofter = edge.harder;
  }
  return factor;
}
