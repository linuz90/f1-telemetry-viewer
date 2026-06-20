import type { DriverData, TelemetrySession } from "../../types/telemetry";
import { sectorTimeMs } from "../format";
import { ordinal } from "./core";
import { driverTopSpeed } from "./drivers";
import { avgErsDeployMj, avgErsHarvestMj } from "./energy";
import type { StrategyInsight } from "./insightTypes";
import { RACE_PACE_TOOLTIP } from "./insightTypes";
import { getCleanRaceLaps } from "./laps";
import { getCompletedStints, stintWearRate } from "./tyres";

/** Generate strategy insights for the player (race) */
export function generateInsights(
  session: TelemetrySession,
  player: DriverData,
  rival?: DriverData,
): StrategyInsight[] {
  const insights: StrategyInsight[] = [];
  const allDrivers = session["classification-data"] ?? [];

  if (rival) {
    // --- Head-to-head mode ---
    const rivalName = rival["driver-name"];

    // 1. Pace delta vs rival (clean laps — SC/pit/incident excluded)
    const playerClean = getCleanRaceLaps(player);
    const rivalClean = getCleanRaceLaps(rival);
    if (playerClean.length > 0 && rivalClean.length > 0) {
      const playerAvg =
        playerClean.reduce((s, l) => s + l["lap-time-in-ms"], 0) /
        playerClean.length;
      const rivalAvg =
        rivalClean.reduce((s, l) => s + l["lap-time-in-ms"], 0) /
        rivalClean.length;
      const delta = (playerAvg - rivalAvg) / 1000;
      insights.push({
        type: "pace",
        label: "Race Pace",
        value: `${delta <= 0 ? "" : "+"}${delta.toFixed(3)}s`,
        detail:
          delta <= 0
            ? `faster per lap on average vs ${rivalName}`
            : `slower per lap on average vs ${rivalName}`,
        tooltip: RACE_PACE_TOOLTIP,
      });
    }

    // 2. Tyre wear delta vs rival
    const playerRates = getCompletedStints(player["tyre-set-history"])
      .map((s) => stintWearRate(s))
      .filter((r) => r > 0);
    const rivalRates = getCompletedStints(rival["tyre-set-history"])
      .map((s) => stintWearRate(s))
      .filter((r) => r > 0);
    if (playerRates.length > 0 && rivalRates.length > 0) {
      const playerAvgRate =
        playerRates.reduce((a, b) => a + b, 0) / playerRates.length;
      const rivalAvgRate =
        rivalRates.reduce((a, b) => a + b, 0) / rivalRates.length;
      const diff = playerAvgRate - rivalAvgRate;
      insights.push({
        type: "tyre",
        label: "Tyre Management",
        value: `${diff <= 0 ? "" : "+"}${diff.toFixed(1)}%/lap`,
        detail:
          diff <= 0
            ? `less wear per lap vs ${rivalName}`
            : `more wear per lap vs ${rivalName}`,
      });
    }

    // 3. Sector deltas vs rival (all 3 sectors, clean laps only)
    const playerCleanLaps = getCleanRaceLaps(player);
    const rivalCleanLaps = getCleanRaceLaps(rival);
    if (playerCleanLaps.length > 0 && rivalCleanLaps.length > 0) {
      const sectorKeys = [
        { sector: 1, label: "S1" },
        { sector: 2, label: "S2" },
        { sector: 3, label: "S3" },
      ] as const;

      const sectorRows: string[] = [];
      let netDelta = 0;
      let gains = 0;
      let losses = 0;
      for (const { sector, label } of sectorKeys) {
        const pAvg =
          playerCleanLaps.reduce((s, l) => s + sectorTimeMs(l, sector), 0) /
          playerCleanLaps.length;
        const rAvg =
          rivalCleanLaps.reduce((s, l) => s + sectorTimeMs(l, sector), 0) /
          rivalCleanLaps.length;
        const d = (pAvg - rAvg) / 1000;
        netDelta += d;
        const delta = `${d <= 0 ? "" : "+"}${d.toFixed(3)}s`;
        const direction = d < -0.001 ? "faster" : d > 0.001 ? "slower" : "even";
        sectorRows.push(`${label} · ${delta} ${direction}`);
        if (d < -0.001) gains++;
        if (d > 0.001) losses++;
      }

      insights.push({
        type: "sector",
        label: "Sector Analysis",
        value: `${netDelta <= 0 ? "" : "+"}${netDelta.toFixed(3)}s`,
        detail:
          gains > 0 && losses > 0
            ? `${gains} sectors faster · ${losses} slower vs ${rivalName}`
            : gains === 3
              ? `faster in all sectors vs ${rivalName}`
              : losses === 3
                ? `slower in all sectors vs ${rivalName}`
                : `even by sector vs ${rivalName}`,
        extraDetails: sectorRows,
      });
    }

    // 4. Top speed delta vs rival
    const playerTopSpeed = driverTopSpeed(player);
    const rivalTopSpeed = driverTopSpeed(rival);
    if (playerTopSpeed > 0 && rivalTopSpeed > 0) {
      const delta = Math.round(playerTopSpeed) - Math.round(rivalTopSpeed);
      insights.push({
        type: "speed",
        label: "Top Speed",
        value: `${delta <= 0 ? "" : "+"}${delta} km/h`,
        detail:
          delta < 0
            ? `slower than ${rivalName} (${Math.round(playerTopSpeed)} vs ${Math.round(rivalTopSpeed)})`
            : delta > 0
              ? `faster than ${rivalName} (${Math.round(playerTopSpeed)} vs ${Math.round(rivalTopSpeed)})`
              : `same as ${rivalName} (${Math.round(playerTopSpeed)} km/h)`,
      });
    }

    // 5. ERS deployment delta vs rival
    const playerErs = avgErsDeployMj(player);
    const rivalErs = avgErsDeployMj(rival);
    if (playerErs > 0 && rivalErs > 0) {
      const delta = playerErs - rivalErs;
      insights.push({
        type: "ers",
        label: "ERS Deploy",
        value: `${delta <= 0 ? "" : "+"}${delta.toFixed(1)} MJ`,
        detail: `avg per lap vs ${rivalName} (${playerErs.toFixed(1)} vs ${rivalErs.toFixed(1)} MJ)`,
        tooltip:
          "Average ERS energy deployed per lap (green-flag laps only, excluding first and last lap).",
      });
    }

    // 6. ERS harvest delta vs rival (lift-and-coast signal in F1 26)
    const playerHarv = avgErsHarvestMj(player);
    const rivalHarv = avgErsHarvestMj(rival);
    if (playerHarv > 0 && rivalHarv > 0) {
      const delta = playerHarv - rivalHarv;
      insights.push({
        type: "ers",
        label: "ERS Harv",
        value: `${delta <= 0 ? "" : "+"}${delta.toFixed(1)} MJ`,
        detail: `avg per lap vs ${rivalName} (${playerHarv.toFixed(1)} vs ${rivalHarv.toFixed(1)} MJ)`,
        tooltip:
          "Average ERS energy harvested per lap, MGU-K + MGU-H combined. Higher values indicate more lift-and-coast.",
      });
    }
  } else {
    // --- Field ranking mode (original behavior) ---

    // 1. Pace ranking (clean laps — SC/pit/incident excluded)
    const paceRanking: { driver: DriverData; avgPace: number }[] = [];
    for (const d of allDrivers) {
      const clean = getCleanRaceLaps(d);
      if (clean.length === 0) continue;
      const avg =
        clean.reduce((s, l) => s + l["lap-time-in-ms"], 0) / clean.length;
      paceRanking.push({ driver: d, avgPace: avg });
    }
    paceRanking.sort((a, b) => a.avgPace - b.avgPace);
    const pacePos = paceRanking.findIndex(
      (r) => r.driver.index === player.index,
    );
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
        tooltip: RACE_PACE_TOOLTIP,
        rank: pacePos,
        rankTotal: paceRanking.length,
      });
    }

    // 2. Tyre wear ranking
    const wearRanking: { driver: DriverData; avgRate: number }[] = [];
    for (const d of allDrivers) {
      const stints = getCompletedStints(d["tyre-set-history"] ?? []);
      if (!stints.length) continue;
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

    // 3. Top speed ranking
    const speedRanking: { driver: DriverData; topSpeed: number }[] = [];
    for (const d of allDrivers) {
      const spd = driverTopSpeed(d);
      if (spd > 0) speedRanking.push({ driver: d, topSpeed: spd });
    }
    speedRanking.sort((a, b) => b.topSpeed - a.topSpeed);
    const speedPos = speedRanking.findIndex(
      (r) => r.driver.index === player.index,
    );
    if (speedPos >= 0 && speedRanking.length > 1) {
      const playerSpd = speedRanking[speedPos].topSpeed;
      const delta = speedRanking[0].topSpeed - playerSpd;
      insights.push({
        type: "speed",
        label: "Top Speed",
        value: ordinal(speedPos + 1),
        detail:
          delta < 1
            ? `of ${speedRanking.length} — ${Math.round(playerSpd)} km/h`
            : `of ${speedRanking.length} — ${Math.round(playerSpd)} km/h (${Math.round(delta)} off P1)`,
        tooltip: "Session top speed ranking across all drivers",
        rank: speedPos,
        rankTotal: speedRanking.length,
      });
    }

    // 4. ERS deployment ranking
    const ersRanking: { driver: DriverData; avgErs: number }[] = [];
    for (const d of allDrivers) {
      const avg = avgErsDeployMj(d);
      if (avg > 0) ersRanking.push({ driver: d, avgErs: avg });
    }
    ersRanking.sort((a, b) => b.avgErs - a.avgErs); // highest first
    const ersPos = ersRanking.findIndex((r) => r.driver.index === player.index);
    if (ersPos >= 0 && ersRanking.length > 1) {
      const playerErs = ersRanking[ersPos].avgErs;
      insights.push({
        type: "ers",
        label: "ERS Deploy",
        value: ordinal(ersPos + 1),
        detail: `of ${ersRanking.length} — ${playerErs.toFixed(1)} MJ/lap`,
        tooltip:
          "Average ERS energy deployed per lap (green-flag laps only, excluding first and last lap).",
        rank: ersPos,
        rankTotal: ersRanking.length,
      });
    }

    // 5. ERS harvest ranking (lift-and-coast signal in F1 26)
    const harvRanking: { driver: DriverData; avgHarv: number }[] = [];
    for (const d of allDrivers) {
      const avg = avgErsHarvestMj(d);
      if (avg > 0) harvRanking.push({ driver: d, avgHarv: avg });
    }
    harvRanking.sort((a, b) => b.avgHarv - a.avgHarv); // highest first
    const harvPos = harvRanking.findIndex(
      (r) => r.driver.index === player.index,
    );
    if (harvPos >= 0 && harvRanking.length > 1) {
      const playerHarv = harvRanking[harvPos].avgHarv;
      insights.push({
        type: "ers",
        label: "ERS Harv",
        value: ordinal(harvPos + 1),
        detail: `of ${harvRanking.length} — ${playerHarv.toFixed(1)} MJ/lap`,
        tooltip:
          "Average ERS energy harvested per lap, MGU-K + MGU-H combined. Higher values indicate more lift-and-coast.",
        rank: harvPos,
        rankTotal: harvRanking.length,
      });
    }

    // 6. Weakest & strongest sector (avg vs avg across all drivers, clean laps)
    const playerCleanLaps2 = getCleanRaceLaps(player);
    if (playerCleanLaps2.length > 0) {
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
        const ranking: { driver: DriverData; avg: number }[] = [];
        for (const d of allDrivers) {
          const clean = getCleanRaceLaps(d);
          if (!clean.length) continue;
          const avg =
            clean.reduce((s, l) => s + sectorTimeMs(l, sector), 0) /
            clean.length;
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
            p2Driver:
              ranking.length > 1 ? ranking[1].driver["driver-name"] : "",
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
  }

  // 4. Pit timing vs rival
  if (rival) {
    const playerPits = getCompletedStints(player["tyre-set-history"])
      .slice(1)
      .map((s) => s["start-lap"]);
    const rivalPits = getCompletedStints(rival["tyre-set-history"])
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
