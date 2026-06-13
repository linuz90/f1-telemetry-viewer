import type { SessionSummary } from "../types/telemetry";
import { getSessionFormulaScopeKey } from "./dashboardStats";
import { toTrackSlug } from "./format";

export const TRACKS_ROUTE_SEGMENT = "tracks";
export const SESSIONS_ROUTE_SEGMENT = "sessions";

/**
 * Canonical app routes are scoped by game/formula as the first path segment:
 *   /f1-26
 *   /f1-26/tracks/sakhir
 *   /f1-26/sessions/<session-slug>
 *
 * Keep path construction centralized here. The product model may evolve again,
 * but call sites should only need to express intent: dashboard, track, session.
 */
export function dashboardPath(formulaKey?: string | null): string {
  return formulaKey ? `/${encodeURIComponent(formulaKey)}` : "/";
}

export function trackPath(formulaKey: string, track: string): string {
  return `/${encodeURIComponent(formulaKey)}/${TRACKS_ROUTE_SEGMENT}/${toTrackSlug(track)}`;
}

export function sessionPath(formulaKey: string, slug: string): string {
  return `/${encodeURIComponent(formulaKey)}/${SESSIONS_ROUTE_SEGMENT}/${slug}`;
}

export function sessionSummaryPath(session: SessionSummary): string {
  return sessionPath(getSessionFormulaScopeKey(session), session.slug);
}

export function isRootPath(pathname: string): boolean {
  return pathname.split("/").filter(Boolean).length === 0;
}

/**
 * Return the first path segment as a formula-scope candidate.
 *
 * The context decides whether the candidate is valid against loaded data. This
 * deliberate split keeps routing flexible: future route models can change
 * validation rules in one place without every component learning URL grammar.
 */
export function getFormulaScopeCandidateFromPath(pathname: string): string | null {
  const [formulaKey] = pathname.split("/").filter(Boolean);
  return formulaKey ?? null;
}

export function replaceFormulaScopeInPath(pathname: string, nextFormulaKey: string): string {
  const parts = pathname.split("/").filter(Boolean);
  if (parts.length === 0) return dashboardPath(nextFormulaKey);
  parts[0] = encodeURIComponent(nextFormulaKey);
  return `/${parts.join("/")}`;
}
