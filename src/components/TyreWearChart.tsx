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
import type { PerLapInfo, TyreStint } from "../types/telemetry";
import { CHART_THEME, TOOLTIP_STYLE } from "../utils/colors";
import { getWorstWheelWear } from "../utils/stats";

const SC_COLORS: Record<string, string> = {
  SAFETY_CAR: "#f59e0b",
  FULL_SAFETY_CAR: "#f59e0b",
  VIRTUAL_SAFETY_CAR: "#eab308",
};

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
  if (!stints.length) {
    return <p className="text-sm text-zinc-500">No tyre wear data.</p>;
  }

  // Player data: worst wheel per lap, with gaps between stints
  const playerData: { lap: number; wear: number | undefined; compound: string }[] = [];
  stints.forEach((stint, i) => {
    const wearHistory = stint["tyre-wear-history"];
    if (i > 0 && wearHistory.length > 0) {
      // Insert gap to break the line at pit stops
      playerData.push({ lap: wearHistory[0]["lap-number"] - 0.5, wear: undefined, compound: "" });
    }
    for (const w of wearHistory) {
      playerData.push({
        lap: w["lap-number"],
        wear: +getWorstWheelWear(w).toFixed(1),
        compound: stint["tyre-set-data"]["visual-tyre-compound"],
      });
    }
  });

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

  // Explicit integer ticks for x-axis (every lap)
  const lapTicks = data.filter((d) => Number.isInteger(d.lap)).map((d) => d.lap);

  // SC status lookup by lap number
  const scStatusMap = new Map<number, string>();
  if (perLapInfo) {
    for (const lap of perLapInfo) {
      const status = lap["max-safety-car-status"] ?? "NO_SAFETY_CAR";
      if (status !== "NO_SAFETY_CAR") {
        scStatusMap.set(lap["lap-number"], status);
      }
    }
  }

  // SC/VSC ranges for background shading
  const scRanges: { x1: number; x2: number; status: string }[] = [];
  if (perLapInfo) {
    for (const lap of perLapInfo) {
      const status = lap["max-safety-car-status"] ?? "NO_SAFETY_CAR";
      const isSC = status === "SAFETY_CAR" || status === "FULL_SAFETY_CAR" || status === "VIRTUAL_SAFETY_CAR";
      if (isSC) {
        const lapNum = lap["lap-number"];
        const prev = scRanges[scRanges.length - 1];
        if (prev && prev.status === status && prev.x2 === lapNum - 1) {
          prev.x2 = lapNum;
        } else {
          scRanges.push({ x1: lapNum, x2: lapNum, status });
        }
      }
    }
  }

  // Compute gradient stops based on actual data range
  const maxWear = Math.max(...data.map((d) => d.wear ?? 0), 50);
  // Map wear thresholds to gradient offsets (0% = top/maxWear, 100% = bottom/0)
  const stopAt = (wearLevel: number) =>
    `${Math.max(0, Math.min(100, ((maxWear - wearLevel) / maxWear) * 100))}%`;

  return (
    <div>
      <h3 className="text-sm font-semibold text-zinc-300 mb-2">Tyre Wear</h3>
      <ResponsiveContainer width="100%" height={280}>
        <LineChart
          data={data}
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
            ticks={lapTicks}
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
            formatter={(value: number | undefined, name: string | undefined) => [
              `${value ?? 0}%`,
              name ?? "",
            ]}
            labelFormatter={(lap) => {
              const entry = data.find((d) => d.lap === lap);
              const sc = scStatusMap.get(lap as number);
              const scLabel = sc === "SAFETY_CAR" || sc === "FULL_SAFETY_CAR" ? " \u{1F7E1} SC" : sc === "VIRTUAL_SAFETY_CAR" ? " \u{1F7E1} VSC" : "";
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
          {scRanges.map((range) => (
            <ReferenceArea
              key={`sc-${range.x1}`}
              x1={range.x1 - 0.5}
              x2={range.x2 + 0.5}
              fill={SC_COLORS[range.status] ?? "#f59e0b"}
              fillOpacity={0.12}
              stroke="none"
            />
          ))}

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
            stroke="url(#wearGradient)"
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

    </div>
  );
}
