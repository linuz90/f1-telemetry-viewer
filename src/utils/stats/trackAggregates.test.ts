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
import { quantile } from "./core";
import {
  FUEL_RESERVE_KG,
  collectGreenFlagBurnDeltas,
  collectRaceFuelBurn,
} from "./energy";
import { aggregateFuelData } from "./trackAggregates";

interface AttemptOptions {
  /** Green laps after lap 1; buildAttempt() puts the start lap in front. */
  deltas: number[];
  /** Lap-1 burn from the grid, kg. */
  startLapKg?: number;
  /** Visual compound on every lap; unset reads as dry. */
  compound?: string;
  /** Save date as PnG writes it in file names: `2026_07_13`. */
  savedOn?: string;
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
  compound?: string,
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
        ...(compound ? { "visual-tyre-compound": compound } : {}),
      },
    } as PerLapInfo;
  });
}

function buildPlayer(
  options: AttemptOptions,
  lapNumbers?: number[],
): DriverData {
  const startFuelKg = options.startFuelKg ?? 50;
  const laps = buildFuelLaps(
    options.deltas,
    startFuelKg,
    lapNumbers,
    options.compound,
  );
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
    "classification-data": [
      buildPlayer({
        ...options,
        deltas: [options.startLapKg ?? 1, ...options.deltas],
      }),
    ],
  } as TelemetrySession;

  if (options.sessionUid != null || options.savedOn) {
    session.debug = {
      ...(options.sessionUid != null
        ? { "session-uid": options.sessionUid }
        : {}),
      ...(options.savedOn
        ? { "file-name": `Race_Test_${options.savedOn}_20_00_00.json` }
        : {}),
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
/** The thin-sample allowance for a plan from this many runs. */
const thin = (runs: number) => 0.015 * Math.sqrt(1 / runs - 1 / 6);

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

test("fuel target needs 12 green laps, from one run or several", () => {
  const oneLongRun = aggregateFuelData([
    buildAttempt({ deltas: [...sixStablePairs, ...sixStablePairs] }),
  ]);
  assert.ok(oneLongRun);
  assert.equal(oneLongRun.eligibleAttemptCount, 1);
  assert.equal(
    aggregateFuelData([buildAttempt({ deltas: [1, 1, 1, 1, 1, 1, 1, 1] })]),
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
  assert.equal(result.burnRateKgPerLap, 1);
  assert.equal(result.completedRaceCount, 1);
  assert.equal(result.confidence, "medium");
});

test("fuel target covers lap 1 and the median green burn down to the reserve", () => {
  const result = aggregateFuelData([
    buildAttempt({
      deltas: sixStablePairs,
      startLapKg: 1.2,
      totalLaps: 10,
      startFuelKg: 12,
      startFuelRemaining: 0,
    }),
    buildAttempt({
      deltas: Array<number>(6).fill(1.2),
      startLapKg: 1.4,
      totalLaps: 10,
      startFuelKg: 12,
      startFuelRemaining: 0,
    }),
  ]);

  assert.ok(result);
  assert.ok(Math.abs(result.burnRateKgPerLap - 1.1) < 1e-9);
  assert.ok(Math.abs(result.startLapBurnKg - 1.3) < 1e-9);
  // 1.3 + 9 × 1.1, the two-run allowance, and the reserve.
  const kg = 11.2 * (1 + thin(2)) + FUEL_RESERVE_KG;
  assert.ok(Math.abs(result.avgRecommendedFuelKg - kg) < 1e-9);
  // The slider counts laps at the game's 1.2 kg/lap, not the measured burn.
  assert.ok(Math.abs(result.avgRecommendedFuelLaps - (kg / 1.2 - 10)) < 1e-9);
  assert.ok(Math.abs(result.avgExcessAtFinishLaps - (10 - kg / 1.2)) < 1e-9);
});

test("dry and wet laps make separate fuel plans", () => {
  const dry = { deltas: sixStablePairs, startLapKg: 1 };
  const wet = {
    deltas: Array<number>(6).fill(1.1),
    startLapKg: 1.2,
    compound: "Inters",
  };
  const sessions = [
    buildAttempt({ ...dry, compound: "Medium" }),
    buildAttempt(dry),
    buildAttempt(wet),
    buildAttempt(wet),
  ];

  const dryPlan = aggregateFuelData(sessions);
  const wetPlan = aggregateFuelData(sessions, "wet");
  assert.ok(dryPlan && wetPlan);
  assert.equal(dryPlan.eligibleAttemptCount, 2);
  assert.equal(dryPlan.burnRateKgPerLap, 1);
  assert.equal(wetPlan.eligibleAttemptCount, 2);
  assert.ok(Math.abs(wetPlan.burnRateKgPerLap - 1.1) < 1e-9);
  assert.ok(Math.abs(wetPlan.startLapBurnKg - 1.2) < 1e-9);
});

test("the fuel plan reads this month's runs once two of them qualify", () => {
  const light = { deltas: sixStablePairs };
  const heavy = { deltas: Array<number>(6).fill(1.2), startLapKg: 1.2 };
  const summer = [
    buildAttempt({ ...light, savedOn: "2026_07_08" }),
    buildAttempt({ ...light, savedOn: "2026_07_13" }),
  ];

  // One fresh run is not a plan of its own yet, so the old ones still count.
  const mixed = aggregateFuelData([
    ...summer,
    buildAttempt({ ...heavy, savedOn: "2026_11_08" }),
  ]);
  assert.ok(mixed);
  assert.equal(mixed.eligibleAttemptCount, 3);
  assert.equal(mixed.burnRateKgPerLap, 1);

  const fresh = aggregateFuelData([
    ...summer,
    buildAttempt({ ...heavy, savedOn: "2026_11_08" }),
    buildAttempt({ ...heavy, savedOn: "2026_11_09" }),
  ]);
  assert.ok(fresh);
  assert.equal(fresh.eligibleAttemptCount, 2);
  assert.ok(Math.abs(fresh.burnRateKgPerLap - 1.2) < 1e-9);
});

test("a thin sample carries a little more fuel, six runs none", () => {
  // One run of twelve green laps: a plan, with the largest allowance.
  const single = aggregateFuelData([
    buildAttempt({ deltas: Array<number>(12).fill(1), totalLaps: 14 }),
  ])!;
  assert.ok(
    Math.abs(single.avgRecommendedFuelKg - (14 * (1 + thin(1)) + 0.2)) < 1e-9,
  );

  const run = { deltas: sixStablePairs, totalLaps: 10 };
  const planFrom = (runs: number) =>
    aggregateFuelData(Array.from({ length: runs }, () => buildAttempt(run)))!
      .avgRecommendedFuelKg;

  assert.ok(Math.abs(planFrom(6) - (10 + FUEL_RESERVE_KG)) < 1e-9);
  assert.ok(Math.abs(planFrom(9) - planFrom(6)) < 1e-9);
  assert.ok(planFrom(2) > planFrom(3) && planFrom(3) > planFrom(6));
  assert.ok(Math.abs(planFrom(2) - (10 * (1 + thin(2)) + 0.2)) < 1e-9);
});

test("a lap still in progress when the save was made stays out of the burn", () => {
  const player = buildPlayer({ deltas: [1.1, 1, 1, 1, 0.4] });
  // Four laps timed: lap 5's snapshot was read part-way round.
  player["session-history"]["lap-history-data"] = [1, 2, 3, 4].map(() => ({
    "lap-time-in-ms": 90_000,
  })) as DriverData["session-history"]["lap-history-data"];

  assert.deepEqual(
    collectRaceFuelBurn(player, "dry", 20).greenLapsKg,
    [1, 1, 1],
  );
});

test("the race's last lap stays out of the burn: online it is read after the flag", () => {
  const player = buildPlayer({ deltas: [1.1, 1, 1, 1.6] });

  assert.equal(collectRaceFuelBurn(player, "dry", 4).greenLapsKg.length, 2);
  assert.equal(collectRaceFuelBurn(player, "dry", 10).greenLapsKg.length, 3);
});

test("a formation-lap tag on lap 1 keeps lap 1 and lap 2 in the fuel plan", () => {
  const sessions = [0, 1].map(() => {
    const session = buildAttempt({ deltas: sixStablePairs, startLapKg: 1.3 });
    const laps = session["classification-data"][0]!["per-lap-info"]!;
    laps[1]!["max-safety-car-status"] = "FORMATION_LAP";
    return session;
  });

  const result = aggregateFuelData(sessions);
  assert.ok(result);
  assert.equal(result.consecutiveGreenPairCount, 12);
  assert.ok(Math.abs(result.startLapBurnKg - 1.3) < 1e-9);
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
  assert.ok(
    buckets.every((bucket) =>
      bucket.sessions.every(
        (session) => session["session-info"]["total-laps"] === bucket.totalLaps,
      ),
    ),
  );
});

// Eight green laps a distance: under the gate apart, over it pooled.
test("race analysis does not pool below-gate evidence across distances", () => {
  const races = [
    buildAttempt({
      deltas: Array<number>(8).fill(1),
      totalLaps: 10,
    }),
    buildAttempt({
      deltas: Array<number>(8).fill(1),
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

test("Montreal-like dry runs aim for the reserve at the flag", () => {
  // F1 26 at Montreal: 36.8 kg showed -1.03 on the slider (the game counts
  // ~1.083 kg/lap), lap 1 burned ~1.06 kg and later green laps ~0.98 kg.
  const attempts = [20, 18, 9].map((laps) =>
    buildAttempt({
      deltas: Array<number>(laps).fill(0.98),
      startLapKg: 1.06,
      totalLaps: 35,
      startFuelKg: 36.8,
      startFuelRemaining: -1.035,
    }),
  );

  const result = aggregateFuelData(attempts);
  assert.ok(result);
  assert.equal(result.eligibleAttemptCount, 3);
  assert.equal(result.consecutiveGreenPairCount, 47);
  assert.equal(result.confidence, "low");
  const kg = 34.38 * (1 + thin(3)) + FUEL_RESERVE_KG;
  assert.ok(Math.abs(result.avgRecommendedFuelKg - kg) < 1e-9);
  const gameKgPerLap = 36.8 / (35 - 1.035);
  assert.ok(
    Math.abs(result.avgRecommendedFuelLaps - (kg / gameKgPerLap - 35)) < 1e-9,
  );
  // About three laps under the distance: the game counts ~9% more burn.
  assert.ok(Math.abs(result.avgRecommendedFuelLaps - -2.9) < 0.05);
});
