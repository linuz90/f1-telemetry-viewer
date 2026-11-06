import assert from "node:assert/strict";
import test from "node:test";
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

test("matched pace compares same-compound means with shared evidence", () => {
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

test("matched pace uses the Race Pace mean, not the median", () => {
  // Medians would call this a full second; the means the Classification table
  // shows with Medium selected differ by 0.7 s, and the insight must agree.
  const comparison = compareCompoundMatchedRacePace(
    driver("Player", [100_000, 100_000, 100_000, 101_200]),
    driver("Rival", [101_000, 101_000, 101_000, 101_000]),
  );
  assert.ok(comparison);
  assert.equal(comparison.deltaMs, -700);
  assert.deepEqual(comparison.sectorDeltasMs, [0, 0, -700]);
});
