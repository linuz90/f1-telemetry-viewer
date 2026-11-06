import type {
  DriverLapSeries,
  DriverLapEvent,
} from "../../analysis/lapChartModel";
import { Link } from "react-router-dom";
import type { DriverData } from "../../types/telemetry";
import type { StintCompareLaps } from "../../analysis/stintCompare";
import {
  paceTone,
  signedPercent,
  signedSeconds,
  wearTone,
} from "../../components/session/StintCompare";
import { msToLapTime, sectorTimeMs } from "../../utils/format";
import { getCompoundColor } from "../../utils/colors";
import { cn } from "../../utils/cn";
import {
  tableCellClass,
  tableClass,
  tableHeadCellClass,
  tableHeadClass,
  tableRowClass,
} from "../../components/ui/table";

/** A compared stint laid on this session's laps (`placeComparisonOnLaps`). */
export interface LapTableCompare {
  label: string;
  laps: StintCompareLaps;
  /** Opens this lap and its pair in Lap telemetry, when both are recorded. */
  telemetryHref?: (lap: number) => string | undefined;
}

/**
 * The lap chart's table view: every lap with its position, time, sectors,
 * tyre, wear and why it is or isn't counted. No number is hover-only. With a
 * compared stint, each lap also shows the other stint's lap at the same tyre
 * age, the delta, the running gap and the wear difference.
 */
export function LapTable({
  driver,
  series,
  trace,
  events = [],
  bestMs,
  compare,
}: {
  driver: DriverData;
  series: DriverLapSeries;
  trace?: number[];
  events?: DriverLapEvent[];
  bestMs?: number;
  compare?: LapTableCompare;
}) {
  const laps = driver["session-history"]["lap-history-data"];
  return (
    <div className="overflow-x-auto">
      <table className={tableClass}>
        <thead className={tableHeadClass}>
          <tr>
            <th className={tableHeadCellClass({ layout: "flush" })}>Lap</th>
            {trace && (
              <th className={tableHeadCellClass({ layout: "flush" })}>Pos</th>
            )}
            <th
              className={tableHeadCellClass({
                align: "right",
                layout: "flush",
              })}
            >
              Time
            </th>
            {compare && (
              <>
                <th
                  className={tableHeadCellClass({
                    align: "right",
                    layout: "flush",
                    className: "whitespace-nowrap text-chart-compare",
                  })}
                >
                  {compare.label}
                </th>
                <th
                  className={tableHeadCellClass({
                    align: "right",
                    layout: "flush",
                  })}
                >
                  Δ
                </th>
                <th
                  className={tableHeadCellClass({
                    align: "right",
                    layout: "flush",
                  })}
                >
                  Gap
                </th>
              </>
            )}
            <th
              className={tableHeadCellClass({
                align: "right",
                layout: "flush",
              })}
            >
              S1
            </th>
            <th
              className={tableHeadCellClass({
                align: "right",
                layout: "flush",
              })}
            >
              S2
            </th>
            <th
              className={tableHeadCellClass({
                align: "right",
                layout: "flush",
              })}
            >
              S3
            </th>
            <th className={tableHeadCellClass({ layout: "flush" })}>Tyre</th>
            <th
              className={tableHeadCellClass({
                align: "right",
                layout: "flush",
              })}
            >
              Wear
            </th>
            <th className={tableHeadCellClass({ layout: "flush" })}>Note</th>
          </tr>
        </thead>
        <tbody className="tabular-nums">
          {laps.map((lap, index) => {
            const lapNumber = index + 1;
            const ms = series.lapsMs[index];
            const reason = series.excluded.get(lapNumber);
            const compound = series.compoundByLap.get(lapNumber);
            const wear = series.wear[index];
            const notes = [
              reason ? `not counted: ${reason}` : null,
              ...events.filter((e) => e.lap === lapNumber).map((e) => e.text),
            ].filter(Boolean);
            const isBest = ms != null && bestMs != null && ms === bestMs;
            const other = compare?.laps.lapsMs[index];
            const delta = compare?.laps.deltaMs[index];
            const gap = compare?.laps.gapMs[index];
            const wearDelta = compare?.laps.wearDelta[index];
            const href =
              delta != null ? compare?.telemetryHref?.(lapNumber) : undefined;
            return (
              <tr key={lapNumber} className={cn(tableRowClass, "group")}>
                <td
                  className={tableCellClass({
                    size: "sm",
                    layout: "flush",
                    className: "text-tone-400",
                  })}
                >
                  {lapNumber}
                </td>
                {trace && (
                  <td
                    className={tableCellClass({
                      size: "sm",
                      layout: "flush",
                      className: "text-tone-200",
                    })}
                  >
                    {trace[lapNumber] ? `P${trace[lapNumber]}` : "–"}
                  </td>
                )}
                <td
                  className={tableCellClass({
                    align: "right",
                    mono: true,
                    size: "sm",
                    layout: "flush",
                    className: isBest
                      ? "text-best"
                      : reason
                        ? "text-tone-500"
                        : "text-tone-100",
                  })}
                >
                  {ms ? msToLapTime(ms) : "–"}
                </td>
                {compare && (
                  <>
                    <td
                      className={tableCellClass({
                        align: "right",
                        mono: true,
                        size: "sm",
                        layout: "flush",
                        className: compare.laps.excluded.has(lapNumber)
                          ? "text-tone-600"
                          : "text-tone-400",
                      })}
                    >
                      {other ? msToLapTime(other) : ""}
                    </td>
                    <td
                      className={tableCellClass({
                        align: "right",
                        mono: true,
                        size: "sm",
                        layout: "flush",
                        className: paceTone(delta),
                      })}
                    >
                      {delta != null ? signedSeconds(delta) : ""}
                    </td>
                    <td
                      className={tableCellClass({
                        align: "right",
                        mono: true,
                        size: "sm",
                        layout: "flush",
                        className: paceTone(gap),
                      })}
                    >
                      {gap != null ? signedSeconds(gap, 2) : ""}
                    </td>
                  </>
                )}
                {([1, 2, 3] as const).map((sector) => (
                  <td
                    key={sector}
                    className={tableCellClass({
                      align: "right",
                      mono: true,
                      size: "sm",
                      layout: "flush",
                      className: "text-tone-400",
                    })}
                  >
                    {sectorTimeMs(lap, sector) > 0
                      ? (sectorTimeMs(lap, sector) / 1000).toFixed(3)
                      : "–"}
                  </td>
                ))}
                <td className={tableCellClass({ size: "sm", layout: "flush" })}>
                  {compound && (
                    <span className="inline-flex items-center gap-1.5 text-tone-300">
                      <span
                        className="size-2 rounded-full"
                        style={{ backgroundColor: getCompoundColor(compound) }}
                      />
                      {compound}
                    </span>
                  )}
                </td>
                <td
                  className={tableCellClass({
                    align: "right",
                    size: "sm",
                    layout: "flush",
                    className: "whitespace-nowrap text-tone-400",
                  })}
                >
                  {wear != null ? `${Math.round(wear)}%` : ""}
                  {wearDelta != null && (
                    <span
                      className={cn("ml-1.5 text-[11px]", wearTone(wearDelta))}
                      title={`Worst-wheel wear against ${compare!.label} at the same tyre age`}
                    >
                      {signedPercent(wearDelta)}
                    </span>
                  )}
                </td>
                <td
                  className={tableCellClass({
                    size: "sm",
                    layout: "flush",
                    className: "text-xs text-tone-500",
                  })}
                >
                  {notes.join(" · ")}
                  {href && (
                    <Link
                      to={href}
                      className="ml-2 whitespace-nowrap text-active sm:opacity-0 sm:group-hover:opacity-100 sm:focus-visible:opacity-100"
                    >
                      Lap telemetry ↗
                    </Link>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
