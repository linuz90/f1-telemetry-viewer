import type {
  CarSetup,
  DriverData,
  PlayerStintLaps,
  SetupSnapshot,
  StintTrace,
  TelemetrySession,
} from "../types/telemetry";
import type { SessionKind } from "./sessionKind";
import {
  getRacePaceLapSamples,
  hasCompleteLapTiming,
} from "../utils/stats/laps";
import {
  getCompletedStints,
  getDriverStints,
  getNeutralisedLaps,
  getStintWearCurve,
  stintGreenLife,
} from "../utils/stats/tyres";
import { isWetCompound } from "./trackStrategyCompounds";
import { FUEL_LAP_TIME_MS_PER_KG } from "./trackStrategyTiming";
import { SETUP_IDENTITY_KEYS } from "./trackSetups";

/**
 * Stint comparison: one of the player's stints against another run at the same
 * track and race length, so a driver can see whether a run beat the last one
 * and why. A stint is judged on pace, wear and how it held up together, so a
 * comparison never reports pace alone.
 *
 * - Same track, formula scope and race length only: tyre wear differs between
 *   25%, 50% and full-distance races, and so does fuel per lap.
 * - Laps pair by tyre age (lap 3 of one stint with lap 3 of the other) on laps
 *   Race Pace counts in both. Two long runs from the grid pair lap for lap; a
 *   race's second stint pairs with a long run on the same tyre age.
 * - Each pair is put on equal fuel at `FUEL_LAP_TIME_MS_PER_KG`: about nothing
 *   for runs from the same lap, the whole story for a late stint on a light
 *   car. A pair without fuel data counts only between stints from the same
 *   race lap. Wear is never corrected: managing it is the driver's job, so it
 *   stays in the result and is reported beside it.
 * - The delta is the mean of those pairs, not the gap between two stint
 *   averages, which an extra lap on one side (lighter, more worn) would move.
 */

// --- Tuning -----------------------------------------------------------------

/** Clean laps a stint needs for an average (long runs are short). */
export const STINT_AVERAGE_MIN_LAPS = 2;
/** Clean laps a stint needs before its fade is a trend. */
export const STINT_FADE_MIN_LAPS = 4;
/** Paired laps two stints need for a pace delta: Race Pace's own floor. */
export const STINT_COMPARE_MIN_LAPS = 3;
/** A pace delta under this (ms a lap) reads as matched. */
export const STINT_MATCHED_MS = 50;
/** Wear-rate gap (% a lap) under which two stints read as the same wear. */
export const STINT_SAME_WEAR_PER_LAP = 0.2;
/** Fade gap (s a lap) worth naming beside a pace delta. */
export const STINT_FADE_GAP_MIN_S = 0.1;
/** Fade (s a lap) under which a stint held its pace. */
const STINT_HELD_PACE_S = 0.02;
/** Mean fuel correction a lap (ms) worth saying a delta is fuel-corrected. */
const FUEL_CORRECTION_NOTE_MS = 50;

// --- Building traces --------------------------------------------------------

const round1 = (value: number | undefined) =>
  value == null || !Number.isFinite(value) ? null : Math.round(value * 10) / 10;

/** The driver's completed stints lap by lap, as the summary stores them. */
export function buildStintTraces(driver: DriverData): StintTrace[] {
  const laps = driver["session-history"]?.["lap-history-data"] ?? [];
  const counted = new Set(
    getRacePaceLapSamples(driver).map((sample) => sample.lapNumber),
  );
  const neutralised = getNeutralisedLaps(driver["per-lap-info"]);
  const fuelByLap = new Map<number, number>();
  for (const info of driver["per-lap-info"] ?? []) {
    const kg = info["car-status-data"]?.["fuel-in-tank"];
    if (Number.isFinite(kg) && kg >= 0) fuelByLap.set(info["lap-number"], kg);
  }

  return getCompletedStints(getDriverStints(driver)).flatMap((stint) => {
    const start = stint["start-lap"];
    const end = Math.min(stint["end-lap"], laps.length);
    const compound = stint["tyre-set-data"]?.["visual-tyre-compound"];
    if (!compound || end < start) return [];
    const wearByLap = new Map(
      getStintWearCurve(stint).map((point) => [
        point.lapNumber,
        point.worstWear,
      ]),
    );
    const life = stintGreenLife(stint, neutralised);
    const trace: StintTrace = {
      compound,
      startLap: start,
      lapMs: [],
      counted: [],
      wear: [],
      fuelKg: [],
      wearPerLap: Math.round(life.wearPerLap * 100) / 100,
      lifeLaps: life.lifeLaps,
    };
    for (let lap = start; lap <= end; lap++) {
      const entry = laps[lap - 1];
      trace.lapMs.push(
        entry && hasCompleteLapTiming(entry) ? entry["lap-time-in-ms"] : null,
      );
      trace.counted.push(counted.has(lap));
      trace.wear.push(round1(wearByLap.get(lap)));
      trace.fuelKg.push(round1(fuelByLap.get(lap)));
    }
    return [trace];
  });
}

export function snapshotSetup(
  setup: CarSetup | null | undefined,
): SetupSnapshot | undefined {
  if (!setup?.["is-valid"]) return undefined;
  // Exports carry float noise (a 0.1 toe reads 0.10000000149011612).
  return SETUP_IDENTITY_KEYS.map((key) => {
    const value = Number(setup[key]);
    return Number.isFinite(value) ? Math.round(value * 100) / 100 : null;
  });
}

/** What the summary keeps for stint comparison; undefined without a race length. */
export function buildPlayerStintLaps(
  session: TelemetrySession,
  player: DriverData,
): PlayerStintLaps | undefined {
  const raceLaps = session["session-info"]?.["total-laps"];
  if (typeof raceLaps !== "number" || raceLaps <= 0) return undefined;
  return {
    raceLaps,
    setup: snapshotSetup(player["car-setup"]),
    stints: buildStintTraces(player),
  };
}

// --- Comparable stints ------------------------------------------------------

export interface ComparableStint {
  /** `slug~startLap`: the `?vs=` value. */
  id: string;
  slug: string;
  date: string;
  kind: SessionKind;
  raceLaps: number;
  setup?: SetupSnapshot;
  trace: StintTrace;
  compound: string;
  startLap: number;
  endLap: number;
  /** Mean of the counted laps, or null under `STINT_AVERAGE_MIN_LAPS`. */
  averageMs: number | null;
  cleanLaps: number;
  bestMs: number | null;
  wearPerLap: number;
  lifeLaps: number;
  /** Clean-lap trend in seconds a lap (positive = slowing). */
  fadeSPerLap: number | null;
}

export function stintId(slug: string, startLap: number): string {
  return `${slug}~${startLap}`;
}

function slope(points: { x: number; y: number }[]): number {
  const n = points.length;
  const mx = points.reduce((s, p) => s + p.x, 0) / n;
  const my = points.reduce((s, p) => s + p.y, 0) / n;
  const num = points.reduce((s, p) => s + (p.x - mx) * (p.y - my), 0);
  const den = points.reduce((s, p) => s + (p.x - mx) ** 2, 0);
  return den > 0 ? num / den : 0;
}

function countedLaps(trace: StintTrace): { lap: number; ms: number }[] {
  return trace.lapMs.flatMap((ms, age) =>
    ms != null && trace.counted[age] ? [{ lap: trace.startLap + age, ms }] : [],
  );
}

export function comparableStints(source: {
  slug: string;
  date: string;
  kind: SessionKind;
  stintLaps: PlayerStintLaps;
}): ComparableStint[] {
  const { slug, date, kind, stintLaps } = source;
  return stintLaps.stints.map((trace) => {
    const clean = countedLaps(trace);
    return {
      id: stintId(slug, trace.startLap),
      slug,
      date,
      kind,
      raceLaps: stintLaps.raceLaps,
      setup: stintLaps.setup,
      trace,
      compound: trace.compound,
      startLap: trace.startLap,
      endLap: trace.startLap + trace.lapMs.length - 1,
      averageMs:
        clean.length >= STINT_AVERAGE_MIN_LAPS
          ? clean.reduce((s, c) => s + c.ms, 0) / clean.length
          : null,
      cleanLaps: clean.length,
      bestMs: clean.length ? Math.min(...clean.map((c) => c.ms)) : null,
      wearPerLap: trace.wearPerLap,
      lifeLaps: trace.lifeLaps,
      fadeSPerLap:
        clean.length >= STINT_FADE_MIN_LAPS
          ? slope(clean.map((c) => ({ x: c.lap, y: c.ms / 1000 })))
          : null,
    };
  });
}

const byRunOrder = (a: ComparableStint, b: ComparableStint) =>
  a.date.localeCompare(b.date) || a.startLap - b.startLap;

/** Stints from other sessions this one can be compared with, oldest first. */
export function comparableStintPool(
  current: { slug: string; raceLaps: number },
  others: readonly ComparableStint[],
): ComparableStint[] {
  return others
    .filter((s) => s.slug !== current.slug && s.raceLaps === current.raceLaps)
    .sort(byRunOrder);
}

/** Earlier stints on the same compound, oldest first: the progression. */
export function stintHistory(
  current: ComparableStint,
  pool: readonly ComparableStint[],
): ComparableStint[] {
  return pool
    .filter(
      (s) =>
        s.compound === current.compound &&
        s.slug !== current.slug &&
        s.date < current.date,
    )
    .sort(byRunOrder);
}

/** What a stint opens compared with: the latest earlier stint on its
 *  compound that pairs enough laps for a delta. */
export function defaultCompareStint(
  current: ComparableStint,
  pool: readonly ComparableStint[],
): ComparableStint | null {
  const history = stintHistory(current, pool);
  for (let i = history.length - 1; i >= 0; i--) {
    if (compareStints(current, history[i]).deltaMs != null) return history[i];
  }
  return null;
}

export interface StintCandidates {
  /** The session's other stints. */
  sameSession: ComparableStint[];
  /** Same compound, newest first. */
  sameCompound: ComparableStint[];
  /** Other compounds of the same kind (dry with dry, wet with wet). */
  otherCompounds: ComparableStint[];
}

export function stintCandidates(
  current: ComparableStint,
  sessionStints: readonly ComparableStint[],
  pool: readonly ComparableStint[],
): StintCandidates {
  const wet = isWetCompound(current.compound);
  const newestFirst = [...pool].reverse();
  return {
    sameSession: sessionStints.filter(
      (s) => s.id !== current.id && isWetCompound(s.compound) === wet,
    ),
    sameCompound: newestFirst.filter((s) => s.compound === current.compound),
    otherCompounds: newestFirst.filter(
      (s) =>
        s.compound !== current.compound && isWetCompound(s.compound) === wet,
    ),
  };
}

// --- Comparing --------------------------------------------------------------

export interface StintLapPair {
  /** Tyre age: 1 is each stint's first lap. */
  age: number;
  lapA: number;
  lapB: number;
  msA: number;
  msB: number;
  /** a − b on equal fuel; negative means a was quicker. */
  deltaMs: number;
  /** Running sum of `deltaMs` up to this pair. */
  gapMs: number;
}

export interface StintComparison {
  a: ComparableStint;
  b: ComparableStint;
  pairs: StintLapPair[];
  /** Mean of the paired deltas; null under `STINT_COMPARE_MIN_LAPS` pairs. */
  deltaMs: number | null;
  /** The fuel correction moved the delta enough to say so. */
  fuelCorrected: boolean;
  /** a − b worst-wheel wear at each tyre age both reached, index age - 1. */
  wearDelta: (number | null)[];
  wearPerLapDelta: number | null;
  fadeDeltaS: number | null;
  setupNote: string | null;
}

export function compareStints(
  a: ComparableStint,
  b: ComparableStint,
): StintComparison {
  const pairs: StintLapPair[] = [];
  let gapMs = 0;
  let correctionMs = 0;
  const ages = Math.min(a.trace.lapMs.length, b.trace.lapMs.length);
  for (let i = 0; i < ages; i++) {
    const msA = a.trace.lapMs[i];
    const msB = b.trace.lapMs[i];
    if (
      msA == null ||
      msB == null ||
      !a.trace.counted[i] ||
      !b.trace.counted[i]
    )
      continue;
    const fuelA = a.trace.fuelKg[i];
    const fuelB = b.trace.fuelKg[i];
    // Without fuel on both sides a pair stays on equal fuel only when it is
    // the same race lap; otherwise the lighter car would bank its fuel as pace.
    if ((fuelA == null || fuelB == null) && a.startLap !== b.startLap) continue;
    // The heavier car is slower by its extra fuel; take that off.
    const correction =
      fuelA != null && fuelB != null
        ? (fuelA - fuelB) * FUEL_LAP_TIME_MS_PER_KG
        : 0;
    const deltaMs = msA - msB - correction;
    correctionMs += Math.abs(correction);
    gapMs += deltaMs;
    pairs.push({
      age: i + 1,
      lapA: a.startLap + i,
      lapB: b.startLap + i,
      msA,
      msB,
      deltaMs,
      gapMs,
    });
  }
  const wearAges = Math.max(a.trace.wear.length, b.trace.wear.length);
  const wearDelta = Array.from({ length: wearAges }, (_, i) => {
    const wa = a.trace.wear[i];
    const wb = b.trace.wear[i];
    return wa != null && wb != null ? wa - wb : null;
  });
  return {
    a,
    b,
    pairs,
    deltaMs:
      pairs.length >= STINT_COMPARE_MIN_LAPS ? gapMs / pairs.length : null,
    fuelCorrected:
      pairs.length > 0 &&
      correctionMs / pairs.length >= FUEL_CORRECTION_NOTE_MS,
    wearDelta,
    wearPerLapDelta:
      a.wearPerLap > 0 && b.wearPerLap > 0 ? a.wearPerLap - b.wearPerLap : null,
    fadeDeltaS:
      a.fadeSPerLap != null && b.fadeSPerLap != null
        ? a.fadeSPerLap - b.fadeSPerLap
        : null,
    setupNote: describeSetupDifference(a.setup, b.setup),
  };
}

export interface StintCompareLaps {
  /** b's lap times on a's race laps, by tyre age; index lap - 1. */
  lapsMs: (number | null)[];
  /** b's laps Race Pace left out, which the chart drops. */
  excluded: Map<number, string>;
  /** b's worst-wheel wear on a's race laps. */
  wear: (number | null)[];
  /** a − b on paired laps, fuel-corrected. */
  deltaMs: (number | null)[];
  /** The running gap after each paired lap. */
  gapMs: (number | null)[];
  /** a − b worst-wheel wear. */
  wearDelta: (number | null)[];
  /** b's own race lap at each of a's laps. */
  lapB: (number | null)[];
}

/** A comparison laid on the race laps of a's session, for charts and tables. */
export function placeComparisonOnLaps(
  comparison: StintComparison,
  laps: number,
): StintCompareLaps {
  const { a, b } = comparison;
  const empty = () => Array.from({ length: laps }, () => null);
  const out: StintCompareLaps = {
    lapsMs: empty(),
    excluded: new Map(),
    wear: empty(),
    deltaMs: empty(),
    gapMs: empty(),
    wearDelta: empty(),
    lapB: empty(),
  };
  const span = Math.min(a.trace.lapMs.length, b.trace.lapMs.length);
  for (let i = 0; i < span; i++) {
    const lap = a.startLap + i;
    if (lap > laps) break;
    out.lapsMs[lap - 1] = b.trace.lapMs[i];
    if (b.trace.lapMs[i] != null && !b.trace.counted[i])
      out.excluded.set(lap, "not counted");
    out.wear[lap - 1] = b.trace.wear[i];
    out.wearDelta[lap - 1] = comparison.wearDelta[i] ?? null;
    out.lapB[lap - 1] = b.startLap + i;
  }
  for (const pair of comparison.pairs) {
    if (pair.lapA > laps) continue;
    out.deltaMs[pair.lapA - 1] = pair.deltaMs;
    out.gapMs[pair.lapA - 1] = pair.gapMs;
  }
  return out;
}

/** Where a lead (or deficit) peaked before the end, and how much of it came
 *  back by the last pair. A lead can turn into a deficit, so each direction
 *  is measured from its own extreme rather than from the biggest gap. */
export function gapTurn(
  comparison: StintComparison,
): { peak: StintLapPair; last: StintLapPair; givenBackMs: number } | null {
  const { pairs } = comparison;
  if (pairs.length < STINT_COMPARE_MIN_LAPS) return null;
  const last = pairs[pairs.length - 1];
  const ahead = pairs.reduce((best, p) => (p.gapMs < best.gapMs ? p : best));
  const behind = pairs.reduce((best, p) => (p.gapMs > best.gapMs ? p : best));
  const turns = [
    ahead.gapMs < 0 && ahead !== last
      ? { peak: ahead, last, givenBackMs: last.gapMs - ahead.gapMs }
      : null,
    behind.gapMs > 0 && behind !== last
      ? { peak: behind, last, givenBackMs: behind.gapMs - last.gapMs }
      : null,
  ].filter((turn) => turn != null && turn.givenBackMs > 0);
  return turns.sort((x, y) => y!.givenBackMs - x!.givenBackMs)[0] ?? null;
}

// --- Words ------------------------------------------------------------------

const seconds = (ms: number) => (Math.abs(ms) / 1000).toFixed(3);

const SETUP_LABEL: Partial<Record<keyof CarSetup, string>> = {
  "front-wing": "front wing",
  "rear-wing": "rear wing",
  "on-throttle": "on-throttle diff",
  "off-throttle": "off-throttle diff",
  "front-camber": "front camber",
  "rear-camber": "rear camber",
  "front-toe": "front toe",
  "rear-toe": "rear toe",
  "front-suspension": "front suspension",
  "rear-suspension": "rear suspension",
  "front-anti-roll-bar": "front anti-roll bar",
  "rear-anti-roll-bar": "rear anti-roll bar",
  "front-suspension-height": "front ride height",
  "rear-suspension-height": "rear ride height",
  "brake-pressure": "brake pressure",
  "front-left-tyre-pressure": "front-left tyre pressure",
  "front-right-tyre-pressure": "front-right tyre pressure",
  "rear-left-tyre-pressure": "rear-left tyre pressure",
  "rear-right-tyre-pressure": "rear-right tyre pressure",
};

/** Left and right pressures usually move together; name the pair once. */
const PRESSURE_PAIRS: [keyof CarSetup, keyof CarSetup, string][] = [
  [
    "front-left-tyre-pressure",
    "front-right-tyre-pressure",
    "front tyre pressure",
  ],
  ["rear-left-tyre-pressure", "rear-right-tyre-pressure", "rear tyre pressure"],
];

const setupValue = (value: number) =>
  Number.isInteger(value) ? String(value) : value.toFixed(1);

/** "Same setup." or what changed from `previous` to `current`, by the same
 *  identity as the track's Setups tab (brake bias and fuel ignored). */
export function describeSetupDifference(
  current: SetupSnapshot | undefined,
  previous: SetupSnapshot | undefined,
): string | null {
  if (!current || !previous) return null;
  const now = (key: keyof CarSetup) =>
    current[SETUP_IDENTITY_KEYS.indexOf(key)];
  const before = (key: keyof CarSetup) =>
    previous[SETUP_IDENTITY_KEYS.indexOf(key)];
  const changed = SETUP_IDENTITY_KEYS.filter((key) => {
    const a = now(key);
    const b = before(key);
    return a != null && b != null && a.toFixed(2) !== b.toFixed(2);
  });
  if (changed.length === 0) return "Same setup.";
  const describe = (label: string, key: keyof CarSetup) =>
    `${label} ${setupValue(before(key)!)} → ${setupValue(now(key)!)}`;
  // Setup-sheet order (aero, diff, then the rest), a pressure pair once.
  const changes: string[] = [];
  for (const key of changed) {
    const pair = PRESSURE_PAIRS.find(([left, right]) =>
      [left, right].includes(key),
    );
    const together =
      pair &&
      changed.includes(pair[0]) &&
      changed.includes(pair[1]) &&
      now(pair[0]) === now(pair[1]) &&
      before(pair[0]) === before(pair[1]);
    if (together && key === pair[1]) continue;
    changes.push(
      together ? describe(pair[2], key) : describe(SETUP_LABEL[key]!, key),
    );
  }
  return `Setup changed: ${changes.slice(0, 3).join(", ")}${changes.length > 3 ? `, +${changes.length - 3} more` : ""}.`;
}

/** "Mediums ran 0.188 s a lap faster than your 18:24 run." */
export function stintDeltaClaim(
  comparison: StintComparison,
  label: string,
): string | null {
  const { a, b, deltaMs } = comparison;
  if (deltaMs == null) return null;
  const them =
    a.compound === b.compound
      ? `your ${label}`
      : `the ${b.compound}s of your ${label}`;
  if (Math.abs(deltaMs) < STINT_MATCHED_MS)
    return `${a.compound}s matched ${them}, within ${seconds(deltaMs)} s a lap.`;
  return `${a.compound}s ran ${seconds(deltaMs)} s a lap ${deltaMs > 0 ? "slower" : "faster"} than ${them}.`;
}

/** "faded 0.37 s a lap", "held its pace", "got 0.30 s a lap quicker". */
function trendWords(fade: number): string {
  if (fade > STINT_HELD_PACE_S) return `faded ${fade.toFixed(2)} s a lap`;
  if (fade < -STINT_HELD_PACE_S)
    return `got ${Math.abs(fade).toFixed(2)} s a lap quicker`;
  return "held its pace";
}

/** Setup, wear and fade beside a delta: "Same setup. Same wear, 5.3% a lap.
 *  It faded 0.37 s a lap against 0.19." */
export function stintCompareDetail(comparison: StintComparison): string {
  const { a, b, setupNote, wearPerLapDelta, fadeDeltaS } = comparison;
  const parts: string[] = [];
  if (setupNote) parts.push(setupNote);
  if (wearPerLapDelta != null) {
    parts.push(
      Math.abs(wearPerLapDelta) < STINT_SAME_WEAR_PER_LAP
        ? `Same wear, ${a.wearPerLap.toFixed(1)}% a lap.`
        : `Wear ${a.wearPerLap.toFixed(1)}% a lap against ${b.wearPerLap.toFixed(1)}%.`,
    );
  }
  if (fadeDeltaS != null && Math.abs(fadeDeltaS) >= STINT_FADE_GAP_MIN_S) {
    const fa = a.fadeSPerLap!;
    const fb = b.fadeSPerLap!;
    parts.push(
      fa > STINT_HELD_PACE_S && fb > STINT_HELD_PACE_S
        ? `It faded ${fa.toFixed(2)} s a lap against ${fb.toFixed(2)}.`
        : `It ${trendWords(fa)}, the other ${trendWords(fb)}.`,
    );
  }
  return parts.join(" ");
}

/** Whether `stintCompareDetail` names the fade, so Worth a look need not. */
export function detailNamesFade(comparison: StintComparison): boolean {
  return (
    comparison.fadeDeltaS != null &&
    Math.abs(comparison.fadeDeltaS) >= STINT_FADE_GAP_MIN_S
  );
}

/** "Quickest of your 3 Medium runs here: 0.191 s a lap up on the 18:24 run,
 *  0.702 s on the 18:07 run." Null unless it beat every earlier one shown. */
export function progressionHeadline(
  current: ComparableStint,
  shown: readonly { stint: ComparableStint; label: string }[],
  totalEarlier: number,
): string | null {
  if (shown.length < 2) return null;
  const deltas = shown.map(({ stint, label }) => ({
    label,
    deltaMs: compareStints(current, stint).deltaMs,
  }));
  if (deltas.some((d) => d.deltaMs == null || d.deltaMs > -STINT_MATCHED_MS))
    return null;
  const word = [current, ...shown.map((s) => s.stint)].every(
    (s) => s.kind === "long-run",
  )
    ? "runs"
    : "stints";
  const count = shown.length + 1;
  const scope = totalEarlier > shown.length ? `last ${count}` : String(count);
  const [latest, previous] = [...deltas].reverse();
  return `Quickest of your ${scope} ${current.compound} ${word} here: ${seconds(latest.deltaMs!)} s a lap up on the ${latest.label}, ${seconds(previous.deltaMs!)} s on the ${previous.label}.`;
}
