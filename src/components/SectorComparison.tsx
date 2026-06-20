import type {
  LapHistoryEntry,
  PerLapInfo,
  TyreStintBasic,
} from "../types/telemetry";
import { buildSectorBreakdownModel } from "../analysis/sectorAnalysis";
import { msToLapTime, msToSectorTime } from "../utils/format";
import { cn } from "../utils/cn";
import { PERF_COLORS } from "../constants/colors";
import { accentCardClass, neutralCardClass } from "./Card";
import { CompoundSwatchLabel } from "./ui/CompoundSwatchLabel";
import { Eyebrow } from "./ui/Eyebrow";
import { SectionHeader } from "./ui/SectionHeader";

interface SectorComparisonProps {
  laps: LapHistoryEntry[];
  stints?: TyreStintBasic[];
  perLapInfo?: PerLapInfo[];
}

/**
 * Horizontal segment layout showing each qualifying lap with proportional
 * sector bars, times, and deltas. Replaces the stacked BarChart.
 */
export function SectorComparison({
  laps,
  stints,
  perLapInfo,
}: SectorComparisonProps) {
  const model = buildSectorBreakdownModel({ laps, stints, perLapInfo });
  if (!model.laps.length) {
    return <p className="text-sm text-zinc-500">No lap data for comparison.</p>;
  }

  return (
    <div>
      <SectionHeader size="sm" title="Your Lap Breakdown" />

      {/* Legend */}
      <div className="flex gap-4 mb-3 text-sm text-zinc-400">
        {(
          [
            { color: PERF_COLORS.best, label: "Personal best" },
            { color: PERF_COLORS.normal, label: "Normal" },
            { color: PERF_COLORS.worst, label: "Worst" },
          ] as const
        ).map(({ color, label }) => (
          <span key={label} className="flex items-center gap-1.5">
            <span
              className="inline-block w-2.5 h-2.5 rounded-sm"
              style={{ backgroundColor: color }}
            />
            {label}
          </span>
        ))}
      </div>

      <div className="space-y-2">
        {model.laps.map((d) => {
          const isBest =
            model.bestTime !== null &&
            d.valid &&
            Math.abs(d.total - model.bestTime) < 0.001;
          const delta =
            model.bestTime !== null && d.valid
              ? d.total - model.bestTime
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
                  <CompoundSwatchLabel
                    compound={d.compound}
                    labelClassName="text-zinc-500"
                  />
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
              {(model.hasDeploy || model.hasHarv) && (
                <div className="flex items-center gap-3 mb-1 text-xs font-mono">
                  {model.hasDeploy && (
                    <span
                      className={cn(
                        "flex items-center gap-1",
                        d.deployMj != null && d.deployMj > 0
                          ? "text-ahead"
                          : "text-zinc-600",
                      )}
                    >
                      <Eyebrow className="text-zinc-500">Dep</Eyebrow>
                      <span>
                        {d.deployMj != null && d.deployMj > 0
                          ? `${d.deployMj.toFixed(1)} MJ`
                          : "–"}
                      </span>
                    </span>
                  )}
                  {model.hasHarv && (
                    <span
                      className={cn(
                        "flex items-center gap-1",
                        d.harvMj != null && d.harvMj > 0
                          ? "text-sky-400"
                          : "text-zinc-600",
                      )}
                    >
                      <Eyebrow className="text-zinc-500">Harv</Eyebrow>
                      <span>
                        {d.harvMj != null && d.harvMj > 0
                          ? `${d.harvMj.toFixed(1)} MJ`
                          : "–"}
                      </span>
                    </span>
                  )}
                  {d.deployMj == null && d.harvMj == null && (
                    <span className="text-zinc-600 text-2xs italic">
                      no per-lap telemetry captured
                    </span>
                  )}
                </div>
              )}

              {/* Sector bars */}
              <div className="flex h-6 rounded overflow-hidden gap-px">
                {(["s1", "s2", "s3"] as const).map((key) => {
                  const sectorKey = key.toUpperCase() as "S1" | "S2" | "S3";
                  const time = d[key];
                  const widthPct =
                    model.maxTotal > 0 ? (time / model.maxTotal) * 100 : 0;
                  const best = model.bestBySector[key];
                  const worst = model.worstBySector[key];
                  const isBestSector = d.valid && Math.abs(time - best) < 0.001;
                  const isWorstSector =
                    d.valid &&
                    model.validLapCount > 1 &&
                    Math.abs(time - worst) < 0.001;

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
                          isBestSector
                            ? "text-white font-bold"
                            : "text-white/80",
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
