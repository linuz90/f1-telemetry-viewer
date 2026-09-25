import assert from "node:assert/strict";
import test from "node:test";
import type {
  DriverData,
  TelemetrySession,
  TyreStint,
} from "../src/types/telemetry";
import { isDryCompound } from "../src/analysis/trackStrategyCompounds";
import { buildTrackRaceRecommendation } from "../src/analysis/trackRaceRecommendation";
import { aggregateCompoundLife } from "../src/utils/stats/trackAggregates";
import { PUNCTURE_THRESHOLD } from "../src/utils/stats/tyres";

interface StintSpec {
  compound: string;
  laps: number;
  wearPerLap: number;
}

interface RaceSpec {
  totalLaps: number;
  stints: StintSpec[];
  totalRaceTimeSeconds?: number;
}

function buildStint(
  spec: StintSpec,
  startLap: number,
  index: number,
): TyreStint {
  return {
    "start-lap": startLap,
    "end-lap": startLap + spec.laps - 1,
    "stint-length": spec.laps,
    "fitted-index": index,
    "tyre-set-key": "",
    "tyre-set-data": {
      "actual-tyre-compound": spec.compound,
      "visual-tyre-compound": spec.compound,
      wear: 0,
      available: false,
      "recommended-session": "",
      "life-span": spec.laps,
      "usable-life": spec.laps,
      "lap-delta-time": 0,
      fitted: true,
    },
    "tyre-wear-history": Array.from({ length: spec.laps }, (_, lap) => {
      const wear = spec.wearPerLap * (lap + 1);
      return {
        "lap-number": startLap + lap,
        "front-left-wear": wear,
        "front-right-wear": wear,
        "rear-left-wear": wear,
        "rear-right-wear": wear,
        average: wear,
        desc: "",
      };
    }),
  };
}

function buildRace(spec: RaceSpec): TelemetrySession {
  let startLap = 1;
  const stints = spec.stints.map((stintSpec, index) => {
    const stint = buildStint(stintSpec, startLap, index);
    startLap += stintSpec.laps;
    return stint;
  });
  const lapsDone = spec.stints.reduce((sum, stint) => sum + stint.laps, 0);
  const player = {
    "is-player": true,
    "per-lap-info": [],
    "session-history": {
      "num-laps": lapsDone,
      "lap-history-data": [],
      "tyre-stints-history-data": [],
    },
    "tyre-set-history": stints,
    "final-classification": spec.totalRaceTimeSeconds
      ? {
          "result-status": "FINISHED",
          "total-race-time": spec.totalRaceTimeSeconds,
        }
      : null,
  } as unknown as DriverData;

  return {
    "game-year": 25,
    "session-info": {
      "session-type": "Race",
      "track-id": "Melbourne",
      formula: "F1 Modern",
      "total-laps": spec.totalLaps,
    },
    "classification-data": [player],
  } as unknown as TelemetrySession;
}

function recommend(races: RaceSpec[]) {
  const sessions = races.map(buildRace);
  const recommendation = buildTrackRaceRecommendation(
    sessions,
    aggregateCompoundLife(sessions),
    null,
  );
  assert.ok(recommendation);
  return recommendation;
}

const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);

test("wet-only bucket gets an Inters plan instead of no strategy", () => {
  const recommendation = recommend([
    {
      totalLaps: 20,
      stints: [{ compound: "Inters", laps: 20, wearPerLap: 3 }],
    },
    {
      totalLaps: 20,
      stints: [{ compound: "Inters", laps: 12, wearPerLap: 3 }],
    },
  ]);

  assert.equal(recommendation.recommended, null);
  assert.equal(recommendation.hasEvidence, true);
  assert.equal(recommendation.totalLaps, 20);
  assert.equal(recommendation.wetStrategies.length, 1);
  const [wet] = recommendation.wetStrategies;
  // 20 laps at 3%/lap stays under the cap, so a stop only costs pit loss.
  assert.deepEqual(wet.compounds, ["Inters"]);
  assert.deepEqual(wet.stintLaps, [20]);
  assert.equal(wet.pitWindows.length, 0);
});

test("high-wear wet races stop on the same compound with an even split", () => {
  const recommendation = recommend([
    {
      totalLaps: 30,
      stints: [
        { compound: "Inters", laps: 15, wearPerLap: 4 },
        { compound: "Inters", laps: 15, wearPerLap: 4 },
      ],
    },
  ]);

  const [wet] = recommendation.wetStrategies;
  assert.deepEqual(wet.compounds, ["Inters", "Inters"]);
  assert.deepEqual(wet.stintLaps, [15, 15]);
  assert.deepEqual(wet.pitWindows, [{ earliest: 14, latest: 16, target: 15 }]);
  assert.ok(
    wet.stintWearPercentages.every((wear) => wear <= PUNCTURE_THRESHOLD),
  );
  assert.equal(wet.risk, undefined);
});

test("mixed buckets keep dry and wet plans on their own compounds", () => {
  const recommendation = recommend([
    {
      totalLaps: 24,
      stints: [
        { compound: "Medium", laps: 10, wearPerLap: 4 },
        { compound: "Hard", laps: 14, wearPerLap: 3 },
      ],
    },
    {
      totalLaps: 24,
      stints: [
        { compound: "Inters", laps: 12, wearPerLap: 3 },
        { compound: "Inters", laps: 12, wearPerLap: 3 },
      ],
      totalRaceTimeSeconds: 2_400,
    },
  ]);

  assert.ok(recommendation.recommended);
  assert.ok(recommendation.recommended.compounds.every(isDryCompound));
  // Only the completed Inters race can anchor absolute durations, so it
  // anchors the wet plan and never the dry one.
  assert.equal(
    recommendation.recommended.timeEstimate?.predictedTotalRaceMs,
    undefined,
  );

  const [wet] = recommendation.wetStrategies;
  assert.ok(wet.compounds.every((compound) => compound === "Inters"));
  assert.equal(sum(wet.stintLaps), 24);
  assert.ok(wet.timeEstimate?.predictedTotalRaceMs);
});

test("full wets get their own plan after Inters", () => {
  const recommendation = recommend([
    {
      totalLaps: 20,
      stints: [
        { compound: "Wet", laps: 10, wearPerLap: 2 },
        { compound: "Inters", laps: 10, wearPerLap: 3 },
      ],
    },
  ]);

  assert.deepEqual(
    recommendation.wetStrategies.map((strategy) => strategy.compounds[0]),
    ["Inters", "Wet"],
  );
  for (const strategy of recommendation.wetStrategies) {
    assert.equal(new Set(strategy.compounds).size, 1);
    assert.equal(sum(strategy.stintLaps), 20);
  }
});
