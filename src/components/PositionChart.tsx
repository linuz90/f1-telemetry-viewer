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
import type { OvertakeRecord, PositionHistoryEntry } from "../types/telemetry";
import { getTeamColor, CHART_THEME, TOOLTIP_STYLE } from "../utils/colors";

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
export function PositionChart({ positionHistory, playerName, rivalName, overtakes }: PositionChartProps) {
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

  // Find the race winner (P1 on last lap)
  const lastLapData = data[data.length - 1];
  const winnerName = lastLapData
    ? Object.entries(lastLapData)
        .filter(([k]) => k !== "lap")
        .sort((a, b) => (a[1] as number) - (b[1] as number))[0]?.[0]
    : undefined;

  let visibleDrivers: PositionHistoryEntry[];

  if (rivalName) {
    // Rival selected: show player, rival, and race winner
    visibleDrivers = positionHistory.filter(
      (d) => d.name === playerName || d.name === rivalName || d.name === winnerName,
    );
  } else {
    // No rival: show player, race winner, and drivers ±1 position at race start/end
    const firstLapData = data[0];
    const neighborNames = new Set<string>();

    for (const lapData of [firstLapData, lastLapData]) {
      if (!lapData) continue;
      const playerPos = lapData[playerName] as number | undefined;
      if (playerPos == null) continue;
      for (const [name, pos] of Object.entries(lapData)) {
        if (name === "lap") continue;
        if (Math.abs((pos as number) - playerPos) === 1) neighborNames.add(name);
      }
    }

    visibleDrivers = positionHistory.filter(
      (d) => d.name === playerName || d.name === winnerName || neighborNames.has(d.name),
    );
  }

  // Dynamic Y domain based on visible drivers
  const allPositions = visibleDrivers.flatMap((d) =>
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

          {visibleDrivers.map((driver) => {
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

          {/* Overtake markers */}
          {overtakes?.map((ot, i) => {
            const isPlayerOvertaking = ot["overtaking-driver-name"] === playerName;
            const isPlayerOvertaken = ot["being-overtaken-driver-name"] === playerName;
            if (!isPlayerOvertaking && !isPlayerOvertaken) return null;
            const lap = ot["lap-number"];
            const position = data[lap]?.[playerName];
            if (position == null) return null;
            return (
              <ReferenceDot
                key={`ot-${i}`}
                x={lap}
                y={position}
                r={5}
                fill={isPlayerOvertaking ? "#22c55e" : "#ef4444"}
                fillOpacity={0.8}
                stroke={isPlayerOvertaking ? "#22c55e" : "#ef4444"}
                strokeWidth={1.5}
              />
            );
          })}
        </LineChart>
      </ResponsiveContainer>
      {overtakes && overtakes.some((ot) => ot["overtaking-driver-name"] === playerName || ot["being-overtaken-driver-name"] === playerName) && (
        <div className="flex items-center gap-4 mt-1.5 text-[10px] text-zinc-400">
          {overtakes.some((ot) => ot["overtaking-driver-name"] === playerName) && (
            <span className="flex items-center gap-1">
              <span className="inline-block w-2.5 h-2.5 rounded-full bg-green-500" />
              Overtake
            </span>
          )}
          {overtakes.some((ot) => ot["being-overtaken-driver-name"] === playerName) && (
            <span className="flex items-center gap-1">
              <span className="inline-block w-2.5 h-2.5 rounded-full bg-red-500" />
              Overtaken
            </span>
          )}
        </div>
      )}
    </div>
  );
}
