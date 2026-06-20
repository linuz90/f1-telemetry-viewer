import type { PositionHistoryEntry } from "../types/telemetry";

/**
 * Position-history projection for the race chart.
 *
 * Raw position history is stored per driver. Recharts wants one row per lap,
 * and the UI only wants a handful of story-relevant drivers. Keeping both
 * transformations here makes the chart a renderer, not a race-story arbiter.
 */

export interface PositionChartModel {
  maxPoints: number;
  maxLaps: number;
  data: Record<string, number>[];
  winnerName?: string;
  visibleDrivers: PositionHistoryEntry[];
  maxPosition: number;
}

/**
 * Decide which drivers the race-position chart should render.
 *
 * The chart intentionally avoids plotting the whole field. Without a selected
 * rival it shows the player, winner, and start/end neighbours so the race story
 * stays readable; with a rival it pins player + rival + winner.
 */
export function buildPositionChartModel({
  positionHistory,
  playerName,
  rivalName,
}: {
  positionHistory: readonly PositionHistoryEntry[];
  playerName: string;
  rivalName?: string;
}): PositionChartModel {
  const maxPoints = Math.max(
    ...positionHistory.map(
      (driver) => driver["driver-position-history"].length,
    ),
    0,
  );
  const maxLaps = Math.max(
    ...positionHistory.flatMap((driver) =>
      driver["driver-position-history"].map((point) => point["lap-number"]),
    ),
    0,
  );

  const data: Record<string, number>[] = [];
  for (let lap = 0; lap <= maxLaps; lap++) {
    // Lap 0 represents the grid/start position in Pits n' Giggles exports, so
    // keep it in the series; removing it would erase launch/lap-one context.
    const entry: Record<string, number> = { lap };
    for (const driver of positionHistory) {
      const position = driver["driver-position-history"].find(
        (point) => point["lap-number"] === lap,
      );
      if (position) entry[driver.name] = position.position;
    }
    data.push(entry);
  }

  const lastLapData = data[data.length - 1];
  const winnerName = lastLapData
    ? Object.entries(lastLapData)
        .filter(([key]) => key !== "lap")
        .sort((a, b) => (a[1] as number) - (b[1] as number))[0]?.[0]
    : undefined;

  let visibleDrivers: PositionHistoryEntry[];
  if (rivalName) {
    visibleDrivers = positionHistory.filter(
      (driver) =>
        driver.name === playerName ||
        driver.name === rivalName ||
        driver.name === winnerName,
    );
  } else {
    const firstLapData = data[0];
    const neighborNames = new Set<string>();

    for (const lapData of [firstLapData, lastLapData]) {
      if (!lapData) continue;
      const playerPosition = lapData[playerName] as number | undefined;
      if (playerPosition == null) continue;
      for (const [name, position] of Object.entries(lapData)) {
        if (name === "lap") continue;
        if (Math.abs((position as number) - playerPosition) === 1) {
          neighborNames.add(name);
        }
      }
    }

    visibleDrivers = positionHistory.filter(
      (driver) =>
        driver.name === playerName ||
        driver.name === winnerName ||
        neighborNames.has(driver.name),
    );
  }

  const allPositions = visibleDrivers.flatMap((driver) =>
    driver["driver-position-history"].map((point) => point.position),
  );

  return {
    maxPoints,
    maxLaps,
    data,
    winnerName,
    visibleDrivers,
    maxPosition: Math.max(...allPositions, 1),
  };
}
