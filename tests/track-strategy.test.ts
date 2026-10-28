import assert from "node:assert/strict";
import test from "node:test";
import type {
  DriverData,
  TelemetrySession,
  TyreStint,
} from "../src/types/telemetry";
import {
  isDryCompound,
  rankDryCompoundsByPace,
} from "../src/analysis/trackStrategyCompounds";
import {
  buildTimingContext,
  scoreShape,
} from "../src/analysis/trackStrategyTiming";
import { buildTrackRaceRecommendation } from "../src/analysis/trackRaceRecommendation";
import { aggregateCompoundLife } from "../src/utils/stats/trackAggregates";
import { PUNCTURE_THRESHOLD } from "../src/utils/stats/tyres";

interface StintSpec {
  compound: string;
  laps: number;
  wearPerLap?: number;
  /** Worst-wheel wear after each stint lap, when a linear rate won't do. */
  wear?: number[];
  /** Lap time on fresh tyres and an empty tank. Each lap adds the fuel and
   *  wear it carries at the measured costs, which the pace model takes off. */
  lapTimeMs?: number;
}

interface RaceSpec {
  totalLaps: number;
  stints: StintSpec[];
  totalRaceTimeSeconds?: number;
  /** Laps run behind the Safety Car. */
  safetyCarLaps?: number[];
  /** Saves of one session share it. */
  sessionUid?: number;
  /** Defaults to an F1 25 race. */
  formula?: string;
  sessionType?: string;
}

function buildStint(
  spec: StintSpec,
  startLap: number,
  index: number,
): TyreStint {
  return {
    "start-lap": startLap,
    "end-lap": startLap + spec.laps - 1,
    "stint-length": spec.laps,
    "fitted-index": index,
    "tyre-set-key": "",
    "tyre-set-data": {
      "actual-tyre-compound": spec.compound,
      "visual-tyre-compound": spec.compound,
      wear: 0,
      available: false,
      "recommended-session": "",
      "life-span": spec.laps,
      "usable-life": spec.laps,
      "lap-delta-time": 0,
      fitted: true,
    },
    "tyre-wear-history": Array.from({ length: spec.laps }, (_, lap) => {
      const wear = spec.wear?.[lap] ?? (spec.wearPerLap ?? 0) * (lap + 1);
      return {
        "lap-number": startLap + lap,
        "front-left-wear": wear,
        "front-right-wear": wear,
        "rear-left-wear": wear,
        "rear-right-wear": wear,
        average: wear,
        desc: "",
      };
    }),
  };
}

function buildRace(spec: RaceSpec): TelemetrySession {
  let startLap = 1;
  const stints = spec.stints.map((stintSpec, index) => {
    const stint = buildStint(stintSpec, startLap, index);
    startLap += stintSpec.laps;
    return stint;
  });
  const lapsDone = spec.stints.reduce((sum, stint) => sum + stint.laps, 0);
  const safetyCarLaps = new Set(spec.safetyCarLaps);
  const fuelKg = (lap: number) => Math.max(0, 45 - 1.5 * lap);
  // Wear and fresh-tyre pace for every race lap, from its stint.
  const laps = spec.stints.flatMap((stint) =>
    Array.from({ length: stint.laps }, (_, lap) => ({
      baseMs: stint.lapTimeMs ?? 0,
      wearBefore:
        lap === 0
          ? 0
          : (stint.wear?.[lap - 1] ?? (stint.wearPerLap ?? 0) * lap),
      wearAfter: stint.wear?.[lap] ?? (stint.wearPerLap ?? 0) * (lap + 1),
    })),
  );
  const player = {
    "is-player": true,
    "per-lap-info": Array.from({ length: lapsDone + 1 }, (_, lap) => ({
      "lap-number": lap,
      "max-safety-car-status": safetyCarLaps.has(lap)
        ? "FULL_SAFETY_CAR"
        : "NO_SAFETY_CAR",
      "car-status-data": { "fuel-in-tank": fuelKg(lap) },
    })),
    "session-history": {
      "num-laps": lapsDone,
      "lap-history-data": laps.map(
        ({ baseMs, wearBefore, wearAfter }, index) => {
          const lap = index + 1;
          // 30 ms per kg of fuel and per % of wear, plus a little lap-to-lap
          // noise so the per-stint outlier filter has something to judge.
          const timeMs =
            baseMs > 0
              ? Math.round(
                  baseMs +
                    15 * (fuelKg(lap - 1) + fuelKg(lap)) +
                    15 * (wearBefore + wearAfter) +
                    (index % 3) * 40,
                )
              : 0;
          const sectorMs = Math.round(timeMs / 3);
          return {
            "lap-time-in-ms": timeMs,
            "sector-1-time-in-ms": sectorMs,
            "sector-2-time-in-ms": sectorMs,
            "sector-3-time-in-ms": timeMs - sectorMs * 2,
            "lap-valid-bit-flags": 15,
          };
        },
      ),
      "tyre-stints-history-data": [],
    },
    "tyre-set-history": stints,
    "final-classification": spec.totalRaceTimeSeconds
      ? {
          "result-status": "FINISHED",
          "total-race-time": spec.totalRaceTimeSeconds,
        }
      : null,
  } as unknown as DriverData;

  return {
    "game-year": 25,
    "session-info": {
      "session-type": spec.sessionType ?? "Race",
      "track-id": "Melbourne",
      formula: spec.formula ?? "F1 Modern",
      "total-laps": spec.totalLaps,
    },
    "classification-data": [player],
    debug:
      spec.sessionUid != null ? { "session-uid": spec.sessionUid } : undefined,
  } as unknown as TelemetrySession;
}

function recommend(races: RaceSpec[]) {
  const sessions = races.map(buildRace);
  const recommendation = buildTrackRaceRecommendation(
    sessions,
    aggregateCompoundLife(sessions),
    null,
  );
  assert.ok(recommendation);
  return recommendation;
}

const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);

// Sakhir, 26 Oct: the Soft went on under the Safety Car on lap 23 and only
// started wearing at racing speed after the lap-25 restart. Its few laps look
// quick; a model that believes them plans the Soft for 16 laps at 74% while
// the Tyre Life card says it lasts about 13.
const SAKHIR_SC_SOFT_RACE: RaceSpec = {
  totalLaps: 29,
  safetyCarLaps: [23, 24, 25],
  stints: [
    { compound: "Medium", laps: 8, wearPerLap: 5.4, lapTimeMs: 91_000 },
    { compound: "Hard", laps: 14, wearPerLap: 3.4, lapTimeMs: 91_200 },
    {
      compound: "Soft",
      laps: 7,
      wear: [1.02, 2.01, 7.18, 12.86, 19.09, 24.98, 32.55],
      lapTimeMs: 89_600,
    },
  ],
};

const SAKHIR_BUCKET: RaceSpec[] = [
  SAKHIR_SC_SOFT_RACE,
  {
    totalLaps: 29,
    stints: [
      {
        compound: "Medium",
        laps: 10,
        wear: [6, 11, 16, 21, 26, 32, 38, 44, 50, 56],
        lapTimeMs: 91_000,
      },
      { compound: "Hard", laps: 6, wearPerLap: 3.2, lapTimeMs: 91_200 },
    ],
  },
];

function planStints(recommendation: ReturnType<typeof recommend>) {
  return [recommendation.recommended, recommendation.alternative]
    .filter((plan) => plan != null)
    .flatMap((plan) =>
      plan.compounds.map((compound, index) => ({
        compound,
        laps: plan.stintLaps[index]!,
        wear: plan.stintWearPercentages[index]!,
        isManaged: plan.risk != null,
      })),
    );
}

test("wet-only bucket gets an Inters plan instead of no strategy", () => {
  const recommendation = recommend([
    {
      totalLaps: 20,
      stints: [{ compound: "Inters", laps: 20, wearPerLap: 3 }],
    },
    {
      totalLaps: 20,
      stints: [{ compound: "Inters", laps: 12, wearPerLap: 3 }],
    },
  ]);

  assert.equal(recommendation.recommended, null);
  assert.equal(recommendation.hasEvidence, true);
  assert.equal(recommendation.totalLaps, 20);
  assert.equal(recommendation.wetStrategies.length, 1);
  const [wet] = recommendation.wetStrategies;
  // 20 laps at 3%/lap stays under the cap, so a stop only costs pit loss.
  assert.deepEqual(wet.compounds, ["Inters"]);
  assert.deepEqual(wet.stintLaps, [20]);
  assert.equal(wet.pitWindows.length, 0);
});

test("high-wear wet races stop on the same compound with an even split", () => {
  const recommendation = recommend([
    {
      totalLaps: 30,
      stints: [
        { compound: "Inters", laps: 15, wearPerLap: 4 },
        { compound: "Inters", laps: 15, wearPerLap: 4 },
      ],
    },
  ]);

  const [wet] = recommendation.wetStrategies;
  assert.deepEqual(wet.compounds, ["Inters", "Inters"]);
  assert.deepEqual(wet.stintLaps, [15, 15]);
  assert.deepEqual(wet.pitWindows, [{ earliest: 14, latest: 16, target: 15 }]);
  assert.ok(
    wet.stintWearPercentages.every((wear) => wear <= PUNCTURE_THRESHOLD),
  );
  assert.equal(wet.risk, undefined);
});

test("mixed buckets keep dry and wet plans on their own compounds", () => {
  const recommendation = recommend([
    {
      totalLaps: 24,
      stints: [
        { compound: "Medium", laps: 10, wearPerLap: 4 },
        { compound: "Hard", laps: 14, wearPerLap: 3 },
      ],
    },
    {
      totalLaps: 24,
      stints: [
        { compound: "Inters", laps: 12, wearPerLap: 3 },
        { compound: "Inters", laps: 12, wearPerLap: 3 },
      ],
      totalRaceTimeSeconds: 2_400,
    },
  ]);

  assert.ok(recommendation.recommended);
  assert.ok(recommendation.recommended.compounds.every(isDryCompound));
  // Only the completed Inters race can anchor absolute durations, so it
  // anchors the wet plan and never the dry one.
  assert.equal(
    recommendation.recommended.timeEstimate?.predictedTotalRaceMs,
    undefined,
  );

  const [wet] = recommendation.wetStrategies;
  assert.ok(wet.compounds.every((compound) => compound === "Inters"));
  assert.equal(sum(wet.stintLaps), 24);
  assert.ok(wet.timeEstimate?.predictedTotalRaceMs);
});

test("wet plans stretched past any real stint drop to low confidence", () => {
  // One short opening Inters stint (e.g. before a crossover to slicks) is too
  // thin to vouch for a full-distance wet plan.
  const recommendation = recommend([
    {
      totalLaps: 30,
      stints: [
        { compound: "Inters", laps: 4, wearPerLap: 3 },
        { compound: "Hard", laps: 26, wearPerLap: 2 },
      ],
    },
  ]);

  const [wet] = recommendation.wetStrategies;
  assert.ok(Math.max(...wet.stintLaps) > 4);
  assert.equal(wet.timeEstimate?.confidence, "low");
});

test("full wets get their own plan after Inters", () => {
  const recommendation = recommend([
    {
      totalLaps: 20,
      stints: [
        { compound: "Wet", laps: 10, wearPerLap: 2 },
        { compound: "Inters", laps: 10, wearPerLap: 3 },
      ],
    },
  ]);

  assert.deepEqual(
    recommendation.wetStrategies.map((strategy) => strategy.compounds[0]),
    ["Inters", "Wet"],
  );
  for (const strategy of recommendation.wetStrategies) {
    assert.equal(new Set(strategy.compounds).size, 1);
    assert.equal(sum(strategy.stintLaps), 20);
  }
});

test("compound life projects each stint's wear curve and keeps the longest green run's evidence", () => {
  const stats = aggregateCompoundLife([
    buildRace({
      totalLaps: 20,
      stints: [{ compound: "Medium", laps: 10, wearPerLap: 5 }],
    }),
    buildRace({
      totalLaps: 20,
      stints: [{ compound: "Medium", laps: 6, wearPerLap: 5 }],
    }),
  ]);
  assert.equal(stats.length, 1);
  const [medium] = stats;
  assert.ok(medium);
  assert.equal(medium.compound, "Medium");
  assert.equal(medium.stintCount, 2);
  assert.equal(medium.longestGreenRun, 10);
  assert.equal(medium.longestGreenRunWear, 50);
  // 5%/lap reaches the 75% threshold on lap 15 from either stint.
  assert.equal(medium.estMaxLife, 15);
  // The fixture has no lap history, so there is no peak pace to show.
  assert.equal(medium.peakPaceMs, 0);
  assert.equal(medium.peakPaceLapCount, 0);
});

test("compound life reads the threshold off a stint that actually reached it", () => {
  const [hard] = aggregateCompoundLife([
    buildRace({
      totalLaps: 30,
      stints: [{ compound: "Hard", laps: 25, wearPerLap: 4 }],
    }),
  ]);
  assert.ok(hard);
  // 4%/lap crosses 75% on lap 19 even though the stint ran to 100%.
  assert.equal(hard.estMaxLife, 19);
  assert.equal(hard.longestGreenRunWear, 100);
});

test("compound life cards run softest to hardest regardless of first use", () => {
  const stats = aggregateCompoundLife([
    buildRace({
      totalLaps: 20,
      stints: [
        { compound: "Hard", laps: 8, wearPerLap: 3 },
        { compound: "Soft", laps: 6, wearPerLap: 7 },
        { compound: "Medium", laps: 6, wearPerLap: 5 },
      ],
    }),
  ]);
  assert.deepEqual(
    stats.map((compound) => compound.compound),
    ["Soft", "Medium", "Hard"],
  );
});

test("Safety Car laps neither wear nor count towards a compound's wear rate", () => {
  const soft = aggregateCompoundLife([buildRace(SAKHIR_SC_SOFT_RACE)]).find(
    (compound) => compound.compound === "Soft",
  );
  assert.ok(soft);
  // Green-flag laps 26-29 took the Soft from 7.18% to 32.55%: 6.3%/lap, not
  // the 4.6%/lap that spreading 32.55% over all seven laps gives.
  assert.ok(Math.abs(soft.avgWearRatePerLap - 6.34) < 0.01);
  // Four green laps reach 25.4%, then the late-stint rate of 6.6%/lap.
  assert.equal(soft.estMaxLife, 12);
});

function assertPlansWithinTyreLife(races: RaceSpec[]) {
  const sessions = races.map(buildRace);
  const stats = aggregateCompoundLife(sessions);
  const recommendation = buildTrackRaceRecommendation(sessions, stats, null);
  assert.ok(recommendation?.recommended);
  const lifeByCompound = new Map(
    stats.map((compound) => [compound.compound, compound.estMaxLife]),
  );

  for (const stint of planStints(recommendation)) {
    if (stint.isManaged) continue;
    const life = lifeByCompound.get(stint.compound)!;
    assert.ok(
      stint.laps <= life,
      `${stint.compound} ${stint.laps} laps outlasts Tyre Life ~${life}`,
    );
    assert.ok(stint.wear <= PUNCTURE_THRESHOLD);
  }
}

test("strategy stints never outlast the Tyre Life card", () => {
  assertPlansWithinTyreLife(SAKHIR_BUCKET);
});

test("a gentle latest stint cannot stretch a plan past Tyre Life", () => {
  // The latest Hard stint ran 18 laps to 68%, but two harder-wearing races
  // put the Hard's life at 15 laps. Reading that one stint alone planned a
  // 17-lap Hard stint.
  const olderRace: RaceSpec = {
    totalLaps: 28,
    stints: [
      { compound: "Medium", laps: 8, wearPerLap: 6 },
      { compound: "Hard", laps: 10, wearPerLap: 5 },
    ],
  };
  assertPlansWithinTyreLife([
    olderRace,
    olderRace,
    {
      totalLaps: 28,
      stints: [
        { compound: "Medium", laps: 10, wearPerLap: 6 },
        { compound: "Hard", laps: 18, wearPerLap: 3.8 },
      ],
    },
  ]);
});

test("dry plans stretched past every real stint drop to low confidence", () => {
  const plan = recommend(SAKHIR_BUCKET).recommended;
  assert.ok(plan);
  // No stint in the bucket ran past 14 laps, so a 29-lap one-stop has to
  // extrapolate at least one of its stints.
  assert.ok(Math.max(...plan.stintLaps) > 14);
  assert.equal(plan.timeEstimate?.confidence, "low");
  assert.match(plan.timeEstimate?.details?.paceSource ?? "", /extrapolated/);
});

test("a winning two-stop still offers the best one-stop as the alternative", () => {
  // A full second a lap on Softs that last 9 laps: the Soft-Medium-Soft
  // sandwich wins, and as the only two-stop shape it has no same-count
  // alternative, so the Medium-Hard one-stop has to fill in.
  const race: RaceSpec = {
    totalLaps: 30,
    stints: [
      { compound: "Soft", laps: 8, wearPerLap: 8, lapTimeMs: 89_500 },
      { compound: "Medium", laps: 10, wearPerLap: 5.5, lapTimeMs: 90_500 },
      { compound: "Hard", laps: 12, wearPerLap: 3.5, lapTimeMs: 90_900 },
    ],
  };
  const recommendation = recommend([race, race, race]);
  assert.deepEqual(recommendation.recommended?.compounds, [
    "Soft",
    "Medium",
    "Soft",
  ]);
  assert.equal(recommendation.alternative?.pitWindows.length, 1);
});

test("a tyre that cannot last an even third gets a wear-balanced two-stop", () => {
  // Zandvoort-like: 12-12-12 takes the Medium past the cap and neither tyre
  // pair can one-stop 36 laps, so the sandwich gives the Hard the extra laps.
  const plan = recommend([
    {
      totalLaps: 36,
      stints: [
        { compound: "Medium", laps: 10, wearPerLap: 6.3 },
        { compound: "Hard", laps: 12, wearPerLap: 4.8 },
      ],
    },
  ]).recommended;
  assert.ok(plan);
  assert.deepEqual(plan.compounds, ["Medium", "Hard", "Medium"]);
  assert.deepEqual(plan.stintLaps, [11, 14, 11]);
  assert.ok(
    plan.stintWearPercentages.every((wear) => wear <= PUNCTURE_THRESHOLD),
  );
});

test("one short stint cannot set a compound's pace", () => {
  // Medium and Hard carry three races of clean laps. The only Soft laps come
  // from the end of one race behind a late Safety Car and look 1.4 s quicker,
  // enough to win a Soft-Medium-Soft plan on pace alone if believed.
  const race = (mediumLaps: number): RaceSpec => ({
    totalLaps: 29,
    stints: [
      {
        compound: "Medium",
        laps: mediumLaps,
        wearPerLap: 6,
        lapTimeMs: 92_400,
      },
      {
        compound: "Hard",
        laps: 29 - mediumLaps,
        wearPerLap: 3.7,
        lapTimeMs: 92_600,
      },
    ],
  });
  const plan = recommend([
    race(10),
    race(11),
    {
      totalLaps: 29,
      safetyCarLaps: [23, 24, 25],
      stints: [
        { compound: "Medium", laps: 8, wearPerLap: 6, lapTimeMs: 92_400 },
        { compound: "Hard", laps: 14, wearPerLap: 3.7, lapTimeMs: 92_600 },
        {
          compound: "Soft",
          laps: 7,
          wear: [1.02, 2.01, 7.18, 12.86, 19.09, 24.98, 32.55],
          lapTimeMs: 91_000,
        },
      ],
    },
  ]).recommended;
  assert.ok(plan);
  assert.ok(!plan.compounds.includes("Soft"), plan.compounds.join(" > "));
});

function paceContext(races: RaceSpec[]) {
  const sessions = races.map(buildRace);
  const entries = sessions.map((session, index) => ({
    session,
    player: session["classification-data"]![0]!,
    totalLaps: races[index]!.totalLaps,
    isFullDistance: true,
  }));
  const context = buildTimingContext(
    entries,
    entries,
    rankDryCompoundsByPace(aggregateCompoundLife(sessions)),
  );
  assert.ok(context);
  return context;
}

function paceGapMs(
  context: ReturnType<typeof paceContext>,
  slower: string,
  faster: string,
) {
  const { offsetsMs } = context.paceModel;
  return offsetsMs.get(slower)! - offsetsMs.get(faster)!;
}

/** Medium then Hard, the Hard 0.3 s a lap slower on fresh tyres and an empty
 *  tank. Its laps come later and lighter, so on the timing screen it looks
 *  quicker. */
const mediumHardRace = (baseMs: number, extra: Partial<RaceSpec> = {}) => ({
  totalLaps: 29,
  stints: [
    { compound: "Medium", laps: 12, wearPerLap: 5, lapTimeMs: baseMs },
    { compound: "Hard", laps: 17, wearPerLap: 3.5, lapTimeMs: baseMs + 300 },
  ],
  ...extra,
});

test("compound pace compares tyres within each race, on an empty tank and fresh tyres", () => {
  const context = paceContext([
    mediumHardRace(91_000),
    // A later race, 0.8 s quicker all round.
    mediumHardRace(90_200),
    // A slow early partial race on Mediums alone says nothing about tyres.
    {
      totalLaps: 29,
      stints: [
        { compound: "Medium", laps: 9, wearPerLap: 5, lapTimeMs: 92_500 },
      ],
    },
  ]);
  assert.ok(Math.abs(paceGapMs(context, "Hard", "Medium") - 300) < 80);
});

test("a race saved twice counts once towards pace evidence", () => {
  const softRace: RaceSpec = {
    totalLaps: 29,
    sessionUid: 7,
    stints: [
      { compound: "Soft", laps: 8, wearPerLap: 7, lapTimeMs: 89_000 },
      { compound: "Medium", laps: 21, wearPerLap: 3, lapTimeMs: 90_800 },
    ],
  };
  const context = paceContext([
    mediumHardRace(91_000),
    mediumHardRace(91_000),
    softRace,
    softRace,
  ]);
  assert.ok(context.paceModel.assumedCompounds?.has("Soft"));
  // A plan on that Soft is a guess about the tyre, and says so.
  const score = scoreShape(
    {
      compounds: ["Soft", "Medium"],
      stintLaps: [9, 20],
      stintWearPercentages: [63, 60],
    },
    context,
  );
  assert.equal(score.paceConfidence, "low");
  assert.match(score.paceSource, /Soft pace assumed/);
});

test("an unmeasured compound sits between the measured ones", () => {
  const softHardRace: RaceSpec = {
    totalLaps: 29,
    stints: [
      { compound: "Soft", laps: 10, wearPerLap: 6, lapTimeMs: 90_600 },
      { compound: "Hard", laps: 19, wearPerLap: 3.5, lapTimeMs: 91_400 },
    ],
  };
  const context = paceContext([
    softHardRace,
    softHardRace,
    // Mediums only in a one-compound race: tyre life, but no pace evidence.
    {
      totalLaps: 29,
      stints: [
        { compound: "Medium", laps: 9, wearPerLap: 5, lapTimeMs: 91_000 },
      ],
    },
  ]);
  assert.ok(context.paceModel.assumedCompounds?.has("Medium"));
  assert.ok(Math.abs(paceGapMs(context, "Medium", "Soft") - 400) < 80);
  assert.ok(Math.abs(paceGapMs(context, "Hard", "Medium") - 400) < 80);
});

test("a compound measured out of order is set aside, not the whole model", () => {
  // Two short Soft stints read slower than the Medium, which a fresh Soft
  // never is; the Medium and Hard laps still say something.
  const slowSoftRace: RaceSpec = {
    totalLaps: 29,
    stints: [
      { compound: "Soft", laps: 5, wearPerLap: 7, lapTimeMs: 91_600 },
      { compound: "Medium", laps: 24, wearPerLap: 3, lapTimeMs: 91_000 },
    ],
  };
  const context = paceContext([
    mediumHardRace(91_000),
    mediumHardRace(91_000),
    slowSoftRace,
    slowSoftRace,
  ]);
  assert.ok(context.paceModel.assumedCompounds?.has("Soft"));
  assert.ok(paceGapMs(context, "Medium", "Soft") > 0);
  assert.ok(Math.abs(paceGapMs(context, "Hard", "Medium") - 300) < 80);
});

test("plans the model can't separate start on the softer tyre", () => {
  // Medium-first and Hard-first one-stops score within rounding here; most
  // of the field starts on the Medium, and so does the recommendation.
  const recommendation = recommend([
    mediumHardRace(91_000),
    mediumHardRace(91_000),
  ]);
  const plan = recommendation.recommended;
  assert.ok(plan);
  assert.deepEqual(plan.compounds, ["Medium", "Hard"]);
  // The Hard-first mirror is a touch faster by the model, and the deltas
  // still measure from it.
  assert.deepEqual(recommendation.alternative?.compounds, ["Hard", "Medium"]);
  assert.equal(recommendation.alternative?.timeEstimate?.deltaToFastestMs, 0);
  assert.ok((plan.timeEstimate?.deltaToFastestMs ?? 0) > 0);
});

test("long high-wear races get a Medium-Hard-Medium sandwich even with Softs", () => {
  // Softs last 8 laps and neither one-stop reaches 36 laps, so the only
  // workable plan is the field's usual Medium-Hard-Medium.
  const race: RaceSpec = {
    totalLaps: 36,
    stints: [
      { compound: "Soft", laps: 6, wearPerLap: 9.4 },
      { compound: "Medium", laps: 12, wearPerLap: 5.8 },
      { compound: "Hard", laps: 14, wearPerLap: 5 },
    ],
  };
  const plan = recommend([race, race]).recommended;
  assert.ok(plan);
  assert.deepEqual(plan.compounds, ["Medium", "Hard", "Medium"]);
});

test("F2 feature races one-stop on the two compounds they have", () => {
  const race: RaceSpec = {
    totalLaps: 19,
    formula: "F2",
    sessionType: "Race 2",
    stints: [
      { compound: "Soft", laps: 6, wearPerLap: 8.5 },
      { compound: "Hard", laps: 13, wearPerLap: 3.9 },
    ],
  };
  const plan = recommend([race, race]).recommended;
  assert.ok(plan);
  assert.deepEqual([...plan.compounds].sort(), ["Hard", "Soft"]);
  assert.equal(plan.pitWindows.length, 1);
});

test("F2 sprints run to the flag when one set lasts", () => {
  const race: RaceSpec = {
    totalLaps: 11,
    formula: "F2",
    sessionType: "Race",
    stints: [{ compound: "Hard", laps: 11, wearPerLap: 4 }],
  };
  const plan = recommend([race, race]).recommended;
  assert.ok(plan);
  assert.deepEqual(plan.compounds, ["Hard"]);
  assert.equal(plan.pitWindows.length, 0);
});
