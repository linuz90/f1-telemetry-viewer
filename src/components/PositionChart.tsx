import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceDot,
} from "recharts";
import { buildPositionChartModel } from "../analysis/positionAnalysis";
import type { OvertakeRecord, PositionHistoryEntry } from "../types/telemetry";
import { CHART_THEME, TOOLTIP_STYLE } from "../constants/colors";
import { getTeamColor } from "../utils/colors";
import { EmptyState } from "./EmptyState";
import { SectionHeader } from "./ui/SectionHeader";

interface PositionChartProps {
  positionHistory: PositionHistoryEntry[];
  playerName: string;
  rivalName?: string;
  overtakes?: OvertakeRecord[];
}

/**
 * Position chart for races. Player line is thick, nearby competitors thin.
 * Y-axis inverted (P1 at top).
 */
export function PositionChart({
  positionHistory,
  playerName,
  rivalName,
  overtakes,
}: PositionChartProps) {
  const model = buildPositionChartModel({
    positionHistory,
    playerName,
    rivalName,
  });
  if (!positionHistory.length || model.maxPoints < 2) {
    return (
      <EmptyState
        title="Position Changes"
        message="Not enough lap data was recorded to show position changes."
      />
    );
  }

  return (
    <div>
      <SectionHeader size="sm" title="Position Changes" />
      <ResponsiveContainer width="100%" height={300}>
        <LineChart
          data={model.data}
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
            reversed
            stroke={CHART_THEME.axis}
            fontSize={11}
            domain={[1, model.maxPosition]}
            label={{
              value: "Position",
              angle: -90,
              position: "insideLeft",
              fill: CHART_THEME.axis,
              fontSize: 11,
            }}
          />
          <Tooltip
            {...TOOLTIP_STYLE}
            content={({ active, payload, label }) => {
              if (!active || !payload?.length) return null;
              const lap = label as number;
              const lapOvertakes =
                overtakes?.filter((ot) => {
                  const otLap = ot["overtaking-driver-lap"];
                  return (
                    otLap === lap &&
                    (ot["overtaking-driver-name"] === playerName ||
                      ot["overtaken-driver-name"] === playerName)
                  );
                }) ?? [];
              return (
                <div className="rounded-md bg-zinc-900 border border-zinc-700 px-3 py-2 text-xs">
                  <p className="text-zinc-400 mb-1">Lap {lap}</p>
                  {payload.map((entry) => (
                    <p
                      key={entry.name}
                      style={{ color: entry.color }}
                      className="font-mono"
                    >
                      {entry.name}: P{entry.value}
                    </p>
                  ))}
                  {lapOvertakes.map((ot, i) => {
                    const isPlayerOvertaking =
                      ot["overtaking-driver-name"] === playerName;
                    return (
                      <p
                        key={i}
                        className="mt-1"
                        style={{
                          color: isPlayerOvertaking
                            ? CHART_THEME.ahead
                            : CHART_THEME.behind,
                        }}
                      >
                        {isPlayerOvertaking
                          ? `Passed ${ot["overtaken-driver-name"]}`
                          : `Overtaken by ${ot["overtaking-driver-name"]}`}
                      </p>
                    );
                  })}
                </div>
              );
            }}
          />

          {model.visibleDrivers.map((driver) => {
            const isPlayer = driver.name === playerName;
            return (
              <Line
                key={driver.name}
                type="stepAfter"
                dataKey={driver.name}
                stroke={
                  isPlayer ? CHART_THEME.player : getTeamColor(driver.team)
                }
                strokeWidth={isPlayer ? 3 : 1}
                strokeOpacity={isPlayer ? 1 : 0.4}
                dot={false}
                connectNulls
              />
            );
          })}

          {/* Overtake markers */}
          {overtakes?.map((ot, i) => {
            const isPlayerOvertaking =
              ot["overtaking-driver-name"] === playerName;
            const isPlayerOvertaken =
              ot["overtaken-driver-name"] === playerName;
            if (!isPlayerOvertaking && !isPlayerOvertaken) return null;
            const lap = ot["overtaking-driver-lap"];
            const position = model.data[lap]?.[playerName];
            if (position == null) return null;
            return (
              <ReferenceDot
                key={`ot-${ot["overtake-id"] ?? i}`}
                x={lap}
                y={position}
                r={5}
                fill={
                  isPlayerOvertaking ? CHART_THEME.ahead : CHART_THEME.behind
                }
                fillOpacity={0.8}
                stroke={
                  isPlayerOvertaking ? CHART_THEME.ahead : CHART_THEME.behind
                }
                strokeWidth={1.5}
              />
            );
          })}
        </LineChart>
      </ResponsiveContainer>
      {overtakes &&
        overtakes.some(
          (ot) =>
            ot["overtaking-driver-name"] === playerName ||
            ot["overtaken-driver-name"] === playerName,
        ) && (
          <div className="flex items-center gap-4 mt-1.5 text-2xs text-zinc-400">
            {overtakes.some(
              (ot) => ot["overtaking-driver-name"] === playerName,
            ) && (
              <span className="flex items-center gap-1">
                <span
                  className="inline-block w-2.5 h-2.5 rounded-full"
                  style={{ backgroundColor: CHART_THEME.ahead }}
                />
                Overtake
              </span>
            )}
            {overtakes.some(
              (ot) => ot["overtaken-driver-name"] === playerName,
            ) && (
              <span className="flex items-center gap-1">
                <span
                  className="inline-block w-2.5 h-2.5 rounded-full"
                  style={{ backgroundColor: CHART_THEME.behind }}
                />
                Overtaken
              </span>
            )}
          </div>
        )}
    </div>
  );
}
