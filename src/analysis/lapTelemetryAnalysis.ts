import type { LapTrace } from "../utils/lapRecording/types";
import { titleCaseName } from "../utils/format";
import { isRaceSessionType } from "../utils/sessionTypes";
import type { TrackCorner } from "../utils/tracks";

/**
 * Lap-against-lap analysis for Pits n' Giggles lap recordings.
 *
 * How a comparison is built, in the order of this file:
 * 1. `prepareLap` cleans one recording: samples before the line are dropped
 *    and the clock is repaired and pinned to the official lap time.
 * 2. `buildLapSeries` puts laps on one distance grid. The gap is A's elapsed
 *    time minus the comparison's at the same distance, so positive means A is
 *    behind.
 * 3. `detectCornerUnits` splits the lap into units that run from where either
 *    lap first lifts or brakes to the next unit's start, so the straight after
 *    a corner belongs to that corner's exit.
 * 4. `compareLaps` measures each unit as the gap change across it, split for
 *    corners into three phases (way in, way out, run to the next unit). Units
 *    telescope, so they always add up to the official lap-time difference.
 * 5. `explainUnit` and the `explain*` rule lists turn a unit into a tip.
 */

// ---------------------------------------------------------------------------
// Tuning
//
// Every threshold the analysis applies is a constant in this section, with
// what it gates and what it rests on. The evidence so far is one circuit and
// one car: Melbourne in F1 26, two dry qualifying runs and one wet race (49
// laps). Expect to revisit corner detection on circuits with tighter chicanes,
// and the battery rules for cars without the F1 26 battery.
//
// `pnpm check:lap-telemetry` re-measures the clock accuracy on every recording
// in TELEMETRY_DIR and counts tips by kind and category. Run it before and
// after changing a constant: a change shows up as tips moving between rows.
// "Judgement" marks a value picked by reading traces, not measured.
// ---------------------------------------------------------------------------

// --- Measurement -----------------------------------------------------------

/**
 * Analysis and display grid spacing. Recordings sample every 1–2 m at racing
 * speed (30–60 Hz), so a finer grid would only interpolate.
 */
export const GRID_STEP_M = 2;
/**
 * Smallest net time change that gets a tip. The recording's clock ticks at
 * 60 Hz and lags the distance channel by up to a tick. Against official sector
 * times one lap's clock is off by 10 ms RMS (worst 21 ms) and the gap between
 * two laps by 6 ms RMS (worst 20 ms). A stretch's time is the difference of
 * two gap readings, about 9 ms RMS, so the floor is a little over three times
 * that. Lower it only if the check shows a better clock.
 */
export const TIP_FLOOR_S = 0.03;
/**
 * A corner that nets under the tip floor still gets a note when one phase
 * moved this much: time won on the brakes and handed back on the exit is real
 * and worth seeing, and a net-only floor would hide it. Higher than the tip
 * floor because phase boundaries (slowest point, back to flat) sit where the
 * gap moves fastest, so a phase is read less exactly than a whole unit.
 */
const WASH_PHASE_FLOOR_S = 0.05;
/**
 * A wash note's headline says "offset" when the corner's net is under this
 * share of the phase that moved, and "partly offset" otherwise. Judgement.
 */
const WASH_OFFSET_NET_SHARE = 1 / 3;
/**
 * Phases a tip's cause does not cover are itemised in its evidence from these
 * sizes up: one that went the other way sooner than one that went the same
 * way, because leaving out an offset overstates the cause. Both are below
 * what the clock resolves for a single phase, so they are shown as context,
 * never explained.
 */
const PHASE_OFFSET_MENTION_S = 0.01;
const PHASE_EXTRA_MENTION_S = 0.02;
/** Half-width of the moving average applied to the charted gap. */
const GAP_SMOOTHING_HALF_WINDOW_M = 50;
/**
 * Tighter average for reading the gap at unit and phase boundaries, which sit
 * in braking zones where the gap moves fastest: ±50 m there shifted about
 * 0.01 s into the neighbouring stretch. Against official sector times the gap
 * is as accurate at ±20 m as at ±50 m (6 ms RMS); unaveraged it is 10 ms.
 */
const UNIT_GAP_HALF_WINDOW_M = 20;

// --- Corner detection ------------------------------------------------------

/**
 * A slowest point is the lowest speed within this distance either side, which
 * also makes it the closest two corners can sit and still be two units.
 * Melbourne's Turns 9 and 10 are about 100 m apart: they split when a lap
 * shows two speed dips there and merge into "Turns 9–10" when it shows one.
 */
const APEX_WINDOW_M = 80;
/**
 * A slowest point must also sit this far below the top speed within
 * `APEX_CONTEXT_M` before and after it. 20 km/h keeps Melbourne's fast Turn 6
 * and Turns 9–10 (60 km/h and more) and ignores Turn 12 in the dry (6 km/h),
 * which is a kink. In the wet Turn 12 drops enough to become a corner.
 */
const APEX_MIN_DROP_KMH = 20;
const APEX_CONTEXT_M = 300;
/**
 * How far before the slowest point a lift can start and still open the
 * corner. Melbourne's longest is Turns 9–10: the lift comes 246 m before the
 * slowest point, because the car scrubs speed through both turns at full
 * throttle.
 */
const ONSET_LOOKBACK_M = 400;
/**
 * A lap counts as off the throttle below this, or with the brake above
 * `BRAKE_NOISE_PCT`. This decides where a corner unit starts and whether a
 * lap "stayed flat". Judgement: both pedals read a clean 0 or 100 at rest in
 * the recordings checked, so the margins only absorb interpolation.
 */
const OFF_THROTTLE_PCT = 95;
const BRAKE_NOISE_PCT = 2;
/** Throttle at or above this is full throttle. Judgement, as above. */
const FULL_THROTTLE_PCT = 98;
/**
 * A run of full throttle has to last this long to count as "flat". Between
 * Melbourne's Turns 3 and 4 both laps are flat for about 40 m before lifting
 * again; that stab must not end the corner.
 */
const SUSTAINED_THROTTLE_M = 50;
/**
 * Official turn markers come from real reference laps, not the game: on the
 * Melbourne corners checked they sat 9–47 m before the game's slowest point,
 * moving about 20 m with the driver's line. A marker this far past the
 * slowest point still belongs to the corner; the next turn of a chicane
 * (Melbourne's Turn 2, 46 m or more past) does not, unless the laps are still
 * off the throttle there.
 */
const TURN_APEX_SLACK_M = 30;
/** Furthest a marker can sit from a stretch and still name it. Judgement. */
const TURN_NEAREST_MAX_M = 120;

// --- Driver inputs ---------------------------------------------------------
// Where a lap lifts, brakes and gets back to full throttle, and how far two
// laps must differ before a tip says they did. All judgement so far: there
// are too few laps to measure how much one driver varies lap to lap. More
// same-driver laps on one tyre would let these be set from that spread.

/**
 * Pedal levels for the points quoted in evidence ("came off the throttle 7 m
 * later", "braked 5 m later"). Stricter than `OFF_THROTTLE_PCT` and
 * `BRAKE_NOISE_PCT` so the distance is where the pedal clearly moved, not
 * where it first wavered.
 */
const LIFT_PCT = 90;
const BRAKING_PCT = 10;
/**
 * Lift, braking and slowest points this far apart count as different. Samples
 * are 1–2 m apart, so each lap's point is good to about 2 m.
 */
const BRAKE_POINT_DIFF_M = 5;
/**
 * Full-throttle points this far apart count as different. Looser than the
 * braking point because the pedal ramps up over tens of metres and the
 * `FULL_THROTTLE_PCT` crossing moves with the ramp.
 */
const THROTTLE_POINT_DIFF_M = 10;
/**
 * Speeds this far apart count as different: slowest point, exit speed, entry
 * to a straight, and the largest difference along a stretch. Speed is recorded
 * in whole km/h, so 1–2 km/h between two laps can be rounding alone.
 */
const SPEED_DIFF_KMH = 3;
/**
 * Speed difference that counts through a braking zone and on arrival at one.
 * Higher than `SPEED_DIFF_KMH` because speed falls about 2 km/h per metre
 * there (lifting 7 m later read as up to 13 km/h faster), so a braking point
 * within `BRAKE_POINT_DIFF_M` already moves speed by more than 3 km/h.
 */
const BRAKING_SPEED_DIFF_KMH = 5;
/**
 * "Braked too late" accepts a slowest point this much lower. Looser than
 * `SPEED_DIFF_KMH` because it only supports a later braking point that was
 * already found, and never stands as a cause on its own.
 */
const OVERSHOOT_SPEED_DIFF_KMH = 2;
/** A peak brake this many percentage points higher reads as over-braking. */
const PEAK_BRAKE_DIFF_PCT = 15;
/**
 * Share of a full-throttle stretch that one lap spent off full throttle more
 * than the other, from which a tip says so.
 */
const FLAT_SHARE_DIFF = 0.05;
/**
 * `lateSpeedSurplus` reads the last part of a full-throttle stretch, where an
 * exit-speed lead should have faded. Judgement.
 */
const LATE_STRETCH_SHARE = 1 / 3;

// --- Battery ---------------------------------------------------------------
// Stored energy is exact in the recording (joules), so these are about what
// is worth saying, not about measurement. For scale, the F1 26 qualifying laps
// checked cross the line with about 3 MJ and finish empty.

const MJ = 1_000_000;
/**
 * Battery counts as empty below this. The store settles at a few kJ rather
 * than zero once deployment stops (0.00–0.01 MJ in the Melbourne traces).
 */
const BATTERY_EMPTY_J = 20_000;
/**
 * Battery is only blamed on a full-throttle stretch at least this long, with
 * both laps flat for `FLAT_STRETCH_MIN_SHARE` of it. Shorter, or with a lift
 * in it, and throttle explains the speed better than deployment does.
 */
const BATTERY_STRETCH_MIN_M = 100;
const FLAT_STRETCH_MIN_SHARE = 0.9;
/** One lap ran dry "sooner" when it emptied at least this far before the other. */
const RAN_DRY_DIFF_M = 20;
/**
 * Energy used over a stretch differs when it is this far apart: about a third
 * of a second of full deployment at the 2026 cars' 350 kW. Also the least an
 * earlier stretch must have spent or saved to be named as where a battery
 * difference came from.
 */
const ENERGY_DIFF_J = 0.1 * MJ;
/**
 * Stored energy on arrival at a stretch differs when it is this far apart;
 * below it the tip says both laps arrived with the same charge.
 */
const ARRIVAL_ENERGY_DIFF_J = 0.05 * MJ;

// --- Comparability chips ---------------------------------------------------

/** Tyres count as the same up to this many points of worst-wheel wear apart. Judgement. */
const TYRE_WEAR_SAME_PCT = 5;
/**
 * Battery counts as the same when both the store at the line and the energy
 * used over the lap are within this, about 10% of a lap's use. Judgement.
 */
const BATTERY_SAME_J = 0.3 * MJ;

export interface LapContext {
  key: string;
  driverName: string;
  team?: string;
  isPlayer: boolean;
  sessionType: string;
  lapNumber: number;
  lapTimeMs: number;
  compound?: string;
  weather?: string;
}

export interface PreparedLap {
  context: LapContext;
  trackLengthM: number;
  /** Strictly increasing distance, 0 at the line, track length at the end. */
  d: Float64Array;
  /** Seconds since the line, pinned to the official lap time at the end. */
  t: Float64Array;
  speed: Float64Array;
  throttle: Float64Array;
  brake: Float64Array;
  steering: Float64Array;
  gear: Float64Array;
  rpm: Float64Array;
  /** Stored battery energy, joules. */
  ersJ: Float64Array;
  /** Game ERS deploy mode (UDP enum, 0-3); see `ersModeLabel` in LapReadout. */
  ersMode: Float64Array;
  /** Worst-wheel tyre wear at the line, percent. */
  wearStartPct?: number;
}

/** First index whose value is at or above `target` in a sorted array. */
export function lowerBound(values: ArrayLike<number>, target: number): number {
  let lo = 0;
  let hi = values.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (values[mid] < target) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** Linear interpolation of `values` (sampled at `d`) at distance `x`. */
export function valueAt(
  d: ArrayLike<number>,
  values: ArrayLike<number>,
  x: number,
): number {
  const n = d.length;
  if (n === 0) return Number.NaN;
  if (x <= d[0]) return values[0];
  if (x >= d[n - 1]) return values[n - 1];
  const j = lowerBound(d, x);
  const d0 = d[j - 1];
  const d1 = d[j];
  const w = d1 === d0 ? 0 : (x - d0) / (d1 - d0);
  return values[j - 1] + (values[j] - values[j - 1]) * w;
}

/** Forward-fill NaNs; leading NaNs take the first finite value. */
function fillGaps(values: Float64Array): void {
  let last = 0;
  for (const value of values) {
    if (Number.isFinite(value)) {
      last = value;
      break;
    }
  }
  for (let i = 0; i < values.length; i += 1) {
    if (Number.isFinite(values[i])) last = values[i];
    else values[i] = last;
  }
}

/**
 * Clean one recorded lap: drop samples before the line, fill NaNs, replace
 * stale clock samples by interpolation, and pin the clock to 0 at the line
 * and the official lap time at the track length.
 */
export function prepareLap(
  trace: LapTrace,
  context: LapContext,
  trackLengthM: number,
): PreparedLap {
  const rawDistance = trace.lap_distance;
  if (!rawDistance) throw new Error("Lap trace has no distance channel");

  const keep: number[] = [];
  let lastDistance = 0;
  for (let i = 0; i < rawDistance.length; i += 1) {
    const value = rawDistance[i];
    // Before the line distance is negative; repeated or backward samples and
    // anything at or past the line would break distance alignment.
    if (!(value > lastDistance) || value >= trackLengthM) continue;
    keep.push(i);
    lastDistance = value;
  }
  if (keep.length < 2) throw new Error("Lap trace has too few samples");

  // Index 0 is the line (d = 0) and n - 1 the next line (d = track length).
  const n = keep.length + 2;
  const d = new Float64Array(n);
  d[n - 1] = trackLengthM;
  keep.forEach((sourceIndex, i) => {
    d[i + 1] = rawDistance[sourceIndex];
  });

  const channel = (name: string): Float64Array => {
    const source = trace[name];
    const out = new Float64Array(n).fill(Number.NaN);
    if (source) {
      keep.forEach((sourceIndex, i) => {
        out[i + 1] = source[sourceIndex];
      });
    }
    fillGaps(out);
    out[0] = out[1];
    out[n - 1] = out[n - 2];
    return out;
  };

  const speed = channel("speed");
  const lapTimeS = context.lapTimeMs / 1000;
  const t = new Float64Array(n).fill(Number.NaN);
  const rawClock = trace.lap_time_ms;
  let lastClock = 0;
  let clockSamples = 0;
  if (rawClock) {
    keep.forEach((sourceIndex, i) => {
      const value = rawClock[sourceIndex] / 1000;
      // The exporter repeats the previous clock value on alternate samples;
      // treat repeats as missing and interpolate them by distance instead.
      if (Number.isFinite(value) && value > lastClock && value < lapTimeS + 1) {
        t[i + 1] = value;
        lastClock = value;
        clockSamples += 1;
      }
    });
  }

  if (clockSamples < keep.length / 4) {
    // No usable clock: integrate speed instead, then scale to the lap time.
    t[0] = 0;
    for (let i = 1; i < n; i += 1) {
      const v = Math.max((speed[i] + speed[i - 1]) / 7.2, 1);
      t[i] = t[i - 1] + (d[i] - d[i - 1]) / v;
    }
    const scale = lapTimeS / t[n - 1];
    for (let i = 1; i < n; i += 1) t[i] *= scale;
  } else {
    // Estimate the clock at the line from the last good sample and its speed,
    // then scale the lap so it ends exactly on the official time.
    let lastGood = n - 2;
    while (lastGood > 0 && !Number.isFinite(t[lastGood])) lastGood -= 1;
    const tailSpeed = Math.max(speed[lastGood] / 3.6, 5);
    const estimate = t[lastGood] + (trackLengthM - d[lastGood]) / tailSpeed;
    const scale = estimate > 0 ? lapTimeS / estimate : 1;
    for (let i = 1; i < n - 1; i += 1) t[i] *= scale;
    t[0] = 0;
    t[n - 1] = lapTimeS;
    let previous = 0;
    for (let i = 1; i < n; i += 1) {
      if (!Number.isFinite(t[i])) continue;
      for (let j = previous + 1; j < i; j += 1) {
        t[j] =
          t[previous] +
          ((t[i] - t[previous]) * (d[j] - d[previous])) / (d[i] - d[previous]);
      }
      previous = i;
    }
  }

  const wear = ["tyre_wear.fl", "tyre_wear.fr", "tyre_wear.rl", "tyre_wear.rr"]
    .filter((name) => trace[name])
    .map((name) => channel(name)[0])
    .filter(Number.isFinite);

  return {
    context,
    trackLengthM,
    d,
    t,
    speed,
    throttle: channel("throttle"),
    brake: channel("brake"),
    steering: channel("steering"),
    gear: channel("gear"),
    rpm: channel("engine_rpm"),
    ersJ: channel("ers.store_energy_j"),
    ersMode: channel("ers.deploy_mode"),
    wearStartPct: wear.length > 0 ? Math.max(...wear) : undefined,
  };
}

// ---------------------------------------------------------------------------
// Grid series for charts
// ---------------------------------------------------------------------------

export type LapSeriesChannel =
  | "speed"
  | "throttle"
  | "brake"
  | "gear"
  | "steering"
  | "rpm"
  | "ersMj"
  | "ersMode";

export interface LapSeries {
  key: string;
  channels: Record<LapSeriesChannel, Float32Array>;
  /** Elapsed seconds at each grid point. */
  time: Float32Array;
}

export interface LapSeriesSet {
  /** Common distance grid, metres. */
  grid: Float64Array;
  trackLengthM: number;
  laps: LapSeries[];
  /** A minus each comparison (seconds), smoothed; positive = A behind. */
  gaps: { key: string; gapS: Float32Array; totalS: number }[];
}

export function buildGrid(
  trackLengthM: number,
  step = GRID_STEP_M,
): Float64Array {
  const count = Math.floor(trackLengthM / step);
  const grid = new Float64Array(count + 2);
  for (let i = 0; i <= count; i += 1) grid[i] = i * step;
  grid[count + 1] = trackLengthM;
  // The last two points coincide when the length is a multiple of the step.
  return grid[count] === trackLengthM ? grid.subarray(0, count + 1) : grid;
}

function resample(
  lap: PreparedLap,
  values: Float64Array,
  grid: Float64Array,
  mode: "linear" | "step" = "linear",
): Float32Array {
  const out = new Float32Array(grid.length);
  let j = 1;
  for (let i = 0; i < grid.length; i += 1) {
    const x = grid[i];
    while (j < lap.d.length - 1 && lap.d[j] < x) j += 1;
    const d0 = lap.d[j - 1];
    const d1 = lap.d[j];
    const w = d1 === d0 ? 0 : Math.min(Math.max((x - d0) / (d1 - d0), 0), 1);
    out[i] =
      mode === "step"
        ? w < 1
          ? values[j - 1]
          : values[j]
        : values[j - 1] + (values[j] - values[j - 1]) * w;
  }
  return out;
}

/** Centered moving average that shrinks symmetrically at the ends, so the end values stay exact. */
function smooth(values: Float64Array, halfWindow: number): Float32Array {
  const n = values.length;
  const prefix = new Float64Array(n + 1);
  for (let i = 0; i < n; i += 1) prefix[i + 1] = prefix[i] + values[i];
  const out = new Float32Array(n);
  for (let i = 0; i < n; i += 1) {
    const half = Math.min(halfWindow, i, n - 1 - i);
    out[i] = (prefix[i + half + 1] - prefix[i - half]) / (2 * half + 1);
  }
  return out;
}

function gapSeries(
  a: Float32Array,
  b: Float32Array,
  step: number,
  halfWindowM = GAP_SMOOTHING_HALF_WINDOW_M,
): Float32Array {
  const raw = new Float64Array(a.length);
  for (let i = 0; i < a.length; i += 1) raw[i] = a[i] - b[i];
  return smooth(raw, Math.round(halfWindowM / step));
}

/** Resample laps onto one distance grid; the first lap is A. */
export function buildLapSeries(laps: readonly PreparedLap[]): LapSeriesSet {
  const trackLengthM = Math.min(...laps.map((lap) => lap.trackLengthM));
  const grid = buildGrid(trackLengthM);
  const series = laps.map((lap): LapSeries => {
    const ersMj = resample(lap, lap.ersJ, grid);
    for (let i = 0; i < ersMj.length; i += 1) ersMj[i] /= MJ;
    return {
      key: lap.context.key,
      time: resample(lap, lap.t, grid),
      channels: {
        speed: resample(lap, lap.speed, grid),
        throttle: resample(lap, lap.throttle, grid),
        brake: resample(lap, lap.brake, grid),
        gear: resample(lap, lap.gear, grid, "step"),
        steering: resample(lap, lap.steering, grid),
        rpm: resample(lap, lap.rpm, grid),
        ersMj,
        ersMode: resample(lap, lap.ersMode, grid, "step"),
      },
    };
  });
  const [reference, ...comparisons] = series;
  return {
    grid,
    trackLengthM,
    laps: series,
    gaps: reference
      ? comparisons.map((comparison, i) => ({
          key: comparison.key,
          gapS: gapSeries(reference.time, comparison.time, GRID_STEP_M),
          totalS:
            (laps[0].context.lapTimeMs - laps[i + 1].context.lapTimeMs) / 1000,
        }))
      : [],
  };
}

/**
 * Time A lost (+) or gained (−) in each sector against every comparison lap,
 * in seconds. Read off the unsmoothed clocks so the three deltas sum to the
 * official lap-time gap. They come from the recording, not the exported
 * sector times, which are missing for rival and cross-session laps.
 */
export function sectorGaps(
  series: LapSeriesSet,
  sectorStarts: [number, number],
): { key: string; deltasS: [number, number, number] }[] {
  const [reference, ...comparisons] = series.laps;
  if (!reference) return [];
  const bounds = [0, ...sectorStarts, series.trackLengthM];
  return comparisons.map((comparison) => {
    const gapAt = (x: number) =>
      valueAt(series.grid, reference.time, x) -
      valueAt(series.grid, comparison.time, x);
    const gaps = bounds.map(gapAt);
    return {
      key: comparison.key,
      deltasS: [gaps[1] - gaps[0], gaps[2] - gaps[1], gaps[3] - gaps[2]],
    };
  });
}

// ---------------------------------------------------------------------------
// Corner units
// ---------------------------------------------------------------------------

export type UnitKind = "lead" | "corner" | "straight";

export interface CornerUnit {
  index: number;
  kind: UnitKind;
  from: number;
  to: number;
  /** Slowest point of the reference speed (corners); `from` for straights. */
  apexD: number;
  /** Where both laps are flat again (sustained full throttle). */
  flatD: number;
  /** Gap change, seconds (A − B): way in, way out, run to the next unit. */
  phases: { in: number; out: number; run: number };
  net: number;
  sector?: 1 | 2 | 3;
  /**
   * "Turn 13", "the straight from Turn 10 to Turn 11"; by lap distance where
   * the layout has no turn markers ("the 4.66 km corner").
   */
  name: string;
}

type DetectedUnit = Omit<CornerUnit, "phases" | "net" | "flatD" | "name">;

function km(distance: number): string {
  return (distance / 1000).toFixed(2);
}

function sectorAt(
  distance: number,
  sectorStarts: [number, number] | undefined,
): 1 | 2 | 3 | undefined {
  if (!sectorStarts) return undefined;
  return distance < sectorStarts[0] ? 1 : distance < sectorStarts[1] ? 2 : 3;
}

/** Local speed minima that are real corners, on the shared grid. */
function detectApexes(speed: Float32Array, step: number): number[] {
  const window = Math.round(APEX_WINDOW_M / step);
  const context = Math.round(APEX_CONTEXT_M / step);
  const apexes: number[] = [];
  for (let i = window; i < speed.length - window; i += 1) {
    let isMin = true;
    for (let j = i - window; j <= i + window; j += 1) {
      if (speed[j] < speed[i] || (speed[j] === speed[i] && j < i)) {
        isMin = false;
        break;
      }
    }
    if (!isMin) continue;
    let before = speed[i];
    let after = speed[i];
    for (let j = Math.max(0, i - context); j < i; j += 1)
      before = Math.max(before, speed[j]);
    for (let j = i; j < Math.min(speed.length, i + context); j += 1)
      after = Math.max(after, speed[j]);
    if (Math.min(before, after) - speed[i] < APEX_MIN_DROP_KMH) continue;
    if (apexes.length > 0 && i - apexes[apexes.length - 1] <= window) continue;
    apexes.push(i);
  }
  return apexes;
}

function isOffThrottle(lap: LapSeries, i: number): boolean {
  return (
    lap.channels.throttle[i] < OFF_THROTTLE_PCT ||
    lap.channels.brake[i] > BRAKE_NOISE_PCT
  );
}

function nearestTurn(
  corners: Iterable<TrackCorner>,
  distance: number,
): TrackCorner | undefined {
  let best: TrackCorner | undefined;
  let bestGap = TURN_NEAREST_MAX_M;
  for (const corner of corners) {
    const gap = Math.abs(corner.distanceM - distance);
    if (gap <= bestGap) {
      best = corner;
      bestGap = gap;
    }
  }
  return best;
}

/**
 * Name each unit after the official turns it covers. A corner takes the turns
 * from where the driver comes off the throttle to where both laps are flat
 * again (or just past the slowest point), so a complex reads "Turns 3–4" when
 * the time went on the second turn's exit; turns taken flat on the run to the
 * next corner name nothing. Without markers, names fall back to lap distance.
 */
function nameUnits(
  units: readonly (DetectedUnit & { flatD: number })[],
  corners: readonly TrackCorner[],
): string[] {
  const covered: TrackCorner[][] = units.map(() => []);
  const unclaimed = new Set(corners);
  for (const corner of corners) {
    let owner = -1;
    units.forEach((unit, i) => {
      if (
        unit.kind !== "corner" ||
        corner.distanceM < unit.from ||
        corner.distanceM > Math.max(unit.apexD + TURN_APEX_SLACK_M, unit.flatD)
      )
        return;
      // Only the slack past one apex can overlap the next corner's approach.
      if (
        owner < 0 ||
        Math.abs(corner.distanceM - unit.apexD) <
          Math.abs(corner.distanceM - units[owner].apexD)
      )
        owner = i;
    });
    if (owner >= 0) {
      covered[owner].push(corner);
      unclaimed.delete(corner);
    }
  }
  units.forEach((unit, i) => {
    if (unit.kind !== "corner" || covered[i].length > 0) return;
    const nearest = nearestTurn(unclaimed, unit.apexD);
    if (!nearest) return;
    covered[i].push(nearest);
    unclaimed.delete(nearest);
  });

  // The turn a stretch running into each unit arrives at. A flat-out stretch
  // starts at a speed dip with no lift, which is a turn taken flat.
  const entry = units.map((unit, i) =>
    unit.kind === "corner"
      ? covered[i][0]
      : unit.kind === "straight"
        ? nearestTurn(corners, unit.from)
        : undefined,
  );

  const names = units.map((unit, i) => {
    if (unit.kind === "corner") {
      const turns = covered[i];
      if (turns.length === 0) return `the ${km(unit.apexD)} km corner`;
      const first = turns[0].number;
      const last = turns[turns.length - 1].number;
      return first === last ? `Turn ${first}` : `Turns ${first}–${last}`;
    }
    if (unit.kind === "lead") return "";
    const start = entry[i]?.number;
    const end = entry[i + 1]?.number;
    if (start && end && end > start) {
      return `the ${end === start + 1 ? "straight" : "run"} from Turn ${start} to Turn ${end}`;
    }
    if (end) return `the straight before Turn ${end}`;
    if (start) {
      return i === units.length - 1
        ? `the run from Turn ${start} to the line`
        : `the straight after Turn ${start}`;
    }
    return `the ${km(unit.from)}–${km(unit.to)} km straight`;
  });
  // The lead stretch reads best named after the corner it runs into.
  if (units[0]?.kind === "lead") {
    names[0] = entry[1]
      ? `the run to Turn ${entry[1].number}`
      : units[1]
        ? `the run to ${names[1]}`
        : `the run from the line to ${km(units[0].to)} km`;
  }
  return names;
}

/**
 * Split the lap into units for two laps on the same grid. Units start where
 * either lap first lifts or brakes before a corner's slowest point.
 */
function detectCornerUnits(
  set: LapSeriesSet,
  sectorStarts?: [number, number],
): DetectedUnit[] {
  const [a, b] = set.laps;
  if (!a || !b) return [];
  const step = GRID_STEP_M;
  const reference = new Float32Array(set.grid.length);
  for (let i = 0; i < reference.length; i += 1) {
    reference[i] = (a.channels.speed[i] + b.channels.speed[i]) / 2;
  }
  const apexes = detectApexes(reference, step);
  const lookback = Math.round(ONSET_LOOKBACK_M / step);
  const lifted: boolean[] = [];
  const onsets = apexes.map((apex, k) => {
    const floor = k > 0 ? apexes[k - 1] + 1 : 0;
    const limit = Math.max(floor, apex - lookback);
    // A fast corner is back on full throttle before its slowest point (the
    // car keeps scrubbing speed through it), so the lift is searched for from
    // the approach's top speed onwards, not only at the slowest point. Without
    // this Melbourne's Turn 6 and Turns 9–10 read as flat-out straights and
    // their braking was charged to the corner before.
    let peak = apex;
    for (let j = apex; j >= limit; j -= 1) {
      if (reference[j] > reference[peak]) peak = j;
    }
    let onset = apex;
    let anyLift = false;
    for (const lap of [a, b]) {
      let j = apex;
      while (j >= peak && !isOffThrottle(lap, j)) j -= 1;
      if (j < peak) continue;
      while (j > limit && isOffThrottle(lap, j - 1)) j -= 1;
      onset = Math.min(onset, j);
      anyLift = true;
    }
    lifted.push(anyLift);
    return onset;
  });

  const units: DetectedUnit[] = [];
  const lastIndex = set.grid.length - 1;
  if (onsets.length === 0 || onsets[0] > 0) {
    const to = onsets[0] ?? lastIndex;
    units.push({
      index: 0,
      kind: "lead",
      from: 0,
      to: set.grid[to],
      apexD: 0,
      sector: sectorAt(0, sectorStarts),
    });
  }
  apexes.forEach((apex, k) => {
    const from = set.grid[onsets[k]];
    const to = set.grid[k + 1 < onsets.length ? onsets[k + 1] : lastIndex];
    const isStraight = !lifted[k];
    const apexD = set.grid[apex];
    units.push({
      index: units.length,
      kind: isStraight ? "straight" : "corner",
      from,
      to,
      apexD: isStraight ? from : apexD,
      sector: sectorAt(isStraight ? from : apexD, sectorStarts),
    });
  });
  return units;
}

// ---------------------------------------------------------------------------
// Per-unit evidence from raw samples
// ---------------------------------------------------------------------------

interface UnitLapEvidence {
  liftD: number | null;
  brakeD: number | null;
  peakBrake: number;
  minSpeed: number;
  minSpeedD: number;
  /**
   * Where the driver is back on sustained full throttle: after the slowest
   * point in a slow corner, before it in a fast one.
   */
  fullThrottleD: number | null;
  /** Never off the throttle between the unit start and the slowest point. */
  stayedFlat: boolean;
}

function scan(
  lap: PreparedLap,
  from: number,
  to: number,
  visit: (i: number) => boolean | void,
): void {
  for (
    let i = lowerBound(lap.d, from);
    i < lap.d.length && lap.d[i] <= to;
    i += 1
  ) {
    if (visit(i) === true) return;
  }
}

function unitEvidence(
  lap: PreparedLap,
  unit: Pick<CornerUnit, "from" | "to" | "apexD">,
): UnitLapEvidence {
  let liftD: number | null = null;
  let brakeD: number | null = null;
  scan(lap, unit.from - 5, unit.apexD, (i) => {
    if (lap.throttle[i] < LIFT_PCT) {
      liftD = lap.d[i];
      return true;
    }
  });
  scan(lap, unit.from - 5, unit.apexD + 40, (i) => {
    if (lap.brake[i] > BRAKING_PCT) {
      brakeD = lap.d[i];
      return true;
    }
  });
  let minSpeed = Infinity;
  let minSpeedD = unit.apexD;
  scan(lap, unit.from, Math.min(unit.apexD + 120, unit.to), (i) => {
    if (lap.speed[i] < minSpeed) {
      minSpeed = lap.speed[i];
      minSpeedD = lap.d[i];
    }
  });
  let peakBrake = 0;
  let stayedFlat = true;
  scan(lap, unit.from, minSpeedD, (i) => {
    peakBrake = Math.max(peakBrake, lap.brake[i]);
    // Same thresholds as `isOffThrottle`, which decided where the unit starts.
    if (lap.throttle[i] < OFF_THROTTLE_PCT || lap.brake[i] > BRAKE_NOISE_PCT)
      stayedFlat = false;
  });
  // In a fast corner the throttle is already flat at the slowest point; the
  // run in progress there began where the driver picked it back up.
  let throttleFrom = lowerBound(lap.d, minSpeedD);
  if (
    throttleFrom < lap.d.length &&
    lap.throttle[throttleFrom] >= FULL_THROTTLE_PCT
  ) {
    while (
      throttleFrom > 0 &&
      lap.d[throttleFrom - 1] >= unit.from &&
      lap.throttle[throttleFrom - 1] >= FULL_THROTTLE_PCT
    )
      throttleFrom -= 1;
  }
  // A brief full-throttle stab followed by another lift is not "flat": take
  // the start of a run that lasts SUSTAINED_THROTTLE_M or reaches the unit end.
  let fullThrottleD: number | null = null;
  let runStart: number | null = null;
  scan(lap, lap.d[throttleFrom] ?? minSpeedD, unit.to, (i) => {
    if (lap.throttle[i] >= FULL_THROTTLE_PCT) {
      runStart ??= lap.d[i];
      if (lap.d[i] - runStart >= SUSTAINED_THROTTLE_M) {
        fullThrottleD = runStart;
        return true;
      }
    } else {
      runStart = null;
    }
  });
  fullThrottleD ??= runStart;
  return {
    liftD,
    brakeD,
    peakBrake,
    minSpeed: Number.isFinite(minSpeed)
      ? minSpeed
      : valueAt(lap.d, lap.speed, unit.apexD),
    minSpeedD,
    fullThrottleD,
    stayedFlat,
  };
}

/**
 * How much faster `fast` still is over the last third of a full-throttle
 * stretch than its higher exit speed predicts, in km/h. Two equal cars at full
 * throttle follow one speed curve shifted along the track, so a lead in exit
 * speed fades as they near top speed; one that persists is battery, car or
 * tow, not the corner.
 */
function lateSpeedSurplus(
  fast: PreparedLap,
  slow: PreparedLap,
  from: number,
  to: number,
): { surplus: number; delta: number } | null {
  const exitSpeed = valueAt(fast.d, fast.speed, from);
  let shift: number | null = null;
  for (let x = from; x <= to; x += GRID_STEP_M) {
    if (valueAt(slow.d, slow.speed, x) >= exitSpeed) {
      shift = x - from;
      break;
    }
  }
  // The slower lap never reaches that speed: too short a stretch to tell.
  if (shift === null) return null;
  const start = to - (to - from) * LATE_STRETCH_SHARE;
  let surplus = 0;
  let delta = 0;
  let count = 0;
  for (let x = start; x <= to; x += 10) {
    const fastSpeed = valueAt(fast.d, fast.speed, x);
    surplus += fastSpeed - valueAt(slow.d, slow.speed, Math.min(x + shift, to));
    delta += fastSpeed - valueAt(slow.d, slow.speed, x);
    count += 1;
  }
  return count > 0 ? { surplus: surplus / count, delta: delta / count } : null;
}

function storeAt(lap: PreparedLap, x: number): number {
  return valueAt(lap.d, lap.ersJ, x);
}

function firstEmpty(lap: PreparedLap, from: number, to: number): number | null {
  let found: number | null = null;
  scan(lap, from, to, (i) => {
    if (lap.ersJ[i] <= BATTERY_EMPTY_J) {
      found = lap.d[i];
      return true;
    }
  });
  return found;
}

function flatShare(lap: PreparedLap, from: number, to: number): number {
  let flat = 0;
  let total = 0;
  scan(lap, from, to, (i) => {
    total += 1;
    if (lap.throttle[i] >= FULL_THROTTLE_PCT) flat += 1;
  });
  return total === 0 ? 1 : flat / total;
}

/** Largest amount by which `b` is faster than `a` over a stretch (km/h). */
function maxSpeedDeficit(
  a: PreparedLap,
  b: PreparedLap,
  from: number,
  to: number,
): number {
  let worst = 0;
  for (let x = from; x <= to; x += GRID_STEP_M) {
    worst = Math.max(
      worst,
      valueAt(b.d, b.speed, x) - valueAt(a.d, a.speed, x),
    );
  }
  return worst;
}

// ---------------------------------------------------------------------------
// Tips
// ---------------------------------------------------------------------------

export type TipCategory =
  | "Battery"
  | "Braking"
  | "Mid-corner"
  | "Exit"
  | "Straight";

export interface LapTip {
  id: string;
  /** tip = A lost time; keep = A gained it; note = a fact with no advice to give. */
  kind: "tip" | "keep" | "note";
  category: TipCategory;
  /** Signed seconds for the unit: positive = A lost time. */
  timeS: number;
  /** Where on the lap, for list titles: "Turn 1 exit", "Run to Turn 1". */
  title: string;
  /** Compact facts: "Throttle 104 m later · 22 km/h slower onto the straight". */
  summary: string;
  /** Imperative advice, only for the player's own lap and only on tips. */
  advice?: string;
  /** The advice, or a plain description with the time when there is none. */
  headline: string;
  evidence: string;
  unitIndex: number;
  /** Stretch the chart zooms to. */
  from: number;
  to: number;
  sector?: 1 | 2 | 3;
}

export type ComparabilityTone = "same" | "differs";

export interface ComparabilityItem {
  id: "car" | "tyres" | "battery" | "weather" | "start" | "traffic";
  label: string;
  tone: ComparabilityTone;
}

export interface LapComparison {
  totalS: number;
  units: CornerUnit[];
  tips: LapTip[];
  /** Time in units below the tip floor, and how many there are. */
  remainderS: number;
  remainderCount: number;
  comparability: ComparabilityItem[];
  /** Imperative advice only when A is the player's own lap. */
  advice: boolean;
}

const fmtS = (value: number) => `${Math.abs(value).toFixed(3)} s`;
const fmtM = (value: number) => `${Math.round(Math.abs(value))} m`;
const fmtKmh = (value: number) => `${Math.round(Math.abs(value))} km/h`;
const fmtMj = (joules: number) => `${(Math.abs(joules) / MJ).toFixed(2)} MJ`;

interface Voice {
  /** Sentence-initial subject for A: "You" or the driver's name. */
  subject: string;
  /** Mid-sentence subject: "you" or the driver's name. */
  mid: string;
  /** Matching past tense of "to be". */
  was: string;
  possessive: string;
  /** Imperative advice is only written for the player's own lap. */
  advice: boolean;
}

function voiceFor(a: LapContext): Voice {
  if (a.isPlayer) {
    return {
      subject: "You",
      mid: "you",
      was: "were",
      possessive: "Your",
      advice: true,
    };
  }
  const name = titleCaseName(a.driverName);
  return {
    subject: name,
    mid: name,
    was: "was",
    possessive: `${name}'s`,
    advice: false,
  };
}

interface Explanation {
  category: TipCategory;
  /** Imperative headline, when the cause has advice to give. */
  advice?: string;
  /** Plain headline for descriptions and causes with no advice. */
  describe: string;
  /** Compact "·"-joined facts, built with `factLine()`. */
  summary: string;
  evidence: string;
  /**
   * Set by battery explanations that traced the energy to an earlier unit:
   * that unit's index, and the time the energy was worth here (A − B).
   */
  energy?: { fromUnit: number; alongS: number; where: string };
}

type Phase = keyof CornerUnit["phases"];
const PHASE_ORDER: Phase[] = ["in", "out", "run"];
const PHASE_WORDS: Record<Phase, string> = {
  in: "on the way in",
  out: "on the way out",
  run: "on the straight after",
};

function lostOrGained(value: number): "lost" | "gained" {
  return value > 0 ? "lost" : "gained";
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Compact facts for a tip's one-line summary, skipping empty parts. */
function factLine(
  parts: readonly (string | false | null | undefined)[],
): string {
  return capitalize(parts.filter((part): part is string => !!part).join(" · "));
}

/**
 * Clause for the phases a tip's cause does not cover, so the evidence adds up
 * to the stretch's time and never overstates the cause: "0.034 s won back
 * after", "after losing 0.031 s on the way in", or "plus 0.056 s on the
 * straight after" for more time the same way.
 */
function otherPhases(unit: CornerUnit, dominant: Phase): string {
  const sign = Math.sign(unit.net);
  const dominantAt = PHASE_ORDER.indexOf(dominant);
  const others = PHASE_ORDER.filter((phase) => phase !== dominant);
  const opposite = others.filter(
    (phase) => Math.sign(unit.phases[phase]) === -sign,
  );
  const same = others.filter((phase) => Math.sign(unit.phases[phase]) === sign);
  const before = opposite.filter(
    (phase) => PHASE_ORDER.indexOf(phase) < dominantAt,
  );
  const after = opposite.filter(
    (phase) => PHASE_ORDER.indexOf(phase) > dominantAt,
  );
  const total = (phases: Phase[]) =>
    phases.reduce((sum, phase) => sum + unit.phases[phase], 0);
  const words = (phases: Phase[]) =>
    phases.map((phase) => PHASE_WORDS[phase]).join(" and ");
  const clauses: string[] = [];
  if (Math.abs(total(before)) >= PHASE_OFFSET_MENTION_S) {
    clauses.push(
      `after ${sign > 0 ? "gaining" : "losing"} ${fmtS(total(before))} ${words(before)}`,
    );
  }
  if (Math.abs(total(after)) >= PHASE_OFFSET_MENTION_S) {
    clauses.push(
      `${fmtS(total(after))} ${sign > 0 ? "won back" : "given back"} after`,
    );
  }
  if (Math.abs(total(same)) >= PHASE_EXTRA_MENTION_S) {
    clauses.push(`plus ${fmtS(total(same))} ${words(same)}`);
  }
  return clauses.length > 0 ? `, ${clauses.join(", ")}` : "";
}

interface EnergySource {
  unitIndex: number;
  name: string;
  extraJ: number;
}

interface UnitFacts {
  unit: CornerUnit;
  a: PreparedLap;
  b: PreparedLap;
  eA: UnitLapEvidence;
  eB: UnitLapEvidence;
  /** Extra battery A spent over the whole unit (J); positive = A spent more. */
  extraSpendJ: number;
  /**
   * The earlier units where A spent the most extra battery and saved the most,
   * for battery tips; `extraJ` is positive where A spent more.
   */
  earlierSpend?: EnergySource;
  earlierSaving?: EnergySource;
  /** Either lap is a race's lap 1, so the opening stretch includes the launch. */
  standingStart: boolean;
  /** The unit before this one, which a straight inherits its entry speed from. */
  previousName?: string;
}

/**
 * Plain list of the input differences above noise, for a time change no
 * single cause explains. Never claims inputs match without checking them.
 */
function inputDifferences(
  facts: UnitFacts,
  voice: Voice,
  /** A's speed minus B's at the unit start (km/h), for the way in. */
  arrival = 0,
): string {
  const d = inputDeltas(facts, arrival);
  const clauses: string[] = [];
  if (d.arrival !== null) {
    clauses.push(
      `${voice.mid} arrived ${fmtKmh(d.arrival)} ${d.arrival > 0 ? "faster" : "slower"}`,
    );
  }
  if (d.brake !== null) {
    clauses.push(
      `${clauses.length > 0 ? "" : `${voice.mid} `}braked ${fmtM(d.brake)} ${d.brake < 0 ? "earlier" : "later"}`,
    );
  }
  if (d.min !== null) {
    clauses.push(
      `the slowest point was ${fmtKmh(d.min)} ${d.min < 0 ? "lower" : "higher"}`,
    );
  }
  if (d.throttle !== null) {
    clauses.push(
      `full throttle came ${fmtM(d.throttle)} ${d.throttle > 0 ? "later" : "sooner"}`,
    );
  }
  if (clauses.length === 0) {
    return "Braking point, slowest point and full throttle are all within a few metres and km/h, so no single input explains it.";
  }
  const listed =
    clauses.length === 1
      ? clauses[0]
      : `${clauses.slice(0, -1).join(", ")} and ${clauses[clauses.length - 1]}`;
  return `${capitalize(listed)}, but none of it accounts for the time on its own.`;
}

/** Input differences above noise (A − B), null where within noise. */
function inputDeltas(facts: UnitFacts, arrival: number) {
  const { eA, eB } = facts;
  const brake =
    eA.brakeD !== null && eB.brakeD !== null ? eA.brakeD - eB.brakeD : null;
  const min = eA.minSpeed - eB.minSpeed;
  const throttle =
    eA.fullThrottleD !== null && eB.fullThrottleD !== null
      ? eA.fullThrottleD - eB.fullThrottleD
      : null;
  return {
    arrival: Math.abs(arrival) >= BRAKING_SPEED_DIFF_KMH ? arrival : null,
    brake:
      brake !== null && Math.abs(brake) >= BRAKE_POINT_DIFF_M ? brake : null,
    min: Math.abs(min) >= SPEED_DIFF_KMH ? min : null,
    throttle:
      throttle !== null && Math.abs(throttle) >= THROTTLE_POINT_DIFF_M
        ? throttle
        : null,
  };
}

/** `inputDifferences()` as compact facts; empty when inputs match. */
function inputFacts(facts: UnitFacts, arrival = 0): string[] {
  const d = inputDeltas(facts, arrival);
  return [
    d.arrival !== null &&
      `arrived ${fmtKmh(d.arrival)} ${d.arrival > 0 ? "faster" : "slower"}`,
    d.brake !== null &&
      `braked ${fmtM(d.brake)} ${d.brake < 0 ? "earlier" : "later"}`,
    d.min !== null &&
      `slowest point ${fmtKmh(d.min)} ${d.min < 0 ? "lower" : "higher"}`,
    d.throttle !== null &&
      `throttle ${fmtM(d.throttle)} ${d.throttle > 0 ? "later" : "sooner"}`,
  ].filter((part): part is string => !!part);
}

const NO_SINGLE_INPUT = "No single input explains it";

/** Name for the full-throttle stretch of a unit. */
function stretchName(unit: CornerUnit): string {
  return unit.kind === "corner"
    ? `the straight out of ${unit.name}`
    : unit.name;
}

/**
 * Where a tip happened, for list titles: "Turn 1 exit", "Turns 3–4 entry",
 * "Straight out of Turn 6", "Run to Turn 1". Corner categories name the part
 * of the corner; full-throttle categories name the stretch.
 */
function tipTitle(unit: CornerUnit, category: TipCategory): string {
  const place = (name: string) => capitalize(name.replace(/^the /, ""));
  if (
    unit.kind !== "corner" ||
    category === "Straight" ||
    category === "Battery"
  ) {
    return place(stretchName(unit));
  }
  const part =
    category === "Braking"
      ? "entry"
      : category === "Mid-corner"
        ? "mid-corner"
        : "exit";
  return `${place(unit.name)} ${part}`;
}

/**
 * Battery as the cause on a full-throttle stretch, or null when it is not.
 * All of these must hold:
 * - the stretch is `BATTERY_STRETCH_MIN_M` long and both laps are flat for
 *   `FLAT_STRETCH_MIN_SHARE` of it;
 * - entry speed does not already explain the direction of the change;
 * - one lap ran dry clearly sooner, or deployed `ENERGY_DIFF_J` less;
 * - the speed difference along it reached `SPEED_DIFF_KMH`.
 *
 * A loss is advice: arrive with more, or deploy more. A gain is only worth
 * keeping when A arrived with more; a gain from spending more is a note,
 * because that energy is missing later in the lap.
 */
function explainBattery(facts: UnitFacts, voice: Voice): Explanation | null {
  const { unit, a, b } = facts;
  const from = unit.flatD;
  const to = unit.to;
  if (to - from < BATTERY_STRETCH_MIN_M) return null;
  const lost = unit.net > 0;
  // Entering the stretch slower (for a loss) or faster (for a gain) is the
  // simpler explanation; battery is only blamed when entry speed is not.
  const entryDelta = valueAt(a.d, a.speed, from) - valueAt(b.d, b.speed, from);
  if ((lost ? 1 : -1) * entryDelta <= -SPEED_DIFF_KMH) return null;
  if (
    flatShare(a, from, to) < FLAT_STRETCH_MIN_SHARE ||
    flatShare(b, from, to) < FLAT_STRETCH_MIN_SHARE
  )
    return null;

  const startA = storeAt(a, from);
  const startB = storeAt(b, from);
  const usedA = startA - storeAt(a, to);
  const usedB = startB - storeAt(b, to);
  const emptyA = firstEmpty(a, from, to);
  const emptyB = firstEmpty(b, from, to);
  const [early, late] = lost ? [emptyA, emptyB] : [emptyB, emptyA];
  const ranDryBy =
    early !== null && (late === null || late - early >= RAN_DRY_DIFF_M)
      ? (late ?? to) - early
      : null;
  const deployGap = lost ? usedB - usedA : usedA - usedB;
  if (ranDryBy === null && deployGap < ENERGY_DIFF_J) return null;
  const swing = lost
    ? maxSpeedDeficit(a, b, from, to)
    : maxSpeedDeficit(b, a, from, to);
  if (swing < SPEED_DIFF_KMH) return null;

  const where = stretchName(unit);
  const arrivedDiff = startA - startB;
  const arrived =
    Math.abs(arrivedDiff) >= ARRIVAL_ENERGY_DIFF_J
      ? `${voice.subject} arrived with ${fmtMj(startA)} against ${fmtMj(startB)}`
      : `${voice.subject} arrived with the same ${fmtMj(startA)}`;
  const how =
    ranDryBy === null
      ? `deployed ${fmtMj(deployGap)} ${lost ? "less" : "more"}`
      : late === null
        ? lost
          ? `ran dry with ${fmtM(ranDryBy)} to go where lap B never did`
          : `still had charge where lap B ran dry with ${fmtM(ranDryBy)} to go`
        : `ran dry ${fmtM(ranDryBy)} ${lost ? "sooner" : "later"}`;
  const despite =
    Math.abs(entryDelta) > SPEED_DIFF_KMH
      ? ` despite entering ${fmtKmh(entryDelta)} ${entryDelta > 0 ? "faster" : "slower"}`
      : "";
  const speed = `${voice.was} up to ${fmtKmh(swing)} ${lost ? "slower" : "faster"}${despite}`;
  // Only the full-throttle part of a corner unit is battery; its way in and
  // out are itemised so the tip's time is not all pinned on the battery.
  const alongS = unit.kind === "corner" ? unit.phases.run : unit.net;
  const rest = unit.kind === "corner" ? otherPhases(unit, "run") : "";
  const cost = rest
    ? `: ${fmtS(alongS)} ${lostOrGained(alongS)} along it${rest}`
    : "";
  // The battery on arrival is the sum of what each earlier stretch spent, so
  // the biggest contributor can be named; "most" only when it is most.
  const source =
    arrivedDiff < -ARRIVAL_ENERGY_DIFF_J
      ? facts.earlierSpend
      : arrivedDiff > ARRIVAL_ENERGY_DIFF_J
        ? facts.earlierSaving
        : undefined;
  const cite = source
    ? ` ${Math.abs(source.extraJ) >= 0.5 * Math.abs(arrivedDiff) ? "Most" : "The largest part"} of that came from ${source.name}, where ${voice.mid} used ${fmtMj(source.extraJ)} ${source.extraJ > 0 ? "more" : "less"}.`
    : "";
  const energy = source && { fromUnit: source.unitIndex, alongS, where };
  const describe = `${capitalize(lostOrGained(alongS))} ${fmtS(alongS)} on battery along ${where}`;
  const summary = factLine([
    Math.abs(arrivedDiff) >= ARRIVAL_ENERGY_DIFF_J &&
      `arrived with ${fmtMj(arrivedDiff)} ${arrivedDiff > 0 ? "more" : "less"}`,
    how,
    `up to ${fmtKmh(swing)} ${lost ? "slower" : "faster"}`,
  ]);

  if (lost) {
    return {
      category: "Battery",
      advice:
        ranDryBy !== null || arrivedDiff < -ARRIVAL_ENERGY_DIFF_J
          ? `Arrive at ${where} with more battery`
          : `Deploy more battery along ${where}`,
      describe,
      summary,
      evidence: `${arrived}, ${how} and ${speed}${cost}.${cite}`,
      energy,
    };
  }
  // A gain from spending more is not something to repeat blindly: that
  // energy is missing later. Only arriving with more is worth keeping.
  return {
    category: "Battery",
    advice:
      arrivedDiff > ARRIVAL_ENERGY_DIFF_J
        ? `Keep saving battery for ${where}`
        : undefined,
    describe,
    summary,
    evidence:
      arrivedDiff > ARRIVAL_ENERGY_DIFF_J
        ? `${arrived}, ${how} and ${speed}${cost}.${cite}`
        : `${arrived}, ${how} and ${speed}${cost}; that energy was not there for later in the lap.`,
    energy,
  };
}

/**
 * Full-throttle stretch: a straight, the lead stretch, or a corner's run to
 * the next unit. First match wins:
 * 1. Lead stretch with a race's lap 1 involved: the launch, not comparable.
 * 2. Battery, by `explainBattery`.
 * 3. After a corner, a slower or faster exit speed, named by what changed the
 *    exit: the throttle point, then the slowest-point speed, else the listed
 *    differences. Adds a caveat when the speed lead is still there late on.
 * 4. A loss with more of the stretch off full throttle: stay flat.
 * 5. A straight entered slower or faster: inherited from the unit before.
 * 6. Entry speed, battery use or throttle differ: listed, never divided up.
 * 7. Nothing differs: car, setup or tow, so no driving advice.
 */
function explainRun(facts: UnitFacts, voice: Voice): Explanation {
  const { unit, a, b, eA, eB } = facts;
  const lost = unit.net > 0;
  const sign = lost ? 1 : -1;
  if (unit.kind === "lead" && facts.standingStart) {
    return {
      category: "Straight",
      describe: `${capitalize(lostOrGained(unit.net))} ${fmtS(unit.net)} on ${unit.name}`,
      summary: "Includes the launch from the grid",
      evidence:
        "This stretch includes the launch from the grid, and grid slots differ, so it is not a like-for-like comparison.",
    };
  }
  const battery = explainBattery(facts, voice);
  if (battery) return battery;

  const where = unit.name;
  const back = otherPhases(unit, "run");
  const verb = lostOrGained(unit.net);
  const exitDelta =
    valueAt(a.d, a.speed, unit.flatD) - valueAt(b.d, b.speed, unit.flatD);
  if (unit.kind === "corner" && sign * exitDelta <= -SPEED_DIFF_KMH) {
    // A left the corner slower (loss) or faster (gain) and it compounded
    // down the straight; name the input that changed the exit.
    const onto = `${voice.mid} ${voice.was} ${fmtKmh(exitDelta)} ${exitDelta < 0 ? "slower" : "faster"} onto the straight`;
    const ontoFact = `${fmtKmh(exitDelta)} ${exitDelta < 0 ? "slower" : "faster"} onto the straight`;
    const cost = `${fmtS(unit.phases.run)} ${lostOrGained(unit.phases.run)} by the next corner${back}`;
    // An exit-speed lead fades down a straight. If it is still there late on,
    // the corner is not the whole story and the tip must say so.
    const late = lost
      ? lateSpeedSurplus(b, a, unit.flatD, unit.to)
      : lateSpeedSurplus(a, b, unit.flatD, unit.to);
    const straightLine =
      late && late.surplus >= SPEED_DIFF_KMH
        ? ` ${voice.subject} ${voice.was} still ${fmtKmh(late.delta)} ${lost ? "slower" : "faster"} late on the straight, more than exit speed explains, so part of this is battery, car or tow.`
        : "";
    const spend = `${straightLine}${
      Math.abs(facts.extraSpendJ) >= ENERGY_DIFF_J
        ? ` ${voice.subject} used ${fmtMj(facts.extraSpendJ)} ${facts.extraSpendJ > 0 ? "more" : "less"} battery through here.`
        : ""
    }`;
    const throttleDelta =
      eA.fullThrottleD !== null && eB.fullThrottleD !== null
        ? eA.fullThrottleD - eB.fullThrottleD
        : null;
    if (
      throttleDelta !== null &&
      sign * throttleDelta >= THROTTLE_POINT_DIFF_M
    ) {
      return {
        category: "Exit",
        advice: lost
          ? `Get on the throttle sooner out of ${where}`
          : `Keep the early throttle out of ${where}`,
        describe: `${capitalize(verb)} ${fmtS(unit.net)} out of ${where}`,
        summary: factLine([
          `throttle ${fmtM(throttleDelta)} ${throttleDelta > 0 ? "later" : "sooner"}`,
          ontoFact,
        ]),
        evidence: `Full throttle came ${fmtM(throttleDelta)} ${throttleDelta > 0 ? "later" : "sooner"} and ${onto}: ${cost}.${spend}`,
      };
    }
    const minDelta = eA.minSpeed - eB.minSpeed;
    if (sign * minDelta <= -SPEED_DIFF_KMH) {
      return {
        category: "Mid-corner",
        advice: lost
          ? `Carry more speed through ${where}`
          : `Keep the corner speed through ${where}`,
        describe: `${capitalize(verb)} ${fmtS(unit.net)} out of ${where}`,
        summary: factLine([
          `slowest point ${fmtKmh(minDelta)} ${minDelta < 0 ? "lower" : "higher"}`,
          ontoFact,
        ]),
        evidence: `${voice.possessive} slowest point was ${fmtKmh(minDelta)} ${minDelta < 0 ? "lower" : "higher"} (${Math.round(eA.minSpeed)} vs ${Math.round(eB.minSpeed)} km/h) and ${onto}: ${cost}.${spend}`,
      };
    }
    return {
      category: "Exit",
      describe: `${capitalize(verb)} ${fmtS(unit.net)} out of ${where}`,
      summary: factLine([ontoFact, ...inputFacts(facts)]),
      evidence: `${capitalize(onto)}: ${cost}. ${inputDifferences(facts, voice)}${spend}`,
    };
  }

  const flatA = flatShare(a, unit.flatD, unit.to);
  const flatB = flatShare(b, unit.flatD, unit.to);
  if (lost && flatB - flatA >= FLAT_SHARE_DIFF) {
    return {
      category: "Straight",
      advice: `Stay flat along ${stretchName(unit)}`,
      describe: `Lost ${fmtS(unit.net)} along ${stretchName(unit)}`,
      summary: `${fmtM((flatB - flatA) * (unit.to - unit.flatD))} more off full throttle`,
      evidence: `${voice.subject} ${voice.was} off full throttle for ${fmtM((flatB - flatA) * (unit.to - unit.flatD))} more: ${fmtS(unit.phases.run)} lost${back}.`,
    };
  }
  // "Car, setup or tow" only once entry speed, throttle and battery use are
  // checked to match; otherwise say what differed without dividing it up.
  const usedDiff =
    storeAt(a, unit.flatD) -
    storeAt(a, unit.to) -
    (storeAt(b, unit.flatD) - storeAt(b, unit.to));
  if (unit.kind !== "corner" && sign * exitDelta <= -SPEED_DIFF_KMH) {
    return {
      category: "Straight",
      describe: `${capitalize(verb)} ${fmtS(unit.net)} along ${stretchName(unit)}`,
      summary:
        unit.kind === "lead"
          ? `Crossed the line ${fmtKmh(exitDelta)} ${exitDelta < 0 ? "slower" : "faster"}`
          : `Entered ${fmtKmh(exitDelta)} ${exitDelta < 0 ? "slower" : "faster"}`,
      evidence: `${capitalize(voice.mid)} entered it ${fmtKmh(exitDelta)} ${exitDelta < 0 ? "slower" : "faster"}${
        facts.previousName
          ? `, carried over from ${facts.previousName}`
          : unit.kind === "lead"
            ? ", carried across the line from the previous lap"
            : ""
      }, and the gap grew at full throttle.`,
    };
  }
  const differences: string[] = [];
  const differenceFacts: string[] = [];
  if (Math.abs(exitDelta) > SPEED_DIFF_KMH) {
    const fact = `entered it ${fmtKmh(exitDelta)} ${exitDelta < 0 ? "slower" : "faster"}`;
    differences.push(`${voice.mid} ${fact}`);
    differenceFacts.push(fact.replace("entered it", "entered"));
  }
  if (Math.abs(usedDiff) >= ENERGY_DIFF_J) {
    const fact = `deployed ${fmtMj(usedDiff)} ${usedDiff > 0 ? "more" : "less"} battery`;
    differences.push(`${voice.mid} ${fact}`);
    differenceFacts.push(fact);
  }
  if (Math.abs(flatA - flatB) >= FLAT_SHARE_DIFF) {
    const offThrottle = `${fmtM((flatA - flatB) * (unit.to - unit.flatD))} ${flatA < flatB ? "more" : "less"} off full throttle`;
    differences.push(`${voice.mid} spent ${offThrottle}`);
    differenceFacts.push(offThrottle);
  }
  // On a corner unit these rules judge the straight only; `back` itemises the
  // corner's own time so it is never put down to the car.
  const runS = unit.phases.run;
  if (differences.length > 0) {
    const listed =
      differences.length === 1
        ? differences[0]
        : `${differences.slice(0, -1).join(", ")} and ${differences[differences.length - 1]}`;
    return {
      category: "Straight",
      describe: `${capitalize(verb)} ${fmtS(unit.net)} along ${stretchName(unit)}`,
      summary: factLine(differenceFacts),
      evidence: `${capitalize(listed)}; the recording cannot say how much of the ${fmtS(runS)} each accounts for${back}.`,
    };
  }
  const notDriving =
    a.context.team && a.context.team === b.context.team
      ? "setup, tow or wind"
      : "car, setup or tow";
  const cornerS = unit.phases.in + unit.phases.out;
  if (Math.abs(cornerS) >= PHASE_EXTRA_MENTION_S) {
    return {
      category: "Straight",
      describe: `${capitalize(verb)} ${fmtS(unit.net)} along ${stretchName(unit)}`,
      summary: factLine([
        `${fmtS(runS)} on the straight: ${notDriving}`,
        `${fmtS(cornerS)} ${lostOrGained(cornerS)} in the corner`,
      ]),
      evidence: `Same entry speed, throttle and battery use down the straight, so its ${fmtS(runS)} is ${notDriving}${back}.`,
    };
  }
  return {
    category: "Straight",
    describe: `${capitalize(verb)} ${fmtS(unit.net)} along ${stretchName(unit)} at full throttle`,
    summary: `Same inputs, so ${notDriving}`,
    evidence: `Same entry speed, throttle and battery use, so this is ${notDriving}; there is no driving fix here.`,
  };
}

/**
 * Way in, from the lift to the slowest point. First match wins:
 * 1. Lifted or braked earlier (later) and slower (faster) all the way in:
 *    the braking point.
 * 2. One lap never came off the throttle: flat against a lift.
 * 3. Fast corner, both back on full throttle before the slowest point but at
 *    different places: the throttle pick-up.
 * 4. Slowest point lower or higher: corner speed.
 * 5. A loss with a much higher peak brake: over-braking.
 * 6. Otherwise the differences are listed, arrival speed included, and no
 *    cause is claimed.
 */
function explainEntry(facts: UnitFacts, voice: Voice): Explanation {
  const { unit, a, b, eA, eB } = facts;
  const lost = unit.net > 0;
  const sign = lost ? 1 : -1;
  const where = unit.name;
  const back = otherPhases(unit, "in");
  const verb = lostOrGained(unit.net);
  const liftDelta =
    eA.liftD !== null && eB.liftD !== null ? eA.liftD - eB.liftD : null;
  const brakeDelta =
    eA.brakeD !== null && eB.brakeD !== null ? eA.brakeD - eB.brakeD : null;
  const earlierBy =
    liftDelta !== null &&
    (brakeDelta === null || Math.abs(liftDelta) >= Math.abs(brakeDelta))
      ? { what: "came off the throttle", by: liftDelta }
      : brakeDelta !== null
        ? { what: "braked", by: brakeDelta }
        : null;
  const swing = lost
    ? maxSpeedDeficit(a, b, unit.from, unit.apexD)
    : maxSpeedDeficit(b, a, unit.from, unit.apexD);
  const inCost = `${fmtS(unit.phases.in)} ${lostOrGained(unit.phases.in)}`;

  // Braked or lifted earlier and slower all the way in (or the mirror image).
  if (
    earlierBy &&
    sign * earlierBy.by <= -BRAKE_POINT_DIFF_M &&
    swing >= BRAKING_SPEED_DIFF_KMH
  ) {
    return {
      category: "Braking",
      advice: lost
        ? `Brake later into ${where}`
        : `Keep the late braking into ${where}`,
      describe: `${capitalize(verb)} ${fmtS(unit.net)} braking into ${where}`,
      summary: factLine([
        `${earlierBy.what === "braked" ? "braked" : "lifted"} ${fmtM(earlierBy.by)} ${earlierBy.by < 0 ? "earlier" : "later"}`,
        `up to ${fmtKmh(swing)} ${lost ? "slower" : "faster"} on the way in`,
      ]),
      evidence: `${voice.subject} ${earlierBy.what} ${fmtM(earlierBy.by)} ${earlierBy.by < 0 ? "earlier" : "later"} and ${voice.was} up to ${fmtKmh(swing)} ${lost ? "slower" : "faster"} on the way in: ${inCost}${back}.`,
    };
  }
  // One lap lifted where the other never came off the throttle.
  const [lifter, flat] = lost ? [eA, eB] : [eB, eA];
  if (flat.stayedFlat && !lifter.stayedFlat && swing >= SPEED_DIFF_KMH) {
    return {
      category: "Mid-corner",
      advice: lost
        ? `Stay flat through ${where}`
        : `Keep it flat through ${where}`,
      describe: `${capitalize(verb)} ${fmtS(unit.net)} through ${where}`,
      summary: factLine([
        lost
          ? "lifted where lap B stayed flat"
          : "stayed flat where lap B lifted",
        `up to ${fmtKmh(swing)} ${lost ? "slower" : "faster"}`,
      ]),
      evidence: `${voice.subject} ${lost ? "lifted where lap B stayed flat" : "stayed flat where lap B lifted"} and ${voice.was} up to ${fmtKmh(swing)} ${lost ? "slower" : "faster"}: ${inCost} by the slowest point${back}.`,
    };
  }
  // In a fast corner the throttle is back before the slowest point, so a late
  // pick-up costs on the way in, not on the way out.
  const pickUpA = eA.fullThrottleD;
  const pickUpB = eB.fullThrottleD;
  if (
    pickUpA !== null &&
    pickUpB !== null &&
    Math.max(pickUpA, pickUpB) <= unit.apexD &&
    sign * (pickUpA - pickUpB) >= THROTTLE_POINT_DIFF_M
  ) {
    return {
      category: "Exit",
      advice: lost
        ? `Get back on the throttle sooner through ${where}`
        : `Keep the early throttle through ${where}`,
      describe: `${capitalize(verb)} ${fmtS(unit.net)} through ${where}`,
      summary: factLine([
        `throttle ${fmtM(pickUpA - pickUpB)} ${pickUpA > pickUpB ? "later" : "sooner"}`,
        `up to ${fmtKmh(swing)} ${lost ? "slower" : "faster"}`,
      ]),
      evidence: `Full throttle came ${fmtM(pickUpA - pickUpB)} ${pickUpA > pickUpB ? "later" : "sooner"} and ${voice.mid} ${voice.was} up to ${fmtKmh(swing)} ${lost ? "slower" : "faster"}: ${inCost} by the slowest point${back}.`,
    };
  }
  const minDelta = eA.minSpeed - eB.minSpeed;
  if (sign * minDelta <= -SPEED_DIFF_KMH) {
    return {
      category: "Mid-corner",
      advice: lost
        ? `Carry more speed to the slowest point of ${where}`
        : `Keep the corner speed through ${where}`,
      describe: `${capitalize(verb)} ${fmtS(unit.net)} into ${where}`,
      summary: `Slowest point ${fmtKmh(minDelta)} ${minDelta < 0 ? "lower" : "higher"} · ${Math.round(eA.minSpeed)} vs ${Math.round(eB.minSpeed)} km/h`,
      evidence: `${voice.possessive} slowest point was ${fmtKmh(minDelta)} ${minDelta < 0 ? "lower" : "higher"} (${Math.round(eA.minSpeed)} vs ${Math.round(eB.minSpeed)} km/h): ${inCost} on the way in${back}.`,
    };
  }
  if (lost && eA.peakBrake - eB.peakBrake >= PEAK_BRAKE_DIFF_PCT) {
    return {
      category: "Braking",
      advice: `Brake less hard into ${where}`,
      describe: `Lost ${fmtS(unit.net)} braking into ${where}`,
      summary: `Peak brake ${Math.round(eA.peakBrake)}% vs ${Math.round(eB.peakBrake)}%`,
      evidence: `${voice.possessive} peak brake was ${Math.round(eA.peakBrake)}% against ${Math.round(eB.peakBrake)}%: ${inCost} on the way in${back}.`,
    };
  }
  // Arriving faster or slower is inherited from the stretch before: it moves
  // time through the braking zone without the driver doing anything here.
  const arrival =
    valueAt(a.d, a.speed, unit.from) - valueAt(b.d, b.speed, unit.from);
  return {
    category: "Braking",
    describe: `${capitalize(verb)} ${fmtS(unit.net)} on the way into ${where}`,
    summary: factLine(inputFacts(facts, arrival)) || NO_SINGLE_INPUT,
    evidence: `${inCost} on the way in${back}. ${inputDifferences(facts, voice, arrival)}`,
  };
}

/**
 * Way out, from the slowest point to where both laps are flat. First match
 * wins:
 * 1. A loss after braking later, with the slowest point later or lower:
 *    braked too late.
 * 2. Full throttle later or sooner. With more speed carried to the slowest
 *    point as well, the corner was overdriven (slow a little more);
 *    otherwise it is the throttle point itself.
 * 3. Slowest point lower or higher: corner speed.
 * 4. Otherwise the differences are listed and no cause is claimed.
 */
function explainExit(facts: UnitFacts, voice: Voice): Explanation {
  const { unit, eA, eB } = facts;
  const lost = unit.net > 0;
  const sign = lost ? 1 : -1;
  const where = unit.name;
  const back = otherPhases(unit, "out");
  const verb = lostOrGained(unit.net);
  const brakeDelta =
    eA.brakeD !== null && eB.brakeD !== null ? eA.brakeD - eB.brakeD : null;
  const throttleDelta =
    eA.fullThrottleD !== null && eB.fullThrottleD !== null
      ? eA.fullThrottleD - eB.fullThrottleD
      : null;
  const minDelta = eA.minSpeed - eB.minSpeed;
  const apexShift = eA.minSpeedD - eB.minSpeedD;
  const outCost = `${fmtS(unit.phases.out)} ${lostOrGained(unit.phases.out)} on the way out`;

  // Braked too late: gained going in, but the slowest point came later or
  // lower and the exit cost more than the entry won.
  if (
    lost &&
    unit.phases.in < -PHASE_OFFSET_MENTION_S &&
    brakeDelta !== null &&
    brakeDelta >= BRAKE_POINT_DIFF_M &&
    (apexShift >= BRAKE_POINT_DIFF_M || minDelta <= -OVERSHOOT_SPEED_DIFF_KMH)
  ) {
    return {
      category: "Braking",
      advice: `Brake a touch earlier into ${where}`,
      describe: `Lost ${fmtS(unit.net)} through ${where} after braking later`,
      summary: factLine([
        `braked ${fmtM(brakeDelta)} later`,
        `slowest point ${fmtM(apexShift)} ${apexShift >= 0 ? "later" : "sooner"}`,
      ]),
      evidence: `${voice.subject} braked ${fmtM(brakeDelta)} later and gained ${fmtS(unit.phases.in)} going in, but the slowest point came ${fmtM(apexShift)} ${apexShift >= 0 ? "later" : "sooner"} and the exit cost ${fmtS(unit.phases.out + unit.phases.run)}.`,
    };
  }
  if (throttleDelta !== null && sign * throttleDelta >= THROTTLE_POINT_DIFF_M) {
    if (sign * minDelta >= SPEED_DIFF_KMH) {
      return {
        category: "Mid-corner",
        // For a gain this branch means A carried less speed and got on the
        // throttle sooner: the throttle is what to keep.
        advice: lost
          ? `Slow a little more for ${where}`
          : `Keep the early throttle out of ${where}`,
        describe: `${capitalize(verb)} ${fmtS(unit.net)} through ${where}`,
        summary: factLine([
          `${fmtKmh(minDelta)} ${minDelta > 0 ? "more" : "less"} at the slowest point`,
          `throttle ${fmtM(throttleDelta)} ${throttleDelta > 0 ? "later" : "sooner"}`,
        ]),
        evidence: `${voice.subject} carried ${fmtKmh(minDelta)} ${minDelta > 0 ? "more" : "less"} to the slowest point (${Math.round(eA.minSpeed)} vs ${Math.round(eB.minSpeed)} km/h) but full throttle came ${fmtM(throttleDelta)} ${throttleDelta > 0 ? "later" : "sooner"}: ${outCost}${back}.`,
      };
    }
    return {
      category: "Exit",
      advice: lost
        ? `Get on the throttle sooner out of ${where}`
        : `Keep the early throttle out of ${where}`,
      describe: `${capitalize(verb)} ${fmtS(unit.net)} out of ${where}`,
      summary: `Throttle ${fmtM(throttleDelta)} ${throttleDelta > 0 ? "later" : "sooner"}`,
      evidence: `Full throttle came ${fmtM(throttleDelta)} ${throttleDelta > 0 ? "later" : "sooner"}: ${outCost}${back}.`,
    };
  }
  if (sign * minDelta <= -SPEED_DIFF_KMH) {
    return {
      category: "Mid-corner",
      advice: lost
        ? `Carry more speed through ${where}`
        : `Keep the corner speed through ${where}`,
      describe: `${capitalize(verb)} ${fmtS(unit.net)} through ${where}`,
      summary: `Slowest point ${fmtKmh(minDelta)} ${minDelta < 0 ? "lower" : "higher"} · ${Math.round(eA.minSpeed)} vs ${Math.round(eB.minSpeed)} km/h`,
      evidence: `${voice.possessive} slowest point was ${fmtKmh(minDelta)} ${minDelta < 0 ? "lower" : "higher"} (${Math.round(eA.minSpeed)} vs ${Math.round(eB.minSpeed)} km/h): ${outCost}${back}.`,
    };
  }
  return {
    category: "Exit",
    describe: `${capitalize(verb)} ${fmtS(unit.net)} out of ${where}`,
    summary: factLine(inputFacts(facts)) || NO_SINGLE_INPUT,
    evidence: `${capitalize(outCost)}${back}. ${inputDifferences(facts, voice)}`,
  };
}

/**
 * Explains one unit. Straights and the lead stretch go to `explainRun`; a
 * corner goes to the phase that moved furthest in the direction of its net
 * change, and its other phases are itemised in the evidence.
 *
 * Each `explain*` function is an ordered list of rules where the first match
 * wins, so the order is the policy: a cause the recording can check directly
 * (braking point, throttle point) comes before a symptom (slowest-point
 * speed), and the last rule lists what differed without claiming a cause.
 * To add a cause, add a rule at the right place in the order, give it a
 * regression test on a synthetic lap, and check the census does not move
 * tips it should not.
 */
function explainUnit(facts: UnitFacts, voice: Voice): Explanation {
  const { unit } = facts;
  if (unit.kind !== "corner") return explainRun(facts, voice);
  const sign = unit.net > 0 ? 1 : -1;
  const dominant = PHASE_ORDER.reduce((best, phase) =>
    sign * unit.phases[phase] > sign * unit.phases[best] ? phase : best,
  );
  if (dominant === "in") return explainEntry(facts, voice);
  if (dominant === "out") return explainExit(facts, voice);
  return explainRun(facts, voice);
}

function compareContext(
  a: PreparedLap,
  b: PreparedLap,
  voice: Voice,
): ComparabilityItem[] {
  const items: ComparabilityItem[] = [];
  const ca = a.context;
  const cb = b.context;
  if (ca.team && cb.team) {
    items.push(
      ca.team === cb.team
        ? { id: "car", label: "Same car", tone: "same" }
        : { id: "car", label: `${ca.team} vs ${cb.team}`, tone: "differs" },
    );
  }
  const wearA = a.wearStartPct;
  const wearB = b.wearStartPct;
  // One figure when both round to the same percent, both figures otherwise.
  const wearText =
    wearA !== undefined && wearB !== undefined
      ? Math.abs(wearA - wearB) < 1
        ? `, ${Math.round(wearA)}% worn`
        : `, ${Math.round(wearA)}% vs ${Math.round(wearB)}% worn`
      : "";
  if (ca.compound && cb.compound) {
    const sameTyres =
      ca.compound === cb.compound &&
      (wearA === undefined ||
        wearB === undefined ||
        Math.abs(wearA - wearB) <= TYRE_WEAR_SAME_PCT);
    items.push({
      id: "tyres",
      label:
        ca.compound === cb.compound
          ? `${sameTyres ? "Same tyres" : "Same compound"} (${ca.compound}${wearText})`
          : `${ca.compound} vs ${cb.compound}${wearText}`,
      tone: sameTyres ? "same" : "differs",
    });
  }
  const startA = a.ersJ[0];
  const startB = b.ersJ[0];
  const endA = a.ersJ[a.ersJ.length - 1];
  const endB = b.ersJ[b.ersJ.length - 1];
  const startDiff = startA - startB;
  const usedDiff = startA - endA - (startB - endB);
  const sameBattery =
    Math.abs(startDiff) <= BATTERY_SAME_J &&
    Math.abs(usedDiff) <= BATTERY_SAME_J;
  items.push({
    id: "battery",
    label: sameBattery
      ? `Same battery (${fmtMj(startA)} → ${fmtMj(endA)})`
      : Math.abs(usedDiff) > BATTERY_SAME_J
        ? `${voice.subject} used ${fmtMj(usedDiff)} ${usedDiff > 0 ? "more" : "less"} battery`
        : `${voice.subject} started with ${fmtMj(startDiff)} ${startDiff > 0 ? "more" : "less"} battery`,
    tone: sameBattery ? "same" : "differs",
  });
  if (ca.weather && cb.weather) {
    items.push(
      ca.weather === cb.weather
        ? { id: "weather", label: ca.weather, tone: "same" }
        : {
            id: "weather",
            label: `${ca.weather} vs ${cb.weather}`,
            tone: "differs",
          },
    );
  }
  const standingA = isRaceSessionType(ca.sessionType) && ca.lapNumber === 1;
  const standingB = isRaceSessionType(cb.sessionType) && cb.lapNumber === 1;
  if (standingA !== standingB) {
    items.push({
      id: "start",
      label: `Lap ${standingA ? "A" : "B"} is a standing start`,
      tone: "differs",
    });
  }
  if (isRaceSessionType(ca.sessionType) || isRaceSessionType(cb.sessionType)) {
    items.push({
      id: "traffic",
      label: "Race lap: traffic and tow can play a part",
      tone: "differs",
    });
  }
  return items;
}

/**
 * Compare lap A with one comparison lap: units, tips in lap order, the
 * remainder below the floor, and how comparable the two laps are.
 */
export function compareLaps(
  a: PreparedLap,
  b: PreparedLap,
  options: {
    sectorStarts?: [number, number];
    /** Official turns of the layout, for naming; see `getTrackCorners()`. */
    corners?: readonly TrackCorner[];
  } = {},
): LapComparison {
  const set = buildLapSeries([a, b]);
  const gap = set.gaps[0];
  const unitGap = gapSeries(
    set.laps[0].time,
    set.laps[1].time,
    GRID_STEP_M,
    UNIT_GAP_HALF_WINDOW_M,
  );
  const gapAt = (x: number) => valueAt(set.grid, unitGap, x);
  const voice = voiceFor(a.context);

  const detected = detectCornerUnits(set, options.sectorStarts);
  const evidence = detected.map((unit) => ({
    eA: unitEvidence(a, unit),
    eB: unitEvidence(b, unit),
  }));
  const measured = detected.map((unit, i) => {
    if (unit.kind !== "corner") {
      const net = gapAt(unit.to) - gapAt(unit.from);
      return {
        ...unit,
        flatD: unit.from,
        phases: { in: 0, out: 0, run: net },
        net,
      };
    }
    const { eA, eB } = evidence[i];
    const flatD = Math.min(
      unit.to,
      Math.max(
        unit.apexD,
        eA.fullThrottleD ?? unit.apexD,
        eB.fullThrottleD ?? unit.apexD,
      ),
    );
    const phases = {
      in: gapAt(unit.apexD) - gapAt(unit.from),
      out: gapAt(flatD) - gapAt(unit.apexD),
      run: gapAt(unit.to) - gapAt(flatD),
    };
    return { ...unit, flatD, phases, net: phases.in + phases.out + phases.run };
  });
  const names = nameUnits(measured, options.corners ?? []);
  const units: CornerUnit[] = measured.map((unit, i) => ({
    ...unit,
    name: names[i],
  }));

  const extraSpend = units.map(
    (unit) =>
      storeAt(a, unit.from) -
      storeAt(a, unit.to) -
      (storeAt(b, unit.from) - storeAt(b, unit.to)),
  );

  const tips: LapTip[] = [];
  const explained: { tip: LapTip; explanation: Explanation }[] = [];
  let remainderS = 0;
  let remainderCount = 0;
  units.forEach((unit, i) => {
    // Under the floor a corner is still shown when one phase moved clearly:
    // that phase is explained as if it were the stretch, and the evidence
    // lists what offset it. The tip keeps the true net, so tips still add up.
    let view = unit;
    const wash = Math.abs(unit.net) < TIP_FLOOR_S;
    if (wash) {
      const largest = PHASE_ORDER.reduce((best, phase) =>
        Math.abs(unit.phases[phase]) > Math.abs(unit.phases[best])
          ? phase
          : best,
      );
      if (
        unit.kind !== "corner" ||
        Math.abs(unit.phases[largest]) < WASH_PHASE_FLOOR_S
      ) {
        remainderS += unit.net;
        remainderCount += 1;
        return;
      }
      view = { ...unit, net: unit.phases[largest] };
    }
    const earlier = units
      .slice(0, i)
      .map((other, j) => ({
        unitIndex: other.index,
        name: other.name,
        extraJ: extraSpend[j],
      }))
      .sort((x, y) => y.extraJ - x.extraJ);
    const spender = earlier[0];
    const saver = earlier[earlier.length - 1];
    const explanation = explainUnit(
      {
        unit: view,
        a,
        b,
        ...evidence[i],
        extraSpendJ: extraSpend[i],
        earlierSpend: spender?.extraJ >= ENERGY_DIFF_J ? spender : undefined,
        earlierSaving: saver?.extraJ <= -ENERGY_DIFF_J ? saver : undefined,
        previousName: units[i - 1]?.name,
        standingStart: [a, b].some(
          (lap) =>
            isRaceSessionType(lap.context.sessionType) &&
            lap.context.lapNumber === 1,
        ),
      },
      voice,
    );
    const lost = unit.net > 0;
    const tip: LapTip = {
      id: `unit-${unit.index}`,
      kind: wash || !explanation.advice ? "note" : lost ? "tip" : "keep",
      category: explanation.category,
      timeS: unit.net,
      title: tipTitle(unit, explanation.category),
      summary: wash
        ? factLine([explanation.summary, "offset in the same corner"])
        : explanation.summary,
      advice: !wash && voice.advice ? explanation.advice : undefined,
      headline: wash
        ? `${explanation.describe}, ${
            Math.abs(unit.net) < Math.abs(view.net) * WASH_OFFSET_NET_SHARE
              ? ""
              : "partly "
          }offset in the same corner`
        : voice.advice && explanation.advice
          ? explanation.advice
          : explanation.describe,
      evidence: explanation.evidence,
      unitIndex: unit.index,
      from: unit.from,
      to: unit.to,
      sector: unit.sector,
    };
    tips.push(tip);
    explained.push({ tip, explanation });
  });
  // Energy is a budget: battery kept by a slow exit comes back on a later
  // straight. Say so on the earlier tip too, and drop its advice when the
  // battery was worth more, so "get on the throttle sooner" never stands
  // beside "keep saving battery" as if the two were unrelated.
  for (const { explanation } of explained) {
    const { energy } = explanation;
    if (!energy) continue;
    const source = explained.find(
      (entry) => entry.tip.unitIndex === energy.fromUnit,
    );
    if (!source || Math.sign(source.tip.timeS) === Math.sign(energy.alongS))
      continue;
    source.tip.evidence += ` The battery ${energy.alongS < 0 ? "saved here won" : "spent here cost"} ${fmtS(energy.alongS)} on ${energy.where}.`;
    if (
      source.tip.kind !== "note" &&
      Math.abs(energy.alongS) >= Math.abs(source.tip.timeS)
    ) {
      source.tip.kind = "note";
      source.tip.advice = undefined;
      source.tip.headline = source.explanation.describe;
    }
  }
  // Units are built in lap order, so tips read like driving the lap and their
  // numbers run around the track map in order.

  return {
    totalS: gap.totalS,
    units,
    tips,
    remainderS,
    remainderCount,
    comparability: compareContext(a, b, voice),
    advice: voice.advice,
  };
}
