import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from "recharts";
import type { LapHistoryEntry } from "../types/telemetry";
import { msToLapTime, isLapValid } from "../utils/format";
import { CHART_THEME, TOOLTIP_STYLE } from "../utils/colors";

interface LapTimeChartProps {
  laps: LapHistoryEntry[];
  /** Pit stop laps to mark with dashed lines */
  pitLaps?: number[];
  /** Rival lap data for overlay */
  rivalLaps?: LapHistoryEntry[];
  /** Rival driver name */
  rivalName?: string;
}

/**
 * Line chart showing lap time progression.
 * Invalid laps shown in red, valid laps in cyan.
 */
export function LapTimeChart({
  laps,
  pitLaps = [],
  rivalLaps,
  rivalName,
}: LapTimeChartProps) {
  if (!laps.length) {
    return <p className="text-sm text-zinc-500">No lap data.</p>;
  }

  // Build rival lookup by lap number
  const rivalMap = new Map<number, number>();
  if (rivalLaps) {
    let lapNum = 0;
    for (const l of rivalLaps) {
      if (l["lap-time-in-ms"] > 0) {
        lapNum++;
        rivalMap.set(lapNum, l["lap-time-in-ms"] / 1000);
      }
    }
  }

  const data = laps
    .filter((l) => l["lap-time-in-ms"] > 0)
    .map((l, i) => ({
      lap: i + 1,
      timeMs: l["lap-time-in-ms"],
      timeStr: l["lap-time-str"],
      timeSec: l["lap-time-in-ms"] / 1000,
      valid: isLapValid(l["lap-valid-bit-flags"]),
      s1: l["sector-1-time-in-ms"] / 1000,
      s2: l["sector-2-time-in-ms"] / 1000,
      s3: l["sector-3-time-in-ms"] / 1000,
      rivalTimeSec: rivalMap.get(i + 1) ?? undefined,
    }));

  // Y-axis domain: pad around min/max for readability (include rival times)
  const allTimes = [
    ...data.map((d) => d.timeSec),
    ...data.filter((d) => d.rivalTimeSec != null).map((d) => d.rivalTimeSec!),
  ];
  const minTime = Math.min(...allTimes);
  const maxTime = Math.max(...allTimes);
  const padding = (maxTime - minTime) * 0.1 || 1;

  const hasRival = rivalLaps && rivalLaps.length > 0;

  // Best lap time for reference line
  const bestTime = Math.min(
    ...data.filter((d) => d.valid).map((d) => d.timeSec),
  );

  return (
    <div>
      <h3 className="text-sm font-semibold text-zinc-300 mb-2">Lap Times</h3>
      <ResponsiveContainer width="100%" height={280}>
        <LineChart data={data} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={CHART_THEME.grid} />
          <XAxis
            dataKey="lap"
            stroke={CHART_THEME.axis}
            fontSize={11}
            label={{ value: "Lap", position: "insideBottom", offset: -2, fill: CHART_THEME.axis, fontSize: 11 }}
          />
          <YAxis
            stroke={CHART_THEME.axis}
            fontSize={11}
            domain={[minTime - padding, maxTime + padding]}
            tickFormatter={(v) => msToLapTime(v * 1000)}
          />
          <Tooltip
            {...TOOLTIP_STYLE}
            formatter={(value: number | undefined, name: string | undefined) => {
              if (value == null) return ["–", name ?? ""];
              return [msToLapTime(value * 1000), name ?? ""];
            }}
            labelFormatter={(lap) => `Lap ${lap}`}
          />

          {/* Best lap reference */}
          {bestTime > 0 && (
            <ReferenceLine
              y={bestTime}
              stroke="#a855f7"
              strokeDasharray="4 4"
              strokeOpacity={0.5}
              label={{ value: `Best: ${msToLapTime(bestTime * 1000)}`, fill: "#a855f7", fontSize: 10, position: "right" }}
            />
          )}

          {/* Pit stop markers */}
          {pitLaps.map((lap) => (
            <ReferenceLine
              key={lap}
              x={lap}
              stroke={CHART_THEME.muted}
              strokeDasharray="4 4"
              label={{ value: "PIT", fill: CHART_THEME.muted, fontSize: 10, position: "top" }}
            />
          ))}

          {hasRival && (
            <Line
              type="monotone"
              dataKey="rivalTimeSec"
              name={rivalName ?? "Rival"}
              stroke="#f97316"
              strokeWidth={2}
              strokeDasharray="6 3"
              strokeOpacity={0.6}
              dot={false}
              connectNulls
            />
          )}

          <Line
            type="monotone"
            dataKey="timeSec"
            name="Player"
            stroke="#22d3ee"
            strokeWidth={2}
            dot={(props) => {
              const { cx, cy, index } = props as { cx?: number; cy?: number; index?: number };
              const entry = index != null ? data[index] : undefined;
              if (!entry || cx == null || cy == null) return <circle key={index} cx={0} cy={0} r={0} />;
              if (!entry.valid) {
                // Invalid: larger red circle with X
                return (
                  <g key={index}>
                    <circle cx={cx} cy={cy} r={5} fill="#ef4444" fillOpacity={0.2} stroke="#ef4444" strokeWidth={2} />
                    <line x1={cx - 2.5} y1={cy - 2.5} x2={cx + 2.5} y2={cy + 2.5} stroke="#ef4444" strokeWidth={1.5} />
                    <line x1={cx + 2.5} y1={cy - 2.5} x2={cx - 2.5} y2={cy + 2.5} stroke="#ef4444" strokeWidth={1.5} />
                  </g>
                );
              }
              const isBest = Math.abs(entry.timeSec - bestTime) < 0.001;
              const color = isBest ? "#a855f7" : "#22d3ee";
              return (
                <circle
                  key={index}
                  cx={cx}
                  cy={cy}
                  r={isBest ? 5 : 3}
                  fill={color}
                  stroke={color}
                  strokeWidth={0}
                />
              );
            }}
            activeDot={{ r: 5, fill: "#22d3ee" }}
          />
        </LineChart>
      </ResponsiveContainer>

      {/* Compact lap table */}
      <div className="mt-3 max-h-48 overflow-y-auto">
        <table className="w-full text-xs">
          <thead className="text-zinc-500 sticky top-0 bg-zinc-950">
            <tr>
              <th className="text-left py-1 px-2">Lap</th>
              <th className="text-right py-1 px-2">Time</th>
              <th className="text-right py-1 px-2">S1</th>
              <th className="text-right py-1 px-2">S2</th>
              <th className="text-right py-1 px-2">S3</th>
              <th className="text-right py-1 px-2">Delta</th>
            </tr>
          </thead>
          <tbody>
            {data.map((d) => {
              const delta = d.valid ? d.timeSec - bestTime : null;
              return (
                <tr
                  key={d.lap}
                  className={`border-t border-zinc-800/50 ${!d.valid ? "bg-red-500/10" : ""}`}
                >
                  <td className="py-1 px-2">
                    {d.lap}
                    {!d.valid && (
                      <span className="ml-1.5 px-1 py-0.5 rounded text-[9px] font-bold bg-red-500/20 text-red-400">
                        INVALID
                      </span>
                    )}
                  </td>
                  <td className={`text-right py-1 px-2 font-mono ${!d.valid ? "text-red-400/70 line-through" : ""}`}>
                    {d.timeStr}
                  </td>
                  <td className={`text-right py-1 px-2 font-mono ${!d.valid ? "text-zinc-600" : ""}`}>{d.s1.toFixed(3)}</td>
                  <td className={`text-right py-1 px-2 font-mono ${!d.valid ? "text-zinc-600" : ""}`}>{d.s2.toFixed(3)}</td>
                  <td className={`text-right py-1 px-2 font-mono ${!d.valid ? "text-zinc-600" : ""}`}>{d.s3.toFixed(3)}</td>
                  <td className="text-right py-1 px-2 font-mono">
                    {delta !== null
                      ? delta < 0.001
                        ? "–"
                        : `+${delta.toFixed(3)}`
                      : ""}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
