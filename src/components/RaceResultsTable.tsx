import { useState, useMemo } from "react";
import {
  buildFallbackRaceRows,
  buildPenaltiesByDriver,
  buildRaceDriverStats,
  buildRaceResultHighlights,
  formatRaceGap,
  formatRaceStrategy,
  sortRaceStintHistoryRows,
  type RaceResultSortKey,
  type SortDirection,
} from "../analysis/resultsAnalysis";
import type { RaceControlEvent, TelemetrySession } from "../types/telemetry";
import { getTeamColor, getTeamName } from "../utils/colors";
import { msToLapTime } from "../utils/format";
import { driverTopSpeed } from "../utils/stats/drivers";
import { RACE_PACE_TOOLTIP } from "../utils/stats/insightTypes";
import { usePlayerOnly } from "../hooks/usePlayerOnly";
import { cn } from "../utils/cn";
import { AlertTriangle, ChevronUp, ChevronDown } from "lucide-react";
import { Tooltip } from "./Tooltip";
import { Badge } from "./ui/Badge";
import { FocusToggle } from "./ui/FocusToggle";
import { ScrollArea } from "./ui/ScrollArea";
import { SectionHeader } from "./ui/SectionHeader";
import {
  tableCellClass,
  tableClass,
  tableHeadCellClass,
  tableHeadClass,
  tableRowClass,
} from "./ui/table";
import { formatPenaltySummary } from "../utils/raceControl";

interface RaceResultsTableProps {
  session: TelemetrySession;
  focusedDriverIndex: number;
  raceControlEvents?: RaceControlEvent[];
}

function SortIcon({
  column,
  sortKey,
  sortDir,
  side = "right",
}: {
  column: RaceResultSortKey;
  sortKey: RaceResultSortKey;
  sortDir: SortDirection;
  side?: "left" | "right";
}) {
  const margin = side === "left" ? "mr-1" : "ml-1";
  if (column !== sortKey)
    return (
      <ChevronDown
        className={cn(
          "inline w-3 h-3",
          margin,
          "opacity-0 group-hover:opacity-30",
        )}
      />
    );
  return sortDir === "asc" ? (
    <ChevronDown className={cn("inline w-3 h-3", margin, "text-active")} />
  ) : (
    <ChevronUp className={cn("inline w-3 h-3", margin, "text-active")} />
  );
}

/**
 * Final classification table for race sessions.
 * Uses tyre-stint-history-v2 when available, falls back to classification-data.
 */
export function RaceResultsTable({
  session,
  focusedDriverIndex,
  raceControlEvents = [],
}: RaceResultsTableProps) {
  const [focusedOnly, toggleFocusedOnly] = usePlayerOnly();
  const [sortKey, setSortKey] = useState<RaceResultSortKey>("pos");
  const [sortDir, setSortDir] = useState<SortDirection>("asc");
  const stintHistory = session["tyre-stint-history-v2"];
  const drivers = session["classification-data"];

  const focusedDriver = drivers.find((d) => d.index === focusedDriverIndex);
  const focusedName = focusedDriver?.["driver-name"];

  const driverStats = useMemo(() => buildRaceDriverStats(drivers), [drivers]);
  const penaltiesByDriver = useMemo(
    () => buildPenaltiesByDriver(raceControlEvents),
    [raceControlEvents],
  );

  const sortedStintHistory = useMemo(() => {
    if (!stintHistory?.length) return [];
    return sortRaceStintHistoryRows({
      entries: stintHistory,
      focusedOnly,
      focusedName,
      sortKey,
      sortDir,
      driverStats,
    });
  }, [driverStats, focusedName, focusedOnly, sortDir, sortKey, stintHistory]);

  function toggleSort(key: RaceResultSortKey) {
    if (sortKey === key) {
      if (sortDir === "asc") {
        setSortDir("desc");
      } else {
        // Third click: reset to default (position)
        setSortKey("pos");
        setSortDir("asc");
      }
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  }

  const thClass = (align: "left" | "right" = "left") =>
    tableHeadCellClass({ align, sortable: true });

  // Use tyre-stint-history-v2 if available (has clean per-driver race results)
  if (stintHistory?.length) {
    const highlights = buildRaceResultHighlights(driverStats);

    return (
      <div>
        <SectionHeader
          size="sm"
          title="Classification"
          action={
            <FocusToggle value={focusedOnly} onChange={toggleFocusedOnly} />
          }
        />
        <ScrollArea axis="x">
          <table className={tableClass}>
            <thead className={tableHeadClass}>
              <tr>
                <th className={thClass()} onClick={() => toggleSort("pos")}>
                  Pos
                  <SortIcon column="pos" sortKey={sortKey} sortDir={sortDir} />
                </th>
                <th className={tableHeadCellClass()}>Driver</th>
                <th className={tableHeadCellClass()}>Team</th>
                <th
                  className={thClass("right")}
                  onClick={() => toggleSort("gap")}
                >
                  <SortIcon
                    column="gap"
                    sortKey={sortKey}
                    sortDir={sortDir}
                    side="left"
                  />
                  Gap
                </th>
                <th
                  className={thClass("right")}
                  onClick={() => toggleSort("bestLap")}
                >
                  <SortIcon
                    column="bestLap"
                    sortKey={sortKey}
                    sortDir={sortDir}
                    side="left"
                  />
                  Best Lap
                </th>
                <th
                  className={thClass("right")}
                  onClick={() => toggleSort("racePace")}
                >
                  <Tooltip text={RACE_PACE_TOOLTIP}>
                    <span>
                      <SortIcon
                        column="racePace"
                        sortKey={sortKey}
                        sortDir={sortDir}
                        side="left"
                      />
                      Race Pace
                    </span>
                  </Tooltip>
                </th>
                <th
                  className={thClass("right")}
                  onClick={() => toggleSort("topSpeed")}
                >
                  <SortIcon
                    column="topSpeed"
                    sortKey={sortKey}
                    sortDir={sortDir}
                    side="left"
                  />
                  Top Speed
                </th>
                <th
                  className={thClass("right")}
                  onClick={() => toggleSort("ers")}
                >
                  <Tooltip text="Average ERS energy deployed per lap (green-flag laps only, excluding first and last lap).">
                    <span>
                      <SortIcon
                        column="ers"
                        sortKey={sortKey}
                        sortDir={sortDir}
                        side="left"
                      />
                      ERS Dep
                    </span>
                  </Tooltip>
                </th>
                {highlights.hasErsHarv && (
                  <th
                    className={thClass("right")}
                    onClick={() => toggleSort("ersHarv")}
                  >
                    <Tooltip text="Average ERS energy harvested per lap, MGU-K + MGU-H combined (green-flag laps only, excluding first and last lap). Higher values indicate more lift-and-coast.">
                      <span>
                        <SortIcon
                          column="ersHarv"
                          sortKey={sortKey}
                          sortDir={sortDir}
                          side="left"
                        />
                        ERS Harv
                      </span>
                    </Tooltip>
                  </th>
                )}
                <th className={tableHeadCellClass({ align: "right" })}>
                  Strategy
                </th>
              </tr>
            </thead>
            <tbody>
              {sortedStintHistory.map((entry) => {
                const isFocused = entry.name === focusedName;
                const status = entry["result-status"];
                const gapStr = formatRaceGap(entry);
                const stintStr = formatRaceStrategy(
                  entry["tyre-stint-history"] ?? [],
                );

                const stats = driverStats.get(entry.name);
                const bestLap = stats?.bestLap ?? 0;
                const racePace = stats?.racePace ?? 0;
                const topSpeed = stats?.topSpeed ?? 0;
                const ers = stats?.ers ?? 0;
                const ersHarv = stats?.ersHarv ?? 0;
                const isBestLap =
                  bestLap > 0 && Math.abs(bestLap - highlights.bestLapMs) < 1;
                const isBestPace =
                  racePace > 0 &&
                  Math.abs(racePace - highlights.bestPaceMs) < 1;
                const isBestSpeed =
                  topSpeed > 0 &&
                  Math.abs(topSpeed - highlights.bestSpeedKmh) < 1;
                const isBestErs =
                  ers > 0 && Math.abs(ers - highlights.bestErs) < 0.1;
                const isBestErsHarv =
                  ersHarv > 0 &&
                  Math.abs(ersHarv - highlights.bestErsHarv) < 0.1;
                const penalties = penaltiesByDriver.get(entry.name) ?? [];

                return (
                  <tr
                    key={`${entry.name}-${entry.team}`}
                    className={cn(
                      tableRowClass,
                      isFocused && "bg-zinc-800/40 text-white font-medium",
                    )}
                  >
                    <td className={tableCellClass()}>{entry.position}</td>
                    <td className={tableCellClass()}>
                      <span
                        className="inline-block w-1 h-3 rounded-sm mr-1.5 align-middle"
                        style={{ backgroundColor: getTeamColor(entry.team) }}
                      />
                      <span className="inline-flex items-center gap-1.5">
                        {entry.name}
                        <PenaltyBadge penalties={penalties} />
                      </span>
                    </td>
                    <td
                      className={tableCellClass({ className: "text-zinc-400" })}
                    >
                      {getTeamName(entry.team)}
                    </td>
                    <td
                      className={cn(
                        tableCellClass({ align: "right", mono: true }),
                        (status === "DNF" || status === "DSQ") && "text-behind",
                      )}
                    >
                      {gapStr}
                    </td>
                    <td
                      className={cn(
                        tableCellClass({ align: "right", mono: true }),
                        isBestLap && "text-best",
                      )}
                    >
                      {bestLap > 0 ? msToLapTime(bestLap) : "–"}
                    </td>
                    <td
                      className={cn(
                        tableCellClass({ align: "right", mono: true }),
                        isBestPace && "text-best",
                      )}
                    >
                      {racePace > 0 ? msToLapTime(racePace) : "–"}
                    </td>
                    <td
                      className={cn(
                        tableCellClass({ align: "right", mono: true }),
                        isBestSpeed && "text-best",
                      )}
                    >
                      {topSpeed > 0 ? `${Math.round(topSpeed)}` : "–"}
                    </td>
                    <td
                      className={cn(
                        tableCellClass({ align: "right", mono: true }),
                        isBestErs && "text-best",
                      )}
                    >
                      {ers > 0 ? ers.toFixed(1) : "–"}
                    </td>
                    {highlights.hasErsHarv && (
                      <td
                        className={cn(
                          tableCellClass({ align: "right", mono: true }),
                          isBestErsHarv && "text-best",
                        )}
                      >
                        {ersHarv > 0 ? ersHarv.toFixed(1) : "–"}
                      </td>
                    )}
                    <td
                      className={tableCellClass({
                        align: "right",
                        className: "text-zinc-400",
                      })}
                    >
                      {stintStr}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </ScrollArea>
      </div>
    );
  }

  // Fallback: use classification-data with final-classification
  const fallbackSorted = buildFallbackRaceRows({
    drivers,
    focusedOnly,
    focusedDriverIndex,
  });

  return (
    <div>
      <SectionHeader
        size="sm"
        title="Classification"
        action={
          <FocusToggle value={focusedOnly} onChange={toggleFocusedOnly} />
        }
      />
      <ScrollArea axis="x">
        <table className={tableClass}>
          <thead className={tableHeadClass}>
            <tr>
              <th className={tableHeadCellClass()}>Pos</th>
              <th className={tableHeadCellClass()}>Driver</th>
              <th className={tableHeadCellClass()}>Team</th>
              <th className={tableHeadCellClass({ align: "right" })}>
                Best Lap
              </th>
              <th className={tableHeadCellClass({ align: "right" })}>
                Top Speed
              </th>
            </tr>
          </thead>
          <tbody>
            {fallbackSorted.map((d) => {
              const fc = d["final-classification"]!;
              const penalties = penaltiesByDriver.get(d["driver-name"]) ?? [];
              return (
                <tr
                  key={d.index}
                  className={cn(
                    tableRowClass,
                    d.index === focusedDriverIndex &&
                      "bg-zinc-800/40 text-white font-medium",
                  )}
                >
                  <td className={tableCellClass()}>{fc.position}</td>
                  <td className={tableCellClass()}>
                    <span
                      className="inline-block w-1 h-3 rounded-sm mr-1.5 align-middle"
                      style={{ backgroundColor: getTeamColor(d.team) }}
                    />
                    <span className="inline-flex items-center gap-1.5">
                      {d["driver-name"]}
                      <PenaltyBadge penalties={penalties} />
                    </span>
                  </td>
                  <td
                    className={tableCellClass({ className: "text-zinc-400" })}
                  >
                    {getTeamName(d.team)}
                  </td>
                  <td
                    className={tableCellClass({ align: "right", mono: true })}
                  >
                    {fc["best-lap-time-str"] || "–"}
                  </td>
                  <td
                    className={tableCellClass({ align: "right", mono: true })}
                  >
                    {driverTopSpeed(d) > 0
                      ? `${Math.round(driverTopSpeed(d))}`
                      : "–"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </ScrollArea>
    </div>
  );
}

function PenaltyBadge({ penalties }: { penalties: RaceControlEvent[] }) {
  if (penalties.length === 0) return null;

  return (
    <Tooltip text={penalties.map(formatPenaltySummary).join(" | ")}>
      <Badge size="xs" shape="square" tone="amber" className="gap-0.5">
        <AlertTriangle className="size-2.5" />
        {penalties.length}
      </Badge>
    </Tooltip>
  );
}
