import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import type {
  CarStatus,
  DriverData,
  ErsStats,
  PerLapInfo,
  TelemetrySession,
  TyreStintHistoryV2Entry,
} from "../src/types/telemetry";
import {
  sortRaceStintHistoryRows,
  type RaceDriverStats,
} from "../src/analysis/resultsAnalysis";
import { avgErsHarvestUtilization } from "../src/utils/stats/energy";
import { generateInsights } from "../src/utils/stats/raceInsights";

function lap({
  number,
  ersStats,
  carStatus = {},
  safetyCarStatus = "NO_SAFETY_CAR",
}: {
  number: number;
  ersStats?: ErsStats;
  carStatus?: Partial<CarStatus>;
  safetyCarStatus?: string;
}): PerLapInfo {
  return {
    "lap-number": number,
    "ers-stats": ersStats,
    "car-status-data": carStatus as CarStatus,
    "car-damage-data": {},
    "max-safety-car-status": safetyCarStatus,
  } as PerLapInfo;
}

function driver(perLapInfo: PerLapInfo[]): DriverData {
  return { "per-lap-info": perLapInfo } as DriverData;
}

test("harvest utilization compares MGU-K recovery with the MGU-K limit", () => {
  const utilization = avgErsHarvestUtilization(
    driver([
      lap({
        number: 0,
        ersStats: {
          "ers-harv-mguk-j": 0,
          "ers-harv-limit-mguk-j": 4_000_000,
        },
      }),
      lap({
        number: 1,
        ersStats: {
          "ers-harv-mguk-j": 2_000_000,
          "ers-harv-mguh-j": 4_000_000,
          "ers-harv-limit-mguk-j": 4_000_000,
        },
        carStatus: {
          "ers-harvested-this-lap-mguk": 8_000_000,
          "ers-harvested-limit-per-lap": 8_000_000,
        },
      }),
      lap({
        number: 2,
        ersStats: {
          "ers-harv-mguk-j": 2_000_000,
          "ers-harv-mguh-j": 4_000_000,
          "ers-harv-limit-mguk-j": 2_000_000,
        },
      }),
      lap({
        number: 3,
        ersStats: {
          "ers-harv-mguk-j": 40_000_000,
          "ers-harv-limit-mguk-j": 4_000_000,
        },
      }),
    ]),
  );

  assert.equal(utilization, 0.75);
});

test("harvest utilization keeps explicit zero laps and supports legacy snapshots", () => {
  const utilization = avgErsHarvestUtilization(
    driver([
      lap({ number: 0 }),
      lap({
        number: 1,
        carStatus: {
          "ers-harvested-this-lap-mguk": 0,
          "ers-harvested-this-lap-mguh": 4_000_000,
          "ers-harvested-limit-per-lap": 2_000_000,
        },
      }),
      lap({
        number: 2,
        carStatus: {
          "ers-harvested-this-lap-mguk": 1_000_000,
          "ers-harvested-this-lap-mguh": 3_000_000,
          "ers-harvested-limit-per-lap": 2_000_000,
        },
      }),
      lap({ number: 3 }),
    ]),
  );

  assert.equal(utilization, 0.25);
});

test("harvest utilization rejects MGU-H-only and non-racing samples", () => {
  const utilization = avgErsHarvestUtilization(
    driver([
      lap({ number: 0 }),
      lap({
        number: 1,
        ersStats: {
          "ers-harv-mguh-j": 4_000_000,
          "ers-harv-limit-mguk-j": 4_000_000,
        },
      }),
      lap({
        number: 2,
        safetyCarStatus: "FULL_SAFETY_CAR",
        ersStats: {
          "ers-harv-mguk-j": 4_000_000,
          "ers-harv-limit-mguk-j": 4_000_000,
        },
      }),
      lap({ number: 3 }),
    ]),
  );

  assert.equal(utilization, null);
});

test("harvest utilization preserves small telemetry-timing overshoot", () => {
  const utilization = avgErsHarvestUtilization(
    driver([
      lap({ number: 0 }),
      lap({
        number: 1,
        ersStats: {
          "ers-harv-mguk-j": 4_004_000,
          "ers-harv-limit-mguk-j": 4_000_000,
        },
      }),
      lap({ number: 2 }),
    ]),
  );

  assert.equal(utilization, 1.001);
});

test("harvest utilization sort keeps missing telemetry last in both directions", () => {
  const raceStats = (ersHarvestPct: number | null): RaceDriverStats => ({
    bestLap: 0,
    racePace: 0,
    racePaceLapCount: 0,
    racePaceConfidence: null,
    racePaceRankEligible: false,
    racePaceRankingSampleThreshold: 3,
    topSpeed: 0,
    ers: 0,
    ersHarv: 0,
    ersHarvestPct,
  });
  const entries = ["Lower", "Missing", "Higher"].map(
    (name, index) => ({ name, position: index + 1 }) as TyreStintHistoryV2Entry,
  );
  const driverStats = new Map([
    ["Lower", raceStats(0.5)],
    ["Missing", raceStats(null)],
    ["Higher", raceStats(0.9)],
  ]);

  for (const sortDir of ["asc", "desc"] as const) {
    const sorted = sortRaceStintHistoryRows({
      entries,
      focusedOnly: false,
      sortKey: "ersHarvestPct",
      sortDir,
      driverStats,
    });
    assert.equal(sorted.at(-1)?.name, "Missing");
  }
});

test("race insights retain raw harvested energy for exports without a limit", () => {
  const session = JSON.parse(
    readFileSync(
      new URL(
        "../public/demo/race-spa-2026-01-26-22-14-52.json",
        import.meta.url,
      ),
      "utf8",
    ),
  ) as TelemetrySession;
  const player = session["classification-data"].find(
    (candidate) => candidate["is-player"],
  );
  const rival = session["classification-data"].find(
    (candidate) => candidate.index !== player?.index,
  );
  assert.ok(player);
  assert.ok(rival);

  const fieldHarvest = generateInsights(session, player).find((insight) =>
    insight.label.startsWith("ERS Harv"),
  );
  const rivalHarvest = generateInsights(session, player, rival).find(
    (insight) => insight.label.startsWith("ERS Harv"),
  );

  assert.equal(fieldHarvest?.label, "ERS Harv");
  assert.match(fieldHarvest?.detail ?? "", /MJ\/lap/);
  assert.equal(rivalHarvest?.label, "ERS Harv");
  assert.match(rivalHarvest?.value ?? "", /MJ/);
});
