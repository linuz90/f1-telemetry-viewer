import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import type { PositionHistoryEntry } from "../types/telemetry";
import { getTeamColor, CHART_THEME, TOOLTIP_STYLE } from "../utils/colors";

interface PositionChartProps {
  positionHistory: PositionHistoryEntry[];
  playerName: string;
}

/**
 * Position chart for races. Player line is thick, nearby competitors thin.
 * Y-axis inverted (P1 at top).
 */
export function PositionChart({ positionHistory, playerName }: PositionChartProps) {
  if (!positionHistory.length) {
    return <p className="text-sm text-zinc-500">No position data.</p>;
  }

  // Build lap-indexed data: { lap: 1, HAMILTON: 1, VERSTAPPEN: 2, ... }
  const maxLaps = Math.max(
    ...positionHistory.flatMap((d) =>
      d["driver-position-history"].map((p) => p["lap-number"]),
    ),
  );

  const data: Record<string, number>[] = [];
  for (let lap = 0; lap <= maxLaps; lap++) {
    const entry: Record<string, number> = { lap };
    for (const driver of positionHistory) {
      const posEntry = driver["driver-position-history"].find(
        (p) => p["lap-number"] === lap,
      );
      if (posEntry) entry[driver.name] = posEntry.position;
    }
    data.push(entry);
  }

  // Find driver names near the player's positions for reduced clutter
  const playerData = positionHistory.find((d) => d.name === playerName);
  const playerPositions = playerData?.["driver-position-history"].map((p) => p.position) ?? [];
  const playerRange = [
    Math.min(...playerPositions) - 3,
    Math.max(...playerPositions) + 3,
  ];

  // Show player + drivers who were within 3 positions
  const nearbyDrivers = positionHistory.filter((d) => {
    if (d.name === playerName) return true;
    return d["driver-position-history"].some(
      (p) => p.position >= playerRange[0] && p.position <= playerRange[1],
    );
  });

  // Dynamic Y domain based on actual grid size
  const allPositions = positionHistory.flatMap((d) =>
    d["driver-position-history"].map((p) => p.position),
  );
  const maxPosition = Math.max(...allPositions);

  return (
    <div>
      <h3 className="text-sm font-semibold text-zinc-300 mb-2">Position Changes</h3>
      <ResponsiveContainer width="100%" height={300}>
        <LineChart data={data} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={CHART_THEME.grid} />
          <XAxis
            dataKey="lap"
            stroke={CHART_THEME.axis}
            fontSize={11}
            label={{ value: "Lap", position: "insideBottom", offset: -2, fill: CHART_THEME.axis, fontSize: 11 }}
          />
          <YAxis
            reversed
            stroke={CHART_THEME.axis}
            fontSize={11}
            domain={[1, maxPosition]}
            label={{ value: "Position", angle: -90, position: "insideLeft", fill: CHART_THEME.axis, fontSize: 11 }}
          />
          <Tooltip
            {...TOOLTIP_STYLE}
            labelFormatter={(lap) => `Lap ${lap}`}
            formatter={(value: number | undefined, name: string | undefined) => [`P${value ?? "–"}`, name ?? ""]}
          />

          {nearbyDrivers.map((driver) => {
            const isPlayer = driver.name === playerName;
            return (
              <Line
                key={driver.name}
                type="stepAfter"
                dataKey={driver.name}
                stroke={isPlayer ? "#22d3ee" : getTeamColor(driver.team)}
                strokeWidth={isPlayer ? 3 : 1}
                strokeOpacity={isPlayer ? 1 : 0.4}
                dot={false}
                connectNulls
              />
            );
          })}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
