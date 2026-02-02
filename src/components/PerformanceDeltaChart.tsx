import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
  ResponsiveContainer,
} from "recharts";
import type { CumulativeDelta } from "../utils/stats";
import { CHART_THEME, TOOLTIP_STYLE } from "../utils/colors";

interface PerformanceDeltaChartProps {
  deltas: CumulativeDelta[];
  rivalName: string;
}

/**
 * Area chart showing cumulative time delta vs a rival.
 * Green (below 0) = player ahead, Red (above 0) = player behind.
 */
export function PerformanceDeltaChart({
  deltas,
  rivalName,
}: PerformanceDeltaChartProps) {
  if (!deltas.length) return null;

  // Split into positive (behind) and negative (ahead) for dual-color fill
  const data = deltas.map((d) => ({
    lap: d.lap,
    delta: +d.delta.toFixed(3),
    behind: d.delta > 0 ? +d.delta.toFixed(3) : 0,
    ahead: d.delta < 0 ? +d.delta.toFixed(3) : 0,
    lapDelta: d.lapDelta,
    s1Delta: d.s1Delta,
    s2Delta: d.s2Delta,
    s3Delta: d.s3Delta,
    playerPit: d.playerPit,
    rivalPit: d.rivalPit,
  }));

  const maxAbs = Math.max(...deltas.map((d) => Math.abs(d.delta)), 1);
  const domainPad = maxAbs * 1.15;

  // Find pit laps for markers
  const playerPitLaps = deltas.filter((d) => d.playerPit).map((d) => d.lap);
  const rivalPitLaps = deltas.filter((d) => d.rivalPit).map((d) => d.lap);

  return (
    <div>
      <h3 className="text-sm font-semibold text-zinc-300 mb-1">
        Performance Delta{" "}
        <span className="font-normal text-zinc-500">vs {rivalName}</span>
      </h3>
      <p className="text-[10px] text-zinc-600 mb-2">
        Above zero = behind {rivalName} / Below zero = ahead
      </p>
      <ResponsiveContainer width="100%" height={240}>
        <AreaChart
          data={data}
          margin={{ top: 5, right: 20, bottom: 5, left: 0 }}
        >
          <defs>
            <linearGradient id="behindGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#ef4444" stopOpacity={0.3} />
              <stop offset="100%" stopColor="#ef4444" stopOpacity={0.05} />
            </linearGradient>
            <linearGradient id="aheadGrad" x1="0" y1="1" x2="0" y2="0">
              <stop offset="0%" stopColor="#22c55e" stopOpacity={0.3} />
              <stop offset="100%" stopColor="#22c55e" stopOpacity={0.05} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke={CHART_THEME.grid} />
          <XAxis
            dataKey="lap"
            stroke={CHART_THEME.axis}
            fontSize={11}
            label={{
              value: "Lap",
              position: "insideBottom",
              offset: -2,
              fill: CHART_THEME.axis,
              fontSize: 11,
            }}
          />
          <YAxis
            stroke={CHART_THEME.axis}
            fontSize={11}
            domain={[-domainPad, domainPad]}
            tickFormatter={(v) => `${v > 0 ? "+" : ""}${v.toFixed(1)}s`}
          />
          <Tooltip
            {...TOOLTIP_STYLE}
            formatter={(_: unknown, name: string | undefined) => {
              // Custom content via labelFormatter instead
              return [null, name];
            }}
            content={({ active, payload, label }) => {
              if (!active || !payload?.length) return null;
              const d = payload[0]?.payload;
              if (!d) return null;
              return (
                <div
                  className="rounded-lg text-xs p-2"
                  style={{
                    backgroundColor: CHART_THEME.tooltipBg,
                    border: `1px solid ${CHART_THEME.tooltipBorder}`,
                  }}
                >
                  <div className="text-zinc-400 mb-1">
                    Lap {label}
                    {d.playerPit && (
                      <span className="ml-1 text-cyan-400">PIT</span>
                    )}
                    {d.rivalPit && (
                      <span className="ml-1 text-orange-400">
                        {rivalName} PIT
                      </span>
                    )}
                  </div>
                  <div
                    className={`font-mono font-medium ${d.delta > 0 ? "text-red-400" : "text-emerald-400"}`}
                  >
                    {d.delta > 0 ? "+" : ""}
                    {d.delta.toFixed(3)}s cumulative
                  </div>
                  <div className="text-zinc-500 mt-1 space-y-0.5">
                    <div>
                      Lap: {d.lapDelta > 0 ? "+" : ""}
                      {d.lapDelta.toFixed(3)}s
                    </div>
                    <div>
                      S1: {d.s1Delta > 0 ? "+" : ""}
                      {d.s1Delta.toFixed(3)}s &nbsp; S2:{" "}
                      {d.s2Delta > 0 ? "+" : ""}
                      {d.s2Delta.toFixed(3)}s &nbsp; S3:{" "}
                      {d.s3Delta > 0 ? "+" : ""}
                      {d.s3Delta.toFixed(3)}s
                    </div>
                  </div>
                </div>
              );
            }}
          />

          {/* Zero line */}
          <ReferenceLine y={0} stroke={CHART_THEME.axis} strokeWidth={1} />

          {/* Pit markers */}
          {playerPitLaps.map((lap) => (
            <ReferenceLine
              key={`pp${lap}`}
              x={lap}
              stroke="#22d3ee"
              strokeDasharray="4 4"
              strokeOpacity={0.4}
              label={{
                value: "PIT",
                fill: "#22d3ee",
                fontSize: 9,
                position: "top",
              }}
            />
          ))}
          {rivalPitLaps.map((lap) => (
            <ReferenceLine
              key={`rp${lap}`}
              x={lap}
              stroke="#f97316"
              strokeDasharray="4 4"
              strokeOpacity={0.4}
              label={{
                value: "PIT",
                fill: "#f97316",
                fontSize: 9,
                position: "bottom",
              }}
            />
          ))}

          {/* Behind area (positive = red) */}
          <Area
            type="monotone"
            dataKey="behind"
            stroke="#ef4444"
            strokeWidth={0}
            fill="url(#behindGrad)"
          />
          {/* Ahead area (negative = green) */}
          <Area
            type="monotone"
            dataKey="ahead"
            stroke="#22c55e"
            strokeWidth={0}
            fill="url(#aheadGrad)"
          />
          {/* Main line */}
          <Area
            type="monotone"
            dataKey="delta"
            stroke={CHART_THEME.axis}
            strokeWidth={1.5}
            fill="none"
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
