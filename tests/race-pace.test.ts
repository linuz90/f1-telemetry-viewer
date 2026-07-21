import assert from "node:assert/strict";
import test from "node:test";
import type { DriverData, LapHistoryEntry } from "../src/types/telemetry";
import type { RacePaceLapSample } from "../src/utils/stats/laps";
import {
  calculateRacePaceEstimate,
  getRacePaceReferenceSampleCount,
  getRacePaceRankingSampleThreshold,
  hasSufficientRacePaceCompletion,
  isRacePaceRankEligible,
} from "../src/utils/stats/racePace";

function sample(timeMs: number, lapNumber: number): RacePaceLapSample {
  return {
    lapNumber,
    timeMs,
    lap: { "lap-time-in-ms": timeMs } as LapHistoryEntry,
  };
}

function samples(...timesMs: number[]): RacePaceLapSample[] {
  return timesMs.map((timeMs, index) => sample(timeMs, index + 1));
}

test("race pace is unavailable below the three-lap evidence floor", () => {
  assert.deepEqual(calculateRacePaceEstimate([]), {
    timeMs: null,
    sampleCount: 0,
    confidence: null,
  });
  assert.deepEqual(calculateRacePaceEstimate(samples(100_000, 101_000)), {
    timeMs: null,
    sampleCount: 2,
    confidence: null,
  });
});

test("race pace averages every eligible lap and reports evidence confidence", () => {
  assert.deepEqual(
    calculateRacePaceEstimate(samples(100_000, 102_000, 104_000)),
    {
      timeMs: 102_000,
      sampleCount: 3,
      confidence: "low",
    },
  );
  assert.equal(
    calculateRacePaceEstimate(samples(1, 2, 3, 4, 5)).confidence,
    "medium",
  );
  assert.equal(
    calculateRacePaceEstimate(samples(1, 2, 3, 4, 5, 6, 7, 8)).confidence,
    "high",
  );
});

test("ranking threshold uses half of the reference evidence with a floor of three", () => {
  assert.equal(getRacePaceRankingSampleThreshold(0), 3);
  assert.equal(getRacePaceRankingSampleThreshold(2), 3);
  assert.equal(getRacePaceRankingSampleThreshold(5), 3);
  assert.equal(getRacePaceRankingSampleThreshold(6), 3);
  assert.equal(getRacePaceRankingSampleThreshold(7), 4);
  assert.equal(getRacePaceRankingSampleThreshold(19), 10);
  assert.equal(getRacePaceRankingSampleThreshold(Number.NaN), 3);
});

test("reference evidence uses the largest eligible sample pool", () => {
  const estimates = [
    calculateRacePaceEstimate(samples(1, 2)),
    calculateRacePaceEstimate(samples(1, 2, 3, 4, 5, 6)),
    calculateRacePaceEstimate(samples(1, 2, 3)),
  ];

  assert.equal(getRacePaceReferenceSampleCount(estimates), 6);
  assert.equal(getRacePaceReferenceSampleCount([]), 0);
});

test("rank eligibility requires both a usable estimate and relative evidence", () => {
  const twoLaps = calculateRacePaceEstimate(samples(100_000, 101_000));
  const threeLaps = calculateRacePaceEstimate(
    samples(100_000, 101_000, 102_000),
  );
  const fiveLaps = calculateRacePaceEstimate(
    samples(100_000, 101_000, 102_000, 103_000, 104_000),
  );

  assert.equal(isRacePaceRankEligible(twoLaps, 5), false);
  assert.equal(isRacePaceRankEligible(threeLaps, 5), true);
  assert.equal(isRacePaceRankEligible(threeLaps, 10), false);
  assert.equal(isRacePaceRankEligible(fiveLaps, 10), true);
});

test("historical pace requires a classified finish near race distance", () => {
  const driverAt = (completedLaps: number, resultStatus?: string) =>
    ({
      "session-history": { "num-laps": completedLaps },
      ...(resultStatus
        ? {
            "final-classification": {
              "num-laps": completedLaps,
              "result-status": resultStatus,
            },
          }
        : {}),
    }) as DriverData;

  assert.equal(hasSufficientRacePaceCompletion(driverAt(3), 10), false);
  assert.equal(hasSufficientRacePaceCompletion(driverAt(8), 10), false);
  assert.equal(hasSufficientRacePaceCompletion(driverAt(9), 10), true);
  assert.equal(hasSufficientRacePaceCompletion(driverAt(10), 10), true);
  assert.equal(
    hasSufficientRacePaceCompletion(driverAt(9, "FINISHED"), 10),
    true,
  );
  assert.equal(hasSufficientRacePaceCompletion(driverAt(10, "DNF"), 10), false);
  assert.equal(
    hasSufficientRacePaceCompletion(driverAt(10, "DISQUALIFIED"), 10),
    false,
  );
  assert.equal(hasSufficientRacePaceCompletion(driverAt(10), 0), false);
});
