import { useState, useMemo } from "react";
import type { TelemetrySession } from "../types/telemetry";
import { getTeamColor } from "../utils/colors";
import { msToLapTime } from "../utils/format";
import { getCleanRaceLaps, getBestLapTime, RACE_PACE_TOOLTIP } from "../utils/stats";
import { usePlayerOnly } from "../hooks/usePlayerOnly";
import { ChevronUp, ChevronDown } from "lucide-react";
import { Tooltip } from "./Tooltip";

interface RaceResultsTableProps {
  session: TelemetrySession;
  focusedDriverIndex: number;
}

type SortKey = "pos" | "bestLap" | "racePace" | "gap";
type SortDir = "asc" | "desc";

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

function SortIcon({ column, sortKey, sortDir, side = "right" }: { column: SortKey; sortKey: SortKey; sortDir: SortDir; side?: "left" | "right" }) {
  const margin = side === "left" ? "mr-1" : "ml-1";
  if (column !== sortKey) return <ChevronDown className={`inline w-3 h-3 ${margin} opacity-0 group-hover:opacity-30`} />;
  return sortDir === "asc"
    ? <ChevronDown className={`inline w-3 h-3 ${margin} text-cyan-400`} />
    : <ChevronUp className={`inline w-3 h-3 ${margin} text-cyan-400`} />;
}

/**
 * Final classification table for race sessions.
 * Uses tyre-stint-history-v2 when available, falls back to classification-data.
 */
export function RaceResultsTable({ session, focusedDriverIndex }: RaceResultsTableProps) {
  const [focusedOnly, toggleFocusedOnly] = usePlayerOnly();
  const [sortKey, setSortKey] = useState<SortKey>("pos");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const stintHistory = session["tyre-stint-history-v2"];
  const drivers = session["classification-data"];

  const focusedDriver = drivers.find((d) => d.index === focusedDriverIndex);
  const focusedName = focusedDriver?.["driver-name"];

  // Pre-compute race pace and best lap for each driver (by name)
  const driverStats = useMemo(() => {
    const map = new Map<string, { bestLap: number; racePace: number }>();
    for (const d of drivers) {
      const laps = d["session-history"]["lap-history-data"];
      const bestLap = getBestLapTime(laps);
      const clean = getCleanRaceLaps(laps);
      const racePace = clean.length > 0
        ? clean.reduce((s, l) => s + l["lap-time-in-ms"], 0) / clean.length
        : 0;
      map.set(d["driver-name"], { bestLap, racePace });
    }
    return map;
  }, [drivers]);

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      if (sortDir === "asc") {
        setSortDir("desc");
      } else {
        // Third click: reset to default (position)
        setSortKey("pos");
        setSortDir("asc");
      }
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  }

  const thClass = "py-1.5 px-2 cursor-pointer select-none group";

  // Use tyre-stint-history-v2 if available (has clean per-driver race results)
  if (stintHistory?.length) {
    const filtered = focusedOnly
      ? stintHistory.filter((entry) => entry.name === focusedName)
      : stintHistory;

    const sorted = useMemo(() => {
      const arr = [...filtered];
      arr.sort((a, b) => {
        const statsA = driverStats.get(a.name);
        const statsB = driverStats.get(b.name);
        let cmp = 0;
        switch (sortKey) {
          case "pos":
            cmp = (a.position ?? 99) - (b.position ?? 99);
            break;
          case "bestLap": {
            const la = statsA?.bestLap || Infinity;
            const lb = statsB?.bestLap || Infinity;
            cmp = la - lb;
            break;
          }
          case "racePace": {
            const pa = statsA?.racePace || Infinity;
            const pb = statsB?.racePace || Infinity;
            cmp = pa - pb;
            break;
          }
          case "gap": {
            const ga = typeof a["delta-to-leader"] === "number" ? a["delta-to-leader"] : 0;
            const gb = typeof b["delta-to-leader"] === "number" ? b["delta-to-leader"] : 0;
            cmp = ga - gb;
            break;
          }
        }
        return sortDir === "desc" ? -cmp : cmp;
      });
      return arr;
    }, [filtered, sortKey, sortDir, driverStats]);

    // Find best values for highlighting
    const bestLapMs = Math.min(...[...driverStats.values()].map((s) => s.bestLap).filter((v) => v > 0));
    const bestPaceMs = Math.min(...[...driverStats.values()].map((s) => s.racePace).filter((v) => v > 0));

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
                <th className={`text-left ${thClass}`} onClick={() => toggleSort("pos")}>
                  Pos<SortIcon column="pos" sortKey={sortKey} sortDir={sortDir} />
                </th>
                <th className="text-left py-1.5 px-2">Driver</th>
                <th className="text-left py-1.5 px-2">Team</th>
                <th className={`text-right ${thClass}`} onClick={() => toggleSort("gap")}>
                  <SortIcon column="gap" sortKey={sortKey} sortDir={sortDir} side="left" />Gap
                </th>
                <th className={`text-right ${thClass}`} onClick={() => toggleSort("bestLap")}>
                  <SortIcon column="bestLap" sortKey={sortKey} sortDir={sortDir} side="left" />Best Lap
                </th>
                <th className={`text-right ${thClass}`} onClick={() => toggleSort("racePace")}>
                  <Tooltip text={RACE_PACE_TOOLTIP}>
                    <span><SortIcon column="racePace" sortKey={sortKey} sortDir={sortDir} side="left" />Race Pace</span>
                  </Tooltip>
                </th>
                <th className="text-right py-1.5 px-2">Stints</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((entry, i) => {
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

                const stats = driverStats.get(entry.name);
                const bestLap = stats?.bestLap ?? 0;
                const racePace = stats?.racePace ?? 0;
                const isBestLap = bestLap > 0 && Math.abs(bestLap - bestLapMs) < 1;
                const isBestPace = racePace > 0 && Math.abs(racePace - bestPaceMs) < 1;

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
                    <td className={`py-1.5 px-2 text-right font-mono ${isBestLap ? "text-purple-400" : ""}`}>
                      {bestLap > 0 ? msToLapTime(bestLap) : "–"}
                    </td>
                    <td className={`py-1.5 px-2 text-right font-mono ${isBestPace ? "text-purple-400" : ""}`}>
                      {racePace > 0 ? msToLapTime(racePace) : "–"}
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
  const fallbackSorted = [...drivers]
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
            {fallbackSorted.map((d) => {
              const fc = d["final-classification"]!;
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
                    –
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
