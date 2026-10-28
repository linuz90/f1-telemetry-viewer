import assert from "node:assert/strict";
import test from "node:test";
import type {
  DriverData,
  LapHistoryEntry,
  SessionSummary,
  TelemetrySession,
  TyreStint,
} from "../src/types/telemetry";
import { sessionKind, summaryKind } from "../src/analysis/sessionKind";
import { buildSessionLog } from "../src/analysis/sessionLog";
import {
  buildRaceStory,
  buildRaceHeadline,
  significantMoments,
} from "../src/analysis/raceStory";
import { buildOnlineForm } from "../src/analysis/onlineForm";
import { buildQualiSummary, qualiHeadline } from "../src/analysis/worthALook";
import { getDriverStints } from "../src/utils/stats/tyres";

function summary(overrides: Partial<SessionSummary>): SessionSummary {
  return {
    relativePath: `${overrides.slug ?? "s"}.json`,
    slug: "s",
    sessionType: "Race",
    track: "Sakhir",
    formula: "F1 26",
    gameYear: 25,
    date: "2026-10-26T18:00:00",
    validLapCount: 10,
    isOnline: false,
    ...overrides,
  };
}

test("an offline race saved before the flag is a long run, a classified one a race", () => {
  const partial = summary({
    playerRaceResult: {
      position: 1,
      playerLaps: 10,
      totalLaps: 29,
      fieldSize: 22,
    },
  });
  assert.equal(summaryKind(partial), "long-run");
  assert.equal(
    summaryKind(
      summary({
        playerRaceResult: {
          position: 3,
          status: "FINISHED",
          playerLaps: 29,
          totalLaps: 29,
          fieldSize: 22,
        },
      }),
    ),
    "race",
  );
  // A retirement is still a result.
  assert.equal(
    summaryKind(
      summary({
        playerRaceResult: {
          position: 22,
          status: "DID_NOT_FINISH",
          playerLaps: 2,
          totalLaps: 10,
          fieldSize: 22,
        },
      }),
    ),
    "race",
  );
  // Online races are results even when the save has no final status.
  assert.equal(summaryKind({ ...partial, isOnline: true }), "race");
  assert.equal(
    summaryKind(summary({ sessionType: "Time Trial" })),
    "time-trial",
  );
  assert.equal(
    summaryKind(summary({ sessionType: "Short Qualifying" })),
    "qualifying",
  );
});

test("the session log puts a day's online event first and folds offline runs per track", () => {
  const days = buildSessionLog([
    summary({
      slug: "q-offline",
      sessionType: "Short Qualifying",
      date: "2026-10-26T18:00:00",
      aiDifficulty: 110,
      bestLapTimeMs: 87_151,
    }),
    summary({
      slug: "q-offline-2",
      sessionType: "Short Qualifying",
      date: "2026-10-26T19:00:00",
      aiDifficulty: 110,
      bestLapTimeMs: 87_262,
    }),
    summary({
      slug: "q-online",
      sessionType: "Short Qualifying",
      date: "2026-10-26T21:29:00",
      isOnline: true,
      classifiedDriverCount: 21,
      bestLapTimeMs: 87_320,
    }),
    summary({
      slug: "r-online",
      date: "2026-10-26T22:36:00",
      isOnline: true,
      classifiedDriverCount: 21,
      playerRaceResult: {
        position: 7,
        status: "FINISHED",
        playerLaps: 29,
        totalLaps: 29,
        fieldSize: 21,
      },
    }),
    summary({
      slug: "older",
      sessionType: "Short Qualifying",
      date: "2026-10-24T19:00:00",
      aiDifficulty: 110,
    }),
  ]);
  assert.deepEqual(
    days.map((d) => d.key),
    ["2026-10-26", "2026-10-24"],
  );
  const [event, practice] = days[0].groups;
  assert.equal(event.online, true);
  assert.deepEqual(
    event.sessions.map((s) => s.slug),
    ["r-online", "q-online"],
  );
  assert.equal(event.driverCount, 21);
  assert.equal(practice.online, false);
  assert.equal(practice.offlineLabel, "AI 110");
  assert.equal(practice.counts.qualifying, 2);
  assert.equal(practice.bestMs.qualifying, 87_151);
});

// --- Race story fixtures -----------------------------------------------------

function lap(timeMs = 90_000): LapHistoryEntry {
  return {
    "lap-time-in-ms": timeMs,
    "lap-time-str": "",
    "sector-1-time-in-ms": 30_000,
    "sector-1-time-str": "",
    "sector-2-time-in-ms": 30_000,
    "sector-2-time-str": "",
    "sector-3-time-in-ms": timeMs - 60_000,
    "sector-3-time-str": "",
    "lap-valid-bit-flags": 15,
  };
}

function stint(
  start: number,
  end: number,
  key: string,
  compound = "Medium",
): TyreStint {
  return {
    "start-lap": start,
    "end-lap": end,
    "stint-length": end - start + 1,
    "fitted-index": 0,
    "tyre-set-key": key,
    "tyre-set-data": {
      "visual-tyre-compound": compound,
      "actual-tyre-compound": "C2",
    },
    "tyre-wear-history": [],
  } as unknown as TyreStint;
}

function raceDriver(
  index: number,
  name: string,
  stints: TyreStint[],
  position: number,
  grid = position,
): DriverData {
  return {
    index,
    "driver-name": name,
    team: "Team",
    "is-player": index === 0,
    "session-history": {
      "num-laps": 10,
      "lap-history-data": Array.from({ length: 10 }, () => lap()),
      "tyre-stints-history-data": [],
    },
    "tyre-set-history": stints,
    "per-lap-info": [],
    "final-classification": {
      position,
      "grid-position": grid,
      "result-status": "FINISHED",
      "total-race-time": 900 + position,
      "penalties-time": 0,
      "num-laps": 10,
    },
  } as unknown as DriverData;
}

function raceSession(
  drivers: DriverData[],
  traces: number[][],
): TelemetrySession {
  return {
    "session-info": {
      "session-type": "Race",
      "total-laps": 10,
      "network-game": 1,
    },
    "classification-data": drivers,
    "position-history": drivers.map((d, i) => ({
      name: d["driver-name"],
      team: d.team,
      "driver-number": i + 1,
      "driver-position-history": traces[i].map((position, lapNumber) => ({
        "lap-number": lapNumber,
        position,
      })),
    })),
    "race-control": [],
  } as unknown as TelemetrySession;
}

test("a pit cycle is measured once the cars around you have stopped too", () => {
  // You stop on lap 4 and drop to P3; both rivals stop on lap 6 and the order
  // is restored. Without the cycle, that reads "lost 2 on lap 5, gained 2 on lap 7".
  const you = raceDriver(0, "You", [stint(1, 4, "a"), stint(5, 10, "b")], 1);
  const second = raceDriver(
    1,
    "Second",
    [stint(1, 6, "c"), stint(7, 10, "d")],
    2,
  );
  const third = raceDriver(
    2,
    "Third",
    [stint(1, 6, "e"), stint(7, 10, "f")],
    3,
  );
  const session = raceSession(
    [you, second, third],
    [
      [1, 1, 1, 1, 1, 3, 3, 1, 1, 1, 1],
      [2, 2, 2, 2, 2, 1, 1, 2, 2, 2, 2],
      [3, 3, 3, 3, 3, 2, 2, 3, 3, 3, 3],
    ],
  );
  const story = buildRaceStory(session, you)!;
  const pit = story.moments.find((m) => m.kind === "pit-cycle")!;
  assert.equal(pit.lap, 4);
  assert.ok(pit.settledLap! >= 7, `settled on lap ${pit.settledLap}`);
  assert.equal(pit.places, 0);
  assert.deepEqual(significantMoments(story), []);
  assert.equal(
    buildRaceHeadline(session, you, story, null).text,
    "Won from P1, 1.0 s clear.",
  );
});

test("places traded back within two laps are not a moment; a held loss is", () => {
  const you = raceDriver(0, "You", [stint(1, 10, "a")], 4, 1);
  const session = raceSession(
    [you],
    // Lose two on lap 3, regain them on lap 4; lose three on lap 7 and keep them.
    [[1, 1, 1, 3, 1, 1, 1, 4, 4, 4, 4]],
  );
  const story = buildRaceStory(session, you)!;
  const moments = significantMoments(story);
  assert.equal(moments.length, 1);
  assert.equal(moments[0].lap, 7);
  assert.equal(moments[0].places, -3);
  assert.deepEqual(
    story.chips.map((c) => [c.label, c.places]),
    [
      ["Start", 0],
      ["Laps 2–10", -3],
    ],
  );
});

test("a retirement's classification slot on its last lap is not places lost", () => {
  // PnG writes the DNF slot (P3) onto the retirement lap after laps at P1.
  const you = raceDriver(0, "You", [stint(1, 10, "a")], 3, 1);
  you["final-classification"]!["result-status"] = "DID_NOT_FINISH";
  you["final-classification"]!["num-laps"] = 4;
  const session = raceSession([you], [[1, 1, 1, 1, 3]]);
  const story = buildRaceStory(session, you)!;
  assert.equal(story.outcome, "retired");
  assert.equal(story.endLap, 4);
  assert.deepEqual(story.trace, [1, 1, 1, 1]);
  assert.deepEqual(significantMoments(story), []);
  assert.ok(!story.chips.some((c) => c.key === "classification"));
  assert.equal(
    buildRaceHeadline(session, you, story, null).text,
    "Retired on lap 4, running P1.",
  );
});

test("an online save before the flag reads as a running position, not a result", () => {
  const you = raceDriver(0, "You", [stint(1, 10, "a")], 5, 3);
  you["final-classification"]!["result-status"] = "";
  const session = raceSession([you], [[3, 3, 4, 5, 5, 5, 5]]);
  const story = buildRaceStory(session, you)!;
  assert.equal(story.outcome, "unfinished");
  assert.equal(
    buildRaceHeadline(session, you, story, { rank: 1, field: 20 }).text,
    "Saved on lap 6 of 10, running P5.",
  );
});

test("a headline gives no time gap to a car on a different lap count", () => {
  const ahead = raceDriver(1, "Ahead", [stint(1, 10, "b")], 1);
  const you = raceDriver(0, "You", [stint(1, 10, "a")], 2);
  you["final-classification"]!["num-laps"] = 9;
  you["final-classification"]!["total-race-time"] = 850;
  const session = raceSession(
    [you, ahead],
    [
      [2, 2, 2, 2, 2, 2, 2, 2, 2, 2],
      [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
    ],
  );
  const story = buildRaceStory(session, you)!;
  assert.equal(
    buildRaceHeadline(session, you, story, null).text,
    "P2 from P2.",
  );
});

test("a race with only a stint-history result opens as a race, not a long run", () => {
  const you = raceDriver(0, "You", [stint(1, 10, "a")], 6);
  delete (you as { "final-classification"?: unknown })["final-classification"];
  const session = raceSession([you], [[3, 3, 3, 4, 5, 5]]);
  session["session-info"]["network-game"] = 0;
  assert.equal(sessionKind(session), "long-run");
  session["tyre-stint-history-v2"] = [
    { index: 0, name: "You", "result-status": "DNF", position: 6 },
  ] as unknown as TelemetrySession["tyre-stint-history-v2"];
  assert.equal(sessionKind(session), "race");
});

test("a quali result comes from the classification when history lacks the lap", () => {
  // History kept only 1:30 laps, not the 1:27.789 that set the result: the
  // official time stands, and no ideal lap is built from slower laps.
  const you = raceDriver(0, "You", [stint(1, 3, "a")], 4);
  you["final-classification"]!["best-lap-time-ms"] = 87_789;
  const pole = raceDriver(1, "Pole", [stint(1, 3, "b")], 1);
  pole["final-classification"]!["best-lap-time-ms"] = 87_300;
  const session = raceSession([you, pole], [[4], [1]]);
  session["session-info"]["session-type"] = "Short Qualifying";
  const summary = buildQualiSummary(session, you)!;
  assert.equal(summary.bestMs, 87_789);
  assert.equal(summary.position, 4);
  assert.deepEqual(summary.sectors, [0, 0, 0]);
  assert.equal(summary.idealMs, 0);
  assert.equal(qualiHeadline(summary), "P4, 0.489 s off pole.");
});

test("a position history covering only the final lap tells no story", () => {
  const you = raceDriver(0, "You", [stint(1, 10, "a")], 6, 18);
  const session = raceSession([you], [[]]);
  session["position-history"]![0]["driver-position-history"] = [
    { "lap-number": 10, position: 6 },
  ];
  assert.equal(buildRaceStory(session, you), null);
});

test("one tyre set split into two stints by the exporter reads as one stint", () => {
  const driver = raceDriver(
    0,
    "You",
    [stint(1, 3, "9.C2"), stint(4, 4, "9.C2"), stint(5, 10, "12.C1", "Hard")],
    1,
  );
  assert.deepEqual(
    getDriverStints(driver).map((s) => [
      s["start-lap"],
      s["end-lap"],
      s["stint-length"],
    ]),
    [
      [1, 4, 4],
      [5, 10, 6],
    ],
  );
});

test("recent form averages the last five races' grid and finish, leaving DNFs out of the finish", () => {
  const race = (
    day: number,
    grid: number,
    position: number,
    status = "FINISHED",
    playerLaps = status === "FINISHED" ? 29 : 3,
  ) =>
    summary({
      slug: `r${day}`,
      date: `2026-10-${String(day).padStart(2, "0")}T21:00:00`,
      isOnline: true,
      onlineDriverCount: 20,
      classifiedDriverCount: 20,
      playerRaceResult: {
        position,
        gridPosition: grid,
        status,
        playerLaps,
        totalLaps: 29,
        fieldSize: 20,
      },
    });
  const form = buildOnlineForm(
    [
      race(1, 1, 1),
      race(2, 7, 5),
      race(3, 4, 10),
      race(4, 4, 9, "DID_NOT_FINISH"),
      // Classified three laps down: still a finish.
      race(5, 3, 11, "FINISHED", 26),
      race(6, 2, 7),
      // An older export's saves before the flag: no status, no result, even
      // two laps short.
      race(7, 5, 6, "", 12),
      race(8, 5, 6, "", 27),
    ],
    "f1-26",
  )!;
  assert.equal(form.races.length, 6);
  assert.equal(form.stats.starts, 6);
  assert.equal(form.races[4].finish, 11);
  assert.equal(form.recent.count, 5);
  assert.equal(form.recent.averageGrid, 4);
  assert.equal(form.recent.averageFinish, (5 + 10 + 11 + 7) / 4);
  assert.equal(form.races[3].finish, null);
  assert.equal(form.recent.behindGrid, 3);
});
