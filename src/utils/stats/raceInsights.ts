import type { DriverData, TelemetrySession } from "../../types/telemetry";
import { sectorTimeMs } from "../format";
import { ordinal } from "./core";
import { driverTopSpeed } from "./drivers";
import { avgErsDeployMj, avgErsHarvestUtilization } from "./energy";
import type { StrategyInsight } from "./insightTypes";
import {
  ERS_HARVEST_UTILIZATION_TOOLTIP,
  RACE_PACE_TOOLTIP,
} from "./insightTypes";
import { getRacePaceLaps } from "./laps";
import { compareCompoundMatchedRacePace } from "./matchedPace";
import {
  getRacePaceEstimate,
  getRacePaceReferenceSampleCount,
  isRacePaceRankEligible,
} from "./racePace";
import { getCompletedStints, getDriverStints, stintWearRate } from "./tyres";

const MATCHED_PACE_TIE_TOLERANCE_MS = 50;

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

    // Direct comparisons control for tyre compound instead of presenting two
    // independently sampled whole-race averages as an apples-to-apples delta.
    const matchedPace = compareCompoundMatchedRacePace(player, rival);
    if (matchedPace) {
      const delta = matchedPace.deltaMs / 1000;
      const isEven =
        Math.abs(matchedPace.deltaMs) <= MATCHED_PACE_TIE_TOLERANCE_MS;
      insights.push({
        type: "pace",
        label: "Matched Pace",
        value: isEven ? "Even" : `${delta < 0 ? "" : "+"}${delta.toFixed(3)}s`,
        detail: isEven
          ? `matched on the same tyres vs ${rivalName} · ${matchedPace.firstSampleCount} vs ${matchedPace.secondSampleCount} laps`
          : delta < 0
            ? `faster on the same tyres vs ${rivalName} · ${matchedPace.firstSampleCount} vs ${matchedPace.secondSampleCount} laps`
            : `slower on the same tyres vs ${rivalName} · ${matchedPace.firstSampleCount} vs ${matchedPace.secondSampleCount} laps`,
        tooltip:
          "Weighted same-compound median pace. Each compound requires at least 3 clean laps per driver, and the smaller sample must cover at least half the larger one.",
      });
    }

    // 2. Tyre wear delta vs rival
    const playerRates = getCompletedStints(getDriverStints(player))
      .map((s) => stintWearRate(s))
      .filter((r) => r > 0);
    const rivalRates = getCompletedStints(getDriverStints(rival))
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

    // 3. Sector deltas use the headline's same-compound, coverage-balanced
    // sample pool so the breakdown cannot contradict the evidence policy.
    if (matchedPace) {
      const sectorKeys = [
        { sector: 1, label: "S1" },
        { sector: 2, label: "S2" },
        { sector: 3, label: "S3" },
      ] as const;

      const sectorRows: string[] = [];
      let gains = 0;
      let losses = 0;
      for (const { sector, label } of sectorKeys) {
        const d = matchedPace.sectorDeltasMs[sector - 1] / 1000;
        const delta = `${d <= 0 ? "" : "+"}${d.toFixed(3)}s`;
        const direction = d < -0.001 ? "faster" : d > 0.001 ? "slower" : "even";
        sectorRows.push(`${label} · ${delta} ${direction}`);
        if (d < -0.001) gains++;
        if (d > 0.001) losses++;
      }

      insights.push({
        type: "sector",
        label: "Sector Analysis",
        value: `${matchedPace.deltaMs <= 0 ? "" : "+"}${(
          matchedPace.deltaMs / 1000
        ).toFixed(3)}s`,
        detail:
          gains > 0 && losses > 0
            ? `${gains} sectors faster · ${losses} slower vs ${rivalName}`
            : gains === 3
              ? `faster in all sectors vs ${rivalName}`
              : losses === 3
                ? `slower in all sectors vs ${rivalName}`
                : `even by sector vs ${rivalName}`,
        extraDetails: sectorRows,
        tooltip:
          "Same-compound median sectors using the same coverage-balanced clean laps as Matched Pace.",
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

    // 6. ERS harvest utilization vs rival
    const playerHarvest = avgErsHarvestUtilization(player);
    const rivalHarvest = avgErsHarvestUtilization(rival);
    if (playerHarvest != null && rivalHarvest != null) {
      const playerPercent = playerHarvest * 100;
      const rivalPercent = rivalHarvest * 100;
      const deltaPoints = playerPercent - rivalPercent;
      insights.push({
        type: "ers",
        label: "ERS Harvest",
        value: `${deltaPoints <= 0 ? "" : "+"}${deltaPoints.toFixed(1)} pp`,
        detail: `${playerPercent.toFixed(1)}% vs ${rivalPercent.toFixed(1)}% for ${rivalName}`,
        tooltip: ERS_HARVEST_UTILIZATION_TOOLTIP,
      });
    }
  } else {
    // --- Field ranking mode (original behavior) ---

    // 1. Pace ranking (race-pace laps — SC/pit/outlier excluded)
    const paceEstimates = new Map(
      allDrivers.map((driver) => [driver.index, getRacePaceEstimate(driver)]),
    );
    const referenceSampleCount = getRacePaceReferenceSampleCount(
      paceEstimates.values(),
    );
    const paceRanking: { driver: DriverData; avgPace: number }[] = allDrivers
      .map((driver) => ({
        driver,
        estimate: paceEstimates.get(driver.index)!,
      }))
      .filter(({ estimate }) =>
        isRacePaceRankEligible(estimate, referenceSampleCount),
      )
      .map(({ driver, estimate }) => ({
        driver,
        avgPace: estimate.timeMs!,
      }));
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
            ? `of ${paceRanking.length} · ${paceEstimates.get(player.index)!.sampleCount} clean laps`
            : `of ${paceRanking.length} — +${(delta / 1000).toFixed(3)}s vs P1 · ${paceEstimates.get(player.index)!.sampleCount} laps`,
        tooltip: RACE_PACE_TOOLTIP,
        rank: pacePos,
        rankTotal: paceRanking.length,
      });
    }

    // 2. Tyre wear ranking
    const wearRanking: { driver: DriverData; avgRate: number }[] = [];
    for (const d of allDrivers) {
      const stints = getCompletedStints(getDriverStints(d));
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

    // 5. ERS harvest utilization ranking. Keep the card neutral because fully
    // using the available harvest allowance is descriptive, not always faster.
    const harvestRanking: { driver: DriverData; utilization: number }[] = [];
    for (const d of allDrivers) {
      const utilization = avgErsHarvestUtilization(d);
      if (utilization != null) harvestRanking.push({ driver: d, utilization });
    }
    harvestRanking.sort((a, b) => b.utilization - a.utilization);
    const harvestPos = harvestRanking.findIndex(
      (r) => r.driver.index === player.index,
    );
    if (harvestPos >= 0 && harvestRanking.length > 1) {
      const playerPercent = harvestRanking[harvestPos].utilization * 100;
      insights.push({
        type: "ers",
        label: "ERS Harvest",
        value: `${playerPercent.toFixed(1)}%`,
        detail:
          harvestPos === 0
            ? `highest of ${harvestRanking.length} drivers`
            : `${ordinal(harvestPos + 1)}-highest of ${harvestRanking.length} drivers`,
        tooltip: ERS_HARVEST_UTILIZATION_TOOLTIP,
      });
    }

    // 6. Weakest & strongest sector (avg vs avg across race-pace laps)
    const rankEligibleDriverIndices = new Set(
      paceRanking.map(({ driver }) => driver.index),
    );
    const playerRacePaceLapsForSectors = getRacePaceLaps(player);
    if (
      rankEligibleDriverIndices.has(player.index) &&
      playerRacePaceLapsForSectors.length > 0
    ) {
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
          if (!rankEligibleDriverIndices.has(d.index)) continue;
          const racePaceLaps = getRacePaceLaps(d);
          if (!racePaceLaps.length) continue;
          const avg =
            racePaceLaps.reduce((s, l) => s + sectorTimeMs(l, sector), 0) /
            racePaceLaps.length;
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
    const playerPits = getCompletedStints(getDriverStints(player))
      .slice(1)
      .map((s) => s["start-lap"]);
    const rivalPits = getCompletedStints(getDriverStints(rival))
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
