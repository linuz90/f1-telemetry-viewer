import type { LapHistoryEntry, PerLapInfo, TyreStintBasic } from "../types/telemetry";
import { isLapValid, msToLapTime, msToSectorTime, sectorTimeMs } from "../utils/format";
import { cn } from "../utils/cn";
import { getCompoundColor, PERF_COLORS } from "../utils/colors";
import { ersDeployMjForLap, ersHarvestMjForLap } from "../utils/stats";
import { accentCardClass, neutralCardClass } from "./Card";

interface SectorComparisonProps {
  laps: LapHistoryEntry[];
  stints?: TyreStintBasic[];
  perLapInfo?: PerLapInfo[];
}

/**
 * Horizontal segment layout showing each qualifying lap with proportional
 * sector bars, times, and deltas. Replaces the stacked BarChart.
 */
export function SectorComparison({ laps, stints, perLapInfo }: SectorComparisonProps) {
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

  // Build lap → ERS deploy/harvest lookup (F1 26 quali: out-lap charge vs push-lap deploy)
  const lapErs = new Map<number, { deployMj: number; harvMj: number }>();
  if (perLapInfo?.length) {
    for (const info of perLapInfo) {
      lapErs.set(info["lap-number"], {
        deployMj: ersDeployMjForLap(info),
        harvMj: ersHarvestMjForLap(info),
      });
    }
  }

  const data = laps
    .filter((l) => l["lap-time-in-ms"] > 0)
    .map((l, i) => {
      const lapNum = i + 1;
      const ers = lapErs.get(lapNum);
      return {
        lap: lapNum,
        s1: sectorTimeMs(l, 1) / 1000,
        s2: sectorTimeMs(l, 2) / 1000,
        s3: sectorTimeMs(l, 3) / 1000,
        total: l["lap-time-in-ms"] / 1000,
        totalStr: l["lap-time-str"],
        valid: isLapValid(l["lap-valid-bit-flags"]),
        compound: lapCompound.get(lapNum),
        deployMj: ers?.deployMj,
        harvMj: ers?.harvMj,
      };
    });

  const hasDeploy = data.some((d) => d.deployMj != null && d.deployMj > 0);
  const hasHarv = data.some((d) => d.harvMj != null && d.harvMj > 0);

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

  // Best and worst individual sectors across valid laps
  const bestS1 = validLaps.length ? Math.min(...validLaps.map((d) => d.s1)) : Infinity;
  const bestS2 = validLaps.length ? Math.min(...validLaps.map((d) => d.s2)) : Infinity;
  const bestS3 = validLaps.length ? Math.min(...validLaps.map((d) => d.s3)) : Infinity;
  const worstS1 = validLaps.length ? Math.max(...validLaps.map((d) => d.s1)) : -Infinity;
  const worstS2 = validLaps.length ? Math.max(...validLaps.map((d) => d.s2)) : -Infinity;
  const worstS3 = validLaps.length ? Math.max(...validLaps.map((d) => d.s3)) : -Infinity;

  return (
    <div>
      <h3 className="text-base font-semibold text-zinc-300 mb-3">
        Your Lap Breakdown
      </h3>

      {/* Legend */}
      <div className="flex gap-4 mb-3 text-sm text-zinc-400">
        {([
          { color: PERF_COLORS.best, label: "Personal best" },
          { color: PERF_COLORS.normal, label: "Normal" },
          { color: PERF_COLORS.worst, label: "Worst" },
        ] as const).map(({ color, label }) => (
          <span key={label} className="flex items-center gap-1.5">
            <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: color }} />
            {label}
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
              className={cn(
                "rounded-lg px-3 py-2.5",
                !d.valid
                  ? "opacity-60 border border-dashed border-red-500/40 bg-zinc-950/50"
                  : isBest
                    ? accentCardClass("purple")
                    : neutralCardClass,
              )}
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
                  <span className="text-behind text-sm font-bold flex items-center gap-0.5">
                    <span className="text-xs">{"\u26A0"}</span> INVALID
                  </span>
                )}
                {d.valid && (
                  <span className="text-ahead/70 text-sm">{"\u2713"}</span>
                )}

                <span className="ml-auto flex items-center gap-3">
                  <span
                    className={cn(
                      "font-mono text-sm font-semibold",
                      !d.valid
                        ? "text-behind/70 line-through"
                        : isBest
                          ? "text-best"
                          : "text-zinc-200",
                    )}
                  >
                    {msToLapTime(d.total * 1000)}
                  </span>
                  <span className="font-mono text-sm w-16 text-right">
                    {isBest ? (
                      <span className="text-best font-semibold">BEST</span>
                    ) : delta !== null ? (
                      <span className="text-zinc-500">+{delta.toFixed(3)}</span>
                    ) : (
                      ""
                    )}
                  </span>
                </span>
              </div>

              {/* ERS deploy/harvest footer — useful for spotting out-lap charging vs push-lap deploy.
                  When ERS exists for the session but not this specific lap (Pits n' Giggles can omit
                  per-lap-info for some laps), show a dimmed placeholder so the gap is explicit. */}
              {(hasDeploy || hasHarv) && (
                <div className="flex items-center gap-3 mb-1 text-xs font-mono">
                  {hasDeploy && (
                    <span className={cn("flex items-center gap-1", d.deployMj != null && d.deployMj > 0 ? "text-ahead" : "text-zinc-600")}>
                      <span className="text-zinc-500 text-2xs uppercase tracking-wide">Dep</span>
                      <span>{d.deployMj != null && d.deployMj > 0 ? `${d.deployMj.toFixed(1)} MJ` : "–"}</span>
                    </span>
                  )}
                  {hasHarv && (
                    <span className={cn("flex items-center gap-1", d.harvMj != null && d.harvMj > 0 ? "text-sky-400" : "text-zinc-600")}>
                      <span className="text-zinc-500 text-2xs uppercase tracking-wide">Harv</span>
                      <span>{d.harvMj != null && d.harvMj > 0 ? `${d.harvMj.toFixed(1)} MJ` : "–"}</span>
                    </span>
                  )}
                  {d.deployMj == null && d.harvMj == null && (
                    <span className="text-zinc-600 text-2xs italic">no per-lap telemetry captured</span>
                  )}
                </div>
              )}

              {/* Sector bars */}
              <div className="flex h-6 rounded overflow-hidden gap-px">
                {(["s1", "s2", "s3"] as const).map((key) => {
                  const sectorKey = key.toUpperCase() as "S1" | "S2" | "S3";
                  const time = d[key];
                  const widthPct = (time / maxTotal) * 100;
                  const best = key === "s1" ? bestS1 : key === "s2" ? bestS2 : bestS3;
                  const worst = key === "s1" ? worstS1 : key === "s2" ? worstS2 : worstS3;
                  const isBestSector = d.valid && Math.abs(time - best) < 0.001;
                  const isWorstSector = d.valid && validLaps.length > 1 && Math.abs(time - worst) < 0.001;

                  let barColor: string;
                  if (!d.valid) barColor = PERF_COLORS.invalid;
                  else if (isBestSector) barColor = PERF_COLORS.best;
                  else if (isWorstSector) barColor = PERF_COLORS.worst;
                  else barColor = PERF_COLORS.normal;

                  return (
                    <div
                      key={key}
                      className="flex items-center justify-center text-xs font-mono relative overflow-hidden"
                      style={{
                        width: `${widthPct}%`,
                        backgroundColor: barColor,
                        minWidth: "60px",
                      }}
                    >
                      <span
                        className={cn(
                          "px-1 truncate",
                          isBestSector ? "text-white font-bold" : "text-white/80",
                        )}
                      >
                        {sectorKey}: {msToSectorTime(time * 1000)}
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
