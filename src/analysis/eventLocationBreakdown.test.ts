import assert from "node:assert/strict";
import test from "node:test";
import type { RaceControlEvent } from "../types/telemetry";
import { isPitLaneOvertake } from "../utils/raceControl";
import {
  buildEventLocationBreakdown,
  buildTrackLocationBreakdowns,
  excludePitLaneOvertakes,
  hasLocationBreakdownEvents,
} from "./eventLocationBreakdown";

function event(overrides: Partial<RaceControlEvent> = {}): RaceControlEvent {
  return {
    id: 1,
    "lap-number": 1,
    timestamp: 1,
    "message-type": "OVERTAKE",
    "involved-drivers": [0, 1],
    "lap-distance": 100,
    sector: "S1",
    ...overrides,
  };
}

test("pit-lane overtakes require two disagreeing boolean flags", () => {
  assert.equal(
    isPitLaneOvertake(
      event({ "overtaker-pitting": true, "overtaken-pitting": false }),
    ),
    true,
  );
  assert.equal(
    isPitLaneOvertake(
      event({ "overtaker-pitting": false, "overtaken-pitting": true }),
    ),
    true,
  );

  for (const candidate of [
    event({ "overtaker-pitting": false, "overtaken-pitting": false }),
    event({ "overtaker-pitting": true, "overtaken-pitting": true }),
    event({ "overtaker-pitting": null, "overtaken-pitting": false }),
    event({ "overtaker-pitting": true }),
    event({
      "message-type": "COLLISION",
      "overtaker-pitting": true,
      "overtaken-pitting": false,
    }),
  ]) {
    assert.equal(isPitLaneOvertake(candidate), false);
  }
});

test("default overtake breakdown excludes only detected pit-lane passes", () => {
  const pitPass = event({
    id: 1,
    "overtaker-pitting": true,
    "overtaken-pitting": false,
  });
  const racingPass = event({
    id: 2,
    "overtaker-pitting": false,
    "overtaken-pitting": false,
  });
  const legacyPass = event({ id: 3 });
  const collision = event({ id: 4, "message-type": "COLLISION" });

  const filtered = excludePitLaneOvertakes([
    pitPass,
    racingPass,
    legacyPass,
    collision,
  ]);
  assert.deepEqual(filtered, [racingPass, legacyPass, collision]);
  assert.equal(buildEventLocationBreakdown(filtered, "OVERTAKE").total, 2);
});

test("pit-only data still advertises location charts and keeps raw events", () => {
  const pitPass = event({
    "overtaker-pitting": true,
    "overtaken-pitting": false,
  });

  assert.equal(hasLocationBreakdownEvents([pitPass]), true);
  assert.equal(
    buildEventLocationBreakdown(excludePitLaneOvertakes([pitPass]), "OVERTAKE")
      .total,
    0,
  );

  const track = buildTrackLocationBreakdowns([[pitPass]]);
  assert.equal(track.overtakes.total, 0);
  assert.deepEqual(track.events, [pitPass]);
  assert.equal(hasLocationBreakdownEvents(track.events), true);
  assert.equal(track.locatedRaceCount, 1);
});
