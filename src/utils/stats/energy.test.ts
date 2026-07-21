import * as assert from "node:assert/strict";
import { test } from "node:test";
import type {
  DriverData,
  PerLapInfo,
  TelemetrySession,
} from "../../types/telemetry";
import { curateSessionInsights } from "../../analysis/sessionInsightCuration";
import { generateFuelMarginInsight } from "./energy";

interface FuelLapOptions {
  fuelKg: number;
  lap: number;
  remainingLaps: number;
  safetyCar?: PerLapInfo["max-safety-car-status"];
}

function fuelLap(options: FuelLapOptions): PerLapInfo {
  return {
    "lap-number": options.lap,
    "max-safety-car-status": options.safetyCar ?? "NO_SAFETY_CAR",
    "car-status-data": {
      "fuel-in-tank": options.fuelKg,
      "fuel-remaining-laps": options.remainingLaps,
    },
  } as PerLapInfo;
}

function playerWithFuel(
  laps: PerLapInfo[],
  resultStatus?: string,
  classifiedLaps = 0,
): DriverData {
  return {
    "is-player": true,
    "per-lap-info": laps,
    "session-history": {
      "num-laps": 0,
      "lap-history-data": [],
      "tyre-stints-history-data": [],
    },
    "tyre-set-history": [],
    "final-classification": resultStatus
      ? { "result-status": resultStatus, "num-laps": classifiedLaps }
      : null,
  } as unknown as DriverData;
}

test("completed sessions report the game's final fuel margin", () => {
  const insight = generateFuelMarginInsight(
    playerWithFuel(
      [
        fuelLap({ fuelKg: 10, lap: 0, remainingLaps: -1 }),
        fuelLap({ fuelKg: 8.5, lap: 1, remainingLaps: -0.8 }),
        fuelLap({ fuelKg: 7, lap: 2, remainingLaps: -0.3 }),
        fuelLap({ fuelKg: 5.5, lap: 3, remainingLaps: 0.3 }),
      ],
      "FINISHED",
    ),
    3,
  );

  assert.deepEqual(insight, {
    type: "fuel",
    label: "Fuel Margin",
    value: "+0.3 laps",
    detail: "game estimate at finish",
    extraDetails: [
      "5.5 kg in tank · 10.0 kg at start",
      "Median green burn 1.50 kg/lap · 3 green pairs",
    ],
  });
});

test("partial sessions project the margin from the last snapshot", () => {
  const insight = generateFuelMarginInsight(
    playerWithFuel([
      fuelLap({ fuelKg: 10, lap: 0, remainingLaps: -1 }),
      fuelLap({ fuelKg: 8.5, lap: 1, remainingLaps: -0.4 }),
      fuelLap({ fuelKg: 7, lap: 2, remainingLaps: -0.1 }),
    ]),
    22,
  );

  assert.deepEqual(insight, {
    type: "fuel",
    label: "Fuel Margin",
    value: "-0.1 laps",
    detail: "game projection from lap 2/22",
    extraDetails: ["7.0 kg in tank · 10.0 kg at start"],
  });
});

test("zero fuel is a valid finish outcome", () => {
  const insight = generateFuelMarginInsight(
    playerWithFuel(
      [
        fuelLap({ fuelKg: 3, lap: 0, remainingLaps: -0.5 }),
        fuelLap({ fuelKg: 1.5, lap: 1, remainingLaps: -0.2 }),
        fuelLap({ fuelKg: 0, lap: 2, remainingLaps: 0.1 }),
      ],
      "FINISHED",
    ),
    2,
  );

  assert.equal(insight?.value, "+0.1 laps");
  assert.equal(insight?.detail, "game estimate at finish");
  assert.equal(insight?.extraDetails?.[0], "0.0 kg in tank · 3.0 kg at start");
});

test("finished classification does not hide a missing final snapshot", () => {
  const insight = generateFuelMarginInsight(
    playerWithFuel(
      [
        fuelLap({ fuelKg: 10, lap: 0, remainingLaps: -1 }),
        fuelLap({ fuelKg: 4, lap: 20, remainingLaps: -0.4 }),
      ],
      "FINISHED",
    ),
    22,
  );

  assert.equal(insight?.detail, "game projection from lap 20/22");
});

test("official completed laps recognize lapped or shortened finishers", () => {
  const insight = generateFuelMarginInsight(
    playerWithFuel(
      [
        fuelLap({ fuelKg: 10, lap: 0, remainingLaps: -1 }),
        fuelLap({ fuelKg: 1, lap: 21, remainingLaps: 0.2 }),
      ],
      "FINISHED",
      21,
    ),
    22,
  );

  assert.equal(insight?.detail, "game estimate at finish");
});

test("late-start exports report the margin without inventing a start", () => {
  const insight = generateFuelMarginInsight(
    playerWithFuel([
      fuelLap({ fuelKg: 10, lap: 13, remainingLaps: -0.4 }),
      fuelLap({ fuelKg: 8, lap: 14, remainingLaps: -0.2 }),
    ]),
    22,
  );

  assert.equal(insight?.value, "-0.2 laps");
  assert.equal(insight?.detail, "game projection from lap 14/22");
  assert.deepEqual(insight?.extraDetails, ["8.0 kg in tank"]);
});

test("lap zero alone cannot describe a fuel outcome", () => {
  assert.equal(
    generateFuelMarginInsight(
      playerWithFuel([fuelLap({ fuelKg: 10, lap: 0, remainingLaps: -1 })]),
      22,
    ),
    null,
  );
});

test("restricted all-zero telemetry cannot invent a fuel margin", () => {
  const insight = generateFuelMarginInsight(
    playerWithFuel([
      fuelLap({ fuelKg: 0, lap: 0, remainingLaps: 0 }),
      fuelLap({ fuelKg: 0, lap: 1, remainingLaps: 0 }),
      fuelLap({ fuelKg: 0, lap: 2, remainingLaps: 0 }),
    ]),
    22,
  );

  assert.equal(insight, null);
});

test("missing game margin keeps kilograms as supporting data", () => {
  const insight = generateFuelMarginInsight(
    playerWithFuel([
      fuelLap({ fuelKg: 10, lap: 0, remainingLaps: -1 }),
      fuelLap({ fuelKg: 8, lap: 1, remainingLaps: Number.NaN }),
    ]),
    22,
  );

  assert.equal(insight?.value, "—");
  assert.equal(insight?.detail, "projection unavailable from lap 1/22");
  assert.deepEqual(insight?.extraDetails, [
    "8.0 kg in tank · 10.0 kg at start",
  ]);
});

test("session curation keeps Fuel Margin descriptive", () => {
  const session = {
    "session-info": { "session-type": "Race", "total-laps": 22 },
  } as TelemetrySession;
  const fuelMargin = generateFuelMarginInsight(
    playerWithFuel([
      fuelLap({ fuelKg: 10, lap: 0, remainingLaps: -1 }),
      fuelLap({ fuelKg: 8.5, lap: 1, remainingLaps: -0.8 }),
    ]),
    22,
  );
  assert.ok(fuelMargin);

  const curated = curateSessionInsights(session, [fuelMargin]);

  assert.deepEqual(curated, [fuelMargin]);
  assert.equal(
    curated.some((insight) => insight.label === "Fuel Plan"),
    false,
  );
  assert.equal(
    curated.some((insight) => insight.label === "Recommended Fuel"),
    false,
  );
});
