import type {
  TelemetrySession,
  DriverData,
  LapHistoryEntry,
  TyreStint,
  TyreWearEntry,
} from "../types/telemetry";
import { isLapValid } from "./format";

/** Find the player driver in a session */
export function findPlayer(session: TelemetrySession): DriverData | undefined {
  return session["classification-data"]?.find((d) => d["is-player"]);
}

/** Get valid laps for a driver */
export function getValidLaps(laps: LapHistoryEntry[]): LapHistoryEntry[] {
  return laps.filter(
    (l) => isLapValid(l["lap-valid-bit-flags"]) && l["lap-time-in-ms"] > 0,
  );
}

/** Get the best lap time in ms from a set of laps */
export function getBestLapTime(laps: LapHistoryEntry[]): number {
  const valid = getValidLaps(laps);
  if (valid.length === 0) return 0;
  return Math.min(...valid.map((l) => l["lap-time-in-ms"]));
}

/** Calculate standard deviation of lap times (consistency metric) */
export function lapTimeStdDev(laps: LapHistoryEntry[]): number {
  const valid = getValidLaps(laps);
  if (valid.length < 2) return 0;

  const times = valid.map((l) => l["lap-time-in-ms"]);
  const mean = times.reduce((a, b) => a + b, 0) / times.length;
  const variance =
    times.reduce((sum, t) => sum + (t - mean) ** 2, 0) / times.length;
  return Math.sqrt(variance);
}

/** Calculate average tyre wear rate (% per lap) across all stints */
export function avgWearRate(player: DriverData): number {
  const stints = player["tyre-set-history"];
  if (!stints?.length) return 0;

  let totalWear = 0;
  let totalLaps = 0;

  for (const stint of stints) {
    const history = stint["tyre-wear-history"];
    if (history.length < 2) continue;

    const lastEntry = history[history.length - 1];
    totalWear += lastEntry.average;
    totalLaps += stint["stint-length"];
  }

  return totalLaps > 0 ? totalWear / totalLaps : 0;
}

/** Check if a session is a race (vs qualifying) */
export function isRaceSession(session: TelemetrySession): boolean {
  return session["session-info"]["session-type"] === "Race";
}

// --- Comparison utilities ---

/** Find the race winner (P1 finisher) */
export function findRaceWinner(
  session: TelemetrySession,
): DriverData | undefined {
  return session["classification-data"]?.find(
    (d) => d["final-classification"]?.position === 1,
  );
}

/** Find the closest rival (±1 position from player) */
export function findClosestRival(
  session: TelemetrySession,
  playerPosition: number,
): DriverData | undefined {
  const drivers = session["classification-data"] ?? [];
  // Prefer the driver just ahead (position - 1), fall back to behind
  return (
    drivers.find(
      (d) => d["final-classification"]?.position === playerPosition - 1,
    ) ??
    drivers.find(
      (d) => d["final-classification"]?.position === playerPosition + 1,
    )
  );
}

/** Find the driver who set the fastest lap (from session records) */
export function findFastestLapDriver(
  session: TelemetrySession,
): DriverData | undefined {
  const driverIndex = session.records?.fastest?.lap?.["driver-index"];
  if (driverIndex == null) return undefined;
  return session["classification-data"]?.find((d) => d.index === driverIndex);
}

/** Get the worst (max) wheel wear from a single TyreWearEntry */
export function getWorstWheelWear(entry: TyreWearEntry): number {
  return Math.max(
    entry["front-left-wear"],
    entry["front-right-wear"],
    entry["rear-left-wear"],
    entry["rear-right-wear"],
  );
}

/** Get the compound sequence for a driver's stints */
function getCompoundSequence(stints: TyreStint[]): string[] {
  return stints.map((s) => s["tyre-set-data"]["visual-tyre-compound"]);
}

/** Find drivers who used the same tyre strategy (same compound sequence) */
export function findSameStrategyDrivers(
  drivers: DriverData[],
  player: DriverData,
): DriverData[] {
  const playerSeq = getCompoundSequence(player["tyre-set-history"]).join(",");
  return drivers.filter((d) => {
    if (d.index === player.index) return false;
    const seq = getCompoundSequence(d["tyre-set-history"]).join(",");
    return seq === playerSeq;
  });
}

/** Calculate avg wear rate (%/lap) for a single stint using worst-wheel metric */
export function stintWearRate(stint: TyreStint): number {
  const history = stint["tyre-wear-history"];
  if (history.length < 2) return 0;
  const lastWear = getWorstWheelWear(history[history.length - 1]);
  return stint["stint-length"] > 0 ? lastWear / stint["stint-length"] : 0;
}

/** Find the best driver on a given compound within an overlapping lap range */
export function getBestDriverOnCompound(
  drivers: DriverData[],
  compound: string,
  lapStart: number,
  lapEnd: number,
): { driver: DriverData; stint: TyreStint; wearRate: number } | undefined {
  let best:
    | { driver: DriverData; stint: TyreStint; wearRate: number }
    | undefined;

  for (const driver of drivers) {
    for (const stint of driver["tyre-set-history"]) {
      if (stint["tyre-set-data"]["visual-tyre-compound"] !== compound) continue;
      // Check overlap
      if (stint["end-lap"] < lapStart || stint["start-lap"] > lapEnd) continue;
      const rate = stintWearRate(stint);
      if (rate > 0 && (!best || rate < best.wearRate)) {
        best = { driver, stint, wearRate: rate };
      }
    }
  }

  return best;
}

/** Calculate average pace (ms) for a driver's laps in a range */
export function avgPaceInRange(
  laps: LapHistoryEntry[],
  startLap: number,
  endLap: number,
): number {
  const subset = laps.slice(startLap - 1, endLap).filter(
    (l) => isLapValid(l["lap-valid-bit-flags"]) && l["lap-time-in-ms"] > 0,
  );
  if (subset.length === 0) return 0;
  return subset.reduce((sum, l) => sum + l["lap-time-in-ms"], 0) / subset.length;
}

/** Calculate pace drop: avg of last N laps minus avg of first N laps (ms) */
export function paceDrop(
  laps: LapHistoryEntry[],
  startLap: number,
  endLap: number,
  n = 5,
): number {
  const subset = laps
    .slice(startLap - 1, endLap)
    .filter(
      (l) => isLapValid(l["lap-valid-bit-flags"]) && l["lap-time-in-ms"] > 0,
    );
  if (subset.length < n * 2) return 0;
  const firstN = subset.slice(0, n);
  const lastN = subset.slice(-n);
  const avgFirst =
    firstN.reduce((s, l) => s + l["lap-time-in-ms"], 0) / firstN.length;
  const avgLast =
    lastN.reduce((s, l) => s + l["lap-time-in-ms"], 0) / lastN.length;
  return avgLast - avgFirst;
}

/** Per-lap cumulative delta entry */
export interface CumulativeDelta {
  lap: number;
  delta: number; // cumulative ms (positive = player behind)
  lapDelta: number; // per-lap ms
  s1Delta: number;
  s2Delta: number;
  s3Delta: number;
  playerPit: boolean;
  rivalPit: boolean;
}

/** Calculate cumulative time deltas between player and rival, lap by lap */
export function calculateCumulativeDeltas(
  playerLaps: LapHistoryEntry[],
  rivalLaps: LapHistoryEntry[],
  playerPitLaps: number[],
  rivalPitLaps: number[],
): CumulativeDelta[] {
  const result: CumulativeDelta[] = [];
  let cumulative = 0;
  const len = Math.min(playerLaps.length, rivalLaps.length);

  for (let i = 0; i < len; i++) {
    const pLap = playerLaps[i];
    const rLap = rivalLaps[i];
    if (pLap["lap-time-in-ms"] <= 0 || rLap["lap-time-in-ms"] <= 0) continue;

    const lapDelta = pLap["lap-time-in-ms"] - rLap["lap-time-in-ms"];
    cumulative += lapDelta;

    result.push({
      lap: i + 1,
      delta: cumulative / 1000, // convert to seconds for display
      lapDelta: lapDelta / 1000,
      s1Delta:
        (pLap["sector-1-time-in-ms"] - rLap["sector-1-time-in-ms"]) / 1000,
      s2Delta:
        (pLap["sector-2-time-in-ms"] - rLap["sector-2-time-in-ms"]) / 1000,
      s3Delta:
        (pLap["sector-3-time-in-ms"] - rLap["sector-3-time-in-ms"]) / 1000,
      playerPit: playerPitLaps.includes(i + 1),
      rivalPit: rivalPitLaps.includes(i + 1),
    });
  }

  return result;
}

// --- Insight generation ---

export interface StrategyInsight {
  type: "tyre" | "sector" | "pit" | "pace" | "history";
  /** Short label shown above the value */
  label: string;
  /** The big prominent value (e.g. "3rd", "1:42.891", "+0.8%/lap") */
  value: string;
  /** Smaller context line below the value */
  detail: string;
  /** Ranking position (0-indexed) — used for color coding. undefined = neutral. */
  rank?: number;
  /** Total drivers in ranking — used alongside rank */
  rankTotal?: number;
}

function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

/** Helper: format ms to lap time string */
function msToLapTimeLocal(ms: number): string {
  if (ms <= 0) return "-";
  const minutes = Math.floor(ms / 60000);
  const seconds = ((ms % 60000) / 1000).toFixed(3);
  return minutes > 0 ? `${minutes}:${seconds.padStart(6, "0")}` : seconds;
}

/** Generate strategy insights for the player (race) */
export function generateInsights(
  session: TelemetrySession,
  player: DriverData,
  rival?: DriverData,
): StrategyInsight[] {
  const insights: StrategyInsight[] = [];
  const allDrivers = session["classification-data"] ?? [];
  const playerLaps = player["session-history"]["lap-history-data"];

  // 1. Pace ranking
  const paceRanking: { driver: DriverData; avgPace: number }[] = [];
  for (const d of allDrivers) {
    const valid = getValidLaps(d["session-history"]["lap-history-data"]);
    if (valid.length === 0) continue;
    const avg =
      valid.reduce((s, l) => s + l["lap-time-in-ms"], 0) / valid.length;
    paceRanking.push({ driver: d, avgPace: avg });
  }
  paceRanking.sort((a, b) => a.avgPace - b.avgPace);
  const pacePos = paceRanking.findIndex((r) => r.driver.index === player.index);
  if (pacePos >= 0 && paceRanking.length > 1) {
    const delta = paceRanking[pacePos].avgPace - paceRanking[0].avgPace;
    insights.push({
      type: "pace",
      label: "Race Pace",
      value: ordinal(pacePos + 1),
      detail:
        delta < 10
          ? `of ${paceRanking.length}`
          : `of ${paceRanking.length} — +${(delta / 1000).toFixed(3)}s vs P1`,
      rank: pacePos,
      rankTotal: paceRanking.length,
    });
  }

  // 2. Tyre wear ranking
  const wearRanking: { driver: DriverData; avgRate: number }[] = [];
  for (const d of allDrivers) {
    const stints = d["tyre-set-history"];
    if (!stints?.length) continue;
    const rates = stints.map((s) => stintWearRate(s)).filter((r) => r > 0);
    if (rates.length === 0) continue;
    const avg = rates.reduce((a, b) => a + b, 0) / rates.length;
    wearRanking.push({ driver: d, avgRate: avg });
  }
  wearRanking.sort((a, b) => a.avgRate - b.avgRate);
  const wearPos = wearRanking.findIndex(
    (r) => r.driver.index === player.index,
  );
  if (wearPos >= 0 && wearRanking.length > 1) {
    const playerRate = wearRanking[wearPos].avgRate;
    const bestRate = wearRanking[0].avgRate;
    const diff = playerRate - bestRate;
    insights.push({
      type: "tyre",
      label: "Tyre Management",
      value: ordinal(wearPos + 1),
      detail:
        diff < 0.05
          ? `of ${wearRanking.length}`
          : `of ${wearRanking.length} — +${diff.toFixed(1)}%/lap vs best`,
      rank: wearPos,
      rankTotal: wearRanking.length,
    });
  }

  // 3. Weakest & strongest sector (avg vs avg across all drivers)
  const playerValidLaps = getValidLaps(playerLaps);
  if (playerValidLaps.length > 0) {
    const sectorKeys = [
      { key: "sector-1-time-in-ms" as const, label: "S1" },
      { key: "sector-2-time-in-ms" as const, label: "S2" },
      { key: "sector-3-time-in-ms" as const, label: "S3" },
    ];

    const sectorRankings: {
      label: string;
      pos: number;
      total: number;
      delta: number;
      bestDriver: string;
      deltaToP2: number;
      p2Driver: string;
    }[] = [];

    for (const { key, label } of sectorKeys) {
      const ranking: { driver: DriverData; avg: number }[] = [];
      for (const d of allDrivers) {
        const valid = getValidLaps(d["session-history"]["lap-history-data"]);
        if (!valid.length) continue;
        const avg =
          valid.reduce((s, l) => s + l[key], 0) / valid.length;
        if (avg > 0) ranking.push({ driver: d, avg });
      }
      ranking.sort((a, b) => a.avg - b.avg);

      const pos = ranking.findIndex((r) => r.driver.index === player.index);
      if (pos >= 0 && ranking.length > 1) {
        sectorRankings.push({
          label,
          pos,
          total: ranking.length,
          delta: ranking[pos].avg - ranking[0].avg,
          bestDriver: ranking[0].driver["driver-name"],
          deltaToP2: ranking.length > 1 ? ranking[1].avg - ranking[0].avg : 0,
          p2Driver: ranking.length > 1 ? ranking[1].driver["driver-name"] : "",
        });
      }
    }

    if (sectorRankings.length > 0) {
      const worst = [...sectorRankings].sort((a, b) => b.pos - a.pos)[0];
      const best = [...sectorRankings].sort((a, b) => a.pos - b.pos)[0];

      if (worst.pos > 0) {
        insights.push({
          type: "sector",
          label: `Weakest — ${worst.label}`,
          value: ordinal(worst.pos + 1),
          detail:
            worst.delta < 1
              ? `of ${worst.total}`
              : `of ${worst.total} — +${(worst.delta / 1000).toFixed(3)}s vs ${worst.bestDriver}`,
          rank: worst.pos,
          rankTotal: worst.total,
        });
      }

      if (best.pos < worst.pos) {
        const isP1 = best.pos === 0;
        insights.push({
          type: "sector",
          label: `Strongest — ${best.label}`,
          value: ordinal(best.pos + 1),
          detail: isP1
            ? best.deltaToP2 < 1
              ? `of ${best.total}`
              : `of ${best.total} — ${(best.deltaToP2 / 1000).toFixed(3)}s ahead of ${best.p2Driver}`
            : best.delta < 1
              ? `of ${best.total}`
              : `of ${best.total} — +${(best.delta / 1000).toFixed(3)}s vs ${best.bestDriver}`,
          rank: best.pos,
          rankTotal: best.total,
        });
      }
    }
  }

  // 4. Pit timing vs rival
  if (rival) {
    const playerPits = player["tyre-set-history"]
      .slice(1)
      .map((s) => s["start-lap"]);
    const rivalPits = rival["tyre-set-history"]
      .slice(1)
      .map((s) => s["start-lap"]);

    if (playerPits.length > 0 && rivalPits.length > 0) {
      const diff = playerPits[0] - rivalPits[0];
      if (diff !== 0) {
        const timing = diff > 0 ? "later" : "earlier";
        insights.push({
          type: "pit",
          label: "First Pit Stop",
          value: `Lap ${playerPits[0]}`,
          detail: `${Math.abs(diff)} lap${Math.abs(diff) > 1 ? "s" : ""} ${timing} than ${rival["driver-name"]}`,
        });
      }
    }
  }

  return insights;
}

/** Generate qualifying-specific insights for the player */
export function generateQualiInsights(
  session: TelemetrySession,
  player: DriverData,
): StrategyInsight[] {
  const insights: StrategyInsight[] = [];
  const allDrivers = session["classification-data"] ?? [];

  // 1. Best lap ranking
  const lapRanking: { driver: DriverData; bestTime: number }[] = [];
  for (const d of allDrivers) {
    const best = getBestLapTime(d["session-history"]["lap-history-data"]);
    if (best > 0) lapRanking.push({ driver: d, bestTime: best });
  }
  lapRanking.sort((a, b) => a.bestTime - b.bestTime);

  const lapPos = lapRanking.findIndex((r) => r.driver.index === player.index);
  if (lapPos >= 0 && lapRanking.length > 1) {
    const delta = lapRanking[lapPos].bestTime - lapRanking[0].bestTime;
    insights.push({
      type: "pace",
      label: "Qualifying",
      value: ordinal(lapPos + 1),
      detail:
        delta < 1
          ? `of ${lapRanking.length}`
          : `of ${lapRanking.length} — +${(delta / 1000).toFixed(3)}s vs P1`,
      rank: lapPos,
      rankTotal: lapRanking.length,
    });
  }

  // 2. Sector rankings
  const playerValid = getValidLaps(player["session-history"]["lap-history-data"]);
  if (playerValid.length > 0) {
    const sectorKeys = [
      { key: "sector-1-time-in-ms" as const, label: "S1" },
      { key: "sector-2-time-in-ms" as const, label: "S2" },
      { key: "sector-3-time-in-ms" as const, label: "S3" },
    ];

    const sectorRankings: {
      label: string;
      pos: number;
      total: number;
      delta: number;
      bestDriver: string;
      deltaToP2: number;
      p2Driver: string;
    }[] = [];

    for (const { key, label } of sectorKeys) {
      const ranking: { driver: DriverData; best: number }[] = [];
      for (const d of allDrivers) {
        const valid = getValidLaps(d["session-history"]["lap-history-data"]);
        if (!valid.length) continue;
        const best = Math.min(...valid.map((l) => l[key]));
        if (best > 0) ranking.push({ driver: d, best });
      }
      ranking.sort((a, b) => a.best - b.best);

      const pos = ranking.findIndex((r) => r.driver.index === player.index);
      if (pos >= 0 && ranking.length > 1) {
        sectorRankings.push({
          label,
          pos,
          total: ranking.length,
          delta: ranking[pos].best - ranking[0].best,
          bestDriver: ranking[0].driver["driver-name"],
          deltaToP2: ranking.length > 1 ? ranking[1].best - ranking[0].best : 0,
          p2Driver: ranking.length > 1 ? ranking[1].driver["driver-name"] : "",
        });
      }
    }

    if (sectorRankings.length > 0) {
      const worst = [...sectorRankings].sort((a, b) => b.pos - a.pos)[0];
      const best = [...sectorRankings].sort((a, b) => a.pos - b.pos)[0];

      if (worst.pos > 0) {
        insights.push({
          type: "sector",
          label: `Weakest — ${worst.label}`,
          value: ordinal(worst.pos + 1),
          detail:
            worst.delta < 1
              ? `of ${worst.total}`
              : `of ${worst.total} — +${(worst.delta / 1000).toFixed(3)}s vs ${worst.bestDriver}`,
          rank: worst.pos,
          rankTotal: worst.total,
        });
      }

      if (best.pos < worst.pos) {
        const isP1 = best.pos === 0;
        insights.push({
          type: "sector",
          label: `Strongest — ${best.label}`,
          value: ordinal(best.pos + 1),
          detail: isP1
            ? best.deltaToP2 < 1
              ? `of ${best.total}`
              : `of ${best.total} — ${(best.deltaToP2 / 1000).toFixed(3)}s ahead of ${best.p2Driver}`
            : best.delta < 1
              ? `of ${best.total}`
              : `of ${best.total} — +${(best.delta / 1000).toFixed(3)}s vs ${best.bestDriver}`,
          rank: best.pos,
          rankTotal: best.total,
        });
      }
    }

    // 3. Theoretical best lap
    const bestS1 = Math.min(...playerValid.map((l) => l["sector-1-time-in-ms"]));
    const bestS2 = Math.min(...playerValid.map((l) => l["sector-2-time-in-ms"]));
    const bestS3 = Math.min(...playerValid.map((l) => l["sector-3-time-in-ms"]));
    const theoretical = bestS1 + bestS2 + bestS3;
    const actualBest = getBestLapTime(player["session-history"]["lap-history-data"]);
    if (actualBest > 0 && theoretical < actualBest) {
      const gap = actualBest - theoretical;
      if (gap >= 10) {
        insights.push({
          type: "pace",
          label: "Theoretical Best",
          value: msToLapTimeLocal(theoretical),
          detail: `${(gap / 1000).toFixed(3)}s left on the table`,
        });
      }
    }
  }

  // 4. Consistency
  if (playerValid.length > 1) {
    const stdDev = lapTimeStdDev(playerValid);
    if (stdDev > 0) {
      const consistencyRanking: { driver: DriverData; stdDev: number }[] = [];
      for (const d of allDrivers) {
        const valid = getValidLaps(d["session-history"]["lap-history-data"]);
        if (valid.length < 2) continue;
        consistencyRanking.push({ driver: d, stdDev: lapTimeStdDev(valid) });
      }
      consistencyRanking.sort((a, b) => a.stdDev - b.stdDev);

      const pos = consistencyRanking.findIndex(
        (r) => r.driver.index === player.index,
      );
      if (pos >= 0 && consistencyRanking.length > 1) {
        insights.push({
          type: "pace",
          label: "Consistency",
          value: ordinal(pos + 1),
          detail: `of ${consistencyRanking.length} — \u00B1${(stdDev / 1000).toFixed(3)}s`,
          rank: pos,
          rankTotal: consistencyRanking.length,
        });
      }
    }
  }

  return insights;
}

/** Historical PB data for a track */
export interface TrackPBData {
  bestQualiLapMs: number;
  bestS1Ms: number;
  bestS2Ms: number;
  bestS3Ms: number;
  bestRaceLapMs: number;
  bestRacePaceMs: number;
  sessionCount: number;
}

/** Generate qualifying insights comparing to personal bests on this track */
export function generateQualiHistoryInsights(
  player: DriverData,
  pbs: TrackPBData,
): StrategyInsight[] {
  const insights: StrategyInsight[] = [];
  const laps = player["session-history"]["lap-history-data"];
  const valid = getValidLaps(laps);
  if (valid.length === 0) return insights;

  const currentBest = getBestLapTime(laps);

  // 1. vs Personal Best lap
  if (currentBest > 0 && pbs.bestQualiLapMs > 0) {
    const delta = currentBest - pbs.bestQualiLapMs;
    if (delta <= 0) {
      insights.push({
        type: "history",
        label: "vs Personal Best",
        value: "New PB!",
        detail:
          delta < 0
            ? `-${(Math.abs(delta) / 1000).toFixed(3)}s improvement`
            : "matched your best",
      });
    } else {
      insights.push({
        type: "history",
        label: "vs Personal Best",
        value: `+${(delta / 1000).toFixed(3)}s`,
        detail: `off your PB of ${msToLapTimeLocal(pbs.bestQualiLapMs)}`,
      });
    }
  }

  // 2. Sector vs PB sectors — show the sector furthest from PB
  const currentS1 = Math.min(
    ...valid.map((l) => l["sector-1-time-in-ms"]).filter((v) => v > 0),
  );
  const currentS2 = Math.min(
    ...valid.map((l) => l["sector-2-time-in-ms"]).filter((v) => v > 0),
  );
  const currentS3 = Math.min(
    ...valid.map((l) => l["sector-3-time-in-ms"]).filter((v) => v > 0),
  );

  if (pbs.bestS1Ms > 0 && pbs.bestS2Ms > 0 && pbs.bestS3Ms > 0) {
    const deltas = [
      { sector: "S1", delta: currentS1 - pbs.bestS1Ms },
      { sector: "S2", delta: currentS2 - pbs.bestS2Ms },
      { sector: "S3", delta: currentS3 - pbs.bestS3Ms },
    ].filter((d) => d.delta > 0);

    if (deltas.length > 0) {
      const worst = deltas.sort((a, b) => b.delta - a.delta)[0];
      insights.push({
        type: "history",
        label: "vs PB Sectors",
        value: worst.sector,
        detail: `+${(worst.delta / 1000).toFixed(3)}s vs your all-time best`,
      });
    } else {
      // All sectors matched or beat PB
      const totalGain =
        (pbs.bestS1Ms - currentS1) +
        (pbs.bestS2Ms - currentS2) +
        (pbs.bestS3Ms - currentS3);
      if (totalGain > 0) {
        insights.push({
          type: "history",
          label: "vs PB Sectors",
          value: "All-time bests!",
          detail: `${(totalGain / 1000).toFixed(3)}s gained across sectors`,
        });
      }
    }
  }

  return insights;
}

/** Generate race insights comparing to historical data on this track */
export function generateRaceHistoryInsights(
  player: DriverData,
  pbs: TrackPBData,
): StrategyInsight[] {
  const insights: StrategyInsight[] = [];
  const laps = player["session-history"]["lap-history-data"];
  const valid = getValidLaps(laps);
  if (valid.length === 0) return insights;

  const bestRaceLap = getBestLapTime(laps);

  // 1. Best race lap vs all-time best race lap
  if (bestRaceLap > 0 && pbs.bestRaceLapMs > 0) {
    const delta = bestRaceLap - pbs.bestRaceLapMs;
    if (delta <= 0) {
      insights.push({
        type: "history",
        label: "vs Best Race Lap",
        value: "New PB!",
        detail:
          delta < 0
            ? `-${(Math.abs(delta) / 1000).toFixed(3)}s improvement`
            : "matched your best",
      });
    } else {
      insights.push({
        type: "history",
        label: "vs Best Race Lap",
        value: `+${(delta / 1000).toFixed(3)}s`,
        detail: `off your PB of ${msToLapTimeLocal(pbs.bestRaceLapMs)}`,
      });
    }
  }

  // 2. Race pace vs best-ever race pace
  if (pbs.bestRacePaceMs > 0) {
    const avgPace =
      valid.reduce((s, l) => s + l["lap-time-in-ms"], 0) / valid.length;
    const delta = avgPace - pbs.bestRacePaceMs;
    if (delta <= 0) {
      insights.push({
        type: "history",
        label: "Race Pace vs Best",
        value: "New best!",
        detail:
          delta < 0
            ? `-${(Math.abs(delta) / 1000).toFixed(3)}s/lap improvement`
            : "matched your best pace",
      });
    } else {
      insights.push({
        type: "history",
        label: "Race Pace vs Best",
        value: `+${(delta / 1000).toFixed(3)}s/lap`,
        detail: "off your best average pace",
      });
    }
  }

  return insights;
}
