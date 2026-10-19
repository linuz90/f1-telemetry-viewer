/**
 * Place lap distance on a track map. Recordings carry no car position, so a
 * map needs an outline in lap order: evenly spaced points that start on the
 * timing line and run the way the lap is driven.
 *
 * Layouts with a real reference lap (`getTrackPath()`) are in lap order
 * already. The rest fall back to the viewer's outline drawings, which carry
 * no start line or direction. Corners are where a drawing bends and where a
 * lap is slow, so the start offset and direction are found by correlating the
 * drawing's bend with the lap's slowness at every candidate offset. On
 * Melbourne the right alignment scored 0.64 against 0.28 for the best other
 * candidate; when the winner is not that clear the map is hidden rather than
 * misplaced.
 */

export interface OutlinePoint {
  x: number;
  y: number;
}

export interface OutlineCalibration {
  direction: 1 | -1;
  /** Index into the outline points where the start line sits. */
  offset: number;
  score: number;
  /** Best score among clearly different alignments. */
  runnerUp: number;
  confident: boolean;
}

const MIN_SCORE = 0.45;
const MIN_MARGIN = 0.15;
/** Bend is measured over this share of the lap on each side of a point. */
const BEND_SPAN = 0.015;
/** Alignments closer than this share of the lap count as the same answer. */
const SAME_ANSWER_SPAN = 0.05;

function wrap(index: number, n: number): number {
  return ((index % n) + n) % n;
}

/** A closed reference-lap path (x0, y0, x1, y1…) as an outline in lap order. */
export function outlineFromPath(
  path: readonly number[],
  count: number,
): OutlinePoint[] {
  const vertices = path.length / 2;
  const x = (i: number) => path[2 * (i % vertices)];
  const y = (i: number) => path[2 * (i % vertices) + 1];
  // Distance travelled on reaching each vertex; the last closes the lap.
  const travelled = new Float64Array(vertices + 1);
  for (let i = 0; i < vertices; i += 1) {
    travelled[i + 1] =
      travelled[i] + Math.hypot(x(i + 1) - x(i), y(i + 1) - y(i));
  }
  const points: OutlinePoint[] = [];
  let segment = 0;
  for (let i = 0; i < count; i += 1) {
    const at = (i / count) * travelled[vertices];
    while (travelled[segment + 1] < at) segment += 1;
    const length = travelled[segment + 1] - travelled[segment];
    const along = length > 0 ? (at - travelled[segment]) / length : 0;
    points.push({
      x: x(segment) + (x(segment + 1) - x(segment)) * along,
      y: y(segment) + (y(segment + 1) - y(segment)) * along,
    });
  }
  return points;
}

/** Absolute turning angle at each point of a closed, evenly spaced outline. */
export function outlineBend(points: readonly OutlinePoint[]): Float64Array {
  const n = points.length;
  const span = Math.max(2, Math.round(n * BEND_SPAN));
  const bend = new Float64Array(n);
  for (let i = 0; i < n; i += 1) {
    const prev = points[wrap(i - span, n)];
    const here = points[i];
    const next = points[wrap(i + span, n)];
    const a1 = Math.atan2(here.y - prev.y, here.x - prev.x);
    const a2 = Math.atan2(next.y - here.y, next.x - here.x);
    let turn = Math.abs(a2 - a1);
    if (turn > Math.PI) turn = 2 * Math.PI - turn;
    bend[i] = turn;
  }
  return bend;
}

function pearson(
  bend: Float64Array,
  slow: Float64Array,
  offset: number,
  direction: 1 | -1,
): number {
  const n = bend.length;
  let sumX = 0;
  let sumY = 0;
  let sumXX = 0;
  let sumYY = 0;
  let sumXY = 0;
  for (let j = 0; j < n; j += 1) {
    const x = bend[wrap(offset + direction * j, n)];
    const y = slow[j];
    sumX += x;
    sumY += y;
    sumXX += x * x;
    sumYY += y * y;
    sumXY += x * y;
  }
  const cov = sumXY - (sumX * sumY) / n;
  const varX = sumXX - (sumX * sumX) / n;
  const varY = sumYY - (sumY * sumY) / n;
  return varX > 0 && varY > 0 ? cov / Math.sqrt(varX * varY) : 0;
}

/**
 * Find where the start line sits on a drawing and which way the lap runs.
 * `speedByFraction` samples one lap's speed at `points.length` evenly spaced
 * fractions of the lap, starting at the line.
 */
export function calibrateOutline(
  points: readonly OutlinePoint[],
  speedByFraction: ArrayLike<number>,
): OutlineCalibration {
  const n = points.length;
  const bend = outlineBend(points);
  let top = 0;
  for (let j = 0; j < n; j += 1) top = Math.max(top, speedByFraction[j]);
  const slow = new Float64Array(n);
  for (let j = 0; j < n; j += 1) slow[j] = top - speedByFraction[j];

  const candidates: { offset: number; direction: 1 | -1; score: number }[] = [];
  for (const direction of [1, -1] as const) {
    for (let offset = 0; offset < n; offset += 1) {
      candidates.push({
        offset,
        direction,
        score: pearson(bend, slow, offset, direction),
      });
    }
  }
  candidates.sort((a, b) => b.score - a.score);
  const best = candidates[0];
  const sameSpan = Math.round(n * SAME_ANSWER_SPAN);
  const runnerUp =
    candidates.find(
      (candidate) =>
        candidate.direction !== best.direction ||
        Math.min(
          wrap(candidate.offset - best.offset, n),
          wrap(best.offset - candidate.offset, n),
        ) > sameSpan,
    )?.score ?? 0;
  return {
    direction: best.direction,
    offset: best.offset,
    score: best.score,
    runnerUp,
    confident: best.score >= MIN_SCORE && best.score - runnerUp >= MIN_MARGIN,
  };
}

/** A drawing's points put in lap order by its calibration. */
export function orderByLap(
  points: readonly OutlinePoint[],
  calibration: Pick<OutlineCalibration, "offset" | "direction">,
): OutlinePoint[] {
  return points.map(
    (_, i) =>
      points[
        wrap(calibration.offset + calibration.direction * i, points.length)
      ],
  );
}

/** Map position at a lap fraction (0 = line, 1 = next line) of an outline in lap order. */
export function outlinePointAt(
  outline: readonly OutlinePoint[],
  fraction: number,
): OutlinePoint {
  return outline[wrap(Math.round(fraction * outline.length), outline.length)];
}
