import type { TelemetrySession } from "../types/telemetry";
import { getTeamColor } from "../utils/colors";
import { usePlayerOnly } from "../hooks/usePlayerOnly";

interface RaceResultsTableProps {
  session: TelemetrySession;
  focusedDriverIndex: number;
}

/**
 * Final classification table for race sessions.
 * Uses tyre-stint-history-v2 when available, falls back to classification-data.
 */
const FocusDriverToggle = ({
  value,
  onChange,
}: {
  value: boolean;
  onChange: () => void;
}) => (
  <label className="flex items-center gap-2 text-xs text-zinc-400 cursor-pointer select-none">
    Focus driver only
    <button
      type="button"
      role="switch"
      aria-checked={value}
      onClick={onChange}
      className={`relative inline-flex h-4 w-7 items-center rounded-full transition-colors ${value ? "bg-cyan-600" : "bg-zinc-800"}`}
    >
      <span
        className={`inline-block h-3 w-3 rounded-full bg-white transition-transform ${value ? "translate-x-3.5" : "translate-x-0.5"}`}
      />
    </button>
  </label>
);

export function RaceResultsTable({ session, focusedDriverIndex }: RaceResultsTableProps) {
  const [focusedOnly, toggleFocusedOnly] = usePlayerOnly();
  const stintHistory = session["tyre-stint-history-v2"];
  const drivers = session["classification-data"];
  const speedTraps = session["speed-trap-records"];

  // Find focused driver name for v2 stint matching
  const focusedDriver = drivers.find((d) => d.index === focusedDriverIndex);
  const focusedName = focusedDriver?.["driver-name"];

  // Use tyre-stint-history-v2 if available (has clean per-driver race results)
  if (stintHistory?.length) {
    const filteredStints = focusedOnly
      ? stintHistory.filter((entry) => entry.name === focusedName)
      : stintHistory;

    return (
      <div>
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-semibold text-zinc-300">Classification</h3>
          <FocusDriverToggle value={focusedOnly} onChange={toggleFocusedOnly} />
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="text-zinc-500">
              <tr>
                <th className="text-left py-1.5 px-2">Pos</th>
                <th className="text-left py-1.5 px-2">Driver</th>
                <th className="text-left py-1.5 px-2">Team</th>
                <th className="text-right py-1.5 px-2">Gap</th>
                <th className="text-right py-1.5 px-2">Stints</th>
              </tr>
            </thead>
            <tbody>
              {filteredStints.map((entry, i) => {
                const isFocused = entry.name === focusedName;
                const gap = entry["delta-to-leader"];
                const status = entry["result-status"];
                const gapStr = status && status !== "FINISHED"
                  ? status
                  : gap == null || gap === 0 || gap === ""
                    ? "Leader"
                    : typeof gap === "number"
                      ? `+${(gap / 1000).toFixed(3)}s`
                      : String(gap);

                const stints = entry["tyre-stint-history"] ?? [];
                const stintStr = stints.length
                  ? stints
                      .map(
                        (s) =>
                          `${s["tyre-set-data"]["visual-tyre-compound"][0]}${s["stint-length"]}`,
                      )
                      .join(" → ")
                  : "–";

                return (
                  <tr
                    key={i}
                    className={`border-t border-zinc-800/50 ${isFocused ? "bg-zinc-900/50 text-white font-medium" : ""}`}
                  >
                    <td className="py-1.5 px-2">{entry.position}</td>
                    <td className="py-1.5 px-2">
                      <span
                        className="inline-block w-1 h-3 rounded-sm mr-1.5 align-middle"
                        style={{ backgroundColor: getTeamColor(entry.team) }}
                      />
                      {entry.name}
                    </td>
                    <td className="py-1.5 px-2 text-zinc-400">{entry.team}</td>
                    <td className={`py-1.5 px-2 text-right font-mono ${status === "DNF" || status === "DSQ" ? "text-red-400" : ""}`}>
                      {gapStr}
                    </td>
                    <td className="py-1.5 px-2 text-right text-zinc-400">
                      {stintStr}
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

  // Fallback: use classification-data with final-classification
  const sorted = [...drivers]
    .filter((d) => d["final-classification"])
    .filter((d) => !focusedOnly || d.index === focusedDriverIndex)
    .sort(
      (a, b) =>
        (a["final-classification"]?.position ?? 99) -
        (b["final-classification"]?.position ?? 99),
    );

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-semibold text-zinc-300">Classification</h3>
        <FocusDriverToggle value={focusedOnly} onChange={toggleFocusedOnly} />
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="text-zinc-500">
            <tr>
              <th className="text-left py-1.5 px-2">Pos</th>
              <th className="text-left py-1.5 px-2">Driver</th>
              <th className="text-left py-1.5 px-2">Team</th>
              <th className="text-right py-1.5 px-2">Best Lap</th>
              <th className="text-right py-1.5 px-2">Top Speed</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((d) => {
              const fc = d["final-classification"]!;
              const speed = speedTraps.find((s) => s.name === d["driver-name"]);
              return (
                <tr
                  key={d.index}
                  className={`border-t border-zinc-800/50 ${d.index === focusedDriverIndex ? "bg-zinc-900/50 text-white font-medium" : ""}`}
                >
                  <td className="py-1.5 px-2">{fc.position}</td>
                  <td className="py-1.5 px-2">
                    <span
                      className="inline-block w-1 h-3 rounded-sm mr-1.5 align-middle"
                      style={{ backgroundColor: getTeamColor(d.team) }}
                    />
                    {d["driver-name"]}
                  </td>
                  <td className="py-1.5 px-2 text-zinc-400">{d.team}</td>
                  <td className="py-1.5 px-2 text-right font-mono">
                    {fc["best-lap-time-str"] || "–"}
                  </td>
                  <td className="py-1.5 px-2 text-right font-mono">
                    {speed ? `${speed["speed-trap-record-kmph"]} km/h` : "–"}
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
