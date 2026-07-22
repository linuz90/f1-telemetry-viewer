import assert from "node:assert/strict";
import test from "node:test";
import {
  buildDriverSpeedComparison,
  buildSessionSpeedAnalysis,
} from "../src/analysis/speedAnalysis";
import { buildTrackInsights } from "../src/analysis/dashboardInsights";
import type { DashboardResultStats } from "../src/analysis/dashboardResultStats";
import { curateSessionInsights } from "../src/analysis/sessionInsightCuration";
import type { SessionInsight } from "../src/analysis/sessionInsightSummary";
import { buildTrackSessionData } from "../src/analysis/trackAnalysis";
import type {
  CarDamage,
  DriverData,
  LapHistoryEntry,
  PerLapInfo,
  SessionSummary,
  TelemetrySession,
} from "../src/types/telemetry";

const NO_DAMAGE: CarDamage = {
  "tyres-wear": [0, 0, 0, 0],
  "tyres-damage": [0, 0, 0, 0],
  "front-left-wing-damage": 0,
  "front-right-wing-damage": 0,
  "rear-wing-damage": 0,
  "floor-damage": 0,
  "diffuser-damage": 0,
  "sidepod-damage": 0,
  "drs-fault": false,
  "ers-fault": false,
};

function completeLap(timeMs = 90_000): LapHistoryEntry {
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

function perLap(lap: number, speed: number, ersMj = 2): PerLapInfo {
  return {
    "lap-number": lap,
    "car-damage-data": NO_DAMAGE,
    "car-status-data": {
      "actual-tyre-compound": "C3",
      "visual-tyre-compound": "Medium",
      "tyres-age-laps": lap,
      "fuel-in-tank": 50 - lap,
      "fuel-remaining-laps": 10,
      "engine-power-ice": 500_000,
    },
    "ers-stats": { "ers-deployed-j": ersMj * 1_000_000 },
    "max-safety-car-status": "NO_SAFETY_CAR",
    "top-speed-kmph": speed,
  };
}

function driver(
  index: number,
  name: string,
  speeds: number[],
  options: {
    sessionPeak?: number | null;
    trap?: { speed: number; lap: number };
    telemetry?: "Public" | "Restricted";
    ersMj?: number;
  } = {},
): DriverData {
  const laps = speeds.map(() => completeLap());
  return {
    index,
    "is-player": index === 0,
    "driver-name": name,
    team: "Test",
    "track-position": index + 1,
    "current-lap": laps.length,
    "top-speed-kmph": options.sessionPeak ?? Math.max(...speeds),
    "participant-data": {
      "telemetry-setting": options.telemetry ?? "Public",
    },
    "car-damage": NO_DAMAGE,
    "car-status": {} as DriverData["car-status"],
    "session-history": {
      "num-laps": laps.length,
      "num-tyre-stints": 1,
      "best-lap-time-lap-num": 1,
      "best-sector-1-lap-num": 1,
      "best-sector-2-lap-num": 1,
      "best-sector-3-lap-num": 1,
      "lap-history-data": laps,
      "tyre-stints-history-data": [],
    },
    "final-classification": null,
    "lap-data": {
      ...(options.trap
        ? {
            "speed-trap-fastest-speed": options.trap.speed,
            "speed-trap-fastest-lap": options.trap.lap,
          }
        : {}),
    } as DriverData["lap-data"],
    "tyre-set-history": [
      {
        "start-lap": 1,
        "end-lap": laps.length,
        "stint-length": laps.length,
        "fitted-index": 0,
        "tyre-set-key": "test",
        "tyre-set-data": {
          "actual-tyre-compound": "C3",
          "visual-tyre-compound": "Medium",
          wear: 0,
          available: true,
          "recommended-session": "Race",
          "life-span": laps.length,
          "usable-life": laps.length,
          "lap-delta-time": 0,
          fitted: true,
        },
        "tyre-wear-history": [],
      },
    ],
    "per-lap-info": [
      perLap(0, 999, options.ersMj),
      ...speeds.map((speed, lap) => perLap(lap + 1, speed, options.ersMj)),
    ],
  } as DriverData;
}

function session(
  drivers: DriverData[],
  options: {
    equalCars?: boolean;
    traps?: Array<{ name: string; speed: number }>;
    sessionType?: string;
    weather?: string;
  } = {},
): TelemetrySession {
  return {
    "session-info": {
      "session-type": options.sessionType ?? "Race",
      weather: options.weather ?? "Clear",
      "equal-car-performance": options.equalCars ?? true,
    },
    "classification-data": drivers,
    "speed-trap-records": (options.traps ?? []).map((trap, index) => ({
      name: trap.name,
      team: "Test",
      "driver-number": index + 1,
      "speed-trap-record-kmph": trap.speed,
    })),
  } as TelemetrySession;
}

test("completed laps replace a stale raw peak and lap zero is ignored", () => {
  const subject = driver(0, "Player", [330, 332, 336], { sessionPeak: 60 });
  const profile = buildSessionSpeedAnalysis(session([subject])).profiles.get(
    0,
  )!;

  assert.deepEqual(profile.sessionPeak, {
    kmh: 336,
    lap: 3,
    source: "completed-lap",
    quality: "good",
    rank: 1,
    fieldSize: 1,
  });
  assert.deepEqual(
    profile.lapPeaks.map(({ lap }) => lap),
    [1, 2, 3],
  );
});

test("track-limit invalidation does not erase a structurally complete peak", () => {
  const subject = driver(0, "Player", [330, 336], { sessionPeak: 336 });
  subject["session-history"]["lap-history-data"][1]["lap-valid-bit-flags"] = 0;

  assert.equal(
    buildSessionSpeedAnalysis(session([subject])).profiles.get(0)?.sessionPeak
      ?.kmh,
    336,
  );
});

test("the 1.15x median rule rejects impossible lap and session peaks", () => {
  const subject = driver(0, "Player", [330, 332, 486, 334], {
    sessionPeak: 486,
  });
  const profile = buildSessionSpeedAnalysis(session([subject])).profiles.get(
    0,
  )!;

  assert.equal(profile.sessionPeak?.kmh, 334);
  assert.deepEqual(profile.lapPeaks[2], {
    lap: 3,
    kmh: 486,
    accepted: false,
    rejectionReasons: ["glitch"],
  });
});

test("the physical ceiling rejects a lone 486 km/h partial-session spike", () => {
  const subject = driver(0, "Player", [486], { sessionPeak: 486 });
  const profile = buildSessionSpeedAnalysis(session([subject])).profiles.get(
    0,
  )!;

  assert.equal(profile.sessionPeak, null);
  assert.deepEqual(profile.lapPeaks[0], {
    lap: 1,
    kmh: 486,
    accepted: false,
    rejectionReasons: ["glitch"],
  });
});

test("credible completed-lap peaks use competition ranks for ties", () => {
  const analysis = buildSessionSpeedAnalysis(
    session([
      driver(0, "A", [330, 340]),
      driver(1, "B", [335, 340]),
      driver(2, "C", [330, 339]),
      driver(3, "Fallback", [], { sessionPeak: 341 }),
    ]),
  );

  assert.equal(analysis.profiles.get(0)?.sessionPeak?.rank, 1);
  assert.equal(analysis.profiles.get(1)?.sessionPeak?.rank, 1);
  assert.equal(analysis.profiles.get(2)?.sessionPeak?.rank, 3);
  assert.equal(analysis.profiles.get(3)?.sessionPeak?.rank, undefined);
  assert.equal(analysis.profiles.get(3)?.sessionPeak?.quality, "limited");
});

test("nearest-rank P80 is exposed only after eight eligible clean laps", () => {
  const enough = driver(
    0,
    "Enough",
    [299, 300, 301, 302, 303, 304, 305, 306, 307],
  );
  const short = driver(1, "Short", [299, 300, 301, 302, 303, 304, 305, 306]);
  const analysis = buildSessionSpeedAnalysis(session([enough, short]));

  assert.deepEqual(analysis.profiles.get(0)?.representativeHighSpeed, {
    kmh: 306,
    percentile: 80,
    eligibleLapCount: 8,
    quality: "good",
  });
  assert.equal(analysis.profiles.get(1)?.representativeHighSpeed, null);
});

test("trap lap attribution requires a unique normalized name and matching value", () => {
  const player = driver(0, "Jean\u00a0Luc", [320, 322, 324], {
    trap: { speed: 321, lap: 2 },
  });
  const mismatch = driver(1, "Mismatch", [318, 320, 322], {
    trap: { speed: 319.5, lap: 2 },
  });
  const analysis = buildSessionSpeedAnalysis(
    session([player, mismatch], {
      traps: [
        { name: "Jean Luc", speed: 321 },
        { name: "Mismatch", speed: 319 },
      ],
    }),
  );

  assert.equal(analysis.profiles.get(0)?.speedTrap?.lap, 2);
  assert.equal(analysis.profiles.get(0)?.speedTrap?.quality, "good");
  assert.equal(analysis.profiles.get(1)?.speedTrap?.lap, undefined);
  assert.equal(analysis.profiles.get(1)?.speedTrap?.quality, "unattributed");
});

test("suspect trap records are removed from values and rank denominators", () => {
  const glitched = driver(0, "Glitched", [320, 322, 324], {
    trap: { speed: 486, lap: 2 },
  });
  const credible = driver(1, "Credible", [318, 320, 322], {
    trap: { speed: 321, lap: 2 },
  });
  const analysis = buildSessionSpeedAnalysis(
    session([glitched, credible], {
      traps: [
        { name: "Glitched", speed: 486 },
        { name: "Credible", speed: 321 },
      ],
    }),
  );

  assert.equal(analysis.profiles.get(0)?.speedTrap, null);
  assert.equal(analysis.profiles.get(1)?.speedTrap?.rank, 1);
  assert.equal(analysis.profiles.get(1)?.speedTrap?.fieldSize, 1);
});

test("opposing paired and trap directions return an explicit conflict", () => {
  const focused = driver(0, "Focused", Array(9).fill(330), {
    trap: { speed: 310, lap: 2 },
  });
  const rival = driver(1, "Rival", Array(9).fill(320), {
    trap: { speed: 320, lap: 2 },
  });
  const race = session([focused, rival], {
    traps: [
      { name: "Focused", speed: 310 },
      { name: "Rival", speed: 320 },
    ],
  });
  const comparison = buildDriverSpeedComparison(race, 0, 1)!;

  assert.equal(comparison.comparableLapCount, 8);
  assert.equal(comparison.pairedMedianDeltaKmh, 10);
  assert.equal(comparison.pairedDirectionAgreement, 1);
  assert.deepEqual(comparison.pairedRepresentative, {
    focusedKmh: 330,
    rivalKmh: 320,
    percentile: 80,
  });
  assert.equal(comparison.interpretation.verdict, "inconclusive");
  assert.ok(comparison.interpretation.reasons.includes("signals-conflict"));
});

test("a neutral paired result stays inconclusive without an eligible trap", () => {
  const race = session([
    driver(0, "Focused", Array(9).fill(330)),
    driver(1, "Rival", Array(9).fill(329)),
  ]);
  const comparison = buildDriverSpeedComparison(race, 0, 1)!;

  assert.equal(comparison.interpretation.verdict, "inconclusive");
  assert.equal(comparison.interpretation.confidence, null);
  assert.ok(comparison.interpretation.reasons.includes("missing-trap"));
});

test("three to four pairs keep metrics but leave the aero verdict unavailable", () => {
  const fourLapRace = session([
    driver(0, "Focused", [300, 310, 310, 310, 310]),
    driver(1, "Rival", [300, 300, 300, 300, 300]),
  ]);
  const twoLapRace = session([
    driver(0, "Focused", [300, 310, 310]),
    driver(1, "Rival", [300, 300, 300]),
  ]);

  assert.equal(
    buildDriverSpeedComparison(fourLapRace, 0, 1)?.interpretation.verdict,
    "unavailable",
  );
  assert.equal(
    buildDriverSpeedComparison(twoLapRace, 0, 1)?.interpretation.verdict,
    "unavailable",
  );
});

test("equal cars enable aero language while Restricted telemetry caps confidence", () => {
  const makeRace = (equalCars: boolean, telemetry: "Public" | "Restricted") => {
    const focused = driver(0, "Focused", Array(9).fill(330), {
      trap: { speed: 330, lap: 2 },
    });
    const rival = driver(1, "Rival", Array(9).fill(320), {
      trap: { speed: 320, lap: 2 },
      telemetry,
    });
    return session([focused, rival], {
      equalCars,
      traps: [
        { name: "Focused", speed: 330 },
        { name: "Rival", speed: 320 },
      ],
    });
  };

  const publicEqual = buildDriverSpeedComparison(
    makeRace(true, "Public"),
    0,
    1,
  )!;
  assert.equal(publicEqual.interpretation.verdict, "rival-higher-load");
  assert.equal(publicEqual.interpretation.confidence, "medium");

  const missingErsRace = makeRace(true, "Public");
  for (const candidate of missingErsRace["classification-data"]) {
    for (const lap of candidate["per-lap-info"] ?? []) {
      delete lap["ers-stats"];
    }
  }
  const missingErs = buildDriverSpeedComparison(missingErsRace, 0, 1)!;
  assert.equal(missingErs.interpretation.verdict, "rival-higher-load");
  assert.equal(missingErs.pairedErsDeltaMj, null);
  assert.equal(missingErs.interpretation.confidence, "low");

  const restricted = buildDriverSpeedComparison(
    makeRace(true, "Restricted"),
    0,
    1,
  )!;
  assert.equal(restricted.interpretation.verdict, "rival-higher-load");
  assert.equal(restricted.interpretation.confidence, "low");
  assert.ok(restricted.interpretation.reasons.includes("restricted-telemetry"));

  const unequal = buildDriverSpeedComparison(makeRace(false, "Public"), 0, 1)!;
  assert.equal(unequal.interpretation.verdict, "inconclusive");
  assert.equal(unequal.interpretation.mode, "straight-line-description");
  assert.ok(unequal.interpretation.reasons.includes("unequal-cars"));

  const unknown = makeRace(true, "Public");
  delete unknown["session-info"]["equal-car-performance"];
  const unknownComparison = buildDriverSpeedComparison(unknown, 0, 1)!;
  assert.ok(
    unknownComparison.interpretation.reasons.includes("equal-cars-unknown"),
  );
  assert.ok(!unknownComparison.interpretation.reasons.includes("unequal-cars"));
});

test("wet, non-race, and partial sessions make the aero verdict unavailable", () => {
  const focused = driver(0, "Focused", Array(9).fill(330), {
    trap: { speed: 330, lap: 2 },
  });
  const rival = driver(1, "Rival", Array(9).fill(320), {
    trap: { speed: 320, lap: 2 },
  });
  const traps = [
    { name: "Focused", speed: 330 },
    { name: "Rival", speed: 320 },
  ];

  const wet = buildDriverSpeedComparison(
    session([focused, rival], { weather: "Heavy Rain", traps }),
    0,
    1,
  )!;
  assert.equal(wet.interpretation.verdict, "unavailable");
  assert.ok(wet.interpretation.reasons.includes("wet-or-mixed"));

  const qualifying = buildDriverSpeedComparison(
    session([focused, rival], { sessionType: "Short Qualifying", traps }),
    0,
    1,
  )!;
  assert.equal(qualifying.interpretation.verdict, "unavailable");
  assert.ok(qualifying.interpretation.reasons.includes("not-race"));

  const partialSession = session([focused, rival], { traps });
  partialSession["session-info"]["total-laps"] = 25;
  const partial = buildDriverSpeedComparison(partialSession, 0, 1)!;
  assert.equal(partial.interpretation.verdict, "unavailable");
  assert.ok(partial.interpretation.reasons.includes("partial-session"));
});

test("five to seven clean pairs support only a Low-confidence tendency", () => {
  const focused = driver(0, "Focused", Array(7).fill(330), {
    trap: { speed: 330, lap: 2 },
  });
  const rival = driver(1, "Rival", Array(7).fill(320), {
    trap: { speed: 320, lap: 2 },
  });
  const comparison = buildDriverSpeedComparison(
    session([focused, rival], {
      traps: [
        { name: "Focused", speed: 330 },
        { name: "Rival", speed: 320 },
      ],
    }),
    0,
    1,
  )!;

  assert.equal(comparison.comparableLapCount, 6);
  assert.equal(comparison.interpretation.verdict, "rival-higher-load");
  assert.equal(comparison.interpretation.confidence, "low");
});

test("tyre mismatch and an ineligible trap lap block aero inference", () => {
  const focused = driver(0, "Focused", Array(9).fill(330), {
    trap: { speed: 330, lap: 2 },
  });
  const mismatched = driver(1, "Mismatch", Array(9).fill(320), {
    trap: { speed: 320, lap: 2 },
  });
  for (const lap of mismatched["per-lap-info"] ?? []) {
    lap["car-status-data"]["visual-tyre-compound"] = "Hard";
  }
  const mismatchComparison = buildDriverSpeedComparison(
    session([focused, mismatched], {
      traps: [
        { name: "Focused", speed: 330 },
        { name: "Mismatch", speed: 320 },
      ],
    }),
    0,
    1,
  )!;
  assert.equal(mismatchComparison.comparableLapCount, 0);
  assert.ok(
    mismatchComparison.interpretation.reasons.includes(
      "compound-or-age-mismatch",
    ),
  );

  const damaged = driver(0, "Damaged", Array(9).fill(330), {
    trap: { speed: 330, lap: 2 },
  });
  damaged["per-lap-info"]![2]!["car-damage-data"] = {
    ...NO_DAMAGE,
    "front-left-wing-damage": 5,
  };
  const clean = driver(1, "Clean", Array(9).fill(320), {
    trap: { speed: 320, lap: 2 },
  });
  const damagedTrapComparison = buildDriverSpeedComparison(
    session([damaged, clean], {
      traps: [
        { name: "Damaged", speed: 330 },
        { name: "Clean", speed: 320 },
      ],
    }),
    0,
    1,
  )!;
  assert.equal(damagedTrapComparison.interpretation.verdict, "inconclusive");
  assert.ok(
    damagedTrapComparison.interpretation.reasons.includes(
      "trap-lap-ineligible",
    ),
  );
});

test("weak, inconsistent, ERS-heavy, and all-sector pace signals stay inconclusive", () => {
  const makeComparison = (
    focused: DriverData,
    rival: DriverData,
    focusedTrap: number,
    rivalTrap: number,
  ) =>
    buildDriverSpeedComparison(
      session([focused, rival], {
        traps: [
          { name: focused["driver-name"], speed: focusedTrap },
          { name: rival["driver-name"], speed: rivalTrap },
        ],
      }),
      focused.index,
      rival.index,
    )!;

  const weak = makeComparison(
    driver(0, "Weak focused", Array(9).fill(324), {
      trap: { speed: 324, lap: 2 },
    }),
    driver(1, "Weak rival", Array(9).fill(320), {
      trap: { speed: 320, lap: 2 },
    }),
    324,
    320,
  );
  assert.ok(weak.interpretation.reasons.includes("weak-speed-difference"));

  const inconsistent = makeComparison(
    driver(0, "Variable focused", Array(9).fill(330), {
      trap: { speed: 330, lap: 2 },
    }),
    driver(1, "Variable rival", [320, 320, 320, 320, 320, 320, 340, 340, 340], {
      trap: { speed: 320, lap: 2 },
    }),
    330,
    320,
  );
  assert.ok(
    inconsistent.interpretation.reasons.includes("low-direction-agreement"),
  );

  const ersBlocked = makeComparison(
    driver(0, "ERS focused", Array(9).fill(330), {
      trap: { speed: 330, lap: 2 },
      ersMj: 3.5,
    }),
    driver(1, "ERS rival", Array(9).fill(320), {
      trap: { speed: 320, lap: 2 },
      ersMj: 2,
    }),
    330,
    320,
  );
  assert.ok(
    ersBlocked.interpretation.reasons.includes("material-ers-difference"),
  );
  assert.equal(ersBlocked.pairedErsDeltaMj, 1.5);

  const paceFocused = driver(0, "Pace focused", Array(9).fill(330), {
    trap: { speed: 330, lap: 2 },
  });
  const paceRival = driver(1, "Pace rival", Array(9).fill(320), {
    trap: { speed: 320, lap: 2 },
  });
  for (const lap of paceFocused["session-history"]["lap-history-data"]) {
    lap["lap-time-in-ms"] = 87_000;
    lap["sector-1-time-in-ms"] = 29_000;
    lap["sector-2-time-in-ms"] = 29_000;
    lap["sector-3-time-in-ms"] = 29_000;
  }
  const paceBlocked = makeComparison(paceFocused, paceRival, 330, 320);
  assert.ok(
    paceBlocked.interpretation.reasons.includes("overall-pace-advantage"),
  );
  assert.deepEqual(paceBlocked.matchedSectorDeltasMs, [-1_000, -1_000, -1_000]);
});

test("Track Progress consumes the canonical peak instead of a stale raw scalar", () => {
  const subject = driver(0, "Player", [330, 336], { sessionPeak: 60 });
  const race = session([subject]);
  const summary = {
    relativePath: "test.json",
    slug: "test",
    sessionType: "Race",
    track: "Test",
    date: "2026-07-21T00:00:00Z",
    validLapCount: 2,
  } satisfies SessionSummary;

  assert.equal(buildTrackSessionData(summary, race)?.sessionPeakKmh, 336);
});

test("dashboard speed-trap rank normalizes placement across field sizes", () => {
  const summaries = [
    { rank: 5, total: 10 },
    { rank: 5, total: 22 },
    { rank: 5, total: 22 },
  ].map(
    ({ rank, total }, index) =>
      ({
        relativePath: `race-${index}.json`,
        slug: `race-${index}`,
        sessionType: "Race",
        track: "Test",
        date: `2026-07-${20 - index}T00:00:00Z`,
        gameYear: 26,
        validLapCount: 10,
        topSpeedTrapRank: rank,
        topSpeedTrapTotal: total,
      }) satisfies SessionSummary,
  );
  const stats = {
    scopedSessions: summaries,
    resultSessions: summaries,
    cleanFinishSessions: [],
    recentResults: [],
    trackResults: [],
    mode: "available-races",
    modeLabel: "Available races",
    modeDetail: "",
    totalLaps: 30,
    trackCount: 1,
    sessionCount: 3,
    starts: 3,
    wins: 0,
    p2: 0,
    p3: 0,
    topFive: 0,
    dnfCount: 0,
    pointsScored: 0,
    polePositions: 0,
    frontRowStarts: 0,
    gridStarts: 0,
  } satisfies DashboardResultStats;

  const insight = buildTrackInsights(stats).find(
    ({ kind }) => kind === "speed-trap-rank",
  );
  assert.equal(insight?.headline, "72%");
  assert.equal(insight?.detail, "speed-trap field percentile · 3 races");
});

test("dense race curation preserves separate speed and ERS cards", () => {
  const fact = (
    type: SessionInsight["type"],
    label: string,
  ): SessionInsight => ({ type, label, value: "Test", detail: "Test" });
  const denseInsights = [
    fact("result", "Result"),
    fact("lap", "Best Lap"),
    fact("race-flow", "Race Flow"),
    fact("context", "Neutralized Laps"),
    fact("pace", "Race Pace"),
    fact("tyre", "Tyre Management"),
    fact("fuel", "Fuel Strategy"),
    fact("sector", "Weakest Sector"),
    fact("speed", "Speed Profile"),
    fact("ers", "ERS Deploy"),
    fact("ers", "ERS Harvest"),
    fact("pit", "First Pit Stop"),
  ];
  const race = {
    "session-info": { "session-type": "Race" },
    "classification-data": [],
  } as unknown as TelemetrySession;

  const curated = curateSessionInsights(race, denseInsights);
  assert.equal(curated.length, 10);
  assert.ok(curated.some(({ label }) => label === "Speed Profile"));
  assert.ok(curated.some(({ label }) => label === "ERS Usage"));
  assert.equal(curateSessionInsights(race, denseInsights, 9).length, 9);
});
