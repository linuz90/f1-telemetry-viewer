import assert from "node:assert/strict";
import test from "node:test";
import type {
  CarSetup,
  DriverData,
  LapHistoryEntry,
  PerLapInfo,
  StintTrace,
  TyreStint,
} from "../src/types/telemetry";
import type { SessionKind } from "../src/analysis/sessionKind";
import {
  buildStintTraces,
  comparableStintPool,
  comparableStints,
  compareStints,
  defaultCompareStint,
  describeSetupDifference,
  snapshotSetup,
  stintCandidates,
  stintCompareDetail,
  type ComparableStint,
} from "../src/analysis/stintCompare";
import { buildLongRunWorthALook } from "../src/analysis/worthALook";

/** A stint trace with every lap counted unless listed in `uncounted`. */
function trace(
  lapMs: (number | null)[],
  {
    compound = "Medium",
    startLap = 1,
    uncounted = [1],
    fuelKg,
    wear,
    wearPerLap = 5,
  }: {
    compound?: string;
    startLap?: number;
    /** Tyre ages (1-based) Race Pace leaves out; the start by default. */
    uncounted?: number[];
    fuelKg?: (number | null)[];
    wear?: (number | null)[];
    wearPerLap?: number;
  } = {},
): StintTrace {
  return {
    compound,
    startLap,
    lapMs,
    counted: lapMs.map((ms, i) => ms != null && !uncounted.includes(i + 1)),
    wear: wear ?? lapMs.map((_, i) => (i + 1) * wearPerLap),
    fuelKg: fuelKg ?? lapMs.map(() => null),
    wearPerLap,
    lifeLaps: Math.round(75 / wearPerLap),
  };
}

function stint(
  slug: string,
  t: StintTrace,
  {
    date = "2026-10-30T18:00:00",
    kind = "long-run" as SessionKind,
    raceLaps = 29,
    setup,
  }: {
    date?: string;
    kind?: SessionKind;
    raceLaps?: number;
    setup?: (number | null)[];
  } = {},
): ComparableStint {
  return comparableStints({
    slug,
    date,
    kind,
    stintLaps: { raceLaps, setup, stints: [t] },
  })[0];
}

test("laps pair by tyre age, and the delta is the mean of the pairs", () => {
  // b ran a fourth clean lap, quick on a light car. Averaging each stint's own
  // laps would credit b with it; pairing leaves it out.
  const a = stint("a", trace([95_000, 90_000, 90_000, 90_000]));
  const b = stint("b", trace([95_000, 90_300, 90_300, 90_300, 88_000]));
  const c = compareStints(a, b);
  assert.equal(c.pairs.length, 3);
  assert.deepEqual(
    c.pairs.map((p) => p.age),
    [2, 3, 4],
  );
  assert.equal(c.deltaMs, -300);
  assert.equal(c.pairs.at(-1)!.gapMs, -900);
  // The stint averages alone would have called a 0.275 s a lap slower.
  assert.equal(a.averageMs! - b.averageMs!, 275);
});

test("a lap only pairs when Race Pace counts it in both stints", () => {
  const a = stint("a", trace([95_000, 90_000, 90_000, 90_000, 90_000]));
  // b's lap 3 was a pit-out lap and doesn't count.
  const b = stint(
    "b",
    trace([95_000, 90_100, 99_000, 90_100, 90_100], { uncounted: [1, 3] }),
  );
  const c = compareStints(a, b);
  assert.deepEqual(
    c.pairs.map((p) => p.age),
    [2, 4, 5],
  );
  assert.equal(c.deltaMs, -100);
});

test("a lighter car is put back on equal fuel, but wear is never corrected", () => {
  // A race's second stint from lap 14 against a long run from the grid: the
  // race car carries 20 kg less, worth 0.6 s at 30 ms/kg.
  const fuelA = [80, 78, 76, 74];
  const fuelB = [100, 98, 96, 94];
  const a = stint(
    "race",
    trace([92_000, 89_400, 89_400, 89_400], {
      startLap: 14,
      fuelKg: fuelA,
      wearPerLap: 6,
    }),
    { kind: "race" },
  );
  const b = stint(
    "run",
    trace([92_000, 90_000, 90_000, 90_000], { fuelKg: fuelB, wearPerLap: 5 }),
  );
  const c = compareStints(a, b);
  assert.equal(c.deltaMs, 0);
  assert.equal(c.fuelCorrected, true);
  assert.equal(c.pairs[0].lapA, 15);
  assert.equal(c.pairs[0].lapB, 2);
  assert.equal(c.wearPerLapDelta, 1);
  assert.deepEqual(c.wearDelta.slice(0, 2), [1, 2]);
});

test("too few paired laps give no delta, and the default skips such runs", () => {
  const current = stint(
    "now",
    trace([95_000, 90_000, 90_000, 90_000, 90_000]),
    {
      date: "2026-10-30T19:00:00",
    },
  );
  const solid = stint("solid", trace([95_000, 90_200, 90_200, 90_200]), {
    date: "2026-10-30T17:00:00",
  });
  // The latest earlier run was saved after two laps.
  const short = stint("short", trace([95_000, 90_100, 90_100]), {
    date: "2026-10-30T18:00:00",
  });
  assert.equal(compareStints(current, short).deltaMs, null);
  assert.equal(defaultCompareStint(current, [solid, short])?.slug, "solid");
});

test("the pool keeps one race length and leaves the session itself out", () => {
  const other = stint("other", trace([95_000, 90_000, 90_000]));
  const longer = stint("longer", trace([95_000, 90_000, 90_000]), {
    raceLaps: 57,
  });
  const own = stint("self", trace([95_000, 90_000, 90_000]));
  assert.deepEqual(
    comparableStintPool({ slug: "self", raceLaps: 29 }, [
      longer,
      own,
      other,
    ]).map((s) => s.slug),
    ["other"],
  );
});

test("candidates keep slicks with slicks and wets with wets", () => {
  const current = stint("now", trace([1, 2, 3], { compound: "Medium" }));
  const pool = [
    stint("m", trace([1, 2, 3], { compound: "Medium" })),
    stint("h", trace([1, 2, 3], { compound: "Hard" })),
    stint("i", trace([1, 2, 3], { compound: "Inters" })),
  ];
  const candidates = stintCandidates(current, [current], pool);
  assert.deepEqual(
    candidates.sameCompound.map((s) => s.slug),
    ["m"],
  );
  assert.deepEqual(
    candidates.otherCompounds.map((s) => s.slug),
    ["h"],
  );
});

function setup(overrides: Partial<CarSetup> = {}): CarSetup {
  return {
    "front-wing": 50,
    "rear-wing": 20,
    "on-throttle": 100,
    "off-throttle": 80,
    "front-camber": -3.5,
    "rear-camber": -2,
    "front-toe": 0,
    "rear-toe": 0.10000000149011612,
    "front-suspension": 41,
    "rear-suspension": 16,
    "front-anti-roll-bar": 1,
    "rear-anti-roll-bar": 6,
    "front-suspension-height": 20,
    "rear-suspension-height": 43,
    "brake-pressure": 100,
    "brake-bias": 56,
    "engine-braking": 100,
    "rear-left-tyre-pressure": 20.5,
    "rear-right-tyre-pressure": 20.5,
    "front-left-tyre-pressure": 22.5,
    "front-right-tyre-pressure": 22.5,
    ballast: 6,
    "fuel-load": 5,
    "is-valid": true,
    ...overrides,
  };
}

test("setup differences ignore brake bias and fuel and name a pressure pair once", () => {
  const before = snapshotSetup(setup());
  assert.equal(
    describeSetupDifference(
      snapshotSetup(setup({ "brake-bias": 54, "fuel-load": 8 })),
      before,
    ),
    "Same setup.",
  );
  assert.equal(
    describeSetupDifference(
      snapshotSetup(
        setup({
          "front-wing": 48,
          "rear-wing": 18,
          "front-left-tyre-pressure": 23,
          "front-right-tyre-pressure": 23,
        }),
      ),
      before,
    ),
    "Setup changed: front wing 50 → 48, rear wing 20 → 18, front tyre pressure 22.5 → 23.",
  );
  assert.equal(snapshotSetup(setup({ "is-valid": false })), undefined);
});

// --- Traces from session JSON -------------------------------------------------

function lap(timeMs: number): LapHistoryEntry {
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

function tyreStint(
  start: number,
  end: number,
  compound: string,
  wearByLap: Record<number, number>,
): TyreStint {
  return {
    "start-lap": start,
    "end-lap": end,
    "stint-length": end - start + 1,
    "fitted-index": 0,
    "tyre-set-key": `${compound}-${start}`,
    "tyre-set-data": {
      "actual-tyre-compound": "C3",
      "visual-tyre-compound": compound,
      wear: 0,
      available: true,
      "recommended-session": "",
      "life-span": 0,
      "usable-life": 0,
      "lap-delta-time": 0,
      fitted: true,
    },
    "tyre-wear-history": Object.entries(wearByLap).map(([n, wear]) => ({
      "lap-number": Number(n),
      "front-left-wear": wear,
      "front-right-wear": wear,
      "rear-left-wear": wear,
      "rear-right-wear": wear,
      average: wear,
      desc: "",
    })),
  };
}

test("traces follow the stints, Race Pace's counted laps, wear and fuel", () => {
  const times = [96_000, 90_000, 90_100, 99_000, 101_000, 89_500, 89_600];
  const driver = {
    index: 0,
    "is-player": true,
    "session-history": {
      "num-laps": times.length,
      "lap-history-data": times.map(lap),
      "tyre-stints-history-data": [],
    },
    "tyre-set-history": [
      tyreStint(1, 4, "Medium", { 1: 5, 2: 10, 3: 15, 4: 20 }),
      tyreStint(5, 7, "Hard", { 5: 3, 6: 6, 7: 9 }),
    ],
    "per-lap-info": times.map(
      (_, i) =>
        ({
          "lap-number": i + 1,
          "max-safety-car-status": "NO_SAFETY_CAR",
          "car-status-data": { "fuel-in-tank": 30 - i * 1.5 },
        }) as unknown as PerLapInfo,
    ),
  } as unknown as DriverData;

  const traces = buildStintTraces(driver);
  assert.deepEqual(
    traces.map((t) => [t.compound, t.startLap, t.lapMs.length]),
    [
      ["Medium", 1, 4],
      ["Hard", 5, 3],
    ],
  );
  // The start, the in-lap (4) and the out-lap (5) don't count.
  assert.deepEqual(traces[0].counted, [false, true, true, false]);
  assert.deepEqual(traces[1].counted, [false, true, true]);
  assert.deepEqual(traces[0].wear, [5, 10, 15, 20]);
  assert.deepEqual(traces[1].fuelKg, [24, 22.5, 21]);
});

// --- Worth a look ------------------------------------------------------------

test("a gap that peaked and turned back is worth a look", () => {
  // Up 0.6 s a lap for three laps, then 0.6 s a lap down for two.
  const a = stint(
    "now",
    trace([95_000, 89_400, 89_400, 89_400, 90_600, 90_600]),
    { date: "2026-10-30T19:00:00" },
  );
  const b = stint(
    "before",
    trace([95_000, 90_000, 90_000, 90_000, 90_000, 90_000]),
  );
  const c = compareStints(a, b);
  const items = buildLongRunWorthALook({
    stints: [a],
    comparisons: [{ comparison: c, label: "18:24 run" }],
    headline: c,
  });
  const turn = items.find((item) => item.id.startsWith("gap-turn"));
  assert.ok(turn);
  assert.equal(
    turn.claim,
    "You were 1.80 s up on your 18:24 run after lap 4, then gave 1.20 s back by lap 6.",
  );
  // The headline told this comparison already.
  assert.ok(!items.some((item) => item.id.startsWith("compare-")));
});

test("without fuel data, only stints from the same race lap pair", () => {
  const early = stint("run", trace([95_000, 90_000, 90_000, 90_000]));
  // A late stint on a light car, from a save without fuel data: pairing it
  // raw would bank the lighter car's fuel as pace.
  const late = stint(
    "race",
    trace([92_000, 89_400, 89_400, 89_400], { startLap: 14 }),
  );
  assert.equal(compareStints(late, early).pairs.length, 0);
  const sameLap = stint("again", trace([95_000, 89_900, 89_900, 89_900]));
  assert.equal(compareStints(sameLap, early).deltaMs, -100);
});

test("a lead that turns into a deficit is still a turn", () => {
  // Gaps after each paired lap: −1, −2, −1, +1, +3 s.
  const b = stint(
    "before",
    trace([95_000, 90_000, 90_000, 90_000, 90_000, 90_000]),
  );
  const a = stint(
    "now",
    trace([95_000, 89_000, 89_000, 91_000, 92_000, 92_000]),
    { date: "2026-10-30T19:00:00" },
  );
  const c = compareStints(a, b);
  assert.deepEqual(
    c.pairs.map((p) => p.gapMs),
    [-1000, -2000, -1000, 1000, 3000],
  );
  const items = buildLongRunWorthALook({
    stints: [a],
    comparisons: [{ comparison: c, label: "18:24 run" }],
    headline: c,
  });
  assert.equal(
    items.find((item) => item.id.startsWith("gap-turn"))?.claim,
    "You were 2.00 s up on your 18:24 run after lap 3, then gave 5.00 s back by lap 6, ending 3.00 s down.",
  );
});

test("fade words cover stints that got quicker", () => {
  // Both stints quicken as fuel burns, one far more.
  const a = stint("now", trace([95_000, 90_900, 90_600, 90_300, 90_000]), {
    date: "2026-10-30T19:00:00",
  });
  const b = stint("before", trace([95_000, 90_150, 90_100, 90_050, 90_000]));
  assert.equal(
    stintCompareDetail(compareStints(a, b)),
    "Same wear, 5.0% a lap. It got 0.30 s a lap quicker, the other got 0.05 s a lap quicker.",
  );
});
