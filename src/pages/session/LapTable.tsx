import type {
  DriverLapSeries,
  DriverLapEvent,
} from "../../analysis/lapChartModel";
import type { DriverData } from "../../types/telemetry";
import { msToLapTime, sectorTimeMs } from "../../utils/format";
import { getCompoundColor } from "../../utils/colors";
import { cn } from "../../utils/cn";

/**
 * The lap chart's table view: every lap with its position, time, sectors,
 * tyre, wear and why it is or isn't counted. No number is hover-only.
 */
export function LapTable({
  driver,
  series,
  trace,
  events = [],
  bestMs,
}: {
  driver: DriverData;
  series: DriverLapSeries;
  trace?: number[];
  events?: DriverLapEvent[];
  bestMs?: number;
}) {
  const laps = driver["session-history"]["lap-history-data"];
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-tone-500">
            <th className="py-2 pr-3 font-normal">Lap</th>
            {trace && <th className="py-2 pr-3 font-normal">Pos</th>}
            <th className="py-2 pr-3 text-right font-normal">Time</th>
            <th className="py-2 pr-3 text-right font-normal">S1</th>
            <th className="py-2 pr-3 text-right font-normal">S2</th>
            <th className="py-2 pr-3 text-right font-normal">S3</th>
            <th className="py-2 pr-3 font-normal">Tyre</th>
            <th className="py-2 pr-3 text-right font-normal">Wear</th>
            <th className="py-2 font-normal">Note</th>
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
            return (
              <tr key={lapNumber} className="border-t border-tone-800/70">
                <td className="py-1.5 pr-3 text-tone-400">{lapNumber}</td>
                {trace && (
                  <td className="py-1.5 pr-3 text-tone-200">
                    {trace[lapNumber] ? `P${trace[lapNumber]}` : "–"}
                  </td>
                )}
                <td
                  className={cn(
                    "py-1.5 pr-3 text-right font-mono",
                    isBest
                      ? "text-best"
                      : reason
                        ? "text-tone-500"
                        : "text-tone-100",
                  )}
                >
                  {ms ? msToLapTime(ms) : "–"}
                </td>
                {([1, 2, 3] as const).map((sector) => (
                  <td
                    key={sector}
                    className="py-1.5 pr-3 text-right font-mono text-tone-400"
                  >
                    {sectorTimeMs(lap, sector) > 0
                      ? (sectorTimeMs(lap, sector) / 1000).toFixed(3)
                      : "–"}
                  </td>
                ))}
                <td className="py-1.5 pr-3">
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
                <td className="py-1.5 pr-3 text-right text-tone-400">
                  {wear != null ? `${Math.round(wear)}%` : ""}
                </td>
                <td className="py-1.5 text-xs text-tone-500">
                  {notes.join(" · ")}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
