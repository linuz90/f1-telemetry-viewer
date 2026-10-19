import assert from "node:assert/strict";
import test from "node:test";
import {
  buildRaceDriverStats,
  listRacePaceCompounds,
} from "../src/analysis/resultsAnalysis";
import type { SessionSpeedAnalysis } from "../src/analysis/speedAnalysis";
import type {
  DriverData,
  LapHistoryEntry,
  TelemetrySession,
} from "../src/types/telemetry";

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

interface StintSpec {
  compound: string;
  timesMs: number[];
}

/** Lap 1 is a slow standing start; each stint follows with its own laps. */
function driver(index: number, stints: StintSpec[]): DriverData {
  const laps = [lap(110_000)];
  const compact: { "tyre-visual-compound": string; "end-lap": number }[] = [];
  for (const stint of stints) {
    laps.push(...stint.timesMs.map(lap));
    compact.push({
      "tyre-visual-compound": stint.compound,
      "end-lap": laps.length,
    });
  }
  return {
    index,
    "driver-name": `Driver ${index}`,
    team: "Test Team",
    "is-player": index === 0,
    "session-history": {
      "num-laps": laps.length,
      "num-tyre-stints": stints.length,
      "best-lap-time-lap-num": 0,
      "best-sector-1-lap-num": 0,
      "best-sector-2-lap-num": 0,
      "best-sector-3-lap-num": 0,
      "lap-history-data": laps,
      "tyre-stints-history-data": compact.map((entry) => ({
        "tyre-actual-compound": "C3",
        ...entry,
      })),
    },
    "per-lap-info": [],
  } as unknown as DriverData;
}

const noSpeed = { profiles: new Map() } as unknown as SessionSpeedAnalysis;

function race(drivers: DriverData[]): TelemetrySession {
  return { "classification-data": drivers } as unknown as TelemetrySession;
}

const session = race([
  driver(0, [
    { compound: "Medium", timesMs: [92_000, 92_200, 92_400, 92_600, 92_800] },
  ]),
  driver(1, [
    { compound: "Soft", timesMs: [91_000, 91_200, 91_400, 91_600, 91_800] },
  ]),
  driver(2, [
    { compound: "Medium", timesMs: [92_500, 92_700, 92_900, 93_100, 93_300] },
  ]),
]);

test("classification compounds are those someone could get a Race Pace on, softest first", () => {
  assert.deepEqual(listRacePaceCompounds(session), ["Soft", "Medium"]);
  // A two-lap stint is not enough to filter by.
  const short = race([
    driver(0, [{ compound: "Hard", timesMs: [93_000, 93_100] }]),
    driver(1, [{ compound: "Medium", timesMs: [92_000, 92_100, 92_200] }]),
  ]);
  assert.deepEqual(listRacePaceCompounds(short), ["Medium"]);
});

test("a selected compound scopes Best Lap and Race Pace to that compound's laps", () => {
  const all = buildRaceDriverStats(session, noSpeed);
  assert.ok((all.get(1)?.racePace ?? 0) > 0);

  const medium = buildRaceDriverStats(session, noSpeed, "Medium");
  const player = medium.get(0)!;
  const softRunner = medium.get(1)!;
  const rival = medium.get(2)!;

  assert.equal(player.bestLap, 92_000);
  assert.equal(rival.bestLap, 92_500);
  assert.ok(player.racePace > 0 && rival.racePace > 0);
  assert.equal(rival.racePace - player.racePace, 500);
  // The Soft runner has nothing on Mediums: no value, so no misleading rank.
  assert.equal(softRunner.bestLap, 0);
  assert.equal(softRunner.racePace, 0);
  assert.equal(softRunner.racePaceLapCount, 0);
  assert.equal(softRunner.racePaceRankEligible, false);
});

test("a late stop's out-lap is not a best lap on the new compound", () => {
  const lateStop = race([
    driver(0, [{ compound: "Hard", timesMs: [93_000, 93_100, 93_200] }]),
    driver(1, [
      { compound: "Soft", timesMs: [91_000, 91_100, 91_200, 91_300] },
      { compound: "Hard", timesMs: [112_000] },
    ]),
  ]);
  const hard = buildRaceDriverStats(lateStop, noSpeed, "Hard");
  assert.equal(hard.get(0)?.bestLap, 93_000);
  assert.equal(hard.get(1)?.bestLap, 0);
});
