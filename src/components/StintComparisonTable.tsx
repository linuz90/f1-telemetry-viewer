import type { DriverData } from "../types/telemetry";
import {
  stintWearRate,
  getBestDriverOnCompound,
  medianPaceInRange,
  paceDrop,
  getDriverStints,
} from "../utils/stats";
import { msToLapTime } from "../utils/format";
import { cn } from "../utils/cn";
import { CompoundSwatchLabel } from "./ui/CompoundSwatchLabel";
import { SectionHeader } from "./ui/SectionHeader";
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
 * Per-stint comparison table: player vs best-on-compound driver.
 * Always visible regardless of rival picker selection.
 */
export function StintComparisonTable({
  player,
  allDrivers,
}: StintComparisonTableProps) {
  const stints = getDriverStints(player);
  const playerLaps = player["session-history"]["lap-history-data"];
  const others = allDrivers.filter((d) => d.index !== player.index);

  if (!stints.length) return null;

  return (
    <div>
      <SectionHeader
        size="sm"
        title="Stint Comparison"
        hint="vs best on compound"
      />
      <div className="overflow-x-auto">
        <table className={cn(tableClass, "min-w-[520px]")}>
          <thead className={tableHeadClass}>
            <tr>
              <th className={tableHeadCellClass()}>Stint</th>
              <th className={tableHeadCellClass()}>Compound</th>
              <th className={tableHeadCellClass({ align: "right" })}>Laps</th>
              <th className={tableHeadCellClass({ align: "right" })}>
                Median Pace
              </th>
              <th className={tableHeadCellClass({ align: "right" })}>
                Wear/Lap
              </th>
              <th className={tableHeadCellClass({ align: "right" })}>
                Pace Drop
              </th>
              <th className={tableHeadCellClass()}>vs Best</th>
            </tr>
          </thead>
          <tbody>
            {stints.map((stint, i) => {
              const compound = stint["tyre-set-data"]["visual-tyre-compound"];
              const playerRate = stintWearRate(stint);
              const best = getBestDriverOnCompound(
                others,
                compound,
                stint["start-lap"],
                stint["end-lap"],
              );

              const compareStartLap = best?.lapStart ?? stint["start-lap"];
              const compareEndLap = best?.lapEnd ?? stint["end-lap"];
              const playerPace = medianPaceInRange(
                playerLaps,
                compareStartLap,
                compareEndLap,
              );
              const playerDrop = paceDrop(
                playerLaps,
                compareStartLap,
                compareEndLap,
              );

              const bestPace = best?.paceMs ?? 0;
              const bestDrop = best
                ? paceDrop(
                    best.driver["session-history"]["lap-history-data"],
                    best.lapStart,
                    best.lapEnd,
                  )
                : 0;

              const wearDelta =
                best && playerRate > 0 && best.wearRate > 0
                  ? playerRate - best.wearRate
                  : 0;
              const paceDelta =
                playerPace > 0 && bestPace > 0 ? playerPace - bestPace : 0;
              const dropDelta =
                playerDrop !== 0 && bestDrop !== 0 ? playerDrop - bestDrop : 0;

              return (
                <tr key={i} className={tableRowClass}>
                  <td
                    className={tableCellClass({
                      className: "font-medium text-zinc-300",
                    })}
                  >
                    {i + 1}
                  </td>
                  <td className={tableCellClass()}>
                    <CompoundSwatchLabel compound={compound} />
                  </td>
                  <td
                    className={tableCellClass({
                      align: "right",
                      mono: true,
                      className: "text-zinc-300",
                    })}
                  >
                    {stint["stint-length"]}
                  </td>
                  <td
                    className={tableCellClass({ align: "right", mono: true })}
                  >
                    <span className="text-zinc-300">
                      {playerPace > 0 ? msToLapTime(playerPace) : "–"}
                    </span>
                    {paceDelta !== 0 && (
                      <Delta value={paceDelta} unit="s" factor={1000} />
                    )}
                  </td>
                  <td
                    className={tableCellClass({ align: "right", mono: true })}
                  >
                    <span className="text-zinc-300">
                      {playerRate > 0 ? `${playerRate.toFixed(1)}%` : "–"}
                    </span>
                    {wearDelta !== 0 && <Delta value={wearDelta} unit="%" />}
                  </td>
                  <td
                    className={tableCellClass({ align: "right", mono: true })}
                  >
                    <span className="text-zinc-300">
                      {playerDrop !== 0
                        ? `${playerDrop > 0 ? "+" : ""}${(playerDrop / 1000).toFixed(3)}s`
                        : "–"}
                    </span>
                    {dropDelta !== 0 && (
                      <Delta value={dropDelta} unit="s" factor={1000} />
                    )}
                  </td>
                  <td
                    className={tableCellClass({
                      className: "text-2xs text-zinc-500",
                    })}
                  >
                    {best
                      ? `${best.driver["driver-name"]} L${best.lapStart}-${best.lapEnd}`
                      : "–"}
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
