import type { LapHistoryEntry, TyreStint } from "../types/telemetry";
import {
  filterOutlierLaps,
  getBestLapTime,
  medianLapTimeMs,
} from "../utils/stats";
import { msToLapTime } from "../utils/format";
import { CompoundSwatchLabel } from "./ui/CompoundSwatchLabel";
import { SectionHeader } from "./ui/SectionHeader";
import {
  tableCellClass,
  tableClass,
  tableHeadCellClass,
  tableHeadClass,
  tableRowClass,
} from "./ui/table";
import { cn } from "../utils/cn";

interface CompoundLapComparisonProps {
  playerStints: TyreStint[];
  playerLaps: LapHistoryEntry[];
  rivalStints: TyreStint[];
  rivalLaps: LapHistoryEntry[];
  rivalName: string;
}

interface CompoundStats {
  compound: string;
  playerMedian: number;
  rivalMedian: number;
  playerBest: number;
  rivalBest: number;
  playerLapCount: number;
  rivalLapCount: number;
}

function getLapsForStint(
  allLaps: LapHistoryEntry[],
  stint: TyreStint,
): LapHistoryEntry[] {
  return allLaps.slice(stint["start-lap"] - 1, stint["end-lap"]);
}

export function CompoundLapComparison({
  playerStints,
  playerLaps,
  rivalStints,
  rivalLaps,
  rivalName,
}: CompoundLapComparisonProps) {
  // Group valid laps by compound for each driver
  const playerByCompound = new Map<string, LapHistoryEntry[]>();
  for (const stint of playerStints) {
    const compound = stint["tyre-set-data"]["visual-tyre-compound"];
    const laps = filterOutlierLaps(getLapsForStint(playerLaps, stint));
    const existing = playerByCompound.get(compound) ?? [];
    playerByCompound.set(compound, [...existing, ...laps]);
  }

  const rivalByCompound = new Map<string, LapHistoryEntry[]>();
  for (const stint of rivalStints) {
    const compound = stint["tyre-set-data"]["visual-tyre-compound"];
    const laps = filterOutlierLaps(getLapsForStint(rivalLaps, stint));
    const existing = rivalByCompound.get(compound) ?? [];
    rivalByCompound.set(compound, [...existing, ...laps]);
  }

  // Build stats for compounds used by both drivers
  const compounds = [...new Set([...playerByCompound.keys()])].filter((c) =>
    rivalByCompound.has(c),
  );

  if (compounds.length === 0) return null;

  const stats: CompoundStats[] = compounds.map((compound) => {
    const pLaps = playerByCompound.get(compound)!;
    const rLaps = rivalByCompound.get(compound)!;
    return {
      compound,
      playerMedian: medianLapTimeMs(pLaps),
      rivalMedian: medianLapTimeMs(rLaps),
      playerBest: getBestLapTime(pLaps),
      rivalBest: getBestLapTime(rLaps),
      playerLapCount: pLaps.length,
      rivalLapCount: rLaps.length,
    };
  });

  return (
    <div>
      <SectionHeader
        size="sm"
        title="Compound Comparison"
        hint={`vs ${rivalName}`}
      />
      <div className="overflow-x-auto">
        <table className={tableClass}>
          <thead className={tableHeadClass}>
            <tr>
              <th className={tableHeadCellClass()}>Compound</th>
              <th className={tableHeadCellClass({ align: "right" })}>
                Your Median
              </th>
              <th className={tableHeadCellClass({ align: "right" })}>
                Rival Median
              </th>
              <th className={tableHeadCellClass({ align: "right" })}>Delta</th>
              <th className={tableHeadCellClass({ align: "right" })}>
                Your Best
              </th>
              <th className={tableHeadCellClass({ align: "right" })}>
                Rival Best
              </th>
              <th className={tableHeadCellClass({ align: "right" })}>Laps</th>
            </tr>
          </thead>
          <tbody>
            {stats.map((s) => {
              const delta = (s.playerMedian - s.rivalMedian) / 1000;
              const positive = delta > 0;
              return (
                <tr key={s.compound} className={tableRowClass}>
                  <td className={tableCellClass()}>
                    <CompoundSwatchLabel compound={s.compound} />
                  </td>
                  <td
                    className={tableCellClass({
                      align: "right",
                      mono: true,
                      className: "text-zinc-300",
                    })}
                  >
                    {msToLapTime(s.playerMedian)}
                  </td>
                  <td
                    className={tableCellClass({
                      align: "right",
                      mono: true,
                      className: "text-zinc-300",
                    })}
                  >
                    {msToLapTime(s.rivalMedian)}
                  </td>
                  <td
                    className={cn(
                      tableCellClass({
                        align: "right",
                        mono: true,
                        className: "font-bold",
                      }),
                      Math.abs(delta) < 0.001
                        ? "text-zinc-400"
                        : positive
                          ? "text-behind"
                          : "text-ahead",
                    )}
                  >
                    {delta <= 0 ? "" : "+"}
                    {delta.toFixed(3)}s
                  </td>
                  <td
                    className={tableCellClass({
                      align: "right",
                      mono: true,
                      className: "text-zinc-400",
                    })}
                  >
                    {msToLapTime(s.playerBest)}
                  </td>
                  <td
                    className={tableCellClass({
                      align: "right",
                      mono: true,
                      className: "text-zinc-400",
                    })}
                  >
                    {msToLapTime(s.rivalBest)}
                  </td>
                  <td
                    className={tableCellClass({
                      align: "right",
                      mono: true,
                      className: "text-zinc-500",
                    })}
                  >
                    {s.playerLapCount} / {s.rivalLapCount}
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
