import type { TelemetrySession, DriverData } from "../types/telemetry";
import { usePlayerOnly } from "../hooks/usePlayerOnly";
import { msToLapTime, msToSectorTime } from "../utils/format";
import { getTeamColor } from "../utils/colors";
import { getValidLaps } from "../utils/stats";

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
    ? Math.min(...allBestLaps.map((l) => l["sector-1-time-in-ms"]))
    : null;
  const bestS2 = allBestLaps.length
    ? Math.min(...allBestLaps.map((l) => l["sector-2-time-in-ms"]))
    : null;
  const bestS3 = allBestLaps.length
    ? Math.min(...allBestLaps.map((l) => l["sector-3-time-in-ms"]))
    : null;

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-base font-semibold text-zinc-300">
          Qualifying Results
        </h3>
        <label className="flex items-center gap-2 text-sm text-zinc-400 cursor-pointer select-none">
          Focus driver only
          <button
            type="button"
            role="switch"
            aria-checked={focusedOnly}
            onClick={toggleFocusedOnly}
            className={`relative inline-flex h-4 w-7 items-center rounded-full transition-colors ${focusedOnly ? "bg-cyan-600" : "bg-zinc-800"}`}
          >
            <span
              className={`inline-block h-3 w-3 rounded-full bg-white transition-transform ${focusedOnly ? "translate-x-3.5" : "translate-x-0.5"}`}
            />
          </button>
        </label>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-zinc-500">
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
              const gap =
                i === 0
                  ? "–"
                  : row.bestTime === Infinity
                    ? row.allInvalid ? "ALL INVALID" : "NO TIME"
                    : `+${((row.bestTime - p1Time) / 1000).toFixed(3)}`;

              return (
                <tr
                  key={row.driver.index}
                  className={`border-t border-zinc-800/50 ${isFocused ? "bg-zinc-900/50 text-white font-medium" : ""}`}
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
                    {row.driver.team}
                  </td>
                  <td className={`py-1.5 px-2 text-right font-mono ${row.bestLap && bestLapTime !== null && row.bestLap["lap-time-in-ms"] === bestLapTime ? "text-purple-400 font-bold" : ""}`}>
                    {row.bestLap
                      ? msToLapTime(row.bestLap["lap-time-in-ms"])
                      : "–"}
                  </td>
                  <td className={`py-1.5 px-2 text-right font-mono ${row.bestLap && bestS1 !== null && row.bestLap["sector-1-time-in-ms"] === bestS1 ? "text-purple-400 font-bold" : "text-zinc-400"}`}>
                    {row.bestLap
                      ? msToSectorTime(row.bestLap["sector-1-time-in-ms"])
                      : "–"}
                  </td>
                  <td className={`py-1.5 px-2 text-right font-mono ${row.bestLap && bestS2 !== null && row.bestLap["sector-2-time-in-ms"] === bestS2 ? "text-purple-400 font-bold" : "text-zinc-400"}`}>
                    {row.bestLap
                      ? msToSectorTime(row.bestLap["sector-2-time-in-ms"])
                      : "–"}
                  </td>
                  <td className={`py-1.5 px-2 text-right font-mono ${row.bestLap && bestS3 !== null && row.bestLap["sector-3-time-in-ms"] === bestS3 ? "text-purple-400 font-bold" : "text-zinc-400"}`}>
                    {row.bestLap
                      ? msToSectorTime(row.bestLap["sector-3-time-in-ms"])
                      : "–"}
                  </td>
                  <td className={`py-1.5 px-2 text-right font-mono ${row.allInvalid ? "text-red-400" : ""}`}>{gap}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
