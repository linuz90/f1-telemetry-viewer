import assert from "node:assert/strict";
import test from "node:test";
import type { CarSetup } from "../src/types/telemetry";
import type { TrackStrategySuggestion } from "../src/analysis/trackStrategyTypes";
import { formatSetupText, formatStrategyText } from "../src/analysis/shareText";

const setup: CarSetup = {
  "front-wing": 20,
  "rear-wing": 25,
  "on-throttle": 100,
  "off-throttle": 50,
  "front-camber": -3.5,
  "rear-camber": -1.9999999,
  "front-toe": 0.05,
  "rear-toe": 0.2,
  "front-suspension": 41,
  "rear-suspension": 1,
  "front-anti-roll-bar": 21,
  "rear-anti-roll-bar": 1,
  "front-suspension-height": 20,
  "rear-suspension-height": 45,
  "brake-pressure": 100,
  "brake-bias": 55,
  "engine-braking": 0,
  "rear-left-tyre-pressure": 26.5,
  "rear-right-tyre-pressure": 26.5,
  "front-left-tyre-pressure": 29.5,
  "front-right-tyre-pressure": 29.5,
  ballast: 0,
  "fuel-load": 12,
  "is-valid": true,
};

test("setup text uses creator shorthand with slider-end labels", () => {
  assert.equal(
    formatSetupText({
      ...setup,
      "front-wing": 45,
      "rear-wing": 0,
      "off-throttle": 80,
      "front-anti-roll-bar": 10,
      "rear-anti-roll-bar": 14,
      "front-suspension-height": 24,
      "rear-suspension-height": 42,
      "brake-bias": 58,
      "front-toe": 0,
      "rear-toe": 0.1,
      "rear-left-tyre-pressure": 20.5,
      "rear-right-tyre-pressure": 20.5,
    }),
    `Aerodynamics: 45-0
Transmission: 100-80
Suspension Geometry: L-L-L-L
Suspension: 41-1 10-14 24-42
Brake Bias: 58-100
Tyres: MAX-MIN`,
  );
});

test("setup text prints values between slider ends", () => {
  const text = formatSetupText({
    ...setup,
    "front-camber": -3.3,
    "rear-toe": 0.15,
    "front-left-tyre-pressure": 26,
    "front-right-tyre-pressure": 26.4,
  });
  assert.match(text, /Suspension Geometry: -3\.30-L-0\.05-0\.15/);
  assert.match(text, /Tyres: 26\.0\/26\.4-MAX/);
});

function strategy(
  overrides: Partial<TrackStrategySuggestion>,
): TrackStrategySuggestion {
  return {
    compounds: ["Medium", "Hard"],
    stintLaps: [15, 18],
    stintWearPercentages: [62.4, 70],
    pitWindows: [{ earliest: 14, latest: 16, target: 15 }],
    raceCount: 3,
    fullDistanceRaceCount: 3,
    isEvidenceBacked: true,
    ...overrides,
  };
}

test("strategy text lists the pit window and stints", () => {
  assert.equal(
    formatStrategyText(strategy({}), 33),
    `Race strategy · 33 laps

Medium → Hard (Pit lap 14–16, ideal 15)
Stint 1: Medium, laps 1–15 (15 laps, 62% wear)
Stint 2: Hard, laps 16–33 (18 laps, 70% wear)`,
  );
});

test("strategy text joins multi-stop windows", () => {
  const text = formatStrategyText(
    strategy({
      compounds: ["Soft", "Medium", "Medium"],
      stintLaps: [8, 12, 13],
      stintWearPercentages: [55, 60, 0],
      pitWindows: [
        { earliest: 7, latest: 9, target: 8 },
        { earliest: 19, latest: 21, target: 20 },
      ],
    }),
    33,
  );
  assert.match(
    text,
    /Soft → Medium → Medium \(Pit laps 7–9 & 19–21, ideal 8 & 20\)/,
  );
  assert.match(text, /Stint 3: Medium, laps 21–33 \(13 laps\)$/);
});
