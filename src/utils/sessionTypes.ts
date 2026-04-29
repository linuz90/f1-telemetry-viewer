import type { SessionInfo, TelemetrySession } from "../types/telemetry";

const PRIMARY_FORMULA_KEY = "f1";

export function isRaceSessionType(type: string | undefined): boolean {
  return type?.startsWith("Race") ?? false;
}

export function isQualifyingSessionType(type: string | undefined): boolean {
  return type?.includes("Qualifying") ?? false;
}

export function isRaceSession(session: TelemetrySession): boolean {
  return isRaceSessionType(session["session-info"]["session-type"]);
}

export function getFormulaKey(formula: SessionInfo["formula"] | undefined): string {
  if (!formula) return PRIMARY_FORMULA_KEY;
  const normalized = formula.trim().toLowerCase();
  if (normalized === "" || normalized === "f1" || normalized.startsWith("f1 ")) {
    return PRIMARY_FORMULA_KEY;
  }
  return normalized.replace(/\s+/g, "-");
}

export function getFormulaLabel(formula: SessionInfo["formula"] | undefined): string {
  if (getFormulaKey(formula) === PRIMARY_FORMULA_KEY) return "F1";
  return formula?.trim() || "Unknown";
}

export function isPrimaryFormula(formula: SessionInfo["formula"] | undefined): boolean {
  return getFormulaKey(formula) === PRIMARY_FORMULA_KEY;
}

export function isNonF1Formula(formula: SessionInfo["formula"] | undefined): boolean {
  return !isPrimaryFormula(formula);
}
