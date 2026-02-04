import type { LapHistoryEntry, TyreStintBasic } from "../types/telemetry";
import { isLapValid, msToLapTime } from "../utils/format";
import { getCompoundColor } from "../utils/colors";

interface SectorComparisonProps {
  laps: LapHistoryEntry[];
  stints?: TyreStintBasic[];
}

const SECTOR_COLORS = {
  S1: { bg: "bg-blue-500", bar: "#3b82f6" },
  S2: { bg: "bg-violet-500", bar: "#8b5cf6" },
  S3: { bg: "bg-pink-500", bar: "#ec4899" },
} as const;

/**
 * Horizontal segment layout showing each qualifying lap with proportional
 * sector bars, times, and deltas. Replaces the stacked BarChart.
 */
export function SectorComparison({ laps, stints }: SectorComparisonProps) {
  // Build a lap→compound lookup from stint data
  const lapCompound = new Map<number, string>();
  if (stints?.length) {
    let startLap = 1;
    for (const stint of stints) {
      const compound = stint["tyre-visual-compound"];
      for (let lap = startLap; lap <= stint["end-lap"]; lap++) {
        lapCompound.set(lap, compound);
      }
      startLap = stint["end-lap"] + 1;
    }
  }

  const data = laps
    .filter((l) => l["lap-time-in-ms"] > 0)
    .map((l, i) => ({
      lap: i + 1,
      s1: l["sector-1-time-in-ms"] / 1000,
      s2: l["sector-2-time-in-ms"] / 1000,
      s3: l["sector-3-time-in-ms"] / 1000,
      total: l["lap-time-in-ms"] / 1000,
      totalStr: l["lap-time-str"],
      valid: isLapValid(l["lap-valid-bit-flags"]),
      compound: lapCompound.get(i + 1),
    }));

  if (!data.length) {
    return <p className="text-sm text-zinc-500">No lap data for comparison.</p>;
  }

  // Best valid lap for delta calculation
  const validLaps = data.filter((d) => d.valid);
  const bestTime = validLaps.length
    ? Math.min(...validLaps.map((d) => d.total))
    : null;

  // Common scale: max sector total across all laps
  const maxTotal = Math.max(...data.map((d) => d.s1 + d.s2 + d.s3));

  // Best individual sectors across valid laps
  const bestS1 = validLaps.length ? Math.min(...validLaps.map((d) => d.s1)) : Infinity;
  const bestS2 = validLaps.length ? Math.min(...validLaps.map((d) => d.s2)) : Infinity;
  const bestS3 = validLaps.length ? Math.min(...validLaps.map((d) => d.s3)) : Infinity;

  return (
    <div>
      <h3 className="text-base font-semibold text-zinc-300 mb-3">
        Your Lap Breakdown
      </h3>

      {/* Legend */}
      <div className="flex gap-4 mb-3 text-sm text-zinc-400">
        {(["S1", "S2", "S3"] as const).map((sector) => (
          <span key={sector} className="flex items-center gap-1.5">
            <span className={`inline-block w-2.5 h-2.5 rounded-sm ${SECTOR_COLORS[sector].bg}`} />
            {sector}
          </span>
        ))}
      </div>

      <div className="space-y-2">
        {data.map((d) => {
          const isBest = bestTime !== null && d.valid && Math.abs(d.total - bestTime) < 0.001;
          const delta = bestTime !== null && d.valid
            ? d.total - bestTime
            : null;

          return (
            <div
              key={d.lap}
              className={`rounded-lg px-3 py-2.5 ${
                !d.valid
                  ? "opacity-60 border border-dashed border-red-500/40 bg-zinc-950/50"
                  : isBest
                    ? "border border-purple-500/30 bg-purple-500/5"
                    : "bg-zinc-950/50"
              }`}
            >
              {/* Header row: lap number, validity, total time, delta */}
              <div className="flex items-center gap-3 mb-1.5">
                <span className="text-sm font-semibold text-zinc-400 w-10 shrink-0">
                  Lap {d.lap}
                </span>

                {d.compound && (
                  <span className="flex items-center gap-1">
                    <span
                      className="inline-block w-2.5 h-2.5 rounded-full shrink-0"
                      style={{ backgroundColor: getCompoundColor(d.compound) }}
                    />
                    <span className="text-xs text-zinc-500">{d.compound}</span>
                  </span>
                )}

                {!d.valid && (
                  <span className="text-red-400 text-sm font-bold flex items-center gap-0.5">
                    <span className="text-xs">{"\u26A0"}</span> INVALID
                  </span>
                )}
                {d.valid && (
                  <span className="text-green-400/70 text-sm">{"\u2713"}</span>
                )}

                <span className="ml-auto flex items-center gap-3">
                  <span
                    className={`font-mono text-sm font-semibold ${
                      !d.valid
                        ? "text-red-400/70 line-through"
                        : isBest
                          ? "text-purple-400"
                          : "text-zinc-200"
                    }`}
                  >
                    {msToLapTime(d.total * 1000)}
                  </span>
                  <span className="font-mono text-sm w-16 text-right">
                    {isBest ? (
                      <span className="text-purple-400 font-semibold">BEST</span>
                    ) : delta !== null ? (
                      <span className="text-zinc-500">+{delta.toFixed(3)}</span>
                    ) : (
                      ""
                    )}
                  </span>
                </span>
              </div>

              {/* Sector bars */}
              <div className="flex h-6 rounded overflow-hidden gap-px">
                {(["s1", "s2", "s3"] as const).map((key) => {
                  const sectorKey = key.toUpperCase() as "S1" | "S2" | "S3";
                  const time = d[key];
                  const widthPct = (time / maxTotal) * 100;
                  const isBestSector =
                    d.valid &&
                    ((key === "s1" && Math.abs(time - bestS1) < 0.001) ||
                     (key === "s2" && Math.abs(time - bestS2) < 0.001) ||
                     (key === "s3" && Math.abs(time - bestS3) < 0.001));

                  return (
                    <div
                      key={key}
                      className="flex items-center justify-center text-xs font-mono relative overflow-hidden"
                      style={{
                        width: `${widthPct}%`,
                        backgroundColor: d.valid
                          ? SECTOR_COLORS[sectorKey].bar
                          : `${SECTOR_COLORS[sectorKey].bar}40`,
                        minWidth: "60px",
                      }}
                    >
                      <span
                        className={`px-1 truncate ${
                          isBestSector ? "text-white font-bold" : "text-white/80"
                        }`}
                      >
                        {sectorKey}: {time.toFixed(3)}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
