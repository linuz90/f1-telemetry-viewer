import { useMemo } from "react";
import type { LapTip } from "../../analysis/lapTelemetryAnalysis";
import {
  calibrateOutline,
  orderByLap,
  outlineFromPath,
  outlinePointAt,
  type OutlinePoint,
} from "../../analysis/trackOutline";
import { CHART_THEME } from "../../constants/colors";
import { getTrackLayoutSvg } from "../../utils/trackLayouts";
import { getTrackPath } from "../../utils/tracks";
import { useHoverDistance, type HoverStore } from "./hoverStore";
import { tipTone } from "./LapTipsList";

const OUTLINE_POINTS = 600;
/** Map units: outlines span at most 500, so 570 leaves room for the labels. */
const MAP_WIDTH = 570;
const MAP_MARGIN = 35;
const drawingCache = new Map<string, OutlinePoint[] | null>();

/** Sample a track drawing evenly along its length (needs the DOM for path geometry). */
function sampleDrawing(track: string): OutlinePoint[] | null {
  const cached = drawingCache.get(track);
  if (cached !== undefined) return cached;
  const svg = getTrackLayoutSvg(track);
  const d = svg?.match(/<path[^>]*\sd="([^"]+)"/)?.[1];
  let result: OutlinePoint[] | null = null;
  if (d && typeof document !== "undefined") {
    const ns = "http://www.w3.org/2000/svg";
    const host = document.createElementNS(ns, "svg");
    host.setAttribute("width", "0");
    host.setAttribute("height", "0");
    host.style.position = "absolute";
    host.style.visibility = "hidden";
    const path = document.createElementNS(ns, "path");
    path.setAttribute("d", d);
    host.appendChild(path);
    document.body.appendChild(host);
    try {
      const length = path.getTotalLength();
      if (length > 0) {
        const points: OutlinePoint[] = [];
        for (let i = 0; i < OUTLINE_POINTS; i += 1) {
          const point = path.getPointAtLength((i / OUTLINE_POINTS) * length);
          points.push({ x: point.x, y: point.y });
        }
        result = points;
      }
    } finally {
      host.remove();
    }
  }
  drawingCache.set(track, result);
  return result;
}

function polylinePoints(points: readonly OutlinePoint[]): string {
  return points
    .map((point) => `${point.x.toFixed(1)},${point.y.toFixed(1)}`)
    .join(" ");
}

function stretchPoints(
  outline: readonly OutlinePoint[],
  fromFraction: number,
  toFraction: number,
): string {
  const steps = Math.max(
    2,
    Math.ceil((toFraction - fromFraction) * outline.length),
  );
  const points: OutlinePoint[] = [];
  for (let s = 0; s <= steps; s += 1) {
    const fraction = fromFraction + ((toFraction - fromFraction) * s) / steps;
    points.push(outlinePointAt(outline, fraction));
  }
  return polylinePoints(points);
}

/**
 * A fixed width keeps strokes and labels the same size on every circuit; the
 * height follows the layout so wide circuits leave no empty bands.
 */
function mapViewBox(outline: readonly OutlinePoint[]): string {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const { x, y } of outline) {
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }
  const left = (minX + maxX) / 2 - MAP_WIDTH / 2;
  const height = maxY - minY + 2 * MAP_MARGIN;
  return `${left.toFixed(1)} ${(minY - MAP_MARGIN).toFixed(1)} ${MAP_WIDTH} ${height.toFixed(1)}`;
}

function Cursor({
  store,
  outline,
  trackLengthM,
  color,
}: {
  store: HoverStore;
  outline: readonly OutlinePoint[];
  trackLengthM: number;
  color: string;
}) {
  const hover = useHoverDistance(store);
  if (hover === null) return null;
  const point = outlinePointAt(outline, hover / trackLengthM);
  return (
    <circle
      cx={point.x}
      cy={point.y}
      r={9}
      fill={color}
      stroke="#09090b"
      strokeWidth={3}
    />
  );
}

/**
 * Where each tip sits on the circuit, and where the chart cursor is. Drawn
 * from the layout's real reference lap; layouts without one use the outline
 * drawing, and the map is hidden when that cannot be lined up with the lap.
 */
export function LapTrackMap({
  track,
  tips,
  trackLengthM,
  speedGrid,
  speed,
  hoverStore,
  cursorColor,
  activeTipId,
  onSelectTip,
  onHoverTip,
}: {
  track: string;
  tips: readonly LapTip[];
  trackLengthM: number;
  /** Lap A's speed on the series grid, used to line an outline drawing up. */
  speedGrid: Float64Array;
  speed: Float32Array;
  hoverStore: HoverStore;
  cursorColor: string;
  /** The hovered tip, else the selected one; its stretch is drawn on top. */
  activeTipId: string | null;
  onSelectTip: (tip: LapTip | null) => void;
  onHoverTip: (tip: LapTip | null) => void;
}) {
  const surveyed = useMemo(() => {
    const path = getTrackPath(track);
    return path ? outlineFromPath(path, OUTLINE_POINTS) : null;
  }, [track]);
  const fitted = useMemo(() => {
    if (surveyed) return null;
    const drawing = sampleDrawing(track);
    if (!drawing) return null;
    const n = drawing.length;
    const bySample = new Float64Array(n);
    let j = 0;
    for (let i = 0; i < n; i += 1) {
      const distance = (i / n) * trackLengthM;
      while (j < speedGrid.length - 1 && speedGrid[j + 1] <= distance) j += 1;
      bySample[i] = speed[j];
    }
    const calibration = calibrateOutline(drawing, bySample);
    return calibration.confident ? orderByLap(drawing, calibration) : null;
  }, [surveyed, track, speed, speedGrid, trackLengthM]);

  // Both are in lap order: index 0 on the line, running the way it is driven.
  const outline = surveyed ?? fitted;
  if (!outline) return null;
  const start = outline[0];
  const ahead = outline[4];
  const tangent = { x: ahead.x - start.x, y: ahead.y - start.y };
  const norm = Math.hypot(tangent.x, tangent.y) || 1;
  const normal = { x: (-tangent.y / norm) * 20, y: (tangent.x / norm) * 20 };

  return (
    <figure className="relative">
      <svg
        viewBox={mapViewBox(outline)}
        className="w-full"
        role="img"
        aria-label="Track map with tip locations"
      >
        <polygon
          points={polylinePoints(outline)}
          fill="none"
          stroke="#3f3f46"
          strokeWidth={11}
          strokeLinejoin="round"
        />
        <line
          x1={start.x - normal.x}
          y1={start.y - normal.y}
          x2={start.x + normal.x}
          y2={start.y + normal.y}
          stroke="#e4e4e7"
          strokeWidth={6}
          strokeLinecap="round"
        />
        {[...tips]
          // The active stretch is drawn last so it sits on top of the others.
          .sort(
            (x, y) =>
              Number(x.id === activeTipId) - Number(y.id === activeTipId),
          )
          .map((tip) => {
            const active = tip.id === activeTipId;
            const color =
              tipTone(tip) === "behind"
                ? CHART_THEME.behind
                : CHART_THEME.ahead;
            const line = stretchPoints(
              outline,
              tip.from / trackLengthM,
              tip.to / trackLengthM,
            );
            return (
              <g
                key={tip.id}
                className="cursor-pointer"
                opacity={activeTipId && !active ? 0.55 : 1}
                onClick={() => onSelectTip(tip)}
                onPointerEnter={() => onHoverTip(tip)}
                onPointerLeave={() => onHoverTip(null)}
              >
                <polyline
                  points={line}
                  fill="none"
                  stroke={color}
                  strokeWidth={active ? 14 : 11}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                {/* Wide invisible stroke: a hit target bigger than the line. */}
                <polyline
                  points={line}
                  fill="none"
                  stroke="transparent"
                  strokeWidth={40}
                />
              </g>
            );
          })}
        {tips.map((tip, index) => {
          const active = tip.id === activeTipId;
          const mid = outlinePointAt(
            outline,
            (tip.from + tip.to) / 2 / trackLengthM,
          );
          const color =
            tipTone(tip) === "behind" ? CHART_THEME.behind : CHART_THEME.ahead;
          // Labels are sized for the ~270 px the map renders at: about 9 px text.
          const radius = active ? 22 : 20;
          return (
            <g
              key={`label-${tip.id}`}
              className="cursor-pointer"
              opacity={activeTipId && !active ? 0.7 : 1}
              onClick={() => onSelectTip(tip)}
              onPointerEnter={() => onHoverTip(tip)}
              onPointerLeave={() => onHoverTip(null)}
            >
              <circle
                cx={mid.x}
                cy={mid.y}
                r={radius}
                fill={active ? color : "#09090b"}
                stroke={color}
                strokeWidth={3}
              />
              <text
                x={mid.x}
                y={mid.y + radius * 0.36}
                textAnchor="middle"
                className="font-mono font-bold"
                fontSize={radius * 1.05}
                fill={active ? "#09090b" : color}
              >
                {index + 1}
              </text>
            </g>
          );
        })}
        <Cursor
          store={hoverStore}
          outline={outline}
          trackLengthM={trackLengthM}
          color={cursorColor}
        />
      </svg>
      {!surveyed && (
        <figcaption className="mt-1 text-center text-2xs text-zinc-600">
          Positions follow the circuit drawing, not GPS
        </figcaption>
      )}
    </figure>
  );
}
