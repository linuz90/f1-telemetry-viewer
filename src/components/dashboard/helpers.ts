import { Medal, Trophy, type LucideIcon } from "lucide-react";
import {
  ACCENT_TOKENS,
  type AccentColor,
  accentCardClass,
} from "../Card";
import type { SessionSummary } from "../../types/telemetry";
import {
  getFormulaComparisonKey,
  getFormulaLabel,
  shouldShowFormulaLabel,
} from "../../utils/sessionTypes";
import { toTrackSlug } from "../../utils/format";

export interface SessionStats {
  summary: SessionSummary;
  isRace: boolean;
  bestLapMs: number;
  validLapCount: number;
}

export interface TrackGroup {
  key: string;
  track: string;
  formulaKey: string;
  formulaLabel: string;
  showFormula: boolean;
  stats: SessionStats[];
}

export function trackFormulaPath(track: string, formulaKey: string): string {
  return `/track/${toTrackSlug(track)}?formula=${encodeURIComponent(formulaKey)}`;
}

export function positionLabel(position: number | undefined): string {
  return position ? `P${position}` : "—";
}

export function averagePositionLabel(value: number | undefined): string {
  return value == null ? "—" : `P${value.toFixed(1)}`;
}

export function signedNumber(value: number | undefined): string {
  if (value == null) return "—";
  if (Math.abs(value) < 0.05) return "0.0";
  return `${value > 0 ? "+" : ""}${value.toFixed(1)}`;
}

export function gridGainTone(value: number | undefined): string {
  if (value == null || Math.abs(value) < 0.05) return "text-zinc-300";
  return value > 0 ? "text-emerald-400" : "text-red-400";
}

export function dnfRate(dnfCount: number, starts: number): string {
  if (starts === 0) return "—";
  return `${Math.round((dnfCount / starts) * 100)}%`;
}

export function resultStatusLabel(status: string | undefined): string {
  if (!status) return "Finished";
  const normalized = status.toUpperCase().replace(/[\s-]+/g, "_");
  if (normalized === "DID_NOT_FINISH") return "DNF";
  if (normalized === "DISQUALIFIED") return "DSQ";
  if (normalized === "FINISHED") return "Finished";
  return status.replace(/_/g, " ");
}

export function isProblemStatus(status: string | undefined): boolean {
  const normalized = status?.toUpperCase().replace(/[\s-]+/g, "_");
  return (
    normalized === "DNF" ||
    normalized === "DID_NOT_FINISH" ||
    normalized === "RETIRED" ||
    normalized === "DISQUALIFIED" ||
    normalized === "DSQ"
  );
}

// Shared podium convention: gold/Trophy for P1, silver/Medal for P2, bronze/Medal
// for P3. Used by the hero podium chips, the Recent Results row badge, and the
// hero "Best" microstat tone — keep these in sync if tweaking. Tiles share the
// app-wide accent recipe from Card.tsx so podium chips look identical in shape
// to insight cards / stint cards / best-lap highlights.
export function positionBadgeClasses(position: number | undefined): string {
  const accent: AccentColor | null =
    position === 1 ? "amber"
    : position === 2 ? "zinc"
    : position === 3 ? "orange"
    : null;
  if (accent) return `${accentCardClass(accent)} ${ACCENT_TOKENS[accent].accent}`;
  return "ring-1 ring-inset ring-white/[0.06] bg-zinc-900/70 text-zinc-100";
}

export function positionTone(position: number | undefined): string {
  if (position === 1) return "text-amber-300";
  if (position === 2) return "text-zinc-200";
  if (position === 3) return "text-orange-300";
  return "text-zinc-100";
}

export function podiumIcon(position: number | undefined): LucideIcon | null {
  if (position === 1) return Trophy;
  if (position === 2 || position === 3) return Medal;
  return null;
}

/** Daily best-quali points per track-group, ready to feed QualifyingPaceCard.
 *  Groups with fewer than 3 distinct days are dropped (no useful trend). */
export function buildQualifyingPaceData(
  trackGroups: Record<string, TrackGroup>,
): Record<
  string,
  TrackGroup & { points: { day: string; bestLap: number }[]; pbMs: number }
> {
  const out: Record<
    string,
    TrackGroup & { points: { day: string; bestLap: number }[]; pbMs: number }
  > = {};
  for (const [key, group] of Object.entries(trackGroups)) {
    const qualiSessions = group.stats.filter(
      (session) => !session.isRace && session.bestLapMs > 0,
    );
    const byDay: Record<string, number> = {};
    for (const session of qualiSessions) {
      const dayKey = session.summary.date.split("T")[0];
      const prev = byDay[dayKey];
      if (!prev || session.bestLapMs < prev) {
        byDay[dayKey] = session.bestLapMs;
      }
    }
    const dayEntries = Object.entries(byDay).sort(([a], [b]) =>
      a.localeCompare(b),
    );
    if (dayEntries.length < 3) continue;
    out[key] = {
      ...group,
      points: dayEntries.map(([dayKey, ms]) => ({
        day: new Date(dayKey).toLocaleDateString("en-GB", {
          day: "numeric",
          month: "short",
        }),
        bestLap: ms / 1000,
      })),
      pbMs: Math.min(...Object.values(byDay)),
    };
  }
  return out;
}

export function buildTrackGroups(
  sessions: SessionStats[],
): Record<string, TrackGroup> {
  const trackGroups: Record<string, TrackGroup> = {};
  for (const session of sessions) {
    const formulaKey = getFormulaComparisonKey(
      session.summary.formula,
      session.summary.gameYear,
    );
    const key = `${session.summary.track}::${formulaKey}`;
    if (!trackGroups[key]) {
      trackGroups[key] = {
        key,
        track: session.summary.track,
        formulaKey,
        formulaLabel: getFormulaLabel(
          session.summary.formula,
          session.summary.gameYear,
        ),
        showFormula: shouldShowFormulaLabel(
          session.summary.formula,
          session.summary.gameYear,
        ),
        stats: [],
      };
    }
    trackGroups[key].stats.push(session);
  }
  return trackGroups;
}
