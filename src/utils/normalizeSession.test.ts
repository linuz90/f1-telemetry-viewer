import assert from "node:assert/strict";
import test from "node:test";
import { PNG_TURN_FIXES } from "../constants/pngTurnFixes";
import type {
  RaceControlEvent,
  RaceControlSegmentInfo,
  SessionHistory,
  TelemetrySession,
} from "../types/telemetry";
import { normalizeSession } from "./normalizeSession";
import { formatRaceControlLocation } from "./raceControl";
import { getTrackCorners } from "./tracks";

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

function raceWith(
  track: string,
  trackLength: number,
  located: [lapDistance: number, segment: RaceControlSegmentInfo | null][],
): TelemetrySession {
  const events = located.map(
    ([distance, segment], id) =>
      ({
        id,
        "lap-number": 2,
        timestamp: id,
        "message-type": "OVERTAKE",
        "involved-drivers": [0, 1],
        "lap-distance": distance,
        sector: "S3",
        "segment-info": segment,
      }) as RaceControlEvent,
  );
  return {
    "session-info": { "track-id": track, "track-length": trackLength },
    "classification-data": [],
    "race-control": events,
  } as unknown as TelemetrySession;
}

function locations(session: TelemetrySession): (string | null)[] {
  return (session["race-control"] ?? []).map(formatRaceControlLocation);
}

test("Melbourne's pre-2022 turn numbers read as the official ones", () => {
  const session = raceWith("Melbourne", 5276, [
    [100, { type: "straight", name: "Pit Straight" }],
    [1000, { type: "corner", name: "", corner_number: 3 }],
    [2450, { type: "corner", name: "Clark", corner_number: 9 }],
    [4100, { type: "corner", name: "Ascari", corner_number: 13 }],
    [4600, { type: "corner", name: "Prost", corner_number: 15 }],
    [4800, { type: "corner", name: "", corner_number: 16 }],
  ]);
  normalizeSession(session);
  assert.deepEqual(locations(session), [
    "Pit Straight",
    "T3",
    // The old chicane is flat now: no turn, so the sector.
    "Sector 3",
    "T11 - Ascari",
    "T13 - Prost",
    "T14",
  ]);
});

test("exports with the corrected numbering read the same, and twice is once", () => {
  const corrected = raceWith("Melbourne", 5276, [
    [4100, { type: "corner", name: "Ascari", corner_number: 11 }],
    [4600, { type: "corner", name: "Prost", corner_number: 13 }],
    [2450, null],
  ]);
  normalizeSession(corrected);
  normalizeSession(corrected);
  assert.deepEqual(locations(corrected), [
    "T11 - Ascari",
    "T13 - Prost",
    "Sector 3",
  ]);
});

test("Montreal's repeated Turn 5 and final chicane read as the official ones", () => {
  const session = raceWith("Montreal", 4371, [
    [1000, { type: "corner", name: "", corner_number: 5 }],
    [1200, { type: "corner", name: "", corner_number: 5 }],
    [1400, { type: "corner", name: "", corner_number: 6 }],
    [1500, { type: "corner", name: "", corner_number: 7 }],
    [
      3900,
      { type: "corner", name: "Wall Of Champions", corner_numbers: [12, 13] },
    ],
  ]);
  normalizeSession(session);
  assert.deepEqual(locations(session), [
    "T5",
    "T6",
    "T7",
    "T7",
    "T13-14 - Wall Of Champions",
  ]);
});

test("other tracks and other layout lengths keep the exporter's numbers", () => {
  const prost = { type: "corner", name: "Prost", corner_number: 15 } as const;
  const otherLayout = raceWith("Melbourne", 5303, [[4600, { ...prost }]]);
  const otherTrack = raceWith("Spa", 7004, [[4600, { ...prost }]]);
  normalizeSession(otherLayout);
  normalizeSession(otherTrack);
  assert.deepEqual(locations(otherLayout), ["T15 - Prost"]);
  assert.deepEqual(locations(otherTrack), ["T15 - Prost"]);
});

test("turn fixes agree with the official turn markers", () => {
  for (const [trackId, { trackLengthM, fixes }] of Object.entries(
    PNG_TURN_FIXES,
  )) {
    const corners = getTrackCorners(trackId, trackLengthM);
    for (const { fromM, toM, turns } of fixes) {
      const where = `${trackId} ${fromM}-${toM}`;
      const inside = corners
        .filter(({ distanceM }) => distanceM >= fromM && distanceM < toM)
        .map(({ number }) => number);
      assert.ok(
        inside.every((number) => turns?.includes(number)),
        `${where} holds T${inside}`,
      );
      // Markers come from real reference laps and can sit ~40 m off.
      for (const number of turns ?? []) {
        const { distanceM } = corners[number - 1];
        assert.ok(distanceM >= fromM - 40 && distanceM < toM + 40, where);
      }
    }
  }
});
