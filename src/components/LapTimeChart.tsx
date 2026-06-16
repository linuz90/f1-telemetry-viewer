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
import type { LapHistoryEntry, PerLapInfo, TyreStint } from "../types/telemetry";
import { msToLapTime, msToSectorTime, isLapValid, sectorTimeMs } from "../utils/format";
import { ersDeployMjForLap, ersHarvestMjForLap, getWorstWheelWear } from "../utils/stats";
import { Badge } from "./ui/Badge";
import { tableHeadClass, tableRowClass } from "./ui/table";
import { CHART_THEME, TOOLTIP_STYLE, COMPOUND_COLORS, SC_COLORS, SC_FALLBACK } from "../utils/colors";
import { cn } from "../utils/cn";

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
  /** Laps where damage increased (shown with red shading) */
  damageLaps?: number[];
  /** Tyre stints to group laps by */
  stints?: TyreStint[];
}

/**
 * Line chart showing lap time progression.
 * Invalid laps shown in red, valid laps in cyan.
 * SC/VSC laps highlighted with colored backgrounds.
 * ERS deployment energy shown as bars.
 */
export function LapTimeChart({
  laps,
  pitLaps = [],
  rivalLaps,
  rivalName,
  perLapInfo,
  damageLaps = [],
  stints,
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

  // Per-lap fuel burn (kg) = prev lap's tank − this lap's tank. First lap has
  // no prior reading, so it stays absent. We also track the green-flag median
  // to classify each lap as push (above) vs. saving (below) in the table.
  const fuelBurnMap = new Map<number, number>();
  const greenFlagBurns: number[] = [];
  if (perLapInfo && perLapInfo.length >= 2) {
    const sortedFuel = [...perLapInfo]
      .filter((l) => l["car-status-data"]?.["fuel-in-tank"] > 0)
      .sort((a, b) => a["lap-number"] - b["lap-number"]);
    for (let i = 1; i < sortedFuel.length; i++) {
      const prev = sortedFuel[i - 1]!;
      const curr = sortedFuel[i]!;
      const burn =
        prev["car-status-data"]["fuel-in-tank"] -
        curr["car-status-data"]["fuel-in-tank"];
      // Refuel-style negatives can show up in glitched/aborted sessions —
      // ignore them rather than render a misleading "saving" lap.
      if (burn <= 0) continue;
      fuelBurnMap.set(curr["lap-number"], burn);
      const prevGreen =
        (prev["max-safety-car-status"] ?? "NO_SAFETY_CAR") === "NO_SAFETY_CAR";
      const currGreen =
        (curr["max-safety-car-status"] ?? "NO_SAFETY_CAR") === "NO_SAFETY_CAR";
      if (prevGreen && currGreen) greenFlagBurns.push(burn);
    }
  }
  const medianGreenBurn = (() => {
    if (!greenFlagBurns.length) return undefined;
    const sorted = [...greenFlagBurns].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0
      ? (sorted[mid - 1]! + sorted[mid]!) / 2
      : sorted[mid]!;
  })();

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
      const ersMj = info ? ersDeployMjForLap(info) : undefined;
      const ersHarvMj = info ? ersHarvestMjForLap(info) : undefined;

      return {
        lap: lapNum,
        timeMs: l["lap-time-in-ms"],
        timeStr: l["lap-time-str"],
        timeSec: l["lap-time-in-ms"] / 1000,
        valid: isLapValid(l["lap-valid-bit-flags"]),
        s1: sectorTimeMs(l, 1) / 1000,
        s2: sectorTimeMs(l, 2) / 1000,
        s3: sectorTimeMs(l, 3) / 1000,
        topSpeed: info?.["top-speed-kmph"] ?? undefined,
        rivalTimeSec: rivalMap.get(lapNum) ?? undefined,
        scStatus,
        isSC: scStatus === "SAFETY_CAR" || scStatus === "FULL_SAFETY_CAR",
        isVSC: scStatus === "VIRTUAL_SAFETY_CAR",
        ersMj,
        ersHarvMj,
        fuelKg: fuelBurnMap.get(lapNum) ?? undefined,
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
  const hasErs = data.some((d) => d.ersMj != null && d.ersMj > 0);
  const hasErsHarv = data.some((d) => d.ersHarvMj != null && d.ersHarvMj > 0);
  const maxErsMj = hasErs || hasErsHarv
    ? Math.max(
        0,
        ...data.filter((d) => d.ersMj != null).map((d) => d.ersMj!),
        ...data.filter((d) => d.ersHarvMj != null).map((d) => d.ersHarvMj!),
      )
    : 0;
  const hasFuel = data.some((d) => d.fuelKg != null);
  const hasTopSpeed = data.some((d) => d.topSpeed != null);
  const bestTopSpeed = hasTopSpeed
    ? Math.max(...data.filter((d) => d.valid && d.topSpeed != null).map((d) => d.topSpeed!))
    : 0;

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
          <div className="flex items-center gap-3 text-2xs text-zinc-400">
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
      <ResponsiveContainer width="100%" height={hasErs || hasErsHarv ? 320 : 280}>
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
          {(hasErs || hasErsHarv) && (
            <YAxis
              yAxisId="ers"
              orientation="right"
              stroke="#10b98166"
              fontSize={10}
              domain={[0, Math.ceil(maxErsMj)]}
              tickFormatter={(v) => `${v} MJ`}
              width={45}
            />
          )}
          <Tooltip
            {...TOOLTIP_STYLE}
            formatter={(value: number | undefined, name: string | undefined) => {
              if (value == null) return ["–", name ?? ""];
              if (name === "ERS Deploy" || name === "ERS Harv") return [`${value.toFixed(1)} MJ`, name];
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
              fill={SC_COLORS[range.status] ?? SC_FALLBACK}
              fillOpacity={0.12}
              stroke={SC_COLORS[range.status] ?? SC_FALLBACK}
              strokeOpacity={0.3}
              label={{
                value: range.status === "SAFETY_CAR" || range.status === "FULL_SAFETY_CAR" ? "SC" : "VSC",
                fill: SC_COLORS[range.status] ?? SC_FALLBACK,
                fontSize: 10,
                position: "insideTopLeft",
              }}
            />
          ))}

          {/* Damage lap shading */}
          {damageLaps.map((lap) => (
            <ReferenceArea
              key={`dmg-${lap}`}
              yAxisId="time"
              x1={lap - 0.5}
              x2={lap + 0.5}
              fill={CHART_THEME.behind}
              fillOpacity={0.08}
              stroke="none"
            />
          ))}

          {/* Best lap reference */}
          {bestTime > 0 && (
            <ReferenceLine
              yAxisId="time"
              y={bestTime}
              stroke={CHART_THEME.best}
              strokeDasharray="4 4"
              strokeOpacity={0.5}
              label={{
                value: `Best: ${msToLapTime(bestTime * 1000)}`,
                fill: CHART_THEME.best,
                fontSize: 10,
                position: "insideRight",
                offset: 8,
              }}
            />
          )}

          {/* Pit stop markers */}
          {pitLaps.map((lap, i) => (
            <ReferenceLine
              key={`pit-${lap}-${i}`}
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
              dataKey="ersMj"
              name="ERS Deploy"
              fill={CHART_THEME.valid}
              fillOpacity={0.15}
              stroke="none"
              barSize={6}
              radius={[2, 2, 0, 0]}
            />
          )}
          {hasErsHarv && (
            <Bar
              yAxisId="ers"
              dataKey="ersHarvMj"
              name="ERS Harv"
              fill={CHART_THEME.harvest}
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
              stroke={CHART_THEME.rival}
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
            stroke={CHART_THEME.player}
            strokeWidth={2}
            dot={(props) => {
              const { cx, cy, index } = props as { cx?: number; cy?: number; index?: number };
              const entry = index != null ? data[index] : undefined;
              if (!entry || cx == null || cy == null) return <circle key={`lap-dot-${index}`} cx={0} cy={0} r={0} />;

              // SC/VSC dot styling
              if (entry.isSC || entry.isVSC) {
                const color = entry.isSC ? SC_COLORS.SAFETY_CAR : SC_COLORS.VIRTUAL_SAFETY_CAR;
                return (
                  <circle
                    key={`lap-dot-${index}`}
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
                  <g key={`lap-dot-${index}`}>
                    <circle cx={cx} cy={cy} r={5} fill={CHART_THEME.behind} fillOpacity={0.2} stroke={CHART_THEME.behind} strokeWidth={2} />
                    <line x1={cx - 2.5} y1={cy - 2.5} x2={cx + 2.5} y2={cy + 2.5} stroke={CHART_THEME.behind} strokeWidth={1.5} />
                    <line x1={cx + 2.5} y1={cy - 2.5} x2={cx - 2.5} y2={cy + 2.5} stroke={CHART_THEME.behind} strokeWidth={1.5} />
                  </g>
                );
              }
              const isBest = Math.abs(entry.timeSec - bestTime) < 0.001;
              const color = isBest ? CHART_THEME.best : CHART_THEME.player;
              return (
                <circle
                  key={`lap-dot-${index}`}
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

      {/* Lap table grouped by stint */}
      <div className="mt-3 overflow-x-auto -mx-4 px-4 sm:mx-0 sm:px-0">
        {(() => {
          const hasWear = stints?.some((s) => s["tyre-wear-history"]?.length > 0) ?? false;
          // Build wear lookup: lap number → max/worst-wheel wear %
          // Each stint's wear history starts with the pit-lap at 0% (fresh tyres),
          // which would overwrite the previous stint's final wear. Keep the higher
          // value so pit laps show the outgoing tyre wear, not the incoming 0%.
          const wearMap = new Map<number, number>();
          if (stints) {
            for (const stint of stints) {
              for (const entry of stint["tyre-wear-history"] ?? []) {
                const worst = getWorstWheelWear(entry);
                const existing = wearMap.get(entry["lap-number"]);
                if (existing == null || worst > existing) {
                  wearMap.set(entry["lap-number"], worst);
                }
              }
            }
          }

          const colCount = 5 + (hasTopSpeed ? 1 : 0) + (hasErs ? 1 : 0) + (hasErsHarv ? 1 : 0) + (hasWear ? 1 : 0) + (hasFuel ? 1 : 0);
          const headerRow = (
            <tr>
              <th className="text-left py-1 px-2">Lap</th>
              <th className="text-right py-1 px-2">Time</th>
              <th className="text-right py-1 px-2">S1</th>
              <th className="text-right py-1 px-2">S2</th>
              <th className="text-right py-1 px-2">S3</th>
              {hasTopSpeed && <th className="text-right py-1 px-2">Speed</th>}
              {hasWear && (
                <th
                  className="text-right py-1 px-2"
                  title="Max tyre wear: highest-worn tyre at the end of the lap."
                >
                  Max wear
                </th>
              )}
              {hasErs && <th className="text-right py-1 px-2">ERS Dep</th>}
              {hasErsHarv && <th className="text-right py-1 px-2">ERS Harv</th>}
              {hasFuel && (
                <th
                  className="text-right py-1 px-2"
                  title="Fuel burned this lap (kg). Push laps trend higher than the green-flag median; saving laps trend lower."
                >
                  Fuel (kg)
                </th>
              )}
            </tr>
          );

          const renderLapRow = (d: typeof data[number], rowKey: string) => {
            const isBestLap = d.valid && Math.abs(d.timeSec - bestTime) < 0.001;
            const isBestS1 = d.valid && Math.abs(d.s1 - bestS1) < 0.001;
            const isBestS2 = d.valid && Math.abs(d.s2 - bestS2) < 0.001;
            const isBestS3 = d.valid && Math.abs(d.s3 - bestS3) < 0.001;
            const wear = wearMap.get(d.lap);
            const scBg = d.isSC
              ? "bg-amber-500/10"
              : d.isVSC
                ? "bg-yellow-500/10"
                : "";
            return (
              <tr
                key={rowKey}
                className={cn(tableRowClass, !d.valid ? "bg-red-500/10" : scBg)}
              >
                <td className="py-1 px-2 font-mono">
                  {d.lap}
                  {!d.valid && (
                    // text-behind is the app-wide "you're behind" red, not a
                    // generic chip tone — keep the override here.
                    <Badge size="xs" shape="square" className="ml-1.5 bg-red-500/20 text-behind">
                      INVALID
                    </Badge>
                  )}
                  {d.isSC && (
                    <Badge size="xs" shape="square" tone="amber" className="ml-1.5">
                      SC
                    </Badge>
                  )}
                  {d.isVSC && (
                    <Badge size="xs" shape="square" tone="yellow" className="ml-1.5">
                      VSC
                    </Badge>
                  )}
                </td>
                <td className={cn("text-right py-1 px-2 font-mono", !d.valid ? "text-behind/70 line-through" : isBestLap ? "text-best font-semibold" : "")}>
                  {d.timeStr}
                </td>
                <td className={cn("text-right py-1 px-2 font-mono", !d.valid ? "text-zinc-600" : isBestS1 ? "text-best" : "")}>{msToSectorTime(d.s1 * 1000)}</td>
                <td className={cn("text-right py-1 px-2 font-mono", !d.valid ? "text-zinc-600" : isBestS2 ? "text-best" : "")}>{msToSectorTime(d.s2 * 1000)}</td>
                <td className={cn("text-right py-1 px-2 font-mono", !d.valid ? "text-zinc-600" : isBestS3 ? "text-best" : "")}>{msToSectorTime(d.s3 * 1000)}</td>
                {hasTopSpeed && (
                  <td className={cn("text-right py-1 px-2 font-mono", d.valid && d.topSpeed != null && d.topSpeed === bestTopSpeed ? "text-best font-semibold" : "")}>
                    {d.topSpeed != null ? `${d.topSpeed}` : "–"}
                  </td>
                )}
                {hasWear && (
                  <td
                    className={cn(
                      "text-right py-1 px-2 font-mono",
                      wear != null && wear >= 75 ? "text-behind" : wear != null && wear >= 50 ? "text-warning" : "text-zinc-400",
                    )}
                    title={wear != null ? "Max tyre wear: highest-worn tyre at the end of this lap." : undefined}
                  >
                    {wear != null ? `${wear.toFixed(0)}%` : "–"}
                  </td>
                )}
                {hasErs && (
                  <td className="text-right py-1 px-2 font-mono text-ahead">
                    {d.ersMj != null && d.ersMj > 0 ? d.ersMj.toFixed(1) : "–"}
                  </td>
                )}
                {hasErsHarv && (
                  <td className="text-right py-1 px-2 font-mono text-sky-400">
                    {d.ersHarvMj != null && d.ersHarvMj > 0 ? d.ersHarvMj.toFixed(1) : "–"}
                  </td>
                )}
                {hasFuel && (
                  <td
                    className={cn(
                      "text-right py-1 px-2 font-mono",
                      d.fuelKg == null
                        ? "text-zinc-600"
                        : medianGreenBurn != null && d.fuelKg < medianGreenBurn * 0.95
                          ? "text-ahead"
                          : medianGreenBurn != null && d.fuelKg > medianGreenBurn * 1.05
                            ? "text-warning"
                            : "text-zinc-400",
                    )}
                    title={d.fuelKg != null ? "Fuel burned this lap (kg)." : undefined}
                  >
                    {d.fuelKg != null ? d.fuelKg.toFixed(2) : "–"}
                  </td>
                )}
              </tr>
            );
          };

          // Group laps by stint when stints are available
          if (stints && stints.length > 0) {
            return (
              <table className="w-full text-xs min-w-[500px]">
                <thead className={tableHeadClass}>
                  {headerRow}
                </thead>
                <tbody>
                  {stints.map((stint, si) => {
                    const compound = stint["tyre-set-data"]["visual-tyre-compound"];
                    const color = COMPOUND_COLORS[compound] ?? "#a1a1aa";
                    const stintLaps = data.filter(
                      (d) => d.lap >= stint["start-lap"] && d.lap <= stint["end-lap"],
                    );
                    return [
                      <tr key={`stint-${si}`}>
                        <td colSpan={colCount} className={cn("py-1.5 px-2", si > 0 && "pt-4")}>
                          <div className="flex items-center gap-2">
                            <span
                              className="inline-block w-2.5 h-2.5 rounded-full"
                              style={{ backgroundColor: color }}
                            />
                            <span className="text-xs font-semibold text-zinc-300">
                              Stint {si + 1} — {compound}
                            </span>
                            <span className="text-2xs text-zinc-500">
                              Laps {stint["start-lap"]}–{stint["end-lap"]} ({stint["stint-length"]} laps)
                            </span>
                          </div>
                        </td>
                      </tr>,
                      ...stintLaps.map((lap, li) => renderLapRow(lap, `stint-${si}-lap-${lap.lap}-${li}`)),
                    ];
                  })}
                </tbody>
              </table>
            );
          }

          // Fallback: no stint grouping
          return (
            <table className="w-full text-xs min-w-[500px]">
              <thead className={tableHeadClass}>
                {headerRow}
              </thead>
              <tbody>
                {data.map((lap, i) => renderLapRow(lap, `lap-${lap.lap}-${i}`))}
              </tbody>
            </table>
          );
        })()}
      </div>
    </div>
  );
}
