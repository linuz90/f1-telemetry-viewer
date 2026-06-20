import type { SessionSummary } from "../types/telemetry";
import {
  compareFormulaComparisonKeys,
  getFormulaComparisonAliases,
  getFormulaComparisonKey,
  getFormulaLabel,
  shouldShowFormulaLabel,
} from "./sessionTypes";

export interface FormulaScopeOption {
  key: string;
  label: string;
  sessionCount: number;
  latestTime: number;
  showLabel: boolean;
}

export function getFormulaScopeOptions(
  sessions: SessionSummary[],
): FormulaScopeOption[] {
  const options = new Map<string, FormulaScopeOption>();

  for (const session of sessions) {
    const key = getFormulaComparisonKey(session.formula, session.gameYear);
    const existing = options.get(key);
    const latestTime = new Date(session.date).getTime();

    if (existing) {
      existing.sessionCount += 1;
      existing.latestTime = Math.max(existing.latestTime, latestTime);
      existing.showLabel =
        existing.showLabel ||
        shouldShowFormulaLabel(session.formula, session.gameYear);
    } else {
      options.set(key, {
        key,
        label: getFormulaLabel(session.formula, session.gameYear),
        sessionCount: 1,
        latestTime,
        showLabel: shouldShowFormulaLabel(session.formula, session.gameYear),
      });
    }
  }

  return [...options.values()].sort((a, b) => {
    const formulaOrder = compareFormulaComparisonKeys(a.key, b.key);
    if (formulaOrder !== 0) return formulaOrder;
    if (a.latestTime !== b.latestTime) return b.latestTime - a.latestTime;
    return a.label.localeCompare(b.label);
  });
}

export function getSessionFormulaScopeKey(session: SessionSummary): string {
  return getFormulaComparisonKey(session.formula, session.gameYear);
}

export function resolveFormulaScopeKey(
  sessions: SessionSummary[],
  requestedKey: string | null | undefined,
): string | undefined {
  const options = getFormulaScopeOptions(sessions);
  if (options.length === 0) return undefined;

  if (requestedKey) {
    const optionKeys = new Set(options.map((option) => option.key));
    if (optionKeys.has(requestedKey)) return requestedKey;

    for (const session of sessions) {
      const key = getSessionFormulaScopeKey(session);
      if (
        optionKeys.has(key) &&
        getFormulaComparisonAliases(session.formula, session.gameYear).includes(
          requestedKey,
        )
      ) {
        return key;
      }
    }
  }

  return options[0]?.key;
}

export function resolveFormulaScopeAlias(
  sessions: SessionSummary[],
  requestedKey: string | null | undefined,
): string | undefined {
  if (!requestedKey) return undefined;

  const options = getFormulaScopeOptions(sessions);
  const optionKeys = new Set(options.map((option) => option.key));
  if (optionKeys.has(requestedKey)) return requestedKey;

  for (const session of sessions) {
    const key = getSessionFormulaScopeKey(session);
    if (
      optionKeys.has(key) &&
      getFormulaComparisonAliases(session.formula, session.gameYear).includes(
        requestedKey,
      )
    ) {
      return key;
    }
  }

  return undefined;
}

export function getDefaultFormulaScopeKey(
  sessions: SessionSummary[],
): string | undefined {
  return getFormulaScopeOptions(sessions)[0]?.key;
}
