import assert from "node:assert/strict";
import test from "node:test";
import { curateSessionInsights } from "../src/analysis/sessionInsightCuration";
import type { SessionInsight } from "../src/analysis/sessionInsightSummary";
import type { TelemetrySession } from "../src/types/telemetry";

const race = {
  "session-info": { "session-type": "Race" },
  "classification-data": [],
} as unknown as TelemetrySession;

const qualifying = {
  "session-info": { "session-type": "Qualifying" },
  "classification-data": [],
} as unknown as TelemetrySession;

const EVENTS = "Your Session Events";

function fact(
  type: SessionInsight["type"],
  label: string,
  value = "Test",
  detail = "Test",
  extra: Partial<SessionInsight> = {},
): SessionInsight {
  return { type, label, value, detail, ...extra };
}

function soloRaceFacts(): SessionInsight[] {
  return [
    fact("result", "Result", "P11", "Finished - 27/27 laps", {
      rank: 10,
      rankTotal: 22,
    }),
    fact("lap", "Best Lap", "1:31.575", "+2.032 vs Ciarda"),
    fact("race-flow", "Race Flow", "-8 pos", "P3 to P11 · 18 overtakes, 21 lost"),
    fact("incident", "Penalties", "+3s", "1 penalty applied", {
      groupLabel: EVENTS,
      tone: "warning",
    }),
    fact("incident", "Race Incidents", "12", "12 collisions", {
      groupLabel: EVENTS,
      tone: "negative",
    }),
    fact("context", "Neutralized Laps", "2 laps", "Virtual Safety Car", {
      groupLabel: EVENTS,
      tone: "warning",
    }),
    fact("pace", "Race Pace", "5th", "of 22 — +0.582s vs P1 · 16 laps", {
      rank: 4,
      rankTotal: 22,
    }),
    fact("tyre", "Tyre Management", "4th", "of 21 — +0.5%/lap vs best", {
      rank: 3,
      rankTotal: 21,
    }),
    fact("fuel", "Fuel Margin", "+3.0 laps", "game estimate at finish", {
      extraDetails: [
        "4.2 kg in tank · 37.1 kg at start",
        "Median green burn 1.26 kg/lap · 21 green pairs",
      ],
    }),
    fact("sector", "Weakest — S1", "15th", "of 22 — +0.370s vs rickythekid_22", {
      rank: 14,
      rankTotal: 22,
    }),
    fact("sector", "Strongest — S3", "4th", "of 22 — +0.120s vs Ciarda", {
      rank: 3,
      rankTotal: 22,
    }),
    fact("speed", "Speed Profile", "348 km/h", "session peak · P1/21", {
      rank: 0,
      rankTotal: 21,
      tooltip: "Session peak is the highest credible speed.",
      extraDetails: ["Speed trap 298.2 km/h · P6/22"],
    }),
    fact("ers", "ERS Deploy", "12th", "of 21 — 7.6 MJ/lap", {
      rank: 11,
      rankTotal: 21,
      tooltip: "Average ERS energy deployed per lap",
    }),
    fact("ers", "ERS Harvest", "100.0%", "highest of 21 drivers"),
    fact("history", "vs Best Race Lap", "New PB!", "-0.210s improvement"),
    fact("history", "Race Pace vs Best", "+0.150s/lap", "off your best average pace"),
  ];
}

test("a dense solo race curates into six cards with every topic kept", () => {
  const curated = curateSessionInsights(race, soloRaceFacts());

  assert.deepEqual(
    curated.map(({ label }) => label),
    ["Result", "Best Lap", "Race Pace", "Tyres & Fuel", "Speed & ERS", EVENTS],
  );
  const [result, lap, pace, tyre, speed, events] = curated;

  assert.equal(result.value, "P11");
  assert.equal(result.rank, 10);
  assert.deepEqual(result.extraDetails, ["P3 to P11 · 18 overtakes, 21 lost"]);

  assert.equal(lap.detail, "+2.032 vs Ciarda");
  assert.equal(lap.accent, "purple");
  assert.deepEqual(lap.extraDetails, ["New PB · -0.210s improvement"]);

  assert.equal(pace.value, "5th");
  assert.equal(pace.rank, 4);
  // Whole-race sector splits stay off the card; a non-notable pace history
  // line is dropped too.
  assert.equal(pace.extraDetails, undefined);

  assert.equal(tyre.type, "tyre");
  assert.equal(tyre.value, "4th");
  assert.deepEqual(tyre.extraDetails, [
    "Fuel +3.0 laps · game estimate at finish",
  ]);
  assert.equal(
    tyre.tooltip,
    "Fuel margin is the game's own estimate at the last recorded lap, not a viewer recommendation. 4.2 kg in tank · 37.1 kg at start. Median green burn 1.26 kg/lap · 21 green pairs.",
  );

  assert.equal(speed.type, "speed");
  assert.equal(speed.value, "348 km/h");
  assert.equal(speed.rank, 0);
  assert.deepEqual(speed.extraDetails, [
    "Speed trap 298.2 km/h · P6/22",
    "ERS deploy 7.6 MJ/lap · P12/21",
  ]);
  assert.equal(
    speed.tooltip,
    "Session peak is the highest credible speed. Average ERS energy deployed per lap. ERS harvest 100.0% of the MGU-K limit · highest of 21 drivers.",
  );

  assert.equal(events.value, "3 issues");
  assert.equal(events.extraDetails?.length, 3);
});

test("race flow without a grid position keeps its net value", () => {
  const curated = curateSessionInsights(race, [
    fact("result", "Result", "P4", "Finished - 10/10 laps"),
    fact("race-flow", "Race Flow", "+2 net", "3 overtakes, 1 lost"),
  ]);
  assert.deepEqual(curated[0].extraDetails, ["+2 net · 3 overtakes, 1 lost"]);
});

test("the race budget stays at six whatever the incident count", () => {
  const clean = soloRaceFacts().filter(
    ({ type }) => type !== "incident" && type !== "context",
  );
  assert.deepEqual(
    curateSessionInsights(race, clean).map(({ label }) => label),
    ["Result", "Best Lap", "Race Pace", "Tyres & Fuel", "Speed & ERS"],
  );
  const withLeftover = [...soloRaceFacts(), fact("pit", "Pit Loss", "22.1s")];
  assert.equal(curateSessionInsights(race, withLeftover).length, 6);
  assert.equal(curateSessionInsights(race, withLeftover, 4).length, 4);
});

test("a head-to-head race drops sector rows and folds pit timing under tyres", () => {
  const curated = curateSessionInsights(race, [
    fact("result", "Result", "P6", "Finished - 27/27 laps"),
    fact("lap", "Best Lap", "1:31.575", "+0.412 vs Ciarda"),
    fact("race-flow", "Race Flow", "+1 pos", "P7 to P6 · 4 overtakes, 3 lost"),
    fact("pace", "Matched Pace", "+0.123s", "slower on the same tyres vs Ciarda · 12 vs 14 laps"),
    fact("tyre", "Tyre Management", "+0.2%/lap", "more wear per lap vs Ciarda"),
    fact("sector", "Sector Analysis", "+0.123s", "1 sectors faster · 2 slower vs Ciarda", {
      extraDetails: ["S1 · +0.080s slower", "S2 · -0.020s faster", "S3 · +0.063s slower"],
    }),
    fact("ers", "ERS Deploy", "+0.3 MJ", "avg per lap vs Ciarda (7.6 vs 7.3 MJ)"),
    fact("ers", "ERS Harvest", "+1.2 pp", "98.0% vs Ciarda at 96.8%"),
    fact("pit", "First Pit Stop", "Lap 12", "2 laps later than Ciarda"),
    fact("incident", "Penalties", "+3s", "1 penalty applied", { groupLabel: EVENTS }),
  ]);

  assert.deepEqual(
    curated.map(({ label }) => label),
    ["Result", "Best Lap", "Matched Pace", "Tyre Management", "ERS Usage", "Penalties"],
  );
  assert.equal(curated[2].extraDetails, undefined);
  assert.deepEqual(curated[3].extraDetails, [
    "First stop lap 12 · 2 laps later than Ciarda",
  ]);
});

test("qualifying keeps the sector card and folds ERS under speed", () => {
  const curated = curateSessionInsights(qualifying, [
    fact("result", "Result", "P5", "3 valid laps", { rank: 4, rankTotal: 20 }),
    fact("lap", "Best Lap", "1:29.313", "+0.284 vs Ciarda"),
    fact("sector", "Weakest — S2", "9th", "of 20 — +0.210s vs Ciarda", {
      rank: 8,
      rankTotal: 20,
    }),
    fact("sector", "Strongest — S1", "2nd", "of 20 — +0.030s vs Ciarda", {
      rank: 1,
      rankTotal: 20,
    }),
    fact("speed", "Speed Profile", "341 km/h", "session peak · P3/20", {
      rank: 2,
      rankTotal: 20,
    }),
    fact("ers", "ERS Harv", "3rd", "of 20 — 1.9 MJ/lap", { rank: 2, rankTotal: 20 }),
    fact("history", "vs Personal Best", "+0.312s", "off your PB of 1:29.001"),
    fact("context", "Conditions", "Light Rain", "Track 24°C - Air 19°C", {
      groupLabel: EVENTS,
    }),
  ]);

  assert.deepEqual(
    curated.map(({ label }) => label),
    ["Result", "Best Lap", "Sector Split", "Speed & ERS", "Personal Bests", "Conditions"],
  );
  assert.equal(curated[2].value, "+0.210s");
  assert.deepEqual(curated[3].extraDetails, ["ERS harvest 1.9 MJ/lap · P3/20"]);
});

test("a race without race pace shows no sector card", () => {
  const curated = curateSessionInsights(race, [
    fact("result", "Result", "P9", "DNF - 4/27 laps"),
    fact("sector", "Weakest — S2", "12th", "of 20 — +0.250s vs Ciarda"),
  ]);
  assert.deepEqual(
    curated.map(({ label }) => label),
    ["Result"],
  );
});

test("a lone fuel margin stays its own descriptive card", () => {
  const fuel = fact("fuel", "Fuel Margin", "+0.4 laps", "game estimate at finish");
  assert.deepEqual(curateSessionInsights(race, [fuel]), [fuel]);
});
