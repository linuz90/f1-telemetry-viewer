import type { DriverData } from "../types/telemetry";
import {
  stintWearRate,
  getBestDriverOnCompound,
  avgPaceInRange,
  paceDrop,
} from "../utils/stats";
import { msToLapTime } from "../utils/format";
import { getCompoundColor } from "../utils/colors";

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
  const stints = player["tyre-set-history"];
  const playerLaps = player["session-history"]["lap-history-data"];
  const others = allDrivers.filter((d) => d.index !== player.index);

  if (!stints.length) return null;

  return (
    <div>
      <h3 className="text-sm font-semibold text-zinc-300 mb-2">
        Stint Comparison{" "}
        <span className="font-normal text-zinc-500">vs best on compound</span>
      </h3>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="text-zinc-500">
            <tr>
              <th className="text-left py-1.5 px-2">Stint</th>
              <th className="text-left py-1.5 px-2">Compound</th>
              <th className="text-right py-1.5 px-2">Laps</th>
              <th className="text-right py-1.5 px-2">Avg Pace</th>
              <th className="text-right py-1.5 px-2">Wear/Lap</th>
              <th className="text-right py-1.5 px-2">Pace Drop</th>
              <th className="text-left py-1.5 px-2">vs Best</th>
            </tr>
          </thead>
          <tbody>
            {stints.map((stint, i) => {
              const compound =
                stint["tyre-set-data"]["visual-tyre-compound"];
              const playerRate = stintWearRate(stint);
              const playerPace = avgPaceInRange(
                playerLaps,
                stint["start-lap"],
                stint["end-lap"],
              );
              const playerDrop = paceDrop(
                playerLaps,
                stint["start-lap"],
                stint["end-lap"],
              );

              const best = getBestDriverOnCompound(
                others,
                compound,
                stint["start-lap"],
                stint["end-lap"],
              );

              const bestPace = best
                ? avgPaceInRange(
                    best.driver["session-history"]["lap-history-data"],
                    best.stint["start-lap"],
                    best.stint["end-lap"],
                  )
                : 0;
              const bestDrop = best
                ? paceDrop(
                    best.driver["session-history"]["lap-history-data"],
                    best.stint["start-lap"],
                    best.stint["end-lap"],
                  )
                : 0;

              const wearDelta = best ? playerRate - best.wearRate : 0;
              const paceDelta = bestPace > 0 ? playerPace - bestPace : 0;
              const dropDelta = bestDrop !== 0 ? playerDrop - bestDrop : 0;

              return (
                <tr
                  key={i}
                  className="border-t border-zinc-800/50"
                >
                  <td className="py-1.5 px-2 font-medium text-zinc-300">
                    {i + 1}
                  </td>
                  <td className="py-1.5 px-2">
                    <span className="flex items-center gap-1.5">
                      <span
                        className="w-2 h-2 rounded-sm inline-block"
                        style={{ backgroundColor: getCompoundColor(compound) }}
                      />
                      <span className="text-zinc-300">{compound}</span>
                    </span>
                  </td>
                  <td className="text-right py-1.5 px-2 text-zinc-300 font-mono">
                    {stint["stint-length"]}
                  </td>
                  <td className="text-right py-1.5 px-2 font-mono">
                    <span className="text-zinc-300">
                      {playerPace > 0 ? msToLapTime(playerPace) : "–"}
                    </span>
                    {bestPace > 0 && (
                      <Delta value={paceDelta} unit="s" factor={1000} />
                    )}
                  </td>
                  <td className="text-right py-1.5 px-2 font-mono">
                    <span className="text-zinc-300">
                      {playerRate > 0 ? `${playerRate.toFixed(1)}%` : "–"}
                    </span>
                    {best && <Delta value={wearDelta} unit="%" />}
                  </td>
                  <td className="text-right py-1.5 px-2 font-mono">
                    <span className="text-zinc-300">
                      {playerDrop !== 0
                        ? `${playerDrop > 0 ? "+" : ""}${(playerDrop / 1000).toFixed(3)}s`
                        : "–"}
                    </span>
                    {bestDrop !== 0 && (
                      <Delta value={dropDelta} unit="s" factor={1000} />
                    )}
                  </td>
                  <td className="text-left py-1.5 px-2 text-zinc-500 text-[10px]">
                    {best ? best.driver["driver-name"] : "–"}
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
      className={`ml-1.5 text-[10px] ${positive ? "text-red-400" : "text-emerald-400"}`}
    >
      {positive ? "+" : ""}
      {display.toFixed(unit === "%" ? 1 : 3)}
      {unit}
    </span>
  );
}
