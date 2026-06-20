import type { TyreStint, LapHistoryEntry } from "../types/telemetry";
import {
  buildStintDetails,
  buildStintTimelineSegments,
} from "../analysis/stintAnalysis";
import { getCompoundColor } from "../utils/colors";
import { cn } from "../utils/cn";
import { stintChipStyle, stintChipTextStyle } from "./ui/StintChip";
import { PUNCTURE_THRESHOLD } from "../utils/stats/tyres";
import { msToLapTime } from "../utils/format";
import { CompoundStatCard } from "./CompoundStatCard";
import { SectionHeader } from "./ui/SectionHeader";

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

  const segments = buildStintTimelineSegments(stints, totalLaps);

  return (
    <div>
      <SectionHeader size="sm" title="Stint Analysis" />
      <div className="flex h-10 gap-0.5">
        {segments.map((segment, i) => {
          const { stint, compound } = segment;
          return (
            <div
              key={i}
              className={cn(
                "flex items-center justify-center overflow-hidden text-xs font-bold relative",
                segment.isFirst && "rounded-l-lg",
                segment.isLast && "rounded-r-lg",
              )}
              style={{
                width: `${segment.widthPct}%`,
                ...stintChipStyle(compound),
                minWidth: "40px",
                ...(segment.isLastUnfinished && {
                  maskImage:
                    "linear-gradient(to right, black 90%, transparent)",
                }),
              }}
              title={`${compound}: Laps ${stint["start-lap"]}–${stint["end-lap"]} (${stint["stint-length"]} laps)`}
            >
              <span
                className="truncate px-1"
                style={stintChipTextStyle(compound)}
              >
                {compound[0]} · L{stint["start-lap"]}–{stint["end-lap"]}
              </span>
            </div>
          );
        })}
      </div>
      {/* Legend */}
      <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-xs text-zinc-400">
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
 * Stint detail cards showing pace stats and wear-based estimated max life.
 * Placed below the tyre wear chart for context.
 */
export function StintDetailCards({
  stints,
  laps,
}: {
  stints: TyreStint[];
  laps: LapHistoryEntry[];
}) {
  if (stints.length === 0) return null;

  const details = buildStintDetails(stints, laps);
  const hasAnyWear = details.some((detail) => detail.wearRate > 0);

  return (
    <div>
      <SectionHeader size="sm" title="Stints" />
      <div
        className="flex gap-2 overflow-x-auto pb-1 -mx-3 px-3 sm:mx-0 sm:px-0 sm:grid"
        style={{
          gridTemplateColumns: `repeat(${stints.length}, minmax(0, 1fr))`,
        }}
      >
        {details.map((detail, i) => {
          const { stint, compound } = detail;
          const color = getCompoundColor(compound);

          const hero =
            detail.bestTimeMs > 0
              ? { value: msToLapTime(detail.bestTimeMs), label: "Best lap" }
              : undefined;

          const rows = [
            ...(detail.averageTimeMs > 0
              ? [
                  {
                    label: "Average",
                    value: msToLapTime(Math.round(detail.averageTimeMs)),
                    className: "font-mono",
                  },
                ]
              : []),
            ...(detail.averageDeviationMs > 0
              ? [
                  {
                    label: "Consistency",
                    value: `±${(detail.averageDeviationMs / 1000).toFixed(3)}s`,
                    className: "font-mono",
                  },
                ]
              : []),
            ...(detail.peakWear > 0
              ? [
                  {
                    label: "Peak wear",
                    value: `${detail.peakWear.toFixed(1)}%`,
                    className: `font-mono ${detail.peakWear > 60 ? "text-behind" : detail.peakWear > 40 ? "text-warning" : "text-zinc-300"}`,
                    divider: true,
                  },
                ]
              : []),
            ...(detail.wearRate > 0
              ? [
                  {
                    label: "Wear rate",
                    value: `${detail.wearRate.toFixed(1)}%/lap`,
                  },
                ]
              : []),
            ...(detail.estimatedLife > 0
              ? [
                  {
                    label: "Est. max life",
                    value: `~${detail.estimatedLife} laps`,
                  },
                ]
              : []),
          ];

          return (
            <CompoundStatCard
              key={i}
              compound={compound}
              subtitle={`${stint["stint-length"]} laps`}
              hero={hero}
              rows={rows}
              className="min-w-[200px] sm:min-w-0"
            >
              {/* Wear bar: 0–100% scale with puncture threshold marker */}
              {hasAnyWear && (
                <div className="relative h-2 rounded-full bg-zinc-800 mt-1.5">
                  <div
                    className="absolute inset-y-0 left-0 rounded-full"
                    style={{
                      width: `${Math.min(detail.peakWear, 100)}%`,
                      backgroundColor: color,
                    }}
                  />
                  <div
                    className="absolute inset-y-0 w-0.5 bg-red-500/80"
                    style={{ left: `${PUNCTURE_THRESHOLD}%` }}
                    title={`${PUNCTURE_THRESHOLD}% puncture risk`}
                  />
                </div>
              )}
            </CompoundStatCard>
          );
        })}
      </div>
      {hasAnyWear && (
        <p className="text-xs text-zinc-600 mt-1.5">
          Bar = worst-wheel wear.{" "}
          <span className="text-red-500/60">Red line</span> ={" "}
          {PUNCTURE_THRESHOLD}% puncture risk threshold.
        </p>
      )}
    </div>
  );
}
