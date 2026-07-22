import * as assert from "node:assert/strict";
import { test } from "node:test";
import type {
  DriverData,
  PerLapInfo,
  TelemetrySession,
} from "../../types/telemetry";
import {
  buildRaceAnalysisBuckets,
  type TrackSessionData,
} from "../../analysis/trackAnalysis";
import { collectGreenFlagBurnDeltas } from "./energy";
import { quantile } from "./core";
import { aggregateFuelData } from "./trackAggregates";

interface AttemptOptions {
  deltas: number[];
  completed?: boolean;
  sessionUid?: number;
  startFuelKg?: number;
  startFuelRemaining?: number;
  totalLaps?: number;
}

function buildFuelLaps(
  deltas: readonly number[],
  startFuelKg = 50,
  lapNumbers = deltas.map((_, index) => index).concat(deltas.length),
): PerLapInfo[] {
  let fuel = startFuelKg;
  return lapNumbers.map((lapNumber, index) => {
    if (index > 0) fuel -= deltas[index - 1]!;
    return {
      "lap-number": lapNumber,
      "max-safety-car-status": "NO_SAFETY_CAR",
      "car-status-data": {
        "fuel-in-tank": fuel,
        "fuel-remaining-laps": -1,
      },
    } as PerLapInfo;
  });
}

function buildPlayer(
  options: AttemptOptions,
  lapNumbers?: number[],
): DriverData {
  const startFuelKg = options.startFuelKg ?? 50;
  const laps = buildFuelLaps(options.deltas, startFuelKg, lapNumbers);
  laps[0]!["car-status-data"]["fuel-remaining-laps"] =
    options.startFuelRemaining ?? -1;

  return {
    "is-player": true,
    "per-lap-info": laps,
    "session-history": {
      "num-laps": 0,
      "lap-history-data": [],
      "tyre-stints-history-data": [],
    },
    "tyre-set-history": [],
    "final-classification": options.completed
      ? { "result-status": "FINISHED" }
      : null,
  } as unknown as DriverData;
}

function buildAttempt(options: AttemptOptions): TelemetrySession {
  const session = {
    "session-info": {
      "session-type": "Race",
      "total-laps": options.totalLaps ?? 22,
    },
    "classification-data": [buildPlayer(options)],
  } as TelemetrySession;

  if (options.sessionUid != null) {
    session.debug = {
      "session-uid": options.sessionUid,
    } as TelemetrySession["debug"];
  }

  return session;
}

function buildTrackRace(
  session: TelemetrySession,
  index: number,
): TrackSessionData {
  return {
    summary: {
      relativePath: `${index}.json`,
      slug: `race-${index}`,
      sessionType: "Race",
      track: "Test Track",
      date: `2026-01-${String(index + 1).padStart(2, "0")}T00:00:00Z`,
      validLapCount: 0,
    },
    session,
    kind: "race",
    isRace: true,
    bestLapMs: 0,
    bestS1: 0,
    bestS2: 0,
    bestS3: 0,
    stdDevMs: 0,
    wearRate: 0,
    allLaps: [],
    weather: "Clear",
    trackTemp: 0,
    airTemp: 0,
    aiDifficulty: 0,
    sessionPeakKmh: 0,
    sessionPeakQuality: null,
    attemptCount: 1,
  };
}

const sixStablePairs = [1, 1, 1, 1, 1, 1];

test("fuel burn ignores gaps between retained lap snapshots", () => {
  const player = buildPlayer({ deltas: [1, 2] }, [0, 1, 3]);

  assert.deepEqual(collectGreenFlagBurnDeltas(player), [1]);
});

test("fuel burn excludes safety-car boundaries", () => {
  const player = buildPlayer({ deltas: [1, 1, 1] });
  player["per-lap-info"]![1]!["max-safety-car-status"] = "FULL_SAFETY_CAR";

  assert.deepEqual(collectGreenFlagBurnDeltas(player), [1]);
});

test("quantile uses linear interpolation", () => {
  assert.equal(quantile([1, 1, 1, 2], 0.75), 1.25);
});

test("fuel target needs two independently usable attempts and 12 pairs", () => {
  assert.equal(
    aggregateFuelData([
      buildAttempt({ deltas: [...sixStablePairs, ...sixStablePairs] }),
    ]),
    null,
  );
  assert.equal(
    aggregateFuelData([
      buildAttempt({ deltas: [1, 1, 1, 1, 1] }),
      buildAttempt({ deltas: [1, 1, 1, 1, 1] }),
    ]),
    null,
  );
  assert.equal(
    aggregateFuelData([
      buildAttempt({ deltas: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1] }),
      buildAttempt({ deltas: [1, 1] }),
    ]),
    null,
  );

  const result = aggregateFuelData([
    buildAttempt({ deltas: sixStablePairs }),
    buildAttempt({ deltas: sixStablePairs }),
  ]);
  assert.ok(result);
  assert.equal(result.eligibleAttemptCount, 2);
  assert.equal(result.consecutiveGreenPairCount, 12);
});

test("repeated saves from one session count as one fuel attempt", () => {
  assert.equal(
    aggregateFuelData([
      buildAttempt({ deltas: sixStablePairs, sessionUid: 123 }),
      buildAttempt({ deltas: sixStablePairs, sessionUid: 123 }),
    ]),
    null,
  );
});

test("fuel UID dedup keeps the strongest snapshot and its completion state", () => {
  const result = aggregateFuelData([
    buildAttempt({
      deltas: [2, 2, 2, 2, 2, 2],
      completed: true,
      sessionUid: 123,
    }),
    buildAttempt({ deltas: [1, 1, 1, 1, 1, 1, 1], sessionUid: 123 }),
    buildAttempt({ deltas: sixStablePairs, sessionUid: 456 }),
    buildAttempt({
      deltas: sixStablePairs,
      completed: true,
      sessionUid: 456,
    }),
  ]);

  assert.ok(result);
  assert.equal(result.eligibleAttemptCount, 2);
  assert.equal(result.consecutiveGreenPairCount, 13);
  assert.equal(result.p75BurnRateKgPerLap, 1);
  assert.equal(result.completedRaceCount, 1);
  assert.equal(result.confidence, "medium");
});

test("fuel target uses the pooled p75 burn rate", () => {
  const result = aggregateFuelData([
    buildAttempt({ deltas: sixStablePairs, totalLaps: 10 }),
    buildAttempt({ deltas: [1, 1, 1, 2, 2, 2], totalLaps: 10 }),
  ]);

  assert.ok(result);
  assert.equal(result.p75BurnRateKgPerLap, 1.25);
  assert.equal(result.avgRecommendedFuelKg, 13.0125);
});

test("race analysis keeps fuel-only distances isolated", () => {
  const races = [
    buildAttempt({ deltas: sixStablePairs, totalLaps: 10 }),
    buildAttempt({ deltas: sixStablePairs, totalLaps: 10 }),
    buildAttempt({ deltas: sixStablePairs, totalLaps: 22 }),
    buildAttempt({ deltas: sixStablePairs, totalLaps: 22 }),
  ].map(buildTrackRace);

  const buckets = buildRaceAnalysisBuckets(races);

  assert.deepEqual(
    buckets.map((bucket) => bucket.totalLaps),
    [10, 22],
  );
  assert.ok(buckets.every((bucket) => bucket.fuelStats !== null));
  assert.ok(buckets.every((bucket) => bucket.compoundLifeStats.length === 0));
  assert.ok(buckets.every((bucket) => bucket.setupCandidates.length === 0));
  assert.ok(
    buckets.every((bucket) =>
      bucket.sessions.every(
        (session) => session["session-info"]["total-laps"] === bucket.totalLaps,
      ),
    ),
  );
});

test("race analysis does not pool below-gate evidence across distances", () => {
  const races = [
    buildAttempt({
      deltas: [...sixStablePairs, ...sixStablePairs],
      totalLaps: 10,
    }),
    buildAttempt({
      deltas: [...sixStablePairs, ...sixStablePairs],
      totalLaps: 22,
    }),
  ].map(buildTrackRace);

  assert.deepEqual(buildRaceAnalysisBuckets(races), []);
});

test("fuel confidence counts completed contributing attempts", () => {
  const confidenceFor = (completedCount: number) =>
    aggregateFuelData([
      buildAttempt({
        deltas: sixStablePairs,
        completed: completedCount >= 1,
      }),
      buildAttempt({
        deltas: sixStablePairs,
        completed: completedCount >= 2,
      }),
    ]);

  const low = confidenceFor(0);
  const medium = confidenceFor(1);
  const high = confidenceFor(2);
  assert.ok(low && medium && high);
  assert.deepEqual(
    [low.confidence, medium.confidence, high.confidence],
    ["low", "medium", "high"],
  );
  assert.deepEqual(
    [
      low.completedRaceCount,
      medium.completedRaceCount,
      high.completedRaceCount,
    ],
    [0, 1, 2],
  );

  const completedButIneligible = aggregateFuelData([
    buildAttempt({ deltas: sixStablePairs }),
    buildAttempt({ deltas: sixStablePairs }),
    buildAttempt({ deltas: [1, 1], completed: true }),
  ]);
  assert.ok(completedButIneligible);
  assert.equal(completedButIneligible.confidence, "low");
  assert.equal(completedButIneligible.completedRaceCount, 0);
});

test("Spa-like partial evidence produces the accepted conservative target", () => {
  const p75Burn = 1.5293073654174805;
  const pooledDeltas = [
    ...Array<number>(37).fill(p75Burn),
    ...Array<number>(11).fill(1.6),
  ];
  const pairCounts = [20, 7, 7, 7, 7];
  let offset = 0;
  const attempts = pairCounts.map((pairCount) => {
    const deltas = pooledDeltas.slice(offset, offset + pairCount);
    offset += pairCount;
    return buildAttempt({
      deltas,
      totalLaps: 22,
      startFuelKg: 32.83974838256836,
      startFuelRemaining: -1.6718128204345704,
    });
  });

  const result = aggregateFuelData(attempts);
  assert.ok(result);
  assert.equal(result.eligibleAttemptCount, 5);
  assert.equal(result.consecutiveGreenPairCount, 48);
  assert.equal(result.completedRaceCount, 0);
  assert.equal(result.confidence, "low");
  assert.ok(Math.abs(result.avgRecommendedFuelKg - 34.2271) < 0.0001);
  assert.ok(Math.abs(result.avgRecommendedFuelLaps - -0.7646) < 0.0001);
});
