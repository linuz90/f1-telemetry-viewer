import assert from "node:assert/strict";
import test from "node:test";
import {
  buildFallbackRaceRows,
  buildQualifyingTableModel,
  buildRaceDriverStats,
  buildRaceResultHighlights,
  sortRaceStintHistoryRows,
} from "../src/analysis/resultsAnalysis";
import type {
  DriverData,
  FinalClassification,
  LapHistoryEntry,
  PerLapInfo,
  SpeedTrapRecord,
  TelemetrySession,
  TyreStintHistoryV2Entry,
} from "../src/types/telemetry";
import { buildSessionSummary } from "../src/utils/sessionSummary";
import { driverBestLapTimeMs } from "../src/utils/stats/drivers";
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

function raceSession(
  drivers: DriverData[],
  speedTrapRecords: SpeedTrapRecord[] = [],
): TelemetrySession {
  return {
    "session-info": {
      "session-type": "Race",
      weather: "Clear",
      "network-game": 1,
    },
    "classification-data": drivers,
    "speed-trap-records": speedTrapRecords,
  } as unknown as TelemetrySession;
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

  const stats = buildRaceDriverStats(raceSession([player, sparseRival]));
  assert.deepEqual(stats.get(sparseRival.index), {
    bestLap: 108_066,
    racePace: 0,
    racePaceLapCount: 0,
    racePaceConfidence: null,
    racePaceRankEligible: false,
    racePaceRankingSampleThreshold: 3,
    sessionPeakKmh: null,
    sessionPeakQuality: null,
    sessionPeakRank: null,
    speedTrapKmh: null,
    speedTrapQuality: null,
    speedTrapRank: null,
    ers: 0,
    ersHarv: 0,
    ersHarvestPct: null,
  });
  assert.deepEqual(buildRaceResultHighlights(stats), {
    bestLapMs: 107_538,
    bestPaceMs: 0,
    bestSessionPeakKmh: 0,
    bestSpeedTrapKmh: 0,
    hasSpeedTrap: false,
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

  const stats = buildRaceDriverStats(raceSession([fullRace, shortRace]));
  const fullStats = stats.get(fullRace.index)!;
  const shortStats = stats.get(shortRace.index)!;

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
        sortKey: "racePace",
        sortDir,
        drivers: [fullRace, shortRace],
        driverStats: stats,
      })[0]?.name,
      "Full race",
    );
  }
});

test("race result speed stats use indexed profiles and rank peak and trap independently", () => {
  const player = driver({
    index: 0,
    name: "Pílot One",
    laps: [lap(108_000, 31_000, 47_000, 30_000)],
    finalClassification: classification(1, 108_000),
  });
  player["per-lap-info"] = [
    { "lap-number": 1, "top-speed-kmph": 320 } as never,
  ];
  const rival = driver({
    index: 7,
    name: "Rival",
    laps: [lap(109_000, 31_500, 47_500, 30_000)],
    finalClassification: classification(2, 109_000),
  });
  rival["per-lap-info"] = [{ "lap-number": 1, "top-speed-kmph": 330 } as never];
  const tiedTrapDriver = driver({
    index: 9,
    name: "Trap tie",
    laps: [lap(110_000, 32_000, 48_000, 30_000)],
  });
  const limitedPeakDriver = driver({
    index: 11,
    name: "Limited peak",
    laps: [],
    finalClassification: classification(4, 0),
  });
  limitedPeakDriver["top-speed-kmph"] = 400;
  const session = raceSession(
    [player, rival, tiedTrapDriver, limitedPeakDriver],
    [
      {
        name: "  PI\u0301LOT   ONE ",
        team: "Test Team",
        "driver-number": 1,
        "speed-trap-record-kmph": 340,
      },
      {
        name: "Rival",
        team: "Test Team",
        "driver-number": 2,
        "speed-trap-record-kmph": 330,
      },
      {
        name: "Trap tie",
        team: "Test Team",
        "driver-number": 3,
        "speed-trap-record-kmph": 340,
      },
    ],
  );
  const stats = buildRaceDriverStats(session);
  const highlights = buildRaceResultHighlights(stats);

  assert.equal(stats.get(rival.index)?.sessionPeakRank, 1);
  assert.equal(stats.get(player.index)?.speedTrapRank, 1);
  assert.equal(highlights.bestSessionPeakKmh, 330);
  assert.equal(highlights.bestSpeedTrapKmh, 340);

  const sorted = sortRaceStintHistoryRows({
    entries: [
      { name: "wrong legacy name", index: rival.index, position: 2 },
      { name: " pílot one ", position: 1 },
    ] as TyreStintHistoryV2Entry[],
    sortKey: "speedTrap",
    sortDir: "asc",
    drivers: [player, rival, tiedTrapDriver],
    driverStats: stats,
  });
  assert.equal(sorted[0]?.name, " pílot one ");

  const sortedPeaks = sortRaceStintHistoryRows({
    entries: [
      { name: "Limited peak", position: 4 },
      { name: "Rival", position: 2 },
      { name: "Pílot One", position: 1 },
    ] as TyreStintHistoryV2Entry[],
    sortKey: "sessionPeak",
    sortDir: "asc",
    drivers: [player, rival, tiedTrapDriver, limitedPeakDriver],
    driverStats: stats,
  });
  assert.equal(sortedPeaks.at(-1)?.name, "Limited peak");

  const fallbackPeaks = buildFallbackRaceRows({
    drivers: [limitedPeakDriver, rival, player],
    sortKey: "sessionPeak",
    sortDir: "asc",
    driverStats: stats,
  });
  assert.equal(fallbackPeaks[0]?.["driver-name"], "Rival");
  assert.equal(fallbackPeaks.at(-1)?.["driver-name"], "Limited peak");

  const summary = buildSessionSummary(
    "Race_Test_2026_07_21_12_00_00.json",
    session,
  ).summary;
  assert.equal(summary.topSpeedTrapRank, 1);
  assert.equal(summary.topSpeedTrapTotal, 3);
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
