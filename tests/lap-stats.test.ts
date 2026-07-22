import assert from "node:assert/strict";
import test from "node:test";
import {
  buildQualifyingTableModel,
  buildRaceDriverStats,
  buildRaceResultHighlights,
  sortRaceStintHistoryRows,
} from "../src/analysis/resultsAnalysis";
import { buildLapAnalysis } from "../src/analysis/lapAnalysis";
import { buildSessionSummaryInsights } from "../src/analysis/sessionInsightSummary";
import type {
  DriverData,
  FinalClassification,
  LapHistoryEntry,
  PerLapInfo,
  TelemetrySession,
  TyreStintHistoryV2Entry,
} from "../src/types/telemetry";
import { buildSessionSummary } from "../src/utils/sessionSummary";
import { driverBestLapTimeMs } from "../src/utils/stats/drivers";
import { generateQualiInsights } from "../src/utils/stats/qualifyingInsights";
import {
  calculateCumulativeDeltas,
  getBestLapTime,
  getRacePaceLaps,
  getValidLaps,
  hasCompleteLapTiming,
  isCompleteValidLap,
} from "../src/utils/stats/laps";

function lap(
  timeMs: number,
  s1Ms: number,
  s2Ms: number,
  s3Ms: number,
  flags = 15,
): LapHistoryEntry {
  return {
    "lap-time-in-ms": timeMs,
    "lap-time-str": "",
    "sector-1-time-in-ms": s1Ms,
    "sector-1-time-str": "",
    "sector-2-time-in-ms": s2Ms,
    "sector-2-time-str": "",
    "sector-3-time-in-ms": s3Ms,
    "sector-3-time-str": "",
    "lap-valid-bit-flags": flags,
  };
}

const zeroLap = () => lap(0, 0, 0, 0);

function classification(
  position: number,
  bestLapMs: number,
  legacy = false,
): FinalClassification {
  return {
    position,
    "num-laps": 2,
    "grid-position": position,
    points: 0,
    "num-pit-stops": 0,
    "result-status": "FINISHED",
    ...(legacy
      ? { "best-lap-time-in-ms": bestLapMs }
      : { "best-lap-time-ms": bestLapMs }),
    "best-lap-time-str": "",
    "total-race-time": 0,
    "total-race-time-str": "",
    "penalties-time": 0,
    "num-penalties": 0,
    "num-tyre-stints": 0,
  };
}

function driver({
  index,
  name,
  laps,
  finalClassification,
}: {
  index: number;
  name: string;
  laps: LapHistoryEntry[];
  finalClassification?: FinalClassification;
}): DriverData {
  return {
    index,
    "driver-name": name,
    team: "Test Team",
    "is-player": index === 0,
    "final-classification": finalClassification,
    "session-history": {
      "num-laps": laps.length,
      "num-tyre-stints": 0,
      "best-lap-time-lap-num": 0,
      "best-sector-1-lap-num": 0,
      "best-sector-2-lap-num": 0,
      "best-sector-3-lap-num": 0,
      "lap-history-data": laps,
      "tyre-stints-history-data": [],
    },
    "per-lap-info": [],
  } as unknown as DriverData;
}

test("sector fragments are not complete valid laps", () => {
  const fragment = lap(29_191, 0, 0, 29_191);
  const complete = lap(107_538, 31_878, 46_539, 29_119);

  assert.equal(hasCompleteLapTiming(fragment), false);
  assert.equal(isCompleteValidLap(fragment), false);
  assert.deepEqual(getValidLaps([fragment, complete]), [complete]);
  assert.equal(getBestLapTime([fragment, complete]), 107_538);

  const sparseDriver = driver({
    index: 1,
    name: "Sparse rival",
    laps: [zeroLap(), fragment],
  });
  assert.deepEqual(getRacePaceLaps(sparseDriver), []);
});

test("cumulative deltas ignore sector fragments", () => {
  const complete = lap(108_000, 31_000, 47_000, 30_000, 0);
  const fragment = lap(29_191, 0, 0, 29_191);

  assert.deepEqual(
    calculateCumulativeDeltas(
      [complete, complete],
      [complete, fragment],
      [],
      [],
    ),
    [
      {
        lap: 1,
        delta: 0,
        lapDelta: 0,
        s1Delta: 0,
        s2Delta: 0,
        s3Delta: 0,
        playerPit: false,
        rivalPit: false,
      },
    ],
  );
});

test("incomplete timed rows do not renumber later lap analysis", () => {
  const completeOne = lap(108_000, 31_000, 47_000, 30_000);
  const fragment = lap(29_191, 0, 0, 29_191);
  const completeThree = lap(107_000, 30_500, 46_500, 30_000);
  const rivalThree = lap(109_000, 31_500, 47_500, 30_000);

  const model = buildLapAnalysis({
    laps: [completeOne, fragment, completeThree],
    rivalLaps: [completeOne, fragment, rivalThree],
  });

  assert.deepEqual(
    model.rows.map((row) => [row.lap, row.rivalTimeSec]),
    [
      [1, 108],
      [3, 109],
    ],
  );
});

test("race stats use official best laps but do not invent sparse race pace", () => {
  const player = driver({
    index: 0,
    name: "Player",
    laps: [
      lap(110_000, 32_000, 48_000, 30_000),
      lap(107_538, 31_878, 46_539, 29_119),
    ],
    finalClassification: classification(1, 107_538),
  });
  const sparseRival = driver({
    index: 1,
    name: "Sparse rival",
    laps: [zeroLap(), lap(29_191, 0, 0, 29_191)],
    finalClassification: classification(2, 108_066),
  });

  const stats = buildRaceDriverStats([player, sparseRival]);
  assert.deepEqual(stats.get("Sparse rival"), {
    bestLap: 108_066,
    racePace: 0,
    racePaceLapCount: 0,
    racePaceConfidence: null,
    racePaceRankEligible: false,
    racePaceRankingSampleThreshold: 3,
    topSpeed: 0,
    ers: 0,
    ersHarv: 0,
    ersHarvestPct: null,
  });
  assert.deepEqual(buildRaceResultHighlights(stats), {
    bestLapMs: 107_538,
    bestPaceMs: 0,
    bestSpeedKmh: 0,
    bestErs: 0,
    bestErsHarv: 0,
    hasErsHarv: false,
    hasErsHarvestPct: false,
  });
});

test("race pace stays visible but cannot rank without relative evidence", () => {
  const lapsFor = (eligibleCount: number, baseTimeMs: number) => [
    lap(baseTimeMs + 2_000, 31_000, 47_000, baseTimeMs - 76_000),
    ...Array.from({ length: eligibleCount }, (_, index) => {
      const timeMs = baseTimeMs + index * 10;
      return lap(timeMs, 31_000, 47_000, timeMs - 78_000);
    }),
  ];
  const fullRace = driver({
    index: 0,
    name: "Full race",
    laps: lapsFor(19, 108_000),
    finalClassification: classification(1, 108_000),
  });
  const shortRace = driver({
    index: 1,
    name: "Short race",
    laps: lapsFor(6, 107_000),
    finalClassification: classification(2, 107_000),
  });

  const stats = buildRaceDriverStats([fullRace, shortRace]);
  const fullStats = stats.get("Full race")!;
  const shortStats = stats.get("Short race")!;

  assert.equal(fullStats.racePaceLapCount, 19);
  assert.equal(fullStats.racePaceRankEligible, true);
  assert.equal(shortStats.racePaceLapCount, 6);
  assert.equal(shortStats.racePace > 0, true);
  assert.equal(shortStats.racePaceRankingSampleThreshold, 10);
  assert.equal(shortStats.racePaceRankEligible, false);
  assert.equal(buildRaceResultHighlights(stats).bestPaceMs, fullStats.racePace);

  const entries = [
    { name: "Short race", position: 2 },
    { name: "Full race", position: 1 },
  ] as TyreStintHistoryV2Entry[];
  for (const sortDir of ["asc", "desc"] as const) {
    assert.equal(
      sortRaceStintHistoryRows({
        entries,
        focusedOnly: false,
        sortKey: "racePace",
        sortDir,
        driverStats: stats,
      })[0]?.name,
      "Full race",
    );
  }
});

test("official best-lap fallback supports legacy exports", () => {
  const legacyDriver = driver({
    index: 1,
    name: "Legacy rival",
    laps: [zeroLap(), lap(31_680, 0, 0, 31_680)],
    finalClassification: classification(2, 108_138, true),
  });
  const unavailableDriver = driver({
    index: 2,
    name: "Unavailable rival",
    laps: [zeroLap(), lap(31_680, 0, 0, 31_680)],
  });

  assert.equal(driverBestLapTimeMs(legacyDriver), 108_138);
  assert.equal(driverBestLapTimeMs(unavailableDriver), 0);
});

test("focused-driver insight uses an official best when history is partial", () => {
  const sparseDriver = driver({
    index: 1,
    name: "Sparse rival",
    laps: [zeroLap(), lap(31_680, 0, 0, 31_680)],
    finalClassification: classification(2, 108_066),
  });
  const session = {
    "session-info": { "session-type": "Race", "total-laps": 2 },
    "classification-data": [sparseDriver],
    "tyre-stint-history-v2": [],
    records: {},
  } as unknown as TelemetrySession;

  const bestLap = buildSessionSummaryInsights({
    session,
    focusedDriver: sparseDriver,
  }).find((insight) => insight.label === "Best Lap");

  assert.equal(bestLap?.value, "1:48.066");
  assert.equal(bestLap?.detail, "session fastest lap");
  assert.equal(bestLap?.compound, undefined);
});

test("neutralized-lap insight ignores formation laps", () => {
  const player = driver({
    index: 0,
    name: "Player",
    laps: [zeroLap(), lap(108_000, 31_000, 47_000, 30_000)],
  });
  const perLapInfo = (status: string, lapNumber: number) =>
    ({
      "lap-number": lapNumber,
      "max-safety-car-status": status,
    }) as PerLapInfo;
  const session = {
    "session-info": { "session-type": "Race", "total-laps": 3 },
    "classification-data": [player],
    "tyre-stint-history-v2": [],
    records: {},
  } as unknown as TelemetrySession;

  player["per-lap-info"] = [perLapInfo("FORMATION_LAP", 1)];
  assert.equal(
    buildSessionSummaryInsights({ session, focusedDriver: player }).some(
      (insight) => insight.label === "Neutralized Laps",
    ),
    false,
  );

  player["per-lap-info"] = [
    perLapInfo("FORMATION_LAP", 1),
    perLapInfo("FULL_SAFETY_CAR", 2),
    perLapInfo("VIRTUAL_SAFETY_CAR", 3),
  ];
  const neutralized = buildSessionSummaryInsights({
    session,
    focusedDriver: player,
  }).find((insight) => insight.label === "Neutralized Laps");

  assert.equal(neutralized?.value, "2 laps");
  assert.equal(neutralized?.detail, "Full Safety Car, Virtual Safety Car");
});

test("qualifying insight ranks official best laps for sparse drivers", () => {
  const pole = driver({
    index: 0,
    name: "Pole",
    laps: [lap(30_000, 30_000, 0, 0)],
    finalClassification: classification(1, 104_047),
  });
  const second = driver({
    index: 1,
    name: "Second",
    laps: [lap(31_000, 0, 31_000, 0)],
    finalClassification: classification(2, 104_699),
  });
  const session = {
    "session-info": { "session-type": "Qualifying" },
    "classification-data": [second, pole],
  } as unknown as TelemetrySession;

  const insight = generateQualiInsights(session, pole).find(
    (candidate) => candidate.label === "Qualifying",
  );

  assert.equal(insight?.value, "1st");
  assert.equal(insight?.detail, "of 2");
});

test("time trial current-run surfaces ignore classification ghost times", () => {
  const player = driver({
    index: 0,
    name: "Time Trial player",
    laps: [lap(31_000, 31_000, 0, 0)],
    finalClassification: classification(1, 64_818),
  });
  const session = {
    "session-info": { "session-type": "Time Trial" },
    "classification-data": [player],
    records: {
      fastest: {
        lap: { time: 64_818, "driver-index": player.index },
      },
    },
  } as unknown as TelemetrySession;

  const table = buildQualifyingTableModel({
    session,
    focusedOnly: false,
    focusedDriverIndex: player.index,
  });
  const bestLap = buildSessionSummaryInsights({
    session,
    focusedDriver: player,
  }).find((insight) => insight.label === "Best Lap");
  const summary = buildSessionSummary(
    "Time_Trial_Austria_2026_06_25_16_45_32.json",
    session,
  ).summary;

  assert.equal(table.rows[0]?.bestTime, Number.POSITIVE_INFINITY);
  assert.equal(bestLap?.value, "No Time");
  assert.equal(summary.bestLapTimeMs, undefined);
  assert.equal(summary.bestLapTime, undefined);
});

test("qualifying ranks official times and withholds unrelated sectors", () => {
  const pole = driver({
    index: 0,
    name: "Pole",
    laps: [lap(104_047, 30_000, 45_000, 29_047)],
    finalClassification: classification(1, 104_047),
  });
  const sparseRival = driver({
    index: 1,
    name: "Sparse rival",
    laps: [lap(105_100, 30_500, 45_500, 29_100), lap(33_391, 33_391, 0, 0)],
    finalClassification: classification(2, 104_699),
  });
  const session = {
    "session-info": { "session-type": "Qualifying" },
    "classification-data": [sparseRival, pole],
  } as unknown as TelemetrySession;

  const model = buildQualifyingTableModel({
    session,
    focusedOnly: false,
    focusedDriverIndex: 0,
  });

  assert.equal(model.p1Time, 104_047);
  assert.equal(model.bestLapTime, 104_047);
  assert.deepEqual(
    model.rows.map((row) => [
      row.position,
      row.driver["driver-name"],
      row.bestTime,
    ]),
    [
      [1, "Pole", 104_047],
      [2, "Sparse rival", 104_699],
    ],
  );
  assert.equal(model.rows[1]?.bestLap, null);
  assert.deepEqual(model.rows[1]?.sectorTimes, [0, 0, 0]);
});
