import type { SessionSummary } from "../../types/telemetry";
import { summaryKind } from "../../analysis/sessionKind";
import type { SessionLogGroup } from "../../analysis/sessionLog";
import { isDnfResultStatus } from "../../analysis/dashboardResultStats";

/** "22:36" from the save timestamp. */
export function sessionClock(session: SessionSummary): string {
  return session.date.split("T")[1]?.slice(0, 5) ?? "";
}

/** "Mon 26 Oct" — the year only when it is not the current one. */
export function formatDayLabel(dayKey: string, now = new Date()): string {
  const date = new Date(`${dayKey}T12:00:00`);
  return date.toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    ...(date.getFullYear() !== now.getFullYear() ? { year: "numeric" } : {}),
  });
}

export interface SessionResultText {
  main: string;
  detail?: string;
  tone: "gain" | "loss" | "neutral" | "best";
}

/** The result cell: "P7 from P2", "P2 +0.057", "DNF". Null for runs without one. */
export function sessionResult(
  session: SessionSummary,
): SessionResultText | null {
  const kind = summaryKind(session);
  if (kind === "race") {
    const result = session.playerRaceResult;
    if (!result) return null;
    if (isDnfResultStatus(result.status)) {
      return { main: "DNF", detail: `lap ${result.playerLaps}`, tone: "loss" };
    }
    // Saved before the flag: a running position, not a result.
    if (!result.status) {
      return {
        main: `P${result.position}`,
        detail: `on lap ${result.playerLaps}`,
        tone: "neutral",
      };
    }
    const grid = result.gridPosition;
    const tone =
      grid == null || grid === result.position
        ? "neutral"
        : grid > result.position
          ? "gain"
          : "loss";
    return {
      main: `P${result.position}`,
      detail: grid ? `from P${grid}` : undefined,
      tone,
    };
  }
  if (kind === "qualifying" && session.isOnline && session.qualifyingPosition) {
    const best = session.bestLapTimeMs;
    const pole = session.poleLapTimeMs;
    return {
      main: `P${session.qualifyingPosition}`,
      detail:
        session.qualifyingPosition === 1
          ? "pole"
          : best && pole
            ? `+${((best - pole) / 1000).toFixed(3)}`
            : undefined,
      tone: session.qualifyingPosition === 1 ? "best" : "neutral",
    };
  }
  return null;
}

/** Laps in the session and the compounds run, for the details cell. */
export function sessionLapCount(session: SessionSummary): number {
  const kind = summaryKind(session);
  if (kind === "race" || kind === "long-run") {
    return (
      session.stints?.reduce((sum, stint) => sum + stint.laps, 0) ??
      session.playerRaceResult?.playerLaps ??
      session.validLapCount
    );
  }
  return session.validLapCount;
}

export function sessionCompounds(session: SessionSummary): string[] {
  return (session.stints ?? []).map((stint) => stint.compound);
}

/** The folded practice group's summary line pieces. */
export function offlineGroupSummary(group: SessionLogGroup): {
  label: string;
  bestMs?: number;
}[] {
  const parts: { label: string; bestMs?: number }[] = [];
  const plural = (n: number, word: string) =>
    `${n} ${word}${n === 1 ? "" : "s"}`;
  if (group.counts.qualifying) {
    parts.push({
      label: plural(group.counts.qualifying, "quali run"),
      bestMs: group.bestMs.qualifying,
    });
  }
  if (group.counts["long-run"]) {
    parts.push({
      label: plural(group.counts["long-run"], "long run"),
      bestMs: group.bestMs["long-run"],
    });
  }
  if (group.counts.race) {
    parts.push({
      label: plural(group.counts.race, "race"),
      bestMs: group.bestMs.race,
    });
  }
  if (group.counts["time-trial"]) {
    parts.push({
      label: plural(group.counts["time-trial"], "time trial"),
      bestMs: group.bestMs["time-trial"],
    });
  }
  return parts;
}
