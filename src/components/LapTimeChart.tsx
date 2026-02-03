import {
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
  ReferenceArea,
  Bar,
  ComposedChart,
} from "recharts";
import type { LapHistoryEntry, PerLapInfo } from "../types/telemetry";
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
  /** Per-lap info for SC/VSC status and ERS data */
  perLapInfo?: PerLapInfo[];
}

const SC_COLORS: Record<string, string> = {
  SAFETY_CAR: "#f59e0b",       // amber for SC
  FULL_SAFETY_CAR: "#f59e0b",  // amber for SC (alternate key)
  VIRTUAL_SAFETY_CAR: "#eab308", // yellow for VSC
};

const ERS_MAX = 4_000_000; // 4 MJ max capacity

/**
 * Line chart showing lap time progression.
 * Invalid laps shown in red, valid laps in cyan.
 * SC/VSC laps highlighted with colored backgrounds.
 * ERS deployment shown as bars.
 */
export function LapTimeChart({
  laps,
  pitLaps = [],
  rivalLaps,
  rivalName,
  perLapInfo,
}: LapTimeChartProps) {
  if (!laps.length) {
    return <p className="text-sm text-zinc-500">No lap data.</p>;
  }

  // Build per-lap-info lookup by lap number
  const lapInfoMap = new Map<number, PerLapInfo>();
  if (perLapInfo) {
    for (const info of perLapInfo) {
      lapInfoMap.set(info["lap-number"], info);
    }
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
    .map((l, i) => {
      const lapNum = i + 1;
      const info = lapInfoMap.get(lapNum);
      const scStatus = info?.["max-safety-car-status"] ?? "NO_SAFETY_CAR";
      const ersDeployed = info?.["car-status-data"]?.["ers-deployed-this-lap"];
      const ersMax = info?.["car-status-data"]?.["ers-max-capacity"] ?? ERS_MAX;
      const ersPct = ersDeployed != null && ersMax > 0 ? (ersDeployed / ersMax) * 100 : undefined;

      return {
        lap: lapNum,
        timeMs: l["lap-time-in-ms"],
        timeStr: l["lap-time-str"],
        timeSec: l["lap-time-in-ms"] / 1000,
        valid: isLapValid(l["lap-valid-bit-flags"]),
        s1: l["sector-1-time-in-ms"] / 1000,
        s2: l["sector-2-time-in-ms"] / 1000,
        s3: l["sector-3-time-in-ms"] / 1000,
        rivalTimeSec: rivalMap.get(lapNum) ?? undefined,
        scStatus,
        isSC: scStatus === "SAFETY_CAR" || scStatus === "FULL_SAFETY_CAR",
        isVSC: scStatus === "VIRTUAL_SAFETY_CAR",
        ersPct,
      };
    });

  // Y-axis domain: round to whole seconds for clean tick marks
  const allTimes = [
    ...data.map((d) => d.timeSec),
    ...data.filter((d) => d.rivalTimeSec != null).map((d) => d.rivalTimeSec!),
  ];
  const minTime = Math.min(...allTimes);
  const maxTime = Math.max(...allTimes);
  const yMin = Math.floor(minTime);
  const yMax = Math.ceil(maxTime);

  const hasRival = rivalLaps && rivalLaps.length > 0;
  const hasErs = data.some((d) => d.ersPct != null);

  // Best lap time for reference line
  const bestTime = Math.min(
    ...data.filter((d) => d.valid).map((d) => d.timeSec),
  );

  // Best sectors (among valid laps only)
  const validData = data.filter((d) => d.valid);
  const bestS1 = Math.min(...validData.map((d) => d.s1));
  const bestS2 = Math.min(...validData.map((d) => d.s2));
  const bestS3 = Math.min(...validData.map((d) => d.s3));

  // Collect SC/VSC ranges for reference areas
  const scRanges: { x1: number; x2: number; status: string }[] = [];
  for (const d of data) {
    if (d.isSC || d.isVSC) {
      const prev = scRanges[scRanges.length - 1];
      if (prev && prev.status === d.scStatus && prev.x2 === d.lap - 1) {
        prev.x2 = d.lap;
      } else {
        scRanges.push({ x1: d.lap, x2: d.lap, status: d.scStatus });
      }
    }
  }

  return (
    <div>
      <div className="flex items-center gap-3 mb-2">
        <h3 className="text-sm font-semibold text-zinc-300">Lap Times</h3>
        {scRanges.length > 0 && (
          <div className="flex items-center gap-3 text-[10px] text-zinc-400">
            {scRanges.some((r) => r.status === "SAFETY_CAR" || r.status === "FULL_SAFETY_CAR") && (
              <span className="flex items-center gap-1">
                <span className="inline-block w-3 h-2.5 rounded-sm bg-amber-500/25 border border-amber-500/40" />
                SC
              </span>
            )}
            {scRanges.some((r) => r.status === "VIRTUAL_SAFETY_CAR") && (
              <span className="flex items-center gap-1">
                <span className="inline-block w-3 h-2.5 rounded-sm bg-yellow-500/25 border border-yellow-500/40" />
                VSC
              </span>
            )}
          </div>
        )}
      </div>
      <ResponsiveContainer width="100%" height={hasErs ? 320 : 280}>
        <ComposedChart data={data} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={CHART_THEME.grid} />
          <XAxis
            dataKey="lap"
            stroke={CHART_THEME.axis}
            fontSize={11}
            label={{ value: "Lap", position: "insideBottom", offset: -2, fill: CHART_THEME.axis, fontSize: 11 }}
          />
          <YAxis
            yAxisId="time"
            stroke={CHART_THEME.axis}
            fontSize={11}
            domain={[yMin, yMax]}
            allowDecimals={false}
            tickFormatter={(v) => msToLapTime(Math.round(v) * 1000)}
          />
          {hasErs && (
            <YAxis
              yAxisId="ers"
              orientation="right"
              stroke="#10b98166"
              fontSize={10}
              domain={[0, 100]}
              ticks={[0, 25, 50, 75, 100]}
              tickFormatter={(v) => `${v}%`}
              width={35}
            />
          )}
          <Tooltip
            {...TOOLTIP_STYLE}
            formatter={(value: number | undefined, name: string | undefined) => {
              if (value == null) return ["–", name ?? ""];
              if (name === "ERS Used") return [`${value.toFixed(0)}%`, name];
              return [msToLapTime(value * 1000), name ?? ""];
            }}
            labelFormatter={(lap) => {
              const entry = data.find((d) => d.lap === lap);
              const scLabel =
                entry?.isSC ? " 🟡 SC" : entry?.isVSC ? " 🟡 VSC" : "";
              return `Lap ${lap}${scLabel}`;
            }}
          />

          {/* SC/VSC background shading */}
          {scRanges.map((range) => (
            <ReferenceArea
              key={`sc-${range.x1}`}
              yAxisId="time"
              x1={range.x1 - 0.5}
              x2={range.x2 + 0.5}
              fill={SC_COLORS[range.status] ?? "#f59e0b"}
              fillOpacity={0.12}
              stroke={SC_COLORS[range.status] ?? "#f59e0b"}
              strokeOpacity={0.3}
              label={{
                value: range.status === "SAFETY_CAR" || range.status === "FULL_SAFETY_CAR" ? "SC" : "VSC",
                fill: SC_COLORS[range.status] ?? "#f59e0b",
                fontSize: 10,
                position: "insideTopLeft",
              }}
            />
          ))}

          {/* Best lap reference */}
          {bestTime > 0 && (
            <ReferenceLine
              yAxisId="time"
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
              yAxisId="time"
              x={lap}
              stroke={CHART_THEME.muted}
              strokeDasharray="4 4"
              label={{ value: "PIT", fill: CHART_THEME.muted, fontSize: 10, position: "top" }}
            />
          ))}

          {/* ERS bars */}
          {hasErs && (
            <Bar
              yAxisId="ers"
              dataKey="ersPct"
              name="ERS Used"
              fill="#10b981"
              fillOpacity={0.15}
              stroke="none"
              barSize={6}
              radius={[2, 2, 0, 0]}
            />
          )}

          {hasRival && (
            <Line
              yAxisId="time"
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
            yAxisId="time"
            type="monotone"
            dataKey="timeSec"
            name="Player"
            stroke="#22d3ee"
            strokeWidth={2}
            dot={(props) => {
              const { cx, cy, index } = props as { cx?: number; cy?: number; index?: number };
              const entry = index != null ? data[index] : undefined;
              if (!entry || cx == null || cy == null) return <circle key={index} cx={0} cy={0} r={0} />;

              // SC/VSC dot styling
              if (entry.isSC || entry.isVSC) {
                const color = entry.isSC ? "#f59e0b" : "#eab308";
                return (
                  <circle
                    key={index}
                    cx={cx}
                    cy={cy}
                    r={4}
                    fill={color}
                    fillOpacity={0.6}
                    stroke={color}
                    strokeWidth={1.5}
                  />
                );
              }

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
        </ComposedChart>
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
              {hasErs && <th className="text-right py-1 px-2">ERS</th>}
            </tr>
          </thead>
          <tbody>
            {data.map((d) => {
              const delta = d.valid ? d.timeSec - bestTime : null;
              const isBestLap = d.valid && Math.abs(d.timeSec - bestTime) < 0.001;
              const isBestS1 = d.valid && Math.abs(d.s1 - bestS1) < 0.001;
              const isBestS2 = d.valid && Math.abs(d.s2 - bestS2) < 0.001;
              const isBestS3 = d.valid && Math.abs(d.s3 - bestS3) < 0.001;
              const scBg = d.isSC
                ? "bg-amber-500/10"
                : d.isVSC
                  ? "bg-yellow-500/10"
                  : "";
              return (
                <tr
                  key={d.lap}
                  className={`border-t border-zinc-800/50 ${!d.valid ? "bg-red-500/10" : scBg}`}
                >
                  <td className="py-1 px-2">
                    {d.lap}
                    {!d.valid && (
                      <span className="ml-1.5 px-1 py-0.5 rounded text-[9px] font-bold bg-red-500/20 text-red-400">
                        INVALID
                      </span>
                    )}
                    {d.isSC && (
                      <span className="ml-1.5 px-1 py-0.5 rounded text-[9px] font-bold bg-amber-500/20 text-amber-400">
                        SC
                      </span>
                    )}
                    {d.isVSC && (
                      <span className="ml-1.5 px-1 py-0.5 rounded text-[9px] font-bold bg-yellow-500/20 text-yellow-400">
                        VSC
                      </span>
                    )}
                  </td>
                  <td className={`text-right py-1 px-2 font-mono ${!d.valid ? "text-red-400/70 line-through" : isBestLap ? "text-purple-400 font-semibold" : ""}`}>
                    {d.timeStr}
                  </td>
                  <td className={`text-right py-1 px-2 font-mono ${!d.valid ? "text-zinc-600" : isBestS1 ? "text-purple-400" : ""}`}>{d.s1.toFixed(3)}</td>
                  <td className={`text-right py-1 px-2 font-mono ${!d.valid ? "text-zinc-600" : isBestS2 ? "text-purple-400" : ""}`}>{d.s2.toFixed(3)}</td>
                  <td className={`text-right py-1 px-2 font-mono ${!d.valid ? "text-zinc-600" : isBestS3 ? "text-purple-400" : ""}`}>{d.s3.toFixed(3)}</td>
                  <td className="text-right py-1 px-2 font-mono">
                    {delta !== null
                      ? delta < 0.001
                        ? "–"
                        : `+${delta.toFixed(3)}`
                      : ""}
                  </td>
                  {hasErs && (
                    <td className="text-right py-1 px-2 font-mono text-emerald-400">
                      {d.ersPct != null ? `${d.ersPct.toFixed(0)}%` : "–"}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
