import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
} from "recharts";
import { buildTyreWearAnalysis } from "../analysis/tyreWearAnalysis";
import type { PerLapInfo, TyreStint } from "../types/telemetry";
import {
  CHART_THEME,
  TOOLTIP_STYLE,
  SC_COLORS,
  SC_FALLBACK,
} from "../constants/colors";
import { EmptyState } from "./EmptyState";
import { SectionHeader } from "./ui/SectionHeader";

interface TyreWearChartProps {
  stints: TyreStint[];
  rivalStints?: TyreStint[];
  rivalName?: string;
  perLapInfo?: PerLapInfo[];
}

/**
 * Line chart showing worst-wheel tyre wear across all stints.
 * Optionally overlays rival's worst-wheel wear as a dashed orange line.
 */
export function TyreWearChart({
  stints,
  rivalStints,
  rivalName,
  perLapInfo,
}: TyreWearChartProps) {
  const analysis = buildTyreWearAnalysis({
    stints,
    rivalStints,
    perLapInfo,
  });
  if (!stints.length || !analysis.hasAnyWearData) {
    return (
      <EmptyState
        title="Tyre Wear"
        message="Per-lap tyre wear data wasn't recorded for this session."
      />
    );
  }

  // Compute gradient stops based on actual data range
  // Map wear thresholds to gradient offsets (0% = top/maxWear, 100% = bottom/0)
  const stopAt = (wearLevel: number) =>
    `${Math.max(
      0,
      Math.min(100, ((analysis.maxWear - wearLevel) / analysis.maxWear) * 100),
    )}%`;

  return (
    <div>
      <SectionHeader
        size="sm"
        title={
          <>
            Tyre Wear{" "}
            <span
              className="font-normal text-zinc-500"
              title="Tyre wear uses max/worst-wheel wear: the highest-worn tyre at each lap."
            >
              max wheel
            </span>
          </>
        }
      />
      <ResponsiveContainer width="100%" height={280}>
        <LineChart
          data={analysis.data}
          margin={{ top: 5, right: 20, bottom: 5, left: 0 }}
        >
          <defs>
            <linearGradient id="wearGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset={stopAt(80)} stopColor="#ef4444" />
              <stop offset={stopAt(70)} stopColor="#f97316" />
              <stop offset={stopAt(55)} stopColor="#eab308" />
              <stop offset={stopAt(35)} stopColor="#22c55e" />
              <stop offset="100%" stopColor="#22c55e" />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke={CHART_THEME.grid} />
          <XAxis
            dataKey="lap"
            type="number"
            ticks={analysis.lapTicks}
            domain={["dataMin", "dataMax"]}
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
            domain={[0, "auto"]}
            label={{
              value: "Wear %",
              angle: -90,
              position: "insideLeft",
              fill: CHART_THEME.axis,
              fontSize: 11,
            }}
          />
          <Tooltip
            {...TOOLTIP_STYLE}
            formatter={(
              value: number | undefined,
              name: string | undefined,
            ) => [`${value ?? 0}%`, name ?? "Max wear"]}
            labelFormatter={(lap) => {
              const entry = analysis.data.find((d) => d.lap === lap);
              const sc = analysis.scStatusByLap.get(lap as number);
              const scLabel =
                sc === "SAFETY_CAR" || sc === "FULL_SAFETY_CAR"
                  ? " [SC]"
                  : sc === "VIRTUAL_SAFETY_CAR"
                    ? " [VSC]"
                    : "";
              return `Lap ${lap} (${entry?.compound ?? ""})${scLabel}`;
            }}
          />
          <Legend
            wrapperStyle={{
              fontSize: "11px",
              color: CHART_THEME.tooltipLabel,
            }}
          />

          {/* SC/VSC background shading */}
          {analysis.scRanges.map((range) => (
            <ReferenceArea
              key={`sc-${range.x1}`}
              x1={range.x1 - 0.5}
              x2={range.x2 + 0.5}
              fill={SC_COLORS[range.status] ?? SC_FALLBACK}
              fillOpacity={0.12}
              stroke="none"
            />
          ))}

          {analysis.pitLaps.map((lap, i) => (
            <ReferenceLine
              key={`pit-${lap}-${i}`}
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

          <Line
            type="monotone"
            dataKey="wear"
            name="Max wear"
            stroke="url(#wearGradient)"
            strokeWidth={2}
            dot={false}
          />

          {analysis.hasRival && (
            <Line
              type="monotone"
              dataKey="rivalWear"
              name={rivalName ?? "Rival"}
              stroke={CHART_THEME.rival}
              strokeWidth={2}
              strokeDasharray="6 3"
              strokeOpacity={0.6}
              dot={false}
              connectNulls
            />
          )}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
