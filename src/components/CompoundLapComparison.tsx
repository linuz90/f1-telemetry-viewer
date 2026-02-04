import type { LapHistoryEntry, TyreStint } from "../types/telemetry";
import { getValidLaps, getBestLapTime } from "../utils/stats";
import { msToLapTime } from "../utils/format";
import { getCompoundColor } from "../utils/colors";

interface CompoundLapComparisonProps {
  playerStints: TyreStint[];
  playerLaps: LapHistoryEntry[];
  rivalStints: TyreStint[];
  rivalLaps: LapHistoryEntry[];
  rivalName: string;
}

interface CompoundStats {
  compound: string;
  playerAvg: number;
  rivalAvg: number;
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
    const laps = getValidLaps(getLapsForStint(playerLaps, stint));
    const existing = playerByCompound.get(compound) ?? [];
    playerByCompound.set(compound, [...existing, ...laps]);
  }

  const rivalByCompound = new Map<string, LapHistoryEntry[]>();
  for (const stint of rivalStints) {
    const compound = stint["tyre-set-data"]["visual-tyre-compound"];
    const laps = getValidLaps(getLapsForStint(rivalLaps, stint));
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
    const pAvg =
      pLaps.reduce((s, l) => s + l["lap-time-in-ms"], 0) / pLaps.length;
    const rAvg =
      rLaps.reduce((s, l) => s + l["lap-time-in-ms"], 0) / rLaps.length;
    return {
      compound,
      playerAvg: pAvg,
      rivalAvg: rAvg,
      playerBest: getBestLapTime(pLaps),
      rivalBest: getBestLapTime(rLaps),
      playerLapCount: pLaps.length,
      rivalLapCount: rLaps.length,
    };
  });

  return (
    <div>
      <h3 className="text-sm font-semibold text-zinc-300 mb-2">
        Compound Comparison{" "}
        <span className="font-normal text-zinc-500">vs {rivalName}</span>
      </h3>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="text-zinc-500">
            <tr>
              <th className="text-left py-1.5 px-2">Compound</th>
              <th className="text-right py-1.5 px-2">Your Avg</th>
              <th className="text-right py-1.5 px-2">Rival Avg</th>
              <th className="text-right py-1.5 px-2">Delta</th>
              <th className="text-right py-1.5 px-2">Your Best</th>
              <th className="text-right py-1.5 px-2">Rival Best</th>
              <th className="text-right py-1.5 px-2">Laps</th>
            </tr>
          </thead>
          <tbody>
            {stats.map((s) => {
              const delta = (s.playerAvg - s.rivalAvg) / 1000;
              const positive = delta > 0;
              return (
                <tr key={s.compound} className="border-t border-zinc-800/50">
                  <td className="py-1.5 px-2">
                    <span className="flex items-center gap-1.5">
                      <span
                        className="w-2 h-2 rounded-sm inline-block"
                        style={{
                          backgroundColor: getCompoundColor(s.compound),
                        }}
                      />
                      <span className="text-zinc-300">{s.compound}</span>
                    </span>
                  </td>
                  <td className="text-right py-1.5 px-2 font-mono text-zinc-300">
                    {msToLapTime(s.playerAvg)}
                  </td>
                  <td className="text-right py-1.5 px-2 font-mono text-zinc-300">
                    {msToLapTime(s.rivalAvg)}
                  </td>
                  <td
                    className={`text-right py-1.5 px-2 font-mono font-bold ${
                      Math.abs(delta) < 0.001
                        ? "text-zinc-400"
                        : positive
                          ? "text-red-400"
                          : "text-emerald-400"
                    }`}
                  >
                    {delta <= 0 ? "" : "+"}
                    {delta.toFixed(3)}s
                  </td>
                  <td className="text-right py-1.5 px-2 font-mono text-zinc-400">
                    {msToLapTime(s.playerBest)}
                  </td>
                  <td className="text-right py-1.5 px-2 font-mono text-zinc-400">
                    {msToLapTime(s.rivalBest)}
                  </td>
                  <td className="text-right py-1.5 px-2 font-mono text-zinc-500">
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
