import { buildQualifyingTableModel } from "../analysis/resultsAnalysis";
import type { TelemetrySession } from "../types/telemetry";
import { usePlayerOnly } from "../hooks/usePlayerOnly";
import { msToLapTime, msToSectorTime } from "../utils/format";
import { getTeamColor, getTeamName } from "../utils/colors";
import { cn } from "../utils/cn";
import { formatQualifyingTableTitle } from "../analysis/sessionInsightSummary";
import { FocusToggle } from "./ui/FocusToggle";
import { SectionHeader } from "./ui/SectionHeader";
import {
  tableCellClass,
  tableClassLoose,
  tableHeadCellClass,
  tableHeadClass,
  tableRowClass,
} from "./ui/table";

interface QualifyingTableProps {
  session: TelemetrySession;
  focusedDriverIndex: number;
}

/**
 * Qualifying results table: all drivers ranked by best valid lap.
 */
export function QualifyingTable({
  session,
  focusedDriverIndex,
}: QualifyingTableProps) {
  const [focusedOnly, toggleFocusedOnly] = usePlayerOnly();
  const model = buildQualifyingTableModel({
    session,
    focusedOnly,
    focusedDriverIndex,
  });

  return (
    <div>
      <SectionHeader
        size="sm"
        title={formatQualifyingTableTitle(session)}
        action={
          <FocusToggle value={focusedOnly} onChange={toggleFocusedOnly} />
        }
      />
      <div className="overflow-x-auto">
        <table className={tableClassLoose}>
          <thead className={tableHeadClass}>
            <tr>
              <th className={tableHeadCellClass()}>Pos</th>
              <th className={tableHeadCellClass()}>Driver</th>
              <th className={tableHeadCellClass()}>Team</th>
              <th className={tableHeadCellClass({ align: "right" })}>
                Best Lap
              </th>
              <th className={tableHeadCellClass({ align: "right" })}>S1</th>
              <th className={tableHeadCellClass({ align: "right" })}>S2</th>
              <th className={tableHeadCellClass({ align: "right" })}>S3</th>
              <th className={tableHeadCellClass({ align: "right" })}>Gap</th>
            </tr>
          </thead>
          <tbody>
            {model.rows.map((row) => {
              const isFocused = row.driver.index === focusedDriverIndex;
              const [rowS1, rowS2, rowS3] = row.sectorTimes;
              const gap =
                row.position === 1
                  ? "–"
                  : row.bestTime === Infinity
                    ? row.allInvalid
                      ? "ALL INVALID"
                      : "NO TIME"
                    : `+${((row.bestTime - model.p1Time) / 1000).toFixed(3)}`;

              return (
                <tr
                  key={row.driver.index}
                  className={cn(
                    tableRowClass,
                    isFocused && "bg-zinc-800/40 text-white font-medium",
                  )}
                >
                  <td className={tableCellClass()}>{row.position}</td>
                  <td className={tableCellClass()}>
                    <span
                      className="inline-block w-1 h-3 rounded-sm mr-1.5 align-middle"
                      style={{ backgroundColor: getTeamColor(row.driver.team) }}
                    />
                    {row.driver["driver-name"]}
                  </td>
                  <td
                    className={tableCellClass({ className: "text-zinc-400" })}
                  >
                    {getTeamName(row.driver.team)}
                  </td>
                  <td
                    className={cn(
                      tableCellClass({ align: "right", mono: true }),
                      row.bestLap &&
                        model.bestLapTime !== null &&
                        row.bestLap["lap-time-in-ms"] === model.bestLapTime &&
                        "text-best font-bold",
                    )}
                  >
                    {row.bestLap
                      ? msToLapTime(row.bestLap["lap-time-in-ms"])
                      : "–"}
                  </td>
                  <td
                    className={cn(
                      tableCellClass({ align: "right", mono: true }),
                      row.bestLap &&
                        model.bestS1 !== null &&
                        rowS1 === model.bestS1
                        ? "text-best font-bold"
                        : "text-zinc-400",
                    )}
                  >
                    {row.bestLap ? msToSectorTime(rowS1) : "–"}
                  </td>
                  <td
                    className={cn(
                      tableCellClass({ align: "right", mono: true }),
                      row.bestLap &&
                        model.bestS2 !== null &&
                        rowS2 === model.bestS2
                        ? "text-best font-bold"
                        : "text-zinc-400",
                    )}
                  >
                    {row.bestLap ? msToSectorTime(rowS2) : "–"}
                  </td>
                  <td
                    className={cn(
                      tableCellClass({ align: "right", mono: true }),
                      row.bestLap &&
                        model.bestS3 !== null &&
                        rowS3 === model.bestS3
                        ? "text-best font-bold"
                        : "text-zinc-400",
                    )}
                  >
                    {row.bestLap ? msToSectorTime(rowS3) : "–"}
                  </td>
                  <td
                    className={cn(
                      tableCellClass({ align: "right", mono: true }),
                      row.allInvalid && "text-behind",
                    )}
                  >
                    {gap}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
