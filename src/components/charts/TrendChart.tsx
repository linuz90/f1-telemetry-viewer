import { useState } from "react";
import { msToLapTime } from "../../utils/format";
import { useElementWidth } from "./useElementWidth";

export interface TrendPoint {
  key: string;
  label: string;
  ms: number;
  pb?: boolean;
}

/**
 * Dates → progress line: one dot per day, quicker laps lower, the PB in purple.
 * Used for quali progress at a track.
 */
export function TrendChart({
  points,
  height = 170,
}: {
  points: TrendPoint[];
  height?: number;
}) {
  const [ref, width] = useElementWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  if (points.length < 2) return null;
  const L = 54;
  const R = 18;
  const T = 22;
  const B = 24;
  const values = points.map((p) => p.ms);
  const lo = Math.min(...values) - 150;
  const hi = Math.max(...values) + 150;
  const x = (i: number) => L + (i / (points.length - 1)) * (width - L - R);
  const y = (ms: number) =>
    height - B - ((ms - lo) / (hi - lo)) * (height - T - B);
  const step = hi - lo > 4000 ? 1000 : 500;
  const ticks: number[] = [];
  for (let t = Math.ceil(lo / step) * step; t <= hi; t += step) ticks.push(t);
  const labelEvery = Math.max(1, Math.ceil(points.length / 7));

  return (
    <div ref={ref} className="relative">
      <svg
        width="100%"
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        className="block"
      >
        {ticks.map((t) => (
          <g key={t}>
            <line
              x1={L}
              x2={width - R}
              y1={y(t)}
              y2={y(t)}
              className="stroke-tone-800"
            />
            <text
              x={L - 8}
              y={y(t) + 3.5}
              textAnchor="end"
              className="fill-tone-500 text-[10.5px] tabular-nums"
            >
              {msToLapTime(t).replace(/0+$/, "").replace(/\.$/, "")}
            </text>
          </g>
        ))}
        <polyline
          points={points
            .map((p, i) => `${x(i).toFixed(1)},${y(p.ms).toFixed(1)}`)
            .join(" ")}
          fill="none"
          strokeWidth={2}
          strokeLinejoin="round"
          className="stroke-best"
        />
        {points.map((p, i) => (
          <g
            key={p.key}
            onPointerEnter={() => setHover(i)}
            onPointerLeave={() => setHover(null)}
          >
            <rect
              x={x(i) - 12}
              y={T - 10}
              width={24}
              height={height - T - B + 20}
              fill="transparent"
            />
            <circle
              cx={x(i)}
              cy={y(p.ms)}
              r={p.pb ? 5 : 3.5}
              strokeWidth={2}
              className={
                p.pb ? "fill-best stroke-tone-900" : "fill-tone-900 stroke-best"
              }
            />
            {(i % labelEvery === 0 || i === points.length - 1) && (
              <text
                x={x(i)}
                y={height - 6}
                textAnchor="middle"
                className="fill-tone-500 text-[10.5px]"
              >
                {p.label}
              </text>
            )}
            {p.pb && (
              <text
                x={x(i)}
                y={y(p.ms) - 10}
                textAnchor="middle"
                className="fill-best text-[10.5px] font-semibold"
              >
                PB
              </text>
            )}
          </g>
        ))}
      </svg>
      {hover != null && (
        <div
          className="pointer-events-none absolute rounded-lg bg-tone-900 px-2.5 py-1.5 text-xs whitespace-nowrap shadow-xl ring-1 ring-tone-700"
          style={{
            left: Math.min(width - 150, Math.max(0, x(hover) - 60)),
            top: 0,
          }}
        >
          <b className="font-mono font-semibold text-tone-50">
            {msToLapTime(points[hover].ms)}
          </b>{" "}
          <span className="text-tone-400">{points[hover].label}</span>
        </div>
      )}
    </div>
  );
}
