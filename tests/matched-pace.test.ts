import assert from "node:assert/strict";
import test from "node:test";
import { generateInsights } from "../src/utils/stats/raceInsights";
import { generateRaceHistoryInsights } from "../src/utils/stats/historyInsights";
import type {
  DriverData,
  LapHistoryEntry,
  TelemetrySession,
} from "../src/types/telemetry";
import { compareCompoundMatchedRacePace } from "../src/utils/stats/matchedPace";

function lap(timeMs: number): LapHistoryEntry {
  return {
    "lap-time-in-ms": timeMs,
    "lap-time-str": "",
    "sector-1-time-in-ms": 30_000,
    "sector-1-time-str": "",
    "sector-2-time-in-ms": 45_000,
    "sector-2-time-str": "",
    "sector-3-time-in-ms": timeMs - 75_000,
    "sector-3-time-str": "",
    "lap-valid-bit-flags": 15,
  };
}

function driver(
  name: string,
  eligibleTimesMs: number[],
  index = name === "Player" ? 0 : 1,
): DriverData {
  const laps = [lap(110_000), ...eligibleTimesMs.map(lap)];
  return {
    index,
    "driver-name": name,
    team: "Test Team",
    "is-player": index === 0,
    "session-history": {
      "num-laps": laps.length,
      "num-tyre-stints": 1,
      "best-lap-time-lap-num": 0,
      "best-sector-1-lap-num": 0,
      "best-sector-2-lap-num": 0,
      "best-sector-3-lap-num": 0,
      "lap-history-data": laps,
      "tyre-stints-history-data": [
        {
          "tyre-actual-compound": "C3",
          "tyre-visual-compound": "Medium",
          "end-lap": laps.length,
        },
      ],
    },
    "per-lap-info": [],
  } as unknown as DriverData;
}

test("matched pace compares same-compound medians with shared evidence", () => {
  const comparison = compareCompoundMatchedRacePace(
    driver("Player", [100_000, 101_000, 102_000, 103_000, 104_000]),
    driver("Rival", [101_000, 102_000, 103_000, 104_000]),
  );

  assert.deepEqual(comparison, {
    deltaMs: -500,
    evidenceWeight: 4,
    firstSampleCount: 5,
    secondSampleCount: 4,
    compounds: ["Medium"],
    sectorDeltasMs: [0, 0, -500],
  });
});

test("matched pace rejects one- and two-lap hotlap comparisons", () => {
  assert.equal(
    compareCompoundMatchedRacePace(
      driver("Player", [100_000, 101_000]),
      driver("Rival", [101_000, 102_000, 103_000]),
    ),
    null,
  );
});

test("matched pace rejects materially imbalanced same-tyre samples", () => {
  assert.equal(
    compareCompoundMatchedRacePace(
      driver(
        "Player",
        [
          100_000, 101_000, 102_000, 103_000, 104_000, 105_000, 106_000,
          107_000, 108_000, 109_000,
        ],
      ),
      driver("Rival", [101_000, 102_000, 103_000]),
    ),
    null,
  );
});

test("head-to-head insights name same-tyre evidence Matched Pace", () => {
  const player = driver(
    "Player",
    [100_000, 101_000, 102_000, 103_000, 104_000],
  );
  const rival = driver("Rival", [101_000, 102_000, 103_000, 104_000], 1);
  const session = {
    "classification-data": [player, rival],
  } as TelemetrySession;

  const insight = generateInsights(session, player, rival).find(
    ({ label }) => label === "Matched Pace",
  );
  assert.equal(insight?.value, "-0.500s");
  assert.match(insight?.detail ?? "", /same tyres.*5 vs 4 laps/);
  assert.match(insight?.tooltip ?? "", /half the larger one/);

  const sectors = generateInsights(session, player, rival).find(
    ({ label }) => label === "Sector Analysis",
  );
  assert.equal(sectors?.value, "-0.500s");
  assert.deepEqual(sectors?.extraDetails, [
    "S1 · 0.000s even",
    "S2 · 0.000s even",
    "S3 · -0.500s faster",
  ]);

  assert.equal(
    generateInsights(session, player, rival).some(
      ({ type, label }) => type === "speed" || label === "Top Speed",
    ),
    false,
  );
});

test("matched pace renders exact and near ties as even", () => {
  const exactPlayer = driver("Player", [100_000, 101_000, 102_000]);
  const exactRival = driver("Rival", [100_000, 101_000, 102_000], 1);
  const nearRival = driver("Near rival", [100_049, 101_049, 102_049], 2);
  const insightFor = (rival: DriverData) =>
    generateInsights(
      { "classification-data": [exactPlayer, rival] } as TelemetrySession,
      exactPlayer,
      rival,
    ).find(({ label }) => label === "Matched Pace");

  assert.equal(insightFor(exactRival)?.value, "Even");
  assert.match(insightFor(exactRival)?.detail ?? "", /^matched /);
  assert.equal(insightFor(nearRival)?.value, "Even");
  assert.match(insightFor(nearRival)?.detail ?? "", /^matched /);
});

test("sector analysis is withheld without balanced matched evidence", () => {
  const player = driver(
    "Player",
    Array.from({ length: 10 }, (_, index) => 100_000 + index * 100),
  );
  const rival = driver("Rival", [101_000, 101_100, 101_200], 1);
  const insights = generateInsights(
    { "classification-data": [player, rival] } as TelemetrySession,
    player,
    rival,
  );

  assert.equal(
    insights.some(({ label }) => label === "Matched Pace"),
    false,
  );
  assert.equal(
    insights.some(({ label }) => label === "Sector Analysis"),
    false,
  );
});

test("field Race Pace ranks only drivers with comparable coverage", () => {
  const times = (count: number, baseMs: number) =>
    Array.from({ length: count }, (_, index) => baseMs + index * 10);
  const player = driver("Player", times(19, 100_000), 0);
  const fullRaceRival = driver("Full race rival", times(19, 101_000), 1);
  const shortFastRival = driver("Short fast rival", times(6, 99_000), 2);
  const session = {
    "classification-data": [player, fullRaceRival, shortFastRival],
  } as TelemetrySession;

  const insight = generateInsights(session, player).find(
    ({ label }) => label === "Race Pace",
  );
  assert.equal(insight?.value, "1st");
  assert.match(insight?.detail ?? "", /of 2.*19 clean laps/);
  assert.equal(insight?.rankTotal, 2);
});

test("partial races cannot claim a historical Race Pace best", () => {
  const pbs = {
    bestQualiLapMs: 0,
    bestS1Ms: 0,
    bestS2Ms: 0,
    bestS3Ms: 0,
    bestRaceLapMs: 0,
    bestRacePaceMs: 102_000,
    sessionCount: 1,
  };
  const partialPlayer = driver("Player", [100_000, 101_000, 102_000]);
  const completedPlayer = driver(
    "Player",
    [100_000, 101_000, 102_000, 103_000, 104_000, 105_000, 106_000, 107_000],
  );
  const sessionWith = (player: DriverData) =>
    ({
      "session-info": { "total-laps": 10 },
      "classification-data": [player],
    }) as TelemetrySession;

  assert.equal(
    generateRaceHistoryInsights(
      sessionWith(partialPlayer),
      partialPlayer,
      pbs,
    ).some(({ label }) => label === "Race Pace vs Best"),
    false,
  );
  assert.equal(
    generateRaceHistoryInsights(
      sessionWith(completedPlayer),
      completedPlayer,
      pbs,
    ).some(({ label }) => label === "Race Pace vs Best"),
    true,
  );
});
