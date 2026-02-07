import type { TyreStint } from "../types/telemetry";
import { getCompoundColor } from "../utils/colors";
import { stintWearRate, getWorstWheelWear, estimateMaxLife, PUNCTURE_THRESHOLD } from "../utils/stats";
import { CompoundStatCard } from "./CompoundStatCard";

interface StintTimelineProps {
  stints: TyreStint[];
  totalLaps: number;
}

/**
 * Horizontal bar showing each stint as a colored block.
 * Width proportional to stint length relative to total laps.
 */
export function StintTimeline({ stints, totalLaps }: StintTimelineProps) {
  if (!stints.length) {
    return <p className="text-sm text-zinc-500">No stint data available.</p>;
  }

  const effectiveTotal =
    totalLaps || stints.reduce((s, t) => s + t["stint-length"], 0);

  return (
    <div>
      <h3 className="text-sm font-semibold text-zinc-300 mb-2">
        Stint Strategy
      </h3>
      <div className="flex h-10 rounded-lg overflow-hidden gap-0.5">
        {stints.map((stint, i) => {
          const compound = stint["tyre-set-data"]["visual-tyre-compound"];
          const color = getCompoundColor(compound);
          const widthPct = (stint["stint-length"] / effectiveTotal) * 100;
          const isLastUnfinished =
            i === stints.length - 1 && stint["end-lap"] < totalLaps;

          return (
            <div
              key={i}
              className="flex items-center justify-center text-xs font-bold relative"
              style={{
                width: `${widthPct}%`,
                backgroundColor: color,
                color: compound === "Hard" ? "#18181b" : "#fff",
                minWidth: "40px",
                ...(isLastUnfinished && {
                  maskImage:
                    "linear-gradient(to right, black 90%, transparent)",
                }),
              }}
              title={`${compound}: Laps ${stint["start-lap"]}–${stint["end-lap"]} (${stint["stint-length"]} laps)`}
            >
              <span className="truncate px-1">
                {compound[0]} · L{stint["start-lap"]}–{stint["end-lap"]}
              </span>
            </div>
          );
        })}
      </div>
      {/* Legend */}
      <div className="flex gap-4 mt-2 text-xs text-zinc-400">
        {stints.map((stint, i) => (
          <span key={i} className="flex items-center gap-1">
            <span
              className="inline-block w-2.5 h-2.5 rounded-sm"
              style={{
                backgroundColor: getCompoundColor(
                  stint["tyre-set-data"]["visual-tyre-compound"],
                ),
              }}
            />
            {stint["tyre-set-data"]["visual-tyre-compound"]} (
            {stint["stint-length"]} laps)
          </span>
        ))}
      </div>
    </div>
  );
}

/**
 * Stint detail cards showing wear-based estimated max life.
 * Placed below the tyre wear chart for context.
 */
export function StintDetailCards({ stints }: { stints: TyreStint[] }) {
  // Only show if we have meaningful wear data
  const stintsWithWear = stints.filter((s) => stintWearRate(s) > 0);
  if (stintsWithWear.length === 0) return null;

  return (
    <div>
      <h3 className="text-sm font-semibold text-zinc-300 mb-2">
        Tyre Life Estimate
      </h3>
      <div
        className="grid gap-2"
        style={{ gridTemplateColumns: `repeat(${stints.length}, minmax(0, 1fr))` }}
      >
        {stints.map((stint, i) => {
          const compound = stint["tyre-set-data"]["visual-tyre-compound"];
          const color = getCompoundColor(compound);
          const wearHistory = stint["tyre-wear-history"];
          const peakWear = wearHistory.length > 0 ? getWorstWheelWear(wearHistory[wearHistory.length - 1]) : 0;
          const wearRate = stintWearRate(stint);
          const estLife = estimateMaxLife(wearRate);

          const rows = [
            { label: "Stint", value: `${stint["stint-length"]} laps` },
            ...(peakWear > 0 ? [{
              label: "Peak wear",
              value: `${peakWear.toFixed(1)}%`,
              className: `font-mono ${peakWear > 60 ? "text-red-400" : peakWear > 40 ? "text-amber-400" : "text-zinc-300"}`,
            }] : []),
            { label: "Wear rate", value: `${wearRate.toFixed(1)}%/lap` },
            ...(estLife > 0 ? [{ label: "Est. max life", value: `~${estLife} laps` }] : []),
          ];

          return (
            <CompoundStatCard key={i} compound={compound} rows={rows}>
              {/* Wear bar: 0–100% scale with puncture threshold marker */}
              <div className="relative h-2 rounded-full bg-zinc-800 mt-1.5">
                <div
                  className="absolute inset-y-0 left-0 rounded-full"
                  style={{
                    width: `${Math.min(peakWear, 100)}%`,
                    backgroundColor: color,
                  }}
                />
                <div
                  className="absolute inset-y-0 w-0.5 bg-red-500/80"
                  style={{ left: `${PUNCTURE_THRESHOLD}%` }}
                  title={`${PUNCTURE_THRESHOLD}% puncture risk`}
                />
              </div>
            </CompoundStatCard>
          );
        })}
      </div>
      <p className="text-xs text-zinc-600 mt-1.5">
        Bar = worst-wheel wear. <span className="text-red-500/60">Red line</span> = {PUNCTURE_THRESHOLD}% puncture risk threshold.
      </p>
    </div>
  );
}
