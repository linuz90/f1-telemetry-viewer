import type { DriverData } from "../types/telemetry";
import { buildStintComparisonRows } from "../analysis/resultsAnalysis";
import { msToLapTime } from "../utils/format";
import { cn } from "../utils/cn";
import { CompoundSwatchLabel } from "./ui/CompoundSwatchLabel";
import { ScrollArea } from "./ui/ScrollArea";
import {
  tableCellClass,
  tableClass,
  tableHeadCellClass,
  tableHeadClass,
  tableRowClass,
} from "./ui/table";

interface StintComparisonTableProps {
  player: DriverData;
  allDrivers: DriverData[];
}

/**
 * Per-stint comparison: each of your stints against the best stint on the
 * same compound. The page's panel supplies the title.
 */
export function StintComparisonTable({
  player,
  allDrivers,
}: StintComparisonTableProps) {
  const rows = buildStintComparisonRows({ player, allDrivers });
  if (!rows.length) return null;

  return (
    <div>
      <ScrollArea axis="x">
        <table className={cn(tableClass, "min-w-[520px]")}>
          <thead className={tableHeadClass}>
            <tr>
              <th className={tableHeadCellClass()}>Stint</th>
              <th className={tableHeadCellClass()}>Compound</th>
              <th className={tableHeadCellClass({ align: "right" })}>Laps</th>
              <th className={tableHeadCellClass({ align: "right" })}>
                Median pace
              </th>
              <th className={tableHeadCellClass({ align: "right" })}>
                Wear a lap
              </th>
              <th className={tableHeadCellClass({ align: "right" })}>
                Pace drop
              </th>
              <th className={tableHeadCellClass()}>Best on compound</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              return (
                <tr key={row.stintNumber} className={tableRowClass}>
                  <td
                    className={tableCellClass({
                      className: "font-medium text-tone-300",
                    })}
                  >
                    {row.stintNumber}
                  </td>
                  <td className={tableCellClass()}>
                    <CompoundSwatchLabel compound={row.compound} />
                  </td>
                  <td
                    className={tableCellClass({
                      align: "right",
                      mono: true,
                      className: "text-tone-300",
                    })}
                  >
                    {row.stint["stint-length"]}
                  </td>
                  <td
                    className={tableCellClass({ align: "right", mono: true })}
                  >
                    <span className="text-tone-300">
                      {row.playerPace > 0 ? msToLapTime(row.playerPace) : "–"}
                    </span>
                    {row.paceDelta !== 0 && (
                      <Delta value={row.paceDelta} unit="s" factor={1000} />
                    )}
                  </td>
                  <td
                    className={tableCellClass({ align: "right", mono: true })}
                  >
                    <span className="text-tone-300">
                      {row.playerWearRate > 0
                        ? `${row.playerWearRate.toFixed(1)}%`
                        : "–"}
                    </span>
                    {row.wearDelta !== 0 && (
                      <Delta value={row.wearDelta} unit="%" />
                    )}
                  </td>
                  <td
                    className={tableCellClass({ align: "right", mono: true })}
                  >
                    <span className="text-tone-300">
                      {row.playerDrop !== 0
                        ? `${row.playerDrop > 0 ? "+" : ""}${(row.playerDrop / 1000).toFixed(3)}s`
                        : "–"}
                    </span>
                    {row.dropDelta !== 0 && (
                      <Delta value={row.dropDelta} unit="s" factor={1000} />
                    )}
                  </td>
                  <td
                    className={tableCellClass({
                      className: "text-2xs text-tone-500",
                    })}
                  >
                    {row.bestDriverName
                      ? `${row.bestDriverName} L${row.bestLapStart}-${row.bestLapEnd}`
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

function Delta({
  value,
  unit,
  factor = 1,
}: {
  value: number;
  unit: string;
  factor?: number;
}) {
  const display = factor > 1 ? value / factor : value;
  if (Math.abs(display) < 0.001) return null;
  const positive = display > 0;
  return (
    <span
      className={cn("ml-1.5 text-2xs", positive ? "text-behind" : "text-ahead")}
    >
      {positive ? "+" : ""}
      {display.toFixed(unit === "%" ? 1 : 3)}
      {unit}
    </span>
  );
}
