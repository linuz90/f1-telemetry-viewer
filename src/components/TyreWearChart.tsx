import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ReferenceLine,
  ResponsiveContainer,
} from "recharts";
import type { TyreStint } from "../types/telemetry";
import { getCompoundColor, CHART_THEME, TOOLTIP_STYLE } from "../utils/colors";
import { getWorstWheelWear, stintWearRate } from "../utils/stats";

interface TyreWearChartProps {
  stints: TyreStint[];
  rivalStints?: TyreStint[];
  rivalName?: string;
}

/**
 * Line chart showing worst-wheel tyre wear across all stints.
 * Optionally overlays rival's worst-wheel wear as a dashed orange line.
 */
export function TyreWearChart({
  stints,
  rivalStints,
  rivalName,
}: TyreWearChartProps) {
  if (!stints.length) {
    return <p className="text-sm text-zinc-500">No tyre wear data.</p>;
  }

  // Player data: worst wheel per lap
  const playerData = stints.flatMap((stint) =>
    stint["tyre-wear-history"].map((w) => ({
      lap: w["lap-number"],
      wear: +getWorstWheelWear(w).toFixed(1),
      compound: stint["tyre-set-data"]["visual-tyre-compound"],
    })),
  );

  // Rival data (if provided)
  const rivalMap = new Map<number, number>();
  if (rivalStints?.length) {
    for (const stint of rivalStints) {
      for (const w of stint["tyre-wear-history"]) {
        rivalMap.set(w["lap-number"], +getWorstWheelWear(w).toFixed(1));
      }
    }
  }

  // Merge into single dataset
  const data = playerData.map((d) => ({
    ...d,
    rivalWear: rivalMap.get(d.lap) ?? undefined,
  }));

  // Pit stop laps (transitions between stints)
  const pitLaps = stints.slice(1).map((s) => s["start-lap"]);

  const hasRival = rivalStints && rivalStints.length > 0;

  return (
    <div>
      <h3 className="text-sm font-semibold text-zinc-300 mb-2">Tyre Wear</h3>
      <ResponsiveContainer width="100%" height={280}>
        <LineChart
          data={data}
          margin={{ top: 5, right: 20, bottom: 5, left: 0 }}
        >
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
            formatter={(value: number | undefined, name: string | undefined) => [
              `${value ?? 0}%`,
              name ?? "",
            ]}
            labelFormatter={(lap) => {
              const entry = data.find((d) => d.lap === lap);
              return `Lap ${lap} (${entry?.compound ?? ""})`;
            }}
          />
          <Legend
            wrapperStyle={{
              fontSize: "11px",
              color: CHART_THEME.tooltipLabel,
            }}
          />

          {pitLaps.map((lap) => (
            <ReferenceLine
              key={lap}
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
            name="Worst Wheel"
            stroke="#22d3ee"
            strokeWidth={2}
            dot={false}
          />

          {hasRival && (
            <Line
              type="monotone"
              dataKey="rivalWear"
              name={rivalName ?? "Rival"}
              stroke="#f97316"
              strokeWidth={2}
              strokeDasharray="6 3"
              strokeOpacity={0.6}
              dot={false}
              connectNulls
            />
          )}
        </LineChart>
      </ResponsiveContainer>

      {/* Wear rate summary per stint */}
      <div className="flex gap-4 mt-2 text-xs text-zinc-400 flex-wrap">
        {stints.map((stint, i) => {
          const rate = stintWearRate(stint);
          return (
            <span key={i} className="flex items-center gap-1">
              <span
                className="inline-block w-2 h-2 rounded-sm"
                style={{
                  backgroundColor: getCompoundColor(
                    stint["tyre-set-data"]["visual-tyre-compound"],
                  ),
                }}
              />
              {stint["tyre-set-data"]["visual-tyre-compound"]}:{" "}
              {rate > 0 ? `${rate.toFixed(1)}%/lap` : "–"}
            </span>
          );
        })}
        {hasRival && rivalStints && (
          <>
            <span className="text-zinc-600">|</span>
            <span className="text-orange-400/70 text-[10px] uppercase tracking-wide">
              {rivalName}:
            </span>
            {rivalStints.map((stint, i) => {
              const rate = stintWearRate(stint);
              return (
                <span key={`r${i}`} className="flex items-center gap-1 text-orange-400/70">
                  <span
                    className="inline-block w-2 h-2 rounded-sm"
                    style={{
                      backgroundColor: getCompoundColor(
                        stint["tyre-set-data"]["visual-tyre-compound"],
                      ),
                    }}
                  />
                  {stint["tyre-set-data"]["visual-tyre-compound"]}:{" "}
                  {rate > 0 ? `${rate.toFixed(1)}%/lap` : "–"}
                </span>
              );
            })}
          </>
        )}
      </div>
    </div>
  );
}
