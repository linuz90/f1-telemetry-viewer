import type { TelemetrySession, DriverData } from "../types/telemetry";
import { usePlayerOnly } from "../hooks/usePlayerOnly";
import { bestSectorTimeMs, msToLapTime, msToSectorTime, sectorTimeMs } from "../utils/format";
import { getTeamColor, getTeamName } from "../utils/colors";
import { getValidLaps } from "../utils/stats";
import { cn } from "../utils/cn";
import { FocusToggle } from "./ui/FocusToggle";
import { tableHeadClass, tableRowClass } from "./ui/table";

interface QualifyingTableProps {
  session: TelemetrySession;
  focusedDriverIndex: number;
}

/** Get the best lap entry for a driver */
function driverBestLap(driver: DriverData) {
  const laps = driver["session-history"]["lap-history-data"];
  const valid = getValidLaps(laps);
  if (!valid.length) return null;
  return valid.reduce((best, l) =>
    l["lap-time-in-ms"] < best["lap-time-in-ms"] ? l : best,
  );
}

/** Check if driver has laps but all are invalid */
function hasOnlyInvalidLaps(driver: DriverData): boolean {
  const laps = driver["session-history"]["lap-history-data"];
  const withTime = laps.filter((l) => l["lap-time-in-ms"] > 0);
  if (!withTime.length) return false;
  return getValidLaps(laps).length === 0;
}

/**
 * Qualifying results table: all drivers ranked by best valid lap.
 */
export function QualifyingTable({ session, focusedDriverIndex }: QualifyingTableProps) {
  const [focusedOnly, toggleFocusedOnly] = usePlayerOnly();
  const drivers = session["classification-data"];

  // Build rows with best lap data
  const rows = drivers
    .map((d) => {
      const best = driverBestLap(d);
      return {
        driver: d,
        bestLap: best,
        bestTime: best?.["lap-time-in-ms"] ?? Infinity,
        allInvalid: hasOnlyInvalidLaps(d),
      };
    })
    .filter((r) => r.bestLap || r.allInvalid)
    .filter((r) => !focusedOnly || r.driver.index === focusedDriverIndex)
    .sort((a, b) => a.bestTime - b.bestTime);

  const p1Time = rows[0]?.bestTime ?? 0;

  // Compute overall best sector times and best lap for purple highlighting
  const allBestLaps = rows.filter((r) => r.bestLap).map((r) => r.bestLap!);
  const bestLapTime = allBestLaps.length
    ? Math.min(...allBestLaps.map((l) => l["lap-time-in-ms"]))
    : null;
  const bestS1 = allBestLaps.length
    ? bestSectorTimeMs(allBestLaps, 1) || null
    : null;
  const bestS2 = allBestLaps.length
    ? bestSectorTimeMs(allBestLaps, 2) || null
    : null;
  const bestS3 = allBestLaps.length
    ? bestSectorTimeMs(allBestLaps, 3) || null
    : null;

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-base font-semibold text-zinc-300">
          Qualifying Results
        </h3>
        <FocusToggle value={focusedOnly} onChange={toggleFocusedOnly} />
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className={tableHeadClass}>
            <tr>
              <th className="text-left py-1.5 px-2">Pos</th>
              <th className="text-left py-1.5 px-2">Driver</th>
              <th className="text-left py-1.5 px-2">Team</th>
              <th className="text-right py-1.5 px-2">Best Lap</th>
              <th className="text-right py-1.5 px-2">S1</th>
              <th className="text-right py-1.5 px-2">S2</th>
              <th className="text-right py-1.5 px-2">S3</th>
              <th className="text-right py-1.5 px-2">Gap</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => {
              const isFocused = row.driver.index === focusedDriverIndex;
              const rowS1 = row.bestLap ? sectorTimeMs(row.bestLap, 1) : 0;
              const rowS2 = row.bestLap ? sectorTimeMs(row.bestLap, 2) : 0;
              const rowS3 = row.bestLap ? sectorTimeMs(row.bestLap, 3) : 0;
              const gap =
                i === 0
                  ? "–"
                  : row.bestTime === Infinity
                    ? row.allInvalid ? "ALL INVALID" : "NO TIME"
                    : `+${((row.bestTime - p1Time) / 1000).toFixed(3)}`;

              return (
                <tr
                  key={row.driver.index}
                  className={cn(tableRowClass, isFocused && "bg-zinc-800/40 text-white font-medium")}
                >
                  <td className="py-1.5 px-2">{i + 1}</td>
                  <td className="py-1.5 px-2">
                    <span
                      className="inline-block w-1 h-3 rounded-sm mr-1.5 align-middle"
                      style={{ backgroundColor: getTeamColor(row.driver.team) }}
                    />
                    {row.driver["driver-name"]}
                  </td>
                  <td className="py-1.5 px-2 text-zinc-400">
                    {getTeamName(row.driver.team)}
                  </td>
                  <td className={cn("py-1.5 px-2 text-right font-mono", row.bestLap && bestLapTime !== null && row.bestLap["lap-time-in-ms"] === bestLapTime && "text-best font-bold")}>
                    {row.bestLap
                      ? msToLapTime(row.bestLap["lap-time-in-ms"])
                      : "–"}
                  </td>
                  <td className={cn("py-1.5 px-2 text-right font-mono", row.bestLap && bestS1 !== null && rowS1 === bestS1 ? "text-best font-bold" : "text-zinc-400")}>
                    {row.bestLap
                      ? msToSectorTime(rowS1)
                      : "–"}
                  </td>
                  <td className={cn("py-1.5 px-2 text-right font-mono", row.bestLap && bestS2 !== null && rowS2 === bestS2 ? "text-best font-bold" : "text-zinc-400")}>
                    {row.bestLap
                      ? msToSectorTime(rowS2)
                      : "–"}
                  </td>
                  <td className={cn("py-1.5 px-2 text-right font-mono", row.bestLap && bestS3 !== null && rowS3 === bestS3 ? "text-best font-bold" : "text-zinc-400")}>
                    {row.bestLap
                      ? msToSectorTime(rowS3)
                      : "–"}
                  </td>
                  <td className={cn("py-1.5 px-2 text-right font-mono", row.allInvalid && "text-behind")}>{gap}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
