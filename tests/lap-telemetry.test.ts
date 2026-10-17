import assert from "node:assert/strict";
import test from "node:test";
import {
  buildLapSeries,
  compareLaps,
  prepareLap,
  sectorGaps,
  TIP_FLOOR_S,
  type LapContext,
  type PreparedLap,
} from "../src/analysis/lapTelemetryAnalysis";
import {
  defaultComparison,
  defaultLapA,
  isSoloSelection,
  parseLapRefs,
  serializeLapRefs,
  type LapCandidate,
} from "../src/analysis/lapTelemetrySelection";
import {
  calibrateOutline,
  orderByLap,
  outlineFromPath,
  outlinePointAt,
} from "../src/analysis/trackOutline";
import type { LapRecordingSummary } from "../src/utils/lapRecording/types";
import {
  syntheticLap,
  type SyntheticChannels,
  type SyntheticLapOptions,
} from "../src/utils/lapRecording/syntheticLap";

const TRACK_LENGTH = 4000;
const CORNERS = [
  { apex: 1000, minKmh: 120 },
  { apex: 2500, minKmh: 160 },
];

function lap(
  key: string,
  options: Partial<SyntheticLapOptions> = {},
  context: Partial<LapContext> = {},
  /** Rewrite recorded inputs the synthetic model cannot express. */
  tweak?: (channels: SyntheticChannels) => void,
): PreparedLap {
  const { channels, lapTimeMs } = syntheticLap({
    trackLengthM: TRACK_LENGTH,
    corners: CORNERS,
    ...options,
  });
  tweak?.(channels);
  const trace = Object.fromEntries(
    Object.entries(channels).map(([name, values]) => [
      name,
      Float32Array.from(values),
    ]),
  );
  return prepareLap(
    trace,
    {
      key,
      driverName: "RUSSELL",
      team: "Mercedes '26",
      isPlayer: true,
      sessionType: "Short Qualifying",
      lapNumber: 1,
      lapTimeMs,
      compound: "Soft",
      ...context,
    },
    TRACK_LENGTH,
  );
}

function sumOfParts(comparison: ReturnType<typeof compareLaps>): number {
  return (
    comparison.tips.reduce((sum, tip) => sum + tip.timeS, 0) +
    comparison.remainderS
  );
}

test("identical laps produce no tips and a zero gap", () => {
  const comparison = compareLaps(lap("a"), lap("b"));
  assert.equal(comparison.totalS, 0);
  assert.deepEqual(comparison.tips, []);
});

test("the gap ends at the official lap-time difference and the tips add up to it", () => {
  const a = lap("a", { corners: [{ apex: 1000, minKmh: 112 }, CORNERS[1]] });
  const b = lap("b");
  const series = buildLapSeries([a, b]);
  const total = (a.context.lapTimeMs - b.context.lapTimeMs) / 1000;
  assert.ok(total > TIP_FLOOR_S);
  assert.ok(
    Math.abs(series.gaps[0].gapS[series.grid.length - 1] - total) < 1e-6,
  );
  const comparison = compareLaps(a, b);
  assert.ok(Math.abs(sumOfParts(comparison) - total) < 1e-6);
});

test("sector deltas put the loss in its sector and add up to the lap gap", () => {
  // A is slower through the 1000 m corner only, which sits in sector 1.
  const a = lap("a", { corners: [{ apex: 1000, minKmh: 112 }, CORNERS[1]] });
  const b = lap("b");
  const total = (a.context.lapTimeMs - b.context.lapTimeMs) / 1000;
  const [{ key, deltasS }] = sectorGaps(buildLapSeries([a, b]), [1800, 3000]);
  assert.equal(key, "b");
  assert.ok(Math.abs(deltasS[0] + deltasS[1] + deltasS[2] - total) < 1e-6);
  assert.ok(deltasS[0] > TIP_FLOOR_S);
  assert.ok(Math.abs(deltasS[1]) < TIP_FLOOR_S);
  assert.ok(Math.abs(deltasS[2]) < TIP_FLOOR_S);
});

test("braking 25 m earlier into a corner yields one braking tip there", () => {
  const a = lap("a", {
    corners: [{ apex: 1000, minKmh: 120, brakeFor: 175 }, CORNERS[1]],
  });
  const comparison = compareLaps(a, lap("b"));
  assert.equal(comparison.tips.length, 1);
  const [tip] = comparison.tips;
  assert.equal(tip.kind, "tip");
  assert.equal(tip.category, "Braking");
  assert.equal(tip.headline, "Brake later into the 1.00 km corner");
  assert.match(tip.evidence, /came off the throttle 2[4-6] m earlier/);
});

test("turn markers name corners, complexes and flat-out stretches", () => {
  // A speed dip at full throttle stands in for a turn taken without lifting.
  const options = {
    speedLoss: (d: number) => Math.max(0, 30 - Math.abs(d - 1800) * 0.3),
  };
  const corners = [
    { number: 1, distanceM: 900 }, // inside the braking zone
    { number: 2, distanceM: 1020 }, // just past the slowest point
    { number: 3, distanceM: 1400 }, // flat on the run out: names nothing
    { number: 4, distanceM: 1780 },
    { number: 5, distanceM: 2470 },
  ];
  const { units } = compareLaps(lap("a", options), lap("b", options), {
    corners,
  });
  assert.deepEqual(
    units.map((unit) => unit.name),
    [
      "the run to Turn 1",
      "Turns 1–2",
      "the straight from Turn 4 to Turn 5",
      "Turn 5",
    ],
  );
});

test("tips name the official turn, or lap distance when no marker is near", () => {
  const a = lap("a", {
    corners: [{ apex: 1000, minKmh: 120, brakeFor: 175 }, CORNERS[1]],
  });
  const headline = (distanceM: number) =>
    compareLaps(a, lap("b"), { corners: [{ number: 7, distanceM }] }).tips[0]
      .headline;
  assert.equal(headline(985), "Brake later into Turn 7");
  // 110 m past the slowest point: outside the corner, still the nearest turn.
  assert.equal(headline(1110), "Brake later into Turn 7");
  assert.equal(headline(1400), "Brake later into the 1.00 km corner");
});

test("a stale clock on alternate samples does not change the verdict", () => {
  const options = {
    corners: [{ apex: 1000, minKmh: 120, brakeFor: 175 }, CORNERS[1]],
  };
  const clean = compareLaps(lap("a", options), lap("b"));
  const stale = compareLaps(
    lap("a", { ...options, staleClock: true }),
    lap("b", { staleClock: true }),
  );
  assert.deepEqual(
    stale.tips.map((tip) => [tip.headline, tip.timeS.toFixed(2)]),
    clean.tips.map((tip) => [tip.headline, tip.timeS.toFixed(2)]),
  );
});

test("running out of battery on a straight is blamed on battery, not driving", () => {
  // Both deploy at the same rate along the straight after the 2.5 km corner,
  // but A arrives with half the energy, runs dry 450 m sooner and slows.
  const deploy = (stored: number) => (d: number) =>
    d < 2800 ? stored : Math.max(0, stored - ((d - 2800) / 900) * 1_500_000);
  const a = lap("a", {
    battery: deploy(750_000),
    speedLoss: (d) => (d > 3250 ? Math.min(10, (d - 3250) * 0.03) : 0),
  });
  const b = lap("b", { battery: deploy(1_500_000) });
  const comparison = compareLaps(a, b);
  assert.equal(comparison.tips.length, 1);
  const [tip] = comparison.tips;
  assert.equal(tip.category, "Battery");
  assert.equal(
    tip.headline,
    "Arrive at the straight out of the 2.50 km corner with more battery",
  );
  assert.match(
    tip.evidence,
    /^You arrived with 0\.75 MJ against 1\.50 MJ, ran dry 4[45]\d m sooner/,
  );
});

test("deploying less after a faster exit is still blamed on battery", () => {
  // A exits the 2.5 km corner 5 km/h faster but deploys half as much along the
  // straight and ends up slower. A faster entry cannot explain a loss, so
  // battery must not be ruled out by it (or the stretch called car or tow).
  const drain = (perM: number) => (d: number) =>
    d < 2800 ? 2_000_000 : 2_000_000 - (d - 2800) * perM;
  const a = lap("a", {
    corners: [CORNERS[0], { apex: 2500, minKmh: 166 }],
    battery: drain(500),
    speedLoss: (d) => (d > 3000 ? Math.min(14, (d - 3000) * 0.05) : 0),
  });
  const comparison = compareLaps(a, lap("b", { battery: drain(1000) }));
  assert.equal(comparison.tips.length, 1);
  assert.equal(comparison.tips[0].category, "Battery");
  assert.match(
    comparison.tips[0].evidence,
    /deployed 0\.60 MJ less .* despite entering 5 km\/h faster/,
  );
});

test("tips run in lap order so they match the numbers on the track map", () => {
  // The battery loss after the 2.5 km corner is bigger than the braking loss
  // at 1 km, but the braking tip comes first because it comes first in the lap.
  const deploy = (stored: number) => (d: number) =>
    d < 2800 ? stored : Math.max(0, stored - ((d - 2800) / 900) * 1_500_000);
  const a = lap("a", {
    corners: [{ apex: 1000, minKmh: 120, brakeFor: 165 }, CORNERS[1]],
    battery: deploy(750_000),
    speedLoss: (d) => (d > 3250 ? Math.min(10, (d - 3250) * 0.03) : 0),
  });
  const { tips } = compareLaps(a, lap("b", { battery: deploy(1_500_000) }));
  assert.deepEqual(
    tips.map((tip) => tip.category),
    ["Braking", "Battery"],
  );
  assert.ok(Math.abs(tips[1].timeS) > Math.abs(tips[0].timeS));
});

test("a flat-out difference with equal battery gets no driving advice", () => {
  const a = lap("a", { speedLoss: (d) => (d > 3000 && d < 3900 ? 6 : 0) });
  const comparison = compareLaps(a, lap("b"));
  assert.equal(comparison.tips.length, 1);
  assert.equal(comparison.tips[0].kind, "note");
  // Both laps are in the same car, so the car cannot be the difference.
  assert.match(comparison.tips[0].evidence, /setup, tow or wind/);
  const rival = compareLaps(a, lap("b", {}, { team: "Ferrari '26" }));
  assert.match(rival.tips[0].evidence, /car, setup or tow/);
});

test("a slower straight after a corner never puts the corner's time down to the car", () => {
  // Braking 25 m early costs about 0.155 s; the straight after costs more.
  const a = lap("a", {
    corners: [{ apex: 1000, minKmh: 120, brakeFor: 175 }, CORNERS[1]],
    speedLoss: (d) => (d > 1300 && d < 2200 ? 6 : 0),
  });
  const [tip] = compareLaps(a, lap("b")).tips;
  assert.doesNotMatch(tip.evidence, /no driving fix/);
  assert.match(tip.evidence, /plus 0\.1[56]\d s on the way in/);
});

test("a fast corner taken with a lift is a corner, and a late pick-up is blamed there", () => {
  // The car keeps scrubbing speed after the throttle is back, so the slowest
  // point (1800 m) comes after both laps are flat again. A is back on the
  // throttle 30 m later and slower until the slowest point.
  const dip = (extra: number) => (d: number) =>
    Math.max(0, 30 - Math.abs(d - 1800) * 0.3) +
    (d > 1720 && d < 1820 ? extra : 0);
  const liftUntil = (until: number) => (channels: SyntheticChannels) => {
    channels.lap_distance.forEach((d, i) => {
      if (d >= 1700 && d < until) channels.throttle[i] = 0;
    });
  };
  const a = lap("a", { speedLoss: dip(15) }, {}, liftUntil(1790));
  const b = lap("b", { speedLoss: dip(0) }, {}, liftUntil(1760));
  const comparison = compareLaps(a, b, {
    corners: [{ number: 4, distanceM: 1780 }],
  });
  const unit = comparison.units.find((entry) => entry.name === "Turn 4");
  assert.equal(unit?.kind, "corner");
  assert.ok(unit && Math.abs(unit.from - 1700) <= 4, `from ${unit?.from}`);
  assert.equal(comparison.tips.length, 1);
  const [tip] = comparison.tips;
  assert.equal(tip.headline, "Get back on the throttle sooner through Turn 4");
  assert.match(tip.evidence, /^Full throttle came 30 m later/);
});

test("a corner names the later turn when the time goes on its exit", () => {
  // Both laps lift again for a second turn after a 30 m stab of throttle, so
  // neither is flat until past it: the corner is "Turns 3–4", not "Turn 3".
  const secondLift = (channels: SyntheticChannels) => {
    channels.lap_distance.forEach((d, i) => {
      if (d >= 1090 && d < 1160) channels.throttle[i] = 40;
    });
  };
  const { units } = compareLaps(
    lap("a", {}, {}, secondLift),
    lap("b", {}, {}, secondLift),
    {
      corners: [
        { number: 3, distanceM: 985 },
        { number: 4, distanceM: 1150 },
      ],
    },
  );
  assert.equal(units[1].name, "Turns 3–4");
});

test("time won on the brakes and handed back on the exit still gets a note", () => {
  // A brakes 25 m later into the 1 km corner and is slower out of it by about
  // as much: under the floor net, but far too big a swing to hide.
  const a = lap("a", {
    corners: [{ apex: 1000, minKmh: 120, brakeFor: 125 }, CORNERS[1]],
    speedLoss: (d) => (d > 1000 && d < 1300 ? 4.5 : 0),
  });
  const comparison = compareLaps(a, lap("b"));
  assert.equal(comparison.tips.length, 1);
  const [tip] = comparison.tips;
  assert.ok(Math.abs(tip.timeS) < TIP_FLOOR_S, `net ${tip.timeS}`);
  assert.equal(tip.kind, "note");
  assert.match(
    tip.headline,
    /^Gained 0\.\d{3} s braking into the 1\.00 km corner, offset in the same corner$/,
  );
  assert.match(
    tip.evidence,
    /0\.\d{3} s gained, 0\.\d{3} s given back after\.$/,
  );
  // The gap is stored as 32-bit floats, good to about a microsecond.
  assert.ok(Math.abs(sumOfParts(comparison) - comparison.totalS) < 1e-5);
});

test("battery kept by a slow exit is linked to the straight it pays back on", () => {
  // A is slower through the 1 km corner and spends 0.4 MJ less out of it. On
  // the straight after the 2.5 km corner that energy keeps A from running dry.
  const store = (keptJ: number) => (d: number) => {
    const afterFirst =
      2_000_000 - Math.min(Math.max(d - 1000, 0) / 300, 1) * (800_000 - keptJ);
    return d < 2800
      ? afterFirst
      : Math.max(0, afterFirst - ((d - 2800) / 900) * 1_500_000);
  };
  const a = lap("a", {
    corners: [{ apex: 1000, minKmh: 112 }, CORNERS[1]],
    battery: store(400_000),
  });
  const b = lap("b", {
    battery: store(0),
    speedLoss: (d) => (d > 3550 ? Math.min(10, (d - 3550) * 0.03) : 0),
  });
  const { tips } = compareLaps(a, b);
  assert.deepEqual(
    tips.map((tip) => [tip.kind, tip.category]),
    [
      ["tip", "Mid-corner"],
      ["keep", "Battery"],
    ],
  );
  assert.match(
    tips[0].evidence,
    /The battery saved here won 0\.\d{3} s on the straight out of the 2\.50 km corner\.$/,
  );
  assert.match(
    tips[1].evidence,
    /Most of that came from the 1\.00 km corner, where you used 0\.40 MJ less\.$/,
  );
});

test("another driver's lap A is described, not advised", () => {
  const options = {
    corners: [{ apex: 1000, minKmh: 120, brakeFor: 175 }, CORNERS[1]],
  };
  const comparison = compareLaps(
    lap("a", options, {
      driverName: "LECLERC",
      isPlayer: false,
      team: "Ferrari '26",
    }),
    lap("b"),
  );
  assert.equal(comparison.advice, false);
  assert.match(
    comparison.tips[0].headline,
    /^Lost 0\.\d{3} s braking into the 1\.00 km corner$/,
  );
  assert.match(comparison.tips[0].evidence, /^Leclerc came off the throttle/);
  assert.deepEqual(
    comparison.comparability.find((item) => item.id === "car"),
    { id: "car", label: "Ferrari '26 vs Mercedes '26", tone: "differs" },
  );
});

// --- Selection -------------------------------------------------------------

const recording = (slug: string, playerIndex = 21): LapRecordingSummary => ({
  slug,
  sessionType: "Race",
  track: "Melbourne",
  date: "2026-10-05T17:00:04",
  trackLengthM: 5276,
  playerIndex,
  completeLapCount: 0,
  drivers: [],
});

function candidate(
  slug: string,
  driverIndex: number,
  lapNumber: number,
  lapTimeMs: number,
  extra: Partial<LapCandidate> = {},
): LapCandidate {
  return {
    ref: { recordingSlug: slug, driverIndex, lapNumber },
    lapTimeMs,
    driverName: `D${driverIndex}`,
    isPlayer: driverIndex === 21,
    recording: recording(slug),
    eligible: true,
    valid: true,
    pitLap: false,
    standingStart: false,
    ...extra,
  };
}

test("default laps: focused driver first, then the rival, else the quickest lap", () => {
  const pool = [
    candidate("race", 21, 2, 92_741),
    candidate("race", 16, 2, 92_405),
    candidate("race", 14, 2, 92_490),
    candidate("race", 21, 1, 103_467, { eligible: false, standingStart: true }),
    candidate("race", 16, 1, 101_492, { eligible: false, standingStart: true }),
  ];
  const a = defaultLapA(pool, { recordingSlug: "race", driverIndex: 21 })!;
  assert.deepEqual(a.ref, {
    recordingSlug: "race",
    driverIndex: 21,
    lapNumber: 2,
  });
  assert.equal(defaultComparison(a, pool)?.ref.driverIndex, 16);
  assert.equal(
    defaultComparison(a, pool, { rivalDriverIndex: 14 })?.ref.driverIndex,
    14,
  );
  // A standing start is only compared with another standing start.
  assert.deepEqual(defaultComparison(pool[3], pool)?.ref, pool[4].ref);
});

test("the fastest lap compares with the player's best from another run", () => {
  const pool = [
    candidate("q-2049", 21, 1, 77_164),
    candidate("q-2053", 21, 1, 77_268),
    candidate("q-2049", 3, 1, 77_666),
  ];
  const a = defaultLapA(pool, {})!;
  assert.equal(a.lapTimeMs, 77_164);
  assert.equal(defaultComparison(a, pool)?.lapTimeMs, 77_268);
});

test("lap refs in the URL ignore junk and duplicates", () => {
  assert.deepEqual(
    parseLapRefs(
      "race-a~21~2,race-a~21~2,../x~1~1,race-b~3~x,race-b~~,race-b~0x3~1,race-b~3~1",
    ),
    [
      { recordingSlug: "race-a", driverIndex: 21, lapNumber: 2 },
      { recordingSlug: "race-b", driverIndex: 3, lapNumber: 1 },
    ],
  );
});

test("a lone lap round-trips as solo; an entry-point ref does not", () => {
  const a = { recordingSlug: "race-a", driverIndex: 21, lapNumber: 2 };
  const solo = serializeLapRefs([a]);
  assert.equal(solo, "race-a~21~2,solo");
  assert.deepEqual(parseLapRefs(solo), [a]);
  assert.ok(isSoloSelection(solo));
  assert.ok(!isSoloSelection("race-a~21~2"));
  assert.ok(!isSoloSelection(serializeLapRefs([a, { ...a, lapNumber: 3 }])));
});

// --- Track outline -----------------------------------------------------------

function polygonOutline(corners: [number, number][], count: number) {
  const segments = corners.map(
    (point, i) => [point, corners[(i + 1) % corners.length]] as const,
  );
  const lengths = segments.map(([p, q]) =>
    Math.hypot(q[0] - p[0], q[1] - p[1]),
  );
  const total = lengths.reduce((sum, value) => sum + value, 0);
  const points = [];
  for (let i = 0; i < count; i += 1) {
    let along = (i / count) * total;
    let s = 0;
    while (along > lengths[s]) along -= lengths[s++];
    const [p, q] = segments[s];
    const w = along / lengths[s];
    points.push({ x: p[0] + (q[0] - p[0]) * w, y: p[1] + (q[1] - p[1]) * w });
  }
  return { points, total, lengths };
}

test("the outline lines up with the lap's slow points, or admits it cannot", () => {
  // An irregular circuit: corners at uneven spacing.
  const { points, total, lengths } = polygonOutline(
    [
      [0, 0],
      [400, 0],
      [460, 180],
      [200, 260],
      [120, 420],
      [0, 300],
    ],
    600,
  );
  const cornerFractions = lengths.map(
    (_, i) => lengths.slice(0, i + 1).reduce((a, b) => a + b, 0) / total,
  );
  // The start line sits 20% of the way round; the lap runs the same direction.
  const startOffset = 0.2;
  const speed = Array.from({ length: points.length }, (_, j) => {
    const at = (startOffset + j / points.length) % 1;
    const near = Math.min(
      ...cornerFractions.map((f) =>
        Math.min(Math.abs(at - f), 1 - Math.abs(at - f)),
      ),
    );
    return 300 - 180 * Math.exp(-((near / 0.02) ** 2));
  });
  const calibration = calibrateOutline(points, speed);
  assert.equal(calibration.direction, 1);
  assert.ok(
    Math.abs(calibration.offset - startOffset * points.length) <= 6,
    `offset ${calibration.offset}`,
  );
  assert.equal(calibration.confident, true);
  // In lap order the line is index 0 and fractions read straight off.
  const ordered = orderByLap(points, calibration);
  assert.equal(ordered[0], points[calibration.offset]);
  assert.equal(
    outlinePointAt(ordered, 0.5),
    points[(calibration.offset + 300) % 600],
  );

  // A square is symmetric: four alignments fit equally well, so no map.
  const square = polygonOutline(
    [
      [0, 0],
      [100, 0],
      [100, 100],
      [0, 100],
    ],
    400,
  );
  const squareSpeed = Array.from({ length: 400 }, (_, j) => {
    const at = j / 400;
    const near = Math.min(
      ...[0.25, 0.5, 0.75, 1].map((f) =>
        Math.min(Math.abs(at - f), 1 - Math.abs(at - f)),
      ),
    );
    return 300 - 180 * Math.exp(-((near / 0.02) ** 2));
  });
  assert.equal(calibrateOutline(square.points, squareSpeed).confident, false);
});

test("a reference-lap path is walked evenly from the line, closing the lap", () => {
  // A 300 x 100 rectangle driven from its top-left corner: 800 round.
  const outline = outlineFromPath([0, 0, 300, 0, 300, 100, 0, 100], 8);
  assert.deepEqual(outline, [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 200, y: 0 },
    { x: 300, y: 0 },
    { x: 300, y: 100 },
    { x: 200, y: 100 },
    { x: 100, y: 100 },
    { x: 0, y: 100 },
  ]);
  assert.deepEqual(outlinePointAt(outline, 0.25), { x: 200, y: 0 });
  assert.deepEqual(outlinePointAt(outline, 1), { x: 0, y: 0 });
});
