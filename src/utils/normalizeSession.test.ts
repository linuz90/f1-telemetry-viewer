import assert from "node:assert/strict";
import test from "node:test";
import type { SessionHistory, TelemetrySession } from "../types/telemetry";
import { normalizeSession } from "./normalizeSession";

const existingHistory: SessionHistory = {
  "num-laps": 1,
  "num-tyre-stints": 0,
  "best-lap-time-lap-num": 1,
  "best-sector-1-lap-num": 1,
  "best-sector-2-lap-num": 1,
  "best-sector-3-lap-num": 1,
  "lap-history-data": [],
  "tyre-stints-history-data": [],
};

test("normalization fills missing driver history once and preserves valid data", () => {
  const session = {
    "classification-data": [
      { "session-history": null },
      { "session-history": undefined },
      { "session-history": existingHistory },
    ],
  } as unknown as TelemetrySession;

  assert.equal(normalizeSession(session), session);
  assert.deepEqual(session["classification-data"][0]["session-history"], {
    "num-laps": 0,
    "num-tyre-stints": 0,
    "best-lap-time-lap-num": 0,
    "best-sector-1-lap-num": 0,
    "best-sector-2-lap-num": 0,
    "best-sector-3-lap-num": 0,
    "lap-history-data": [],
    "tyre-stints-history-data": [],
  });
  assert.notEqual(
    session["classification-data"][0]["session-history"],
    session["classification-data"][1]["session-history"],
  );
  assert.equal(
    session["classification-data"][2]["session-history"],
    existingHistory,
  );

  const normalizedHistory =
    session["classification-data"][0]["session-history"];
  normalizeSession(session);
  assert.equal(
    session["classification-data"][0]["session-history"],
    normalizedHistory,
  );
});
