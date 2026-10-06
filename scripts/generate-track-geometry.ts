/**
 * Regenerates src/constants/trackGeometry.ts from MultiViewer's circuit API,
 * the source FastF1 uses for circuit maps and corner markers.
 *
 *   pnpm generate-track-geometry
 *
 * Each circuit is a real reference lap driven from the timing line: `x`/`y`
 * are its positions and every corner's `length` is the distance along that
 * lap, both in decimetres. Turns are stored as a fraction of the lap so they
 * scale to the game's own track length, which is not always the official one
 * (Mexico City reports 4525 m for a 4304 m lap).
 *
 * Checked against game exports: every active-aero and DRS zone in
 * `session-info` runs between the expected turns, marshal zones and sector
 * lines sit within about 40 m of the real ones, and every marker falls inside
 * the matching stretch of Pits n' Giggles' `assets/track-segments`. Repeat
 * that for any circuit added here. Monaco had no export to check, and those
 * segment files list its length as 3067 m against positions that fit 3337 m.
 */
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * Track id -> F1 live-timing circuit key and a season that raced the layout
 * the game ships. Only circuits in F1 25 and F1 26, the games that record
 * laps; Madring (key 153) is not published yet.
 */
const CIRCUITS: Record<string, [circuitKey: number, year: number]> = {
  sakhir: [63, 2026],
  jeddah: [149, 2026],
  melbourne: [10, 2026],
  suzuka: [46, 2026],
  shanghai: [49, 2026],
  miami: [151, 2026],
  imola: [6, 2025],
  monaco: [22, 2026],
  catalunya: [15, 2026],
  montreal: [23, 2026],
  spielberg: [19, 2026],
  silverstone: [2, 2026],
  hungaroring: [4, 2026],
  spa: [7, 2026],
  zandvoort: [55, 2026],
  monza: [39, 2026],
  baku: [144, 2026],
  "marina-bay": [61, 2025],
  austin: [9, 2025],
  "mexico-city": [65, 2025],
  interlagos: [14, 2025],
  "las-vegas": [152, 2025],
  lusail: [150, 2025],
  "yas-marina": [70, 2025],
};

/** Longest side of every stored path, in map units. */
const PATH_BOX = 500;
/** Points closer than this to the simplified line are dropped: about 1.5 m. */
const PATH_TOLERANCE = 0.3;

interface Circuit {
  x: number[];
  y: number[];
  /** Degrees that turn the raw positions into the official map orientation. */
  rotation: number;
  corners: { number: number; letter?: string; length: number }[];
}

type Point = [x: number, y: number];

function turnFractions(trackId: string, circuit: Circuit): number[] {
  const { x, y, corners } = circuit;
  let lapLength = 0;
  for (let i = 0; i < x.length; i += 1) {
    const next = (i + 1) % x.length;
    lapLength += Math.hypot(x[next] - x[i], y[next] - y[i]);
  }
  // Lettered markers (Hungaroring's 1A and 12A) are extra label points, not
  // turns in the official numbering.
  const turns = corners.filter((corner) => !corner.letter);
  turns.forEach((corner, i) => {
    const previous = turns[i - 1]?.length ?? 0;
    if (corner.number !== i + 1 || corner.length <= previous) {
      throw new Error(`${trackId}: turns are not numbered in lap order`);
    }
  });
  return turns.map((corner) => Number((corner.length / lapLength).toFixed(4)));
}

/** Douglas-Peucker on a closed lap: keep only the points that shape the line. */
function simplify(points: Point[], tolerance: number): Point[] {
  const keep = new Array<boolean>(points.length).fill(false);
  const last = points.length - 1;
  // A lap ends where it starts, so its two ends define no line to measure
  // against; split it at the point furthest from the start instead.
  let far = 0;
  points.forEach(([px, py], i) => {
    const reach = (at: number) =>
      Math.hypot(points[at][0] - points[0][0], points[at][1] - points[0][1]);
    if (Math.hypot(px - points[0][0], py - points[0][1]) > reach(far)) far = i;
  });
  keep[0] = keep[far] = keep[last] = true;
  const stack: [number, number][] = [
    [0, far],
    [far, last],
  ];
  while (stack.length > 0) {
    const [first, end] = stack.pop()!;
    const [ax, ay] = points[first];
    const [bx, by] = points[end];
    const span = Math.hypot(bx - ax, by - ay) || 1;
    let worst = 0;
    let index = -1;
    for (let i = first + 1; i < end; i += 1) {
      const [px, py] = points[i];
      const offLine =
        Math.abs((bx - ax) * (ay - py) - (ax - px) * (by - ay)) / span;
      if (offLine > worst) {
        worst = offLine;
        index = i;
      }
    }
    if (worst > tolerance) {
      keep[index] = true;
      stack.push([first, index], [index, end]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

/** The lap as a compact map path: official orientation, y down, in a box. */
function mapPath({ x, y, rotation }: Circuit): number[] {
  const angle = (rotation / 180) * Math.PI;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  // Positions have y up; screens have y down.
  const turned = x.map(
    (px, i): Point => [px * cos - y[i] * sin, -(px * sin + y[i] * cos)],
  );
  const minX = Math.min(...turned.map(([px]) => px));
  const minY = Math.min(...turned.map(([, py]) => py));
  const width = Math.max(...turned.map(([px]) => px)) - minX;
  const height = Math.max(...turned.map(([, py]) => py)) - minY;
  const scale = PATH_BOX / Math.max(width, height);
  const boxed = turned.map(
    ([px, py]): Point => [(px - minX) * scale, (py - minY) * scale],
  );
  return simplify(boxed, PATH_TOLERANCE).flatMap(([px, py]) => [
    Number(px.toFixed(1)),
    Number(py.toFixed(1)),
  ]);
}

const entries: string[] = [];
for (const [trackId, [circuitKey, year]] of Object.entries(CIRCUITS)) {
  const url = `https://api.multiviewer.app/api/v1/circuits/${circuitKey}/${year}`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${trackId}: ${response.status} ${url}`);
  const circuit = (await response.json()) as Circuit;
  entries.push(`  ${JSON.stringify(trackId)}: {
    turns: [${turnFractions(trackId, circuit).join(", ")}],
    path: [${mapPath(circuit).join(", ")}],
  },`);
}

const output = `// Generated by \`pnpm generate-track-geometry\`; do not edit by hand.

export interface TrackGeometry {
  /** Lap fraction of each official turn from the timing line; index 0 is Turn 1. */
  turns: readonly number[];
  /**
   * A real reference lap as x0, y0, x1, y1…, starting on the timing line in
   * driving order: oriented like official circuit maps, y down, longest side
   * ${PATH_BOX} units.
   */
  path: readonly number[];
}

/**
 * Keyed by track id; layouts without published data (short and reverse
 * variants, Madring) have no entry. Source: MultiViewer's circuit API
 * (https://api.multiviewer.app/api/v1/circuits/<key>/<year>), the data FastF1
 * draws circuit maps from, simplified and scaled here.
 */
export const TRACK_GEOMETRY: Record<string, TrackGeometry> = {
${entries.join("\n")}
};
`;

writeFileSync(
  fileURLToPath(new URL("../src/constants/trackGeometry.ts", import.meta.url)),
  output,
);
console.log(`Wrote geometry for ${entries.length} circuits`);
