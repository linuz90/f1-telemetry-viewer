import * as assert from "node:assert/strict";
import { test } from "node:test";
import { synthesizeStrategies } from "../src/analysis/trackStrategySynthesis";
import {
  buildStrategyCompoundEvidence,
  findStrategyTyreAllocation,
} from "../src/analysis/trackStrategyEvidence";
import { rankDryCompoundsByPace } from "../src/analysis/trackStrategyCompounds";
import { buildTimingContext } from "../src/analysis/trackStrategyTiming";
import type { BucketRaceEntry } from "../src/analysis/trackStrategyTypes";
import { getActualCompoundLapTimeMultipliers } from "../src/constants/compoundPace";
import { getHarderCompoundWearCalibration } from "../src/constants/compoundWear";
import type {
  DriverData,
  LapHistoryEntry,
  TelemetrySession,
  TyreSetData,
  TyreSetsData,
} from "../src/types/telemetry";
import type { CompoundLifeStats } from "../src/utils/stats/trackAggregates";

function tyreSet(
  visual: string,
  actual: string,
  usableLife: number,
  lapDeltaTime: number,
  wear = 0,
): TyreSetData {
  return {
    "actual-tyre-compound": actual,
    "visual-tyre-compound": visual,
    wear,
    available: true,
    "recommended-session": "Race",
    "life-span": usableLife,
    "usable-life": usableLife,
    "lap-delta-time": lapDeltaTime,
    fitted: false,
  };
}

function packet(rows: TyreSetData[]): TyreSetsData {
  return { "car-index": 0, "fitted-index": 0, "tyre-set-data": rows };
}

function completeLap(timeMs: number): LapHistoryEntry {
  return {
    "lap-time-in-ms": timeMs,
    "lap-time-str": "1:30.000",
    "sector-1-time-in-ms": 30_000,
    "sector-1-time-str": "30.000",
    "sector-2-time-in-ms": 30_000,
    "sector-2-time-str": "30.000",
    "sector-3-time-in-ms": timeMs - 60_000,
    "sector-3-time-str": "30.000",
    "lap-valid-bit-flags": 15,
  };
}

function entryWithPacket(
  tyreSets: TyreSetsData,
  formula = "F1 Modern",
  gameYear = 25,
): BucketRaceEntry {
  const player = {
    "is-player": true,
    "tyre-sets": tyreSets,
    "per-lap-info": [
      {
        "lap-number": 0,
        "max-safety-car-status": "NO_SAFETY_CAR",
        "tyre-sets-data": tyreSets,
      },
    ],
    "tyre-set-history": [],
    "session-history": {
      "num-laps": 4,
      "lap-history-data": [
        completeLap(90_000),
        completeLap(90_100),
        completeLap(90_000),
        completeLap(89_900),
      ],
      "tyre-stints-history-data": [],
    },
    "final-classification": null,
  } as unknown as DriverData;
  const session = {
    "session-info": {
      "session-type": "Race",
      "track-id": "monza",
      "total-laps": 20,
      formula,
    },
    "classification-data": [player],
    "game-year": gameYear,
    version: "test",
  } as unknown as TelemetrySession;

  return {
    session,
    player,
    totalLaps: 20,
    isFullDistance: false,
  };
}

function observedStat(compound: string, wearRate: number): CompoundLifeStats {
  return {
    compound,
    avgWearRatePerLap: wearRate,
    estMaxLife: Math.round(75 / wearRate),
    avgStintLength: 10,
    longestStint: 12,
    stintCount: 1,
    bestLapMs: 90_000,
    samples: [],
  };
}

const f125Allocation = packet([
  tyreSet("Soft", "C4", 10, -500),
  tyreSet("Medium", "C3", 15, 0),
  tyreSet("Hard", "C2", 20, 600),
]);

test("rounded per-game pace priors compose skipped allocations", () => {
  const f125 = getActualCompoundLapTimeMultipliers("f1-25");
  assert.ok(f125);
  assert.ok(
    Math.abs(f125.get("C1")! / f125.get("C3")! - 1 - 0.01304225) < 1e-9,
  );

  const f126 = getActualCompoundLapTimeMultipliers("f1-26");
  assert.ok(f126);
  assert.ok(f125.has("C6"));
  assert.ok(
    Math.abs(f125.get("C1")! / f125.get("C6")! - 1 - 0.0329252552) < 1e-9,
  );
  assert.ok(
    Math.abs(f126.get("C1")! / f126.get("C3")! - 1 - 0.01103025) < 1e-9,
  );
  assert.equal(f126.has("C6"), false);
  assert.equal(getActualCompoundLapTimeMultipliers("f2-25"), null);
  assert.ok(
    Math.abs(getHarderCompoundWearCalibration("f1-25", "C4", "C2")! - 0.6552) <
      1e-9,
  );
  assert.equal(getHarderCompoundWearCalibration("f1-25", "C2", "C3"), null);
});

test("fresh tyre-set rows beat a worn fitted duplicate", () => {
  const entry = entryWithPacket(
    packet([
      tyreSet("Soft", "C4", 10, -500),
      tyreSet("Medium", "C3", 15, 0, 32),
      tyreSet("Medium", "C3", 15, -50),
      tyreSet("Hard", "C2", 20, 600),
    ]),
  );

  const allocation = findStrategyTyreAllocation([entry]);
  assert.ok(allocation);
  assert.equal(allocation.compounds.get("Medium")?.wear, 0);
  assert.equal(allocation.packetPaceOffsetsMs?.get("Medium"), 450);
});

test("worn allocation rows cannot claim fresh packet pace", () => {
  const entry = entryWithPacket(
    packet([
      tyreSet("Soft", "C4", 10, -500, 1),
      tyreSet("Medium", "C3", 15, 0, 1),
      tyreSet("Hard", "C2", 20, 600, 1),
    ]),
  );

  assert.equal(findStrategyTyreAllocation([entry])?.packetPaceOffsetsMs, null);
});

test("packet pace rejects malformed compound ordering and deltas", () => {
  const malformedPackets = [
    packet([
      tyreSet("Soft", "C4", 10, 0),
      tyreSet("Medium", "C3", 15, 0),
      tyreSet("Hard", "C2", 20, 0),
    ]),
    packet([
      tyreSet("Soft", "C4", 10, 600),
      tyreSet("Medium", "C3", 15, 0),
      tyreSet("Hard", "C2", 20, -500),
    ]),
    packet([
      tyreSet("Soft", "C4", 10, -500),
      tyreSet("Medium", "C4", 15, 0),
      tyreSet("Hard", "C2", 20, 600),
    ]),
    packet([
      tyreSet("Soft", "C4", 10, -500),
      tyreSet("Medium", "C3", 15, 0),
      tyreSet("Hard", "C2", 20, 5_000),
    ]),
  ];

  for (const tyreSets of malformedPackets) {
    assert.equal(
      findStrategyTyreAllocation([entryWithPacket(tyreSets)])
        ?.packetPaceOffsetsMs ?? null,
      null,
    );
  }
});

test("fresh packet pace wins over a newer worn usable-life packet", () => {
  const fresh = entryWithPacket(f125Allocation);
  const worn = entryWithPacket(
    packet([
      tyreSet("Soft", "C4", 10, -500, 2),
      tyreSet("Medium", "C3", 15, 0, 2),
      tyreSet("Hard", "C2", 20, 600, 2),
    ]),
  );

  assert.equal(
    findStrategyTyreAllocation([fresh, worn])?.packetPaceOffsetsMs?.get("Hard"),
    1_100,
  );
});

test("duplicate fresh tyre sets use their median packet delta", () => {
  const entry = entryWithPacket(
    packet([
      tyreSet("Soft", "C4", 10, -500),
      tyreSet("Medium", "C3", 15, -100),
      tyreSet("Medium", "C3", 15, 100),
      tyreSet("Medium", "C3", 15, 0),
      tyreSet("Hard", "C2", 20, 600),
    ]),
  );

  const allocation = findStrategyTyreAllocation([entry]);
  assert.equal(allocation?.compounds.get("Medium")?.["lap-delta-time"], 0);
  assert.equal(allocation?.packetPaceOffsetsMs?.get("Medium"), 500);
});

test("one observed compound infers missing wear without mutating observations", () => {
  const medium = observedStat("Medium", 4);
  const evidence = buildStrategyCompoundEvidence(
    [medium],
    [entryWithPacket(f125Allocation)],
  );

  assert.equal(evidence.compounds.length, 2);
  assert.deepEqual([...evidence.inferredCompounds], ["Hard"]);
  assert.ok(
    Math.abs(
      evidence.compounds.find((stat) => stat.compound === "Hard")!
        .avgWearRatePerLap - 2.52,
    ) < 1e-9,
  );
  assert.equal(medium.stintCount, 1);
  assert.equal(medium.avgWearRatePerLap, 4);
});

test("two observed compounds preserve the existing strategy evidence", () => {
  const evidence = buildStrategyCompoundEvidence(
    [observedStat("Medium", 4), observedStat("Hard", 3)],
    [entryWithPacket(f125Allocation)],
  );

  assert.equal(evidence.compounds.length, 2);
  assert.equal(evidence.inferredCompounds.size, 0);
});

test("hard-only evidence abstains instead of inferring unvalidated softer wear", () => {
  const evidence = buildStrategyCompoundEvidence(
    [observedStat("Hard", 3)],
    [entryWithPacket(f125Allocation)],
  );

  assert.equal(evidence.compounds.length, 1);
  assert.equal(evidence.inferredCompounds.size, 0);
});

test("soft-only evidence abstains until its wear transfer is validated", () => {
  const evidence = buildStrategyCompoundEvidence(
    [observedStat("Soft", 5)],
    [entryWithPacket(f125Allocation)],
  );

  assert.equal(evidence.compounds.length, 1);
  assert.equal(evidence.inferredCompounds.size, 0);
});

test("two observed compounds preserve synthesized strategy output", () => {
  const withPacket = entryWithPacket(f125Allocation);
  const withoutPacket = structuredClone(withPacket);
  delete withoutPacket.player["tyre-sets"];
  withoutPacket.player["per-lap-info"] = [];
  const stats = [observedStat("Medium", 4), observedStat("Hard", 3)];

  assert.deepEqual(
    synthesizeStrategies(stats, 20, 1, 0, [withPacket], [withPacket]),
    synthesizeStrategies(stats, 20, 1, 0, [withoutPacket], [withoutPacket]),
  );
});

test("sparse strategy uses packet pace and exposes low-confidence inference", () => {
  const entry = entryWithPacket(f125Allocation);
  const result = synthesizeStrategies(
    [observedStat("Medium", 4)],
    20,
    1,
    0,
    [entry],
    [entry],
  );

  assert.ok(result.recommended);
  assert.ok(result.recommended.evidence?.inferredCompounds.length);
  assert.equal(result.recommended.pitWindows.length, 1);
  assert.equal(result.recommended.timeEstimate?.confidence, "low");
  assert.match(
    result.recommended.timeEstimate?.details?.wearSource ?? "",
    /actual-compound calibration/,
  );
  assert.equal(
    result.recommended.timeEstimate?.details?.paceSource,
    "same-bucket fresh Tyre Sets packet",
  );
});

test("rounded priors backfill pace when the packet omits deltas", () => {
  const noDeltas = packet([
    tyreSet("Soft", "C4", 10, Number.NaN),
    tyreSet("Medium", "C3", 15, Number.NaN),
    tyreSet("Hard", "C2", 20, Number.NaN),
  ]);
  const entry = entryWithPacket(noDeltas);
  const result = synthesizeStrategies(
    [observedStat("Medium", 4)],
    20,
    1,
    0,
    [entry],
    [entry],
  );

  assert.ok(result.recommended);
  assert.equal(
    result.recommended.timeEstimate?.details?.paceSource,
    "f1-25 actual-compound pace prior",
  );
  assert.equal(result.recommended.timeEstimate?.confidence, "low");
});

test("rounded priors produce the expected adjacent pace gap per game", () => {
  for (const { formula, gameYear, expectedGapMs } of [
    { formula: "F1 Modern", gameYear: 25, expectedGapMs: 585 },
    { formula: "F1 26", gameYear: 26, expectedGapMs: 495 },
  ]) {
    const noDeltas = packet([
      tyreSet("Soft", "C4", 10, Number.NaN),
      tyreSet("Medium", "C3", 15, Number.NaN),
      tyreSet("Hard", "C2", 20, Number.NaN),
    ]);
    const entry = entryWithPacket(noDeltas, formula, gameYear);
    const evidence = buildStrategyCompoundEvidence(
      [observedStat("Medium", 4)],
      [entry],
    );
    const context = buildTimingContext(
      [entry],
      [entry],
      rankDryCompoundsByPace(evidence.compounds),
      evidence,
    );

    assert.ok(context);
    assert.ok(
      Math.abs(
        context.paceModel.offsetsMs.get("Hard")! -
          context.paceModel.offsetsMs.get("Medium")! -
          expectedGapMs,
      ) < 1e-9,
    );
  }
});

test("sparse evidence abstains when neither packet nor prior pace is usable", () => {
  const noDeltas = packet([
    tyreSet("Soft", "C4", 10, Number.NaN),
    tyreSet("Medium", "C3", 15, Number.NaN),
    tyreSet("Hard", "C2", 20, Number.NaN),
  ]);
  const entry = entryWithPacket(noDeltas);
  entry.player["session-history"]["lap-history-data"] = [];

  const result = synthesizeStrategies(
    [observedStat("Medium", 4)],
    20,
    1,
    0,
    [entry],
    [entry],
  );

  assert.equal(result.recommended, null);
  assert.equal(result.alternative, null);
});

test("non-F1 allocations do not synthesize missing compounds", () => {
  const entry = entryWithPacket(f125Allocation, "F2", 25);
  const evidence = buildStrategyCompoundEvidence(
    [observedStat("Medium", 4)],
    [entry],
  );

  assert.equal(evidence.compounds.length, 1);
  assert.equal(evidence.inferredCompounds.size, 0);
});
