import assert from "node:assert/strict";
import test from "node:test";
import {
  buildQualifyingTableModel,
  buildRaceDriverStats,
  buildRaceResultHighlights,
  sortRaceStintHistoryRows,
} from "../src/analysis/resultsAnalysis";
import type {
  DriverData,
  FinalClassification,
  LapHistoryEntry,
  TelemetrySession,
  TyreStintHistoryV2Entry,
} from "../src/types/telemetry";
import { driverBestLapTimeMs } from "../src/utils/stats/drivers";
import {
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
  });
  assert.deepEqual(buildRaceResultHighlights(stats), {
    bestLapMs: 107_538,
    bestPaceMs: 0,
    bestSpeedKmh: 0,
    bestErs: 0,
    bestErsHarv: 0,
    hasErsHarv: false,
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
