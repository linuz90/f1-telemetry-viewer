import type { TelemetrySession } from "../../types/telemetry";
import { findPlayer } from "./drivers";
import { getRacePaceLapSamples, type RacePaceLapSample } from "./laps";
import { calculatePeakPace } from "./peakPace";

// ────────────────────────────────────────────────────────────────────────────
// Peak Pace Evolution — race-on-race peak pace per compound at one track.
//
// Each point is `calculatePeakPace` over that race's race-pace laps on the
// compound; `peakPace.ts` owns the definition and the reasons behind it.
// Longer runs have more chances to supply a fast window, which is why the UI
// names the method and carries lap counts instead of presenting it as the
// canonical all-clean-lap Race Pace.
//
// Pit/SC/incident outliers are already filtered by `getRacePaceLapSamples`.
// `minLapsPerCompound` gates noisy single-lap samples (default 3).
// ────────────────────────────────────────────────────────────────────────────

/**
 * Race context. Distinguishes "clean air" runs from "full grid" runs because
 * the underlying physics differs (dirty air, defensive lines, overtake
 * attempts) and pace numbers aren't directly comparable across them.
 *
 * The split is on EFFECTIVE TRAFFIC, not online/offline: a 2-car online
 * sparring session and a 20-car AI race where the player led the whole way
 * both behave as clean air, while a 20-car AI race fought mid-pack behaves
 * as traffic.
 *
 * Driver count is the first signal; if the player led ≥ LEADER_SHARE_OVERRIDE
 * of their race-pace laps, the kind is upgraded to "clean-air" regardless of
 * field size (e.g. low-AI grand prix where the user practices in P1).
 */
export type RaceContextKind = "clean-air" | "small-field" | "full-grid";

export interface RaceContext {
  /** Bucket used by the chart filter. */
  kind: RaceContextKind;
  /** Total driver count in the classification list (player + opponents). */
  driverCount: number;
  /** True when `network-game === 1`. */
  isOnline: boolean;
  /** Share of player's race-pace laps spent in P1 (0..1). 0 when no position data. */
  leaderShare: number;
}

const LEADER_SHARE_OVERRIDE = 0.7;

/**
 * Classify a session's context using only the session-level signals (field
 * size + online flag). Returns leaderShare=0 since per-lap positions aren't
 * inspected here. For the lap-aware variant used by the Pace Evolution chart,
 * see the inline computation in `buildPaceEvolution`.
 */
export function classifyRaceContext(session: TelemetrySession): RaceContext {
  const driverCount = session["classification-data"]?.length ?? 0;
  const isOnline = session["session-info"]?.["network-game"] === 1;
  // Thresholds: ≤3 = clean air (player + 1-2 sparring partners); ≥10 = full
  // grid (the AI/online setup actually creates traffic); the in-between band
  // is real but rare in this app's data.
  const kind: RaceContextKind =
    driverCount <= 3
      ? "clean-air"
      : driverCount >= 10
        ? "full-grid"
        : "small-field";
  return { kind, driverCount, isOnline, leaderShare: 0 };
}

export interface PaceEvolutionPoint {
  /** 1-based session index in chronological order. */
  idx: number;
  /** Tooltip label, e.g. "Race · 14:32". */
  label: string;
  /** Pre-formatted date, e.g. "Sat, 13 Jun 2026". */
  date: string;
  /** Session context (clean air / traffic / online vs offline). */
  context: RaceContext;
  /**
   * Compound → peak pace on that compound (ms): `calculatePeakPace` over the
   * race's eligible laps. Only compounds with at least `minLapsPerCompound`
   * race-pace laps are present.
   */
  paces: Record<string, number>;
  /** Compound → total race-pace lap count for that compound this session. */
  counts: Record<string, number>;
}

export function buildPaceEvolution(
  inputs: { session: TelemetrySession; date: string | Date }[],
  minLapsPerCompound = 3,
): PaceEvolutionPoint[] {
  return inputs
    .map(({ session, date: rawDate }, i): PaceEvolutionPoint | null => {
      const player = findPlayer(session);
      if (!player) return null;
      const samples = getRacePaceLapSamples(player);
      const groups = new Map<string, RacePaceLapSample[]>();
      for (const s of samples) {
        if (!s.compound) continue;
        const arr = groups.get(s.compound) ?? [];
        arr.push(s);
        groups.set(s.compound, arr);
      }
      const paces: Record<string, number> = {};
      const counts: Record<string, number> = {};
      for (const [compound, compoundSamples] of groups) {
        if (compoundSamples.length < minLapsPerCompound) continue;
        const peak = calculatePeakPace(compoundSamples);
        if (!peak) continue;
        paces[compound] = peak.timeMs;
        counts[compound] = peak.sampleCount;
      }
      // Skip sessions that yielded no qualifying compound — keeps the X axis
      // honest about how many sessions actually contribute a data point.
      if (Object.keys(paces).length === 0) return null;
      const date = rawDate instanceof Date ? rawDate : new Date(rawDate);

      // Compute leader share over the player's race-pace laps. A 20-car AI race
      // where the user led the whole way is effectively clean air — same as a
      // 2-car sparring session. We override `kind` to "clean-air" when the
      // leader share crosses the threshold so the chart filter groups these
      // sessions correctly.
      const perLapInfo = player["per-lap-info"] ?? [];
      const positionByLap = new Map<number, number>();
      for (const pli of perLapInfo) {
        const pos = pli["track-position"];
        if (typeof pos === "number" && pos > 0) {
          positionByLap.set(pli["lap-number"], pos);
        }
      }
      let leaderLaps = 0;
      let positionedLaps = 0;
      for (const s of samples) {
        const pos = positionByLap.get(s.lapNumber);
        if (pos == null) continue;
        positionedLaps++;
        if (pos === 1) leaderLaps++;
      }
      const leaderShare = positionedLaps > 0 ? leaderLaps / positionedLaps : 0;

      const baseContext = classifyRaceContext(session);
      const context: RaceContext = {
        ...baseContext,
        leaderShare,
        kind:
          leaderShare >= LEADER_SHARE_OVERRIDE &&
          baseContext.kind !== "clean-air"
            ? "clean-air"
            : baseContext.kind,
      };
      return {
        idx: i + 1,
        context,
        label: `Race · ${date.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}`,
        date: date.toLocaleDateString("en-GB", {
          weekday: "short",
          day: "numeric",
          month: "short",
          year: "numeric",
        }),
        paces,
        counts,
      };
    })
    .filter((p): p is PaceEvolutionPoint => p !== null);
}
