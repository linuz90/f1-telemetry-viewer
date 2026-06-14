import type { SessionInfo, TelemetrySession } from "../types/telemetry";

const PRIMARY_FORMULA_KEY = "f1";
const F1_25_COMPARISON_KEY = "f1-25";
const F1_26_COMPARISON_KEY = "f1-26";
const LEGACY_F1_MODERN_ALIAS = "f1-modern";

function getFormulaGenerationRank(formulaKey: string): number {
  return Number(formulaKey.match(/-(\d{2})$/)?.[1] ?? 0);
}

function getFormulaFamilyRank(formulaKey: string): number {
  if (formulaKey === PRIMARY_FORMULA_KEY || formulaKey === LEGACY_F1_MODERN_ALIAS || formulaKey.startsWith("f1-")) return 0;
  if (formulaKey === "f2" || formulaKey.startsWith("f2-")) return 1;
  return 2;
}

function normalizeFormula(formula: SessionInfo["formula"] | undefined): string {
  return formula?.trim().toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ") ?? "";
}

function isF1ModernFormula(formula: SessionInfo["formula"] | undefined): boolean {
  const normalized = normalizeFormula(formula);
  return normalized === "f1 modern" || normalized === "formula 1 modern";
}

function formatGameYearSuffix(gameYear: number | undefined): string | undefined {
  if (!Number.isFinite(gameYear)) return undefined;
  return String(gameYear).padStart(2, "0").slice(-2);
}

function getF1SeasonSuffix(formula: SessionInfo["formula"] | undefined, gameYear: number | undefined): string | undefined {
  const normalized = normalizeFormula(formula);
  if (normalized.includes("season pack")) return "26";
  // Pits n' Giggles has a durable `F1 Modern` enum for old-regs saves. Keep the
  // URL/display model canonical as F1 25 even when older integrations do not
  // include `game-year` on their lightweight session summaries.
  if (isF1ModernFormula(formula)) return "25";

  const explicitYear = normalized.match(/(?:^|\s)(?:f1|formula 1)\s+(?:20)?(\d{2})(?:\s|$)/)?.[1];
  if (explicitYear) return explicitYear;

  return formatGameYearSuffix(gameYear);
}

export function isRaceSessionType(type: string | undefined): boolean {
  return type?.startsWith("Race") ?? false;
}

export function isQualifyingSessionType(type: string | undefined): boolean {
  return type?.includes("Qualifying") ?? false;
}

export function isTimeTrialSessionType(type: string | undefined): boolean {
  return /time\s*trial/i.test(type ?? "");
}

export function isRaceSession(session: TelemetrySession): boolean {
  return isRaceSessionType(session["session-info"]["session-type"]);
}

export function getFormulaKey(formula: SessionInfo["formula"] | undefined): string {
  const normalized = normalizeFormula(formula);
  if (
    normalized === "" ||
    normalized === "f1" ||
    normalized.startsWith("f1 ") ||
    normalized === "formula 1" ||
    normalized.startsWith("formula 1 ")
  ) {
    return PRIMARY_FORMULA_KEY;
  }
  return normalized.replace(/\s+/g, "-");
}

export function getFormulaComparisonKey(formula: SessionInfo["formula"] | undefined, gameYear?: number): string {
  const formulaKey = getFormulaKey(formula);
  if (formulaKey !== PRIMARY_FORMULA_KEY) {
    const yearSuffix = formatGameYearSuffix(gameYear);
    if (formulaKey === "f2" && yearSuffix) return `${formulaKey}-${yearSuffix}`;
    return formulaKey;
  }

  const seasonSuffix = getF1SeasonSuffix(formula, gameYear);
  if (seasonSuffix === "26") {
    return F1_26_COMPARISON_KEY;
  }
  if (seasonSuffix) return `f1-${seasonSuffix}`;

  return F1_25_COMPARISON_KEY;
}

export function getFormulaComparisonAliases(formula: SessionInfo["formula"] | undefined, gameYear?: number): string[] {
  const key = getFormulaComparisonKey(formula, gameYear);
  const aliases = [key];

  if (key === F1_25_COMPARISON_KEY) aliases.push(LEGACY_F1_MODERN_ALIAS);
  if (key === "f2-25") aliases.push("f2");

  return aliases;
}

export function compareFormulaComparisonKeys(aKey: string, bKey: string): number {
  const generationDiff = getFormulaGenerationRank(bKey) - getFormulaGenerationRank(aKey);
  if (generationDiff !== 0) return generationDiff;

  const familyDiff = getFormulaFamilyRank(aKey) - getFormulaFamilyRank(bKey);
  if (familyDiff !== 0) return familyDiff;

  return aKey.localeCompare(bKey);
}

export function getFormulaLabel(formula: SessionInfo["formula"] | undefined, gameYear?: number): string {
  const formulaKey = getFormulaKey(formula);
  if (formulaKey === PRIMARY_FORMULA_KEY) {
    const seasonSuffix = getF1SeasonSuffix(formula, gameYear);
    return `F1 ${seasonSuffix ?? "25"}`;
  }

  const yearSuffix = formatGameYearSuffix(gameYear);
  if (formulaKey === "f2" && yearSuffix) return `F2 ${yearSuffix}`;

  return formula?.trim() || "Unknown";
}

export function isPrimaryFormula(formula: SessionInfo["formula"] | undefined): boolean {
  return getFormulaKey(formula) === PRIMARY_FORMULA_KEY;
}

export function isNonF1Formula(formula: SessionInfo["formula"] | undefined): boolean {
  return !isPrimaryFormula(formula);
}

export function shouldShowFormulaLabel(formula: SessionInfo["formula"] | undefined, gameYear?: number): boolean {
  return getFormulaComparisonKey(formula, gameYear) !== LEGACY_F1_MODERN_ALIAS;
}
