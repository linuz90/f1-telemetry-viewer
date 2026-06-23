import type { LapHistoryEntry, TyreStint } from "../types/telemetry";
import { buildCompoundLapComparisonRows } from "../analysis/resultsAnalysis";
import { msToLapTime } from "../utils/format";
import { CompoundSwatchLabel } from "./ui/CompoundSwatchLabel";
import { ScrollArea } from "./ui/ScrollArea";
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

export function CompoundLapComparison({
  playerStints,
  playerLaps,
  rivalStints,
  rivalLaps,
  rivalName,
}: CompoundLapComparisonProps) {
  const rows = buildCompoundLapComparisonRows({
    playerStints,
    playerLaps,
    rivalStints,
    rivalLaps,
  });
  if (rows.length === 0) return null;

  return (
    <div>
      <SectionHeader
        size="sm"
        title="Compound Comparison"
        hint={`vs ${rivalName}`}
      />
      <ScrollArea axis="x">
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
            {rows.map((s) => {
              const positive = s.deltaSeconds > 0;
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
                      Math.abs(s.deltaSeconds) < 0.001
                        ? "text-zinc-400"
                        : positive
                          ? "text-behind"
                          : "text-ahead",
                    )}
                  >
                    {s.deltaSeconds <= 0 ? "" : "+"}
                    {s.deltaSeconds.toFixed(3)}s
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
      </ScrollArea>
    </div>
  );
}
