import { useMemo } from "react";
import {
  outlineFromPath,
  outlinePointAt,
  type OutlinePoint,
} from "../analysis/trackOutline";
import { TRACK_GEOMETRY } from "../constants/trackGeometry";
import { getTrackId, getTrackPath } from "../utils/tracks";
import { cn } from "../utils/cn";
import { TrackLayout } from "./TrackLayout";

/** Evenly spaced points for placing marks along the lap. */
const MARK_POINTS = 600;

/**
 * The circuit as the viewer's visual signature: a real reference lap from
 * `trackGeometry.ts` drawn as a line, glowing in the brand red on heroes and
 * the current track, a quiet grey elsewhere. `detail` adds the start/finish
 * line, the sector splits (lap fractions from a session's sector starts) and
 * the official turn numbers. Layouts without published geometry fall back to
 * the outline drawings, which have no start line to place marks from.
 */
export function TrackOutline({
  track,
  glow = false,
  detail,
  className,
}: {
  track: string;
  glow?: boolean;
  /** "start" marks the timing line; "full" adds sectors and turn numbers. */
  detail?: {
    level: "start" | "full";
    /** Sector 2 and 3 starts as lap fractions, when a session reports them. */
    sectorStarts?: readonly [number, number] | null;
  };
  className?: string;
}) {
  const shape = useMemo(() => {
    const path = getTrackPath(track);
    if (!path || path.length < 4) return null;
    let d = "";
    let maxX = 0;
    let maxY = 0;
    for (let i = 0; i < path.length; i += 2) {
      d += `${i === 0 ? "M" : "L"}${path[i].toFixed(1)} ${path[i + 1].toFixed(1)}`;
      maxX = Math.max(maxX, path[i]);
      maxY = Math.max(maxY, path[i + 1]);
    }
    return {
      d: `${d}Z`,
      w: maxX,
      h: maxY,
      outline: outlineFromPath(path, MARK_POINTS),
    };
  }, [track]);

  const level = detail?.level;
  const [s2, s3] = detail?.sectorStarts ?? [];
  const marks = useMemo(() => {
    if (!shape || !level) return null;
    const { outline } = shape;
    const start = chequers(outline, 0);
    if (level === "start") return { start, sectors: [], turns: [] };
    // Turn numbers first, then the sector labels around them, each on the
    // side of the track with the most room.
    const placed: OutlinePoint[] = [];
    const turns = (TRACK_GEOMETRY[getTrackId(track)]?.turns ?? []).map(
      (fraction, i) => ({
        number: i + 1,
        at: labelPoint(outline, fraction, [22], placed),
      }),
    );
    const startLabel = labelPoint(outline, 0, [28, 38], placed);
    const sectors = [s2, s3]
      .filter((f): f is number => f != null && f > 0 && f < 1)
      .map((fraction, i) => ({
        label: `S${i + 2}`,
        tick: crossTick(outline, fraction, 12),
        at: labelPoint(outline, fraction, [28, 38], placed),
      }));
    return { start, startLabel, sectors, turns };
  }, [shape, level, s2, s3, track]);

  if (!shape) {
    return (
      <TrackLayout
        track={track}
        className={cn(
          glow ? "text-brand" : "text-tone-600",
          "[&_svg]:h-full [&_svg]:w-full",
          className,
        )}
      />
    );
  }

  const pad = detail?.level === "full" ? 46 : 14;
  return (
    <svg
      aria-hidden
      viewBox={`${-pad} ${-pad} ${shape.w + pad * 2} ${shape.h + pad * 2}`}
      preserveAspectRatio="xMidYMid meet"
      className={cn("overflow-visible", className)}
    >
      <path
        d={shape.d}
        fill="none"
        strokeLinejoin="round"
        strokeLinecap="round"
        className={glow ? "stroke-brand/20" : "stroke-tone-600/40"}
        strokeWidth={glow ? 11 : 8}
      />
      {glow && (
        <path
          d={shape.d}
          fill="none"
          strokeLinejoin="round"
          strokeLinecap="round"
          className="stroke-brand [filter:drop-shadow(0_0_6px_var(--color-brand))]"
          strokeWidth={3}
        />
      )}
      {marks?.sectors.map((sector) => (
        <g key={sector.label}>
          <line
            {...sector.tick}
            strokeWidth={3.5}
            strokeLinecap="round"
            className="stroke-tone-300"
          />
          <MapLabel at={sector.at} className="fill-tone-300 font-semibold">
            {sector.label}
          </MapLabel>
        </g>
      ))}
      {marks?.start.map((square, i) => (
        <polygon
          key={i}
          points={square.points}
          className={square.light ? "fill-tone-50" : "fill-tone-950"}
        />
      ))}
      {marks?.startLabel && (
        <MapLabel at={marks.startLabel} className="fill-tone-100 font-semibold">
          S1
        </MapLabel>
      )}
      {marks?.turns.map((turn) => (
        <MapLabel
          key={turn.number}
          at={turn.at}
          className="fill-tone-400 tabular-nums"
          size={19}
        >
          {turn.number}
        </MapLabel>
      ))}
    </svg>
  );
}

function MapLabel({
  at,
  className,
  size = 20,
  children,
}: {
  at: OutlinePoint;
  className?: string;
  size?: number;
  children: string | number;
}) {
  return (
    <text
      x={at.x}
      y={at.y}
      textAnchor="middle"
      dominantBaseline="central"
      fontSize={size}
      // A halo in the card colour keeps labels legible where they sit close
      // to another part of the track.
      className={cn(
        "[paint-order:stroke] stroke-tone-900 [stroke-linejoin:round] [stroke-width:5px]",
        className,
      )}
    >
      {children}
    </text>
  );
}

/** Unit tangent and normal at a lap fraction. */
function frame(outline: readonly OutlinePoint[], fraction: number) {
  const n = outline.length;
  const i = Math.round(fraction * n);
  const a = outline[(((i - 3) % n) + n) % n];
  const b = outline[(i + 3) % n];
  const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  const tx = (b.x - a.x) / len;
  const ty = (b.y - a.y) / len;
  return { point: outlinePointAt(outline, fraction), tx, ty, nx: -ty, ny: tx };
}

/** The timing line as a chequered strip across the track: 4 by 2 squares. */
function chequers(outline: readonly OutlinePoint[], fraction: number) {
  const { point, tx, ty, nx, ny } = frame(outline, fraction);
  const size = 7;
  const squares: { points: string; light: boolean }[] = [];
  for (let across = 0; across < 4; across++) {
    for (let along = 0; along < 2; along++) {
      const cx =
        point.x + nx * (across - 1.5) * size + tx * (along - 0.5) * size;
      const cy =
        point.y + ny * (across - 1.5) * size + ty * (along - 0.5) * size;
      const h = size / 2;
      const corners = [
        [-h, -h],
        [h, -h],
        [h, h],
        [-h, h],
      ].map(
        ([a, b]) =>
          `${(cx + nx * a + tx * b).toFixed(1)},${(cy + ny * a + ty * b).toFixed(1)}`,
      );
      squares.push({
        points: corners.join(" "),
        light: (across + along) % 2 === 0,
      });
    }
  }
  return squares;
}

/** A short line across the track at a lap fraction. */
function crossTick(
  outline: readonly OutlinePoint[],
  fraction: number,
  half: number,
) {
  const { point, nx, ny } = frame(outline, fraction);
  return {
    x1: point.x - nx * half,
    y1: point.y - ny * half,
    x2: point.x + nx * half,
    y2: point.y + ny * half,
  };
}

/**
 * Where a label for a lap fraction goes: off the track, on the side and at
 * the distance with the most room from the rest of the circuit (hairpins, the
 * parallel straights at Sakhir) and from labels already placed. The chosen
 * point is added to `placed`.
 */
function labelPoint(
  outline: readonly OutlinePoint[],
  fraction: number,
  offsets: readonly number[],
  placed: OutlinePoint[],
): OutlinePoint {
  const { point, nx, ny } = frame(outline, fraction);
  const clearance = (c: OutlinePoint) => {
    let min = Infinity;
    for (let i = 0; i < outline.length; i += 2) {
      min = Math.min(min, Math.hypot(outline[i].x - c.x, outline[i].y - c.y));
    }
    // Another label is a smaller obstacle than the track itself.
    for (const other of placed) {
      min = Math.min(min, Math.hypot(other.x - c.x, other.y - c.y) * 0.6);
    }
    return min;
  };
  let best = point;
  let bestScore = -Infinity;
  for (const offset of offsets) {
    for (const side of [1, -1]) {
      const c = {
        x: point.x + nx * offset * side,
        y: point.y + ny * offset * side,
      };
      // A farther slot has to earn its distance from the track.
      const score = clearance(c) - (offset - offsets[0]) * 0.5;
      if (score > bestScore) {
        bestScore = score;
        best = c;
      }
    }
  }
  placed.push(best);
  return best;
}
