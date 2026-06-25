import type { DriverData, TelemetrySession } from "../../types/telemetry";
import { bestSectorTimeMs } from "../format";
import { msToLapTimeLocal, ordinal } from "./core";
import { driverTopSpeed } from "./drivers";
import { ersHarvestMjForLap } from "./energy";
import type { StrategyInsight } from "./insightTypes";
import { getBestLapTime, getValidLaps, lapTimeStdDev } from "./laps";

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

  // 2. Top speed ranking
  const qualiSpeedRanking: { driver: DriverData; topSpeed: number }[] = [];
  for (const d of allDrivers) {
    const spd = driverTopSpeed(d);
    if (spd > 0) qualiSpeedRanking.push({ driver: d, topSpeed: spd });
  }
  qualiSpeedRanking.sort((a, b) => b.topSpeed - a.topSpeed);
  const qualiSpeedPos = qualiSpeedRanking.findIndex(
    (r) => r.driver.index === player.index,
  );
  if (qualiSpeedPos >= 0 && qualiSpeedRanking.length > 1) {
    const playerSpd = qualiSpeedRanking[qualiSpeedPos].topSpeed;
    const delta = qualiSpeedRanking[0].topSpeed - playerSpd;
    insights.push({
      type: "speed",
      label: "Top Speed",
      value: ordinal(qualiSpeedPos + 1),
      detail:
        delta < 1
          ? `of ${qualiSpeedRanking.length} — ${Math.round(playerSpd)} km/h`
          : `of ${qualiSpeedRanking.length} — ${Math.round(playerSpd)} km/h (${Math.round(delta)} off P1)`,
      tooltip: "Session top speed ranking across all drivers",
      rank: qualiSpeedPos,
      rankTotal: qualiSpeedRanking.length,
    });
  }

  // 3. Sector rankings
  const playerValid = getValidLaps(
    player["session-history"]["lap-history-data"],
  );
  if (playerValid.length > 0) {
    const sectorKeys = [
      { sector: 1, label: "S1" },
      { sector: 2, label: "S2" },
      { sector: 3, label: "S3" },
    ] as const;

    const sectorRankings: {
      label: string;
      pos: number;
      total: number;
      delta: number;
      bestDriver: string;
      deltaToP2: number;
      p2Driver: string;
    }[] = [];

    for (const { sector, label } of sectorKeys) {
      const ranking: { driver: DriverData; best: number }[] = [];
      for (const d of allDrivers) {
        const valid = getValidLaps(d["session-history"]["lap-history-data"]);
        if (!valid.length) continue;
        const best = bestSectorTimeMs(valid, sector);
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

    // 4. Theoretical best lap
    const bestS1 = bestSectorTimeMs(playerValid, 1);
    const bestS2 = bestSectorTimeMs(playerValid, 2);
    const bestS3 = bestSectorTimeMs(playerValid, 3);
    const theoretical = bestS1 + bestS2 + bestS3;
    const actualBest = getBestLapTime(
      player["session-history"]["lap-history-data"],
    );
    if (
      bestS1 > 0 &&
      bestS2 > 0 &&
      bestS3 > 0 &&
      actualBest > 0 &&
      theoretical < actualBest
    ) {
      const gap = actualBest - theoretical;
      if (gap >= 10) {
        insights.push({
          type: "pace",
          label: "Theoretical Best",
          value: msToLapTimeLocal(theoretical),
          detail: `${(gap / 1000).toFixed(3)}s in this run`,
          tooltip:
            "Session theoretical best: your best valid S1 + S2 + S3 from this run.",
        });
      }
    }
  }

  // 5. Consistency
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

  // 6. ERS harvest ranking — in quali, signals out-lap charging discipline (F1 26)
  const qualiHarv = qualiAvgErsHarvestMj(player);
  if (qualiHarv > 0) {
    const harvRanking: { driver: DriverData; avgHarv: number }[] = [];
    for (const d of allDrivers) {
      const avg = qualiAvgErsHarvestMj(d);
      if (avg > 0) harvRanking.push({ driver: d, avgHarv: avg });
    }
    harvRanking.sort((a, b) => b.avgHarv - a.avgHarv);
    const pos = harvRanking.findIndex((r) => r.driver.index === player.index);
    if (pos >= 0 && harvRanking.length > 1) {
      insights.push({
        type: "ers",
        label: "ERS Harv",
        value: ordinal(pos + 1),
        detail: `of ${harvRanking.length} — ${qualiHarv.toFixed(1)} MJ/lap`,
        tooltip:
          "Average ERS energy harvested per lap, MGU-K + MGU-H combined. In quali this reflects out-lap charging — higher values give more push-lap deploy.",
        rank: pos,
        rankTotal: harvRanking.length,
      });
    }
  }

  return insights;
}

/** Quali variant of avgErsHarvestMj: no SC filtering, no first/last exclusion.
 *  Quali laps are short and structured (out/push/in); averaging every lap with
 *  meaningful harvest captures the driver's overall charging discipline. */
function qualiAvgErsHarvestMj(d: DriverData): number {
  const perLap = d["per-lap-info"] ?? [];
  if (perLap.length === 0) return 0;
  const values: number[] = [];
  for (const lap of perLap) {
    const mj = ersHarvestMjForLap(lap);
    if (mj >= 0.2) values.push(mj);
  }
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}
