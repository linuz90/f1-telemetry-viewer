import { useState } from "react";
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { buildLapAnalysis, type LapAnalysisRow } from "../analysis/lapAnalysis";
import {
  LAP_CHART_BATTERY_VISIBILITY_STORAGE_KEY,
  LAP_CHART_CLEAN_LAPS_STORAGE_KEY,
} from "../constants/storage";
import type {
  LapHistoryEntry,
  PerLapInfo,
  TyreStint,
} from "../types/telemetry";
import { cn } from "../utils/cn";
import {
  CHART_THEME,
  COMPOUND_COLORS,
  SC_COLORS,
  SC_FALLBACK,
} from "../constants/colors";
import { msToLapTime, msToSectorTime } from "../utils/format";
import { readStoredBoolean, writeStoredBoolean } from "../utils/storage";
import { Tooltip as HoverTooltip } from "./Tooltip";
import { Badge } from "./ui/Badge";
import { FocusToggle } from "./ui/FocusToggle";
import { SectionHeader } from "./ui/SectionHeader";
import {
  tableCellClass,
  tableClass,
  tableHeadCellClass,
  tableHeadClass,
  tableRowClass,
} from "./ui/table";

interface LapTooltipPayload {
  name?: string | number;
  value?: number;
  color?: string;
}

interface LapTooltipProps {
  active?: boolean;
  label?: string | number;
  payload?: readonly LapTooltipPayload[];
}

interface LapTimeChartProps {
  laps: LapHistoryEntry[];
  /** Pit stop laps to mark with dashed lines */
  pitLaps?: number[];
  /** Rival pit stop laps, used only by the clean-laps display filter. */
  rivalPitLaps?: number[];
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
  rivalPitLaps = [],
  rivalLaps,
  rivalName,
  perLapInfo,
  damageLaps = [],
  stints,
}: LapTimeChartProps) {
  const [showBattery, setShowBattery] = useState(() =>
    readStoredBoolean(LAP_CHART_BATTERY_VISIBILITY_STORAGE_KEY),
  );
  const [showCleanLaps, setShowCleanLaps] = useState(() =>
    readStoredBoolean(LAP_CHART_CLEAN_LAPS_STORAGE_KEY),
  );

  if (!laps.length) {
    return <p className="text-sm text-zinc-500">No lap data.</p>;
  }

  const toggleBatteryVisibility = () => {
    setShowBattery((prev) => {
      const next = !prev;
      writeStoredBoolean(LAP_CHART_BATTERY_VISIBILITY_STORAGE_KEY, next);
      return next;
    });
  };

  const toggleCleanLaps = () => {
    setShowCleanLaps((prev) => {
      const next = !prev;
      writeStoredBoolean(LAP_CHART_CLEAN_LAPS_STORAGE_KEY, next);
      return next;
    });
  };

  const analysis = buildLapAnalysis({
    laps,
    pitLaps,
    rivalPitLaps,
    rivalLaps,
    perLapInfo,
    stints,
    showCleanLaps,
  });
  if (!analysis.rows.length) {
    return <p className="text-sm text-zinc-500">No lap data.</p>;
  }

  const data = analysis.rows;
  const chartData = analysis.chartRows;
  const maxLap = analysis.maxLap;
  const lapTicks = analysis.lapTicks;
  const yMin = analysis.yMin;
  const yMax = analysis.yMax;
  const hasRival = analysis.hasRival;
  const hasErs = analysis.hasErs;
  const hasErsHarv = analysis.hasErsHarv;
  const hasBattery = analysis.hasBattery;
  const showBatteryDetails = hasBattery && showBattery;
  const maxErsMj = analysis.maxErsMj;
  const hasFuel = analysis.hasFuel;
  const hasTopSpeed = analysis.hasTopSpeed;
  const bestTopSpeed = analysis.bestTopSpeed;
  const hasCleanLapOutliers = analysis.hasCleanLapOutliers;
  const chartBestTime = analysis.chartBestTime;
  const tableBestTime = analysis.tableBestTime;
  const bestS1 = analysis.bestS1;
  const bestS2 = analysis.bestS2;
  const bestS3 = analysis.bestS3;
  const scRanges = analysis.scRanges;
  const medianGreenBurn = analysis.medianGreenBurn;
  const renderLapTooltip = ({ active, label, payload }: LapTooltipProps) => {
    if (!active || !payload?.length) return null;
    const entry = chartData.find((d) => d.lap === Number(label));
    const scLabel = entry?.isSC ? " SC" : entry?.isVSC ? " VSC" : "";

    return (
      <div className="rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-xs shadow-lg">
        <div className="mb-1 text-zinc-400">
          Lap {label}
          {scLabel}
        </div>
        <div className="grid min-w-36 grid-cols-[auto_auto] gap-x-4 gap-y-0.5">
          {payload.map((item) => {
            if (item.value == null) return null;
            const name = String(item.name ?? "");
            const value =
              name === "ERS Deploy" || name === "ERS Harv"
                ? `${item.value.toFixed(1)} MJ`
                : msToLapTime(item.value * 1000);

            return (
              <div
                key={name}
                className="contents"
                style={{ color: item.color }}
              >
                <span>{name}:</span>
                <span className="text-right font-mono">{value}</span>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  return (
    <div>
      <SectionHeader
        size="sm"
        className="items-center mb-4"
        title={
          <span className="inline-flex min-w-0 items-center gap-3">
            <span>Lap Times</span>
            {scRanges.length > 0 && (
              <span className="flex items-center gap-3 text-2xs font-normal text-zinc-400">
                {scRanges.some(
                  (r) =>
                    r.status === "SAFETY_CAR" || r.status === "FULL_SAFETY_CAR",
                ) && (
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
              </span>
            )}
          </span>
        }
      />
      <ResponsiveContainer width="100%" height={showBatteryDetails ? 320 : 280}>
        <ComposedChart
          data={chartData}
          margin={{ top: 5, right: 20, bottom: 5, left: 0 }}
        >
          <CartesianGrid strokeDasharray="3 3" stroke={CHART_THEME.grid} />
          <XAxis
            dataKey="lap"
            type="number"
            stroke={CHART_THEME.axis}
            fontSize={11}
            domain={[1, maxLap]}
            ticks={lapTicks}
            interval={0}
            allowDecimals={false}
            label={{
              value: "Lap",
              position: "insideBottom",
              offset: -2,
              fill: CHART_THEME.axis,
              fontSize: 11,
            }}
          />
          <YAxis
            yAxisId="time"
            stroke={CHART_THEME.axis}
            fontSize={11}
            domain={[yMin, yMax]}
            allowDecimals={false}
            tickFormatter={(v) => msToLapTime(Math.round(v) * 1000)}
          />
          {showBatteryDetails && (
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
          <Tooltip content={renderLapTooltip} />

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
                value:
                  range.status === "SAFETY_CAR" ||
                  range.status === "FULL_SAFETY_CAR"
                    ? "SC"
                    : "VSC",
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
          {chartBestTime > 0 && (
            <ReferenceLine
              yAxisId="time"
              y={chartBestTime}
              stroke={CHART_THEME.best}
              strokeDasharray="4 4"
              strokeOpacity={0.5}
              label={{
                value: `Best: ${msToLapTime(chartBestTime * 1000)}`,
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
              label={{
                value: "PIT",
                fill: CHART_THEME.muted,
                fontSize: 10,
                position: "top",
              }}
            />
          ))}

          {/* ERS bars */}
          {showBatteryDetails && hasErs && (
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
          {showBatteryDetails && hasErsHarv && (
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
            name="You"
            stroke={CHART_THEME.player}
            strokeWidth={2}
            dot={(props) => {
              const { cx, cy, index } = props as {
                cx?: number;
                cy?: number;
                index?: number;
              };
              const entry = index != null ? chartData[index] : undefined;
              if (!entry || cx == null || cy == null)
                return <circle key={`lap-dot-${index}`} cx={0} cy={0} r={0} />;

              // SC/VSC dot styling
              if (entry.isSC || entry.isVSC) {
                const color = entry.isSC
                  ? SC_COLORS.SAFETY_CAR
                  : SC_COLORS.VIRTUAL_SAFETY_CAR;
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
                    <circle
                      cx={cx}
                      cy={cy}
                      r={5}
                      fill={CHART_THEME.behind}
                      fillOpacity={0.2}
                      stroke={CHART_THEME.behind}
                      strokeWidth={2}
                    />
                    <line
                      x1={cx - 2.5}
                      y1={cy - 2.5}
                      x2={cx + 2.5}
                      y2={cy + 2.5}
                      stroke={CHART_THEME.behind}
                      strokeWidth={1.5}
                    />
                    <line
                      x1={cx + 2.5}
                      y1={cy - 2.5}
                      x2={cx - 2.5}
                      y2={cy + 2.5}
                      stroke={CHART_THEME.behind}
                      strokeWidth={1.5}
                    />
                  </g>
                );
              }
              const isBest =
                chartBestTime > 0 &&
                Math.abs(entry.timeSec - chartBestTime) < 0.001;
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
      {(hasCleanLapOutliers || hasBattery) && (
        <div className="mt-2 flex flex-wrap items-center justify-end gap-x-6 gap-y-2">
          {hasCleanLapOutliers && (
            <HoverTooltip text="Hides pit in/out laps and Safety Car/VSC laps from the chart only. The lap table still shows every lap.">
              <FocusToggle
                label="Clean laps"
                value={showCleanLaps}
                onChange={toggleCleanLaps}
              />
            </HoverTooltip>
          )}
          {hasBattery && (
            <FocusToggle
              label="Battery"
              value={showBattery}
              onChange={toggleBatteryVisibility}
            />
          )}
        </div>
      )}

      {/* Lap table grouped by stint */}
      <div className="mt-3 overflow-x-auto -mx-4 px-4 sm:mx-0 sm:px-0">
        {(() => {
          const hasWear = data.some((lap) => lap.wear != null);

          const colCount =
            5 +
            (hasTopSpeed ? 1 : 0) +
            (showBatteryDetails && hasErs ? 1 : 0) +
            (showBatteryDetails && hasErsHarv ? 1 : 0) +
            (hasWear ? 1 : 0) +
            (hasFuel ? 1 : 0);
          const headerRow = (
            <tr>
              <th className={tableHeadCellClass({ size: "sm" })}>Lap</th>
              <th
                className={tableHeadCellClass({ align: "right", size: "sm" })}
              >
                Time
              </th>
              <th
                className={tableHeadCellClass({ align: "right", size: "sm" })}
              >
                S1
              </th>
              <th
                className={tableHeadCellClass({ align: "right", size: "sm" })}
              >
                S2
              </th>
              <th
                className={tableHeadCellClass({ align: "right", size: "sm" })}
              >
                S3
              </th>
              {hasTopSpeed && (
                <th
                  className={tableHeadCellClass({ align: "right", size: "sm" })}
                >
                  Speed
                </th>
              )}
              {hasWear && (
                <th
                  className={tableHeadCellClass({ align: "right", size: "sm" })}
                  title="Max tyre wear: highest-worn tyre at the end of the lap."
                >
                  Max wear
                </th>
              )}
              {showBatteryDetails && hasErs && (
                <th
                  className={tableHeadCellClass({ align: "right", size: "sm" })}
                >
                  ERS Dep
                </th>
              )}
              {showBatteryDetails && hasErsHarv && (
                <th
                  className={tableHeadCellClass({ align: "right", size: "sm" })}
                >
                  ERS Harv
                </th>
              )}
              {hasFuel && (
                <th
                  className={tableHeadCellClass({ align: "right", size: "sm" })}
                  title="Fuel burned this lap (kg). Push laps trend higher than the green-flag median; saving laps trend lower."
                >
                  Fuel (kg)
                </th>
              )}
            </tr>
          );

          const renderLapRow = (d: LapAnalysisRow, rowKey: string) => {
            const isBestLap =
              d.valid &&
              tableBestTime > 0 &&
              Math.abs(d.timeSec - tableBestTime) < 0.001;
            const isBestS1 =
              d.valid && bestS1 > 0 && Math.abs(d.s1 - bestS1) < 0.001;
            const isBestS2 =
              d.valid && bestS2 > 0 && Math.abs(d.s2 - bestS2) < 0.001;
            const isBestS3 =
              d.valid && bestS3 > 0 && Math.abs(d.s3 - bestS3) < 0.001;
            const wear = d.wear;
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
                <td className={tableCellClass({ size: "sm", mono: true })}>
                  {d.lap}
                  {!d.valid && (
                    // text-behind is the app-wide "you're behind" red, not a
                    // generic chip tone — keep the override here.
                    <Badge
                      size="xs"
                      shape="square"
                      className="ml-1.5 bg-red-500/20 text-behind"
                    >
                      INVALID
                    </Badge>
                  )}
                  {d.isSC && (
                    <Badge
                      size="xs"
                      shape="square"
                      tone="amber"
                      className="ml-1.5"
                    >
                      SC
                    </Badge>
                  )}
                  {d.isVSC && (
                    <Badge
                      size="xs"
                      shape="square"
                      tone="yellow"
                      className="ml-1.5"
                    >
                      VSC
                    </Badge>
                  )}
                </td>
                <td
                  className={cn(
                    tableCellClass({ align: "right", size: "sm", mono: true }),
                    !d.valid
                      ? "text-behind/70 line-through"
                      : isBestLap
                        ? "text-best font-semibold"
                        : "",
                  )}
                >
                  {d.timeStr}
                </td>
                <td
                  className={cn(
                    tableCellClass({ align: "right", size: "sm", mono: true }),
                    !d.valid ? "text-zinc-600" : isBestS1 ? "text-best" : "",
                  )}
                >
                  {msToSectorTime(d.s1 * 1000)}
                </td>
                <td
                  className={cn(
                    tableCellClass({ align: "right", size: "sm", mono: true }),
                    !d.valid ? "text-zinc-600" : isBestS2 ? "text-best" : "",
                  )}
                >
                  {msToSectorTime(d.s2 * 1000)}
                </td>
                <td
                  className={cn(
                    tableCellClass({ align: "right", size: "sm", mono: true }),
                    !d.valid ? "text-zinc-600" : isBestS3 ? "text-best" : "",
                  )}
                >
                  {msToSectorTime(d.s3 * 1000)}
                </td>
                {hasTopSpeed && (
                  <td
                    className={cn(
                      tableCellClass({
                        align: "right",
                        size: "sm",
                        mono: true,
                      }),
                      d.valid &&
                        d.topSpeed != null &&
                        d.topSpeed === bestTopSpeed
                        ? "text-best font-semibold"
                        : "",
                    )}
                  >
                    {d.topSpeed != null ? `${d.topSpeed}` : "–"}
                  </td>
                )}
                {hasWear && (
                  <td
                    className={cn(
                      tableCellClass({
                        align: "right",
                        size: "sm",
                        mono: true,
                      }),
                      wear != null && wear >= 75
                        ? "text-behind"
                        : wear != null && wear >= 50
                          ? "text-warning"
                          : "text-zinc-400",
                    )}
                    title={
                      wear != null
                        ? "Max tyre wear: highest-worn tyre at the end of this lap."
                        : undefined
                    }
                  >
                    {wear != null ? `${wear.toFixed(0)}%` : "–"}
                  </td>
                )}
                {showBatteryDetails && hasErs && (
                  <td
                    className={tableCellClass({
                      align: "right",
                      size: "sm",
                      mono: true,
                      className: "text-ahead",
                    })}
                  >
                    {d.ersMj != null && d.ersMj > 0 ? d.ersMj.toFixed(1) : "–"}
                  </td>
                )}
                {showBatteryDetails && hasErsHarv && (
                  <td
                    className={tableCellClass({
                      align: "right",
                      size: "sm",
                      mono: true,
                      className: "text-sky-400",
                    })}
                  >
                    {d.ersHarvMj != null && d.ersHarvMj > 0
                      ? d.ersHarvMj.toFixed(1)
                      : "–"}
                  </td>
                )}
                {hasFuel && (
                  <td
                    className={cn(
                      tableCellClass({
                        align: "right",
                        size: "sm",
                        mono: true,
                      }),
                      d.fuelKg == null
                        ? "text-zinc-600"
                        : medianGreenBurn != null &&
                            d.fuelKg < medianGreenBurn * 0.95
                          ? "text-ahead"
                          : medianGreenBurn != null &&
                              d.fuelKg > medianGreenBurn * 1.05
                            ? "text-warning"
                            : "text-zinc-400",
                    )}
                    title={
                      d.fuelKg != null
                        ? "Fuel burned this lap (kg)."
                        : undefined
                    }
                  >
                    {d.fuelKg != null ? d.fuelKg.toFixed(2) : "–"}
                  </td>
                )}
              </tr>
            );
          };

          if (analysis.stintGroups.length > 0) {
            return (
              <table className={cn(tableClass, "min-w-[500px]")}>
                <thead className={tableHeadClass}>{headerRow}</thead>
                <tbody>
                  {analysis.stintGroups.map((group, si) => {
                    const { stint, compound } = group;
                    const color = COMPOUND_COLORS[compound] ?? "#a1a1aa";
                    return [
                      <tr key={`stint-${si}`}>
                        <td
                          colSpan={colCount}
                          className={cn(tableCellClass(), si > 0 && "pt-4")}
                        >
                          <div className="flex items-center gap-2">
                            <span
                              className="inline-block w-2.5 h-2.5 rounded-full"
                              style={{ backgroundColor: color }}
                            />
                            <span className="text-xs font-semibold text-zinc-300">
                              Stint {si + 1} — {compound}
                            </span>
                            <span className="text-2xs text-zinc-500">
                              Laps {stint["start-lap"]}–{stint["end-lap"]} (
                              {stint["stint-length"]} laps)
                            </span>
                          </div>
                        </td>
                      </tr>,
                      ...group.rows.map((lap, li) =>
                        renderLapRow(lap, `stint-${si}-lap-${lap.lap}-${li}`),
                      ),
                    ];
                  })}
                </tbody>
              </table>
            );
          }

          // Fallback: no stint grouping
          return (
            <table className={cn(tableClass, "min-w-[500px]")}>
              <thead className={tableHeadClass}>{headerRow}</thead>
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
