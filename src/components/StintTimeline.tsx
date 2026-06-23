import type { TyreStint, LapHistoryEntry } from "../types/telemetry";
import {
  buildStintDetails,
  buildStintTimelineSegments,
  pairStintDetailsByCompound,
  type StintDetail,
} from "../analysis/stintAnalysis";
import { getCompoundColor } from "../utils/colors";
import { cn } from "../utils/cn";
import { stintChipStyle, stintChipTextStyle } from "./ui/StintChip";
import { PUNCTURE_THRESHOLD } from "../utils/stats/tyres";
import { msToLapTime } from "../utils/format";
import { CompoundStatCard, type CompoundStatCardRow } from "./CompoundStatCard";
import { ScrollArea } from "./ui/ScrollArea";
import { SectionHeader } from "./ui/SectionHeader";
import { HStack } from "./ui/Stack";

interface StintTimelineProps {
  stints: TyreStint[];
  totalLaps: number;
}

function driverColumnLabel(name: string | undefined, fallback: string): string {
  return name?.trim() || fallback;
}

function formatLapTimeOrDash(timeMs: number): string {
  return timeMs > 0 ? msToLapTime(Math.round(timeMs)) : "–";
}

function formatBestLapOrDash(timeMs: number): string {
  return timeMs > 0 ? msToLapTime(timeMs) : "–";
}

function formatConsistencyOrDash(deviationMs: number): string {
  return deviationMs > 0 ? `±${(deviationMs / 1000).toFixed(3)}s` : "–";
}

function formatWearOrDash(wear: number): string {
  return wear > 0 ? `${wear.toFixed(1)}%` : "–";
}

function formatWearRateOrDash(wearRate: number): string {
  return wearRate > 0 ? `${wearRate.toFixed(1)}%/lap` : "–";
}

function formatEstimatedLifeOrDash(estimatedLife: number): string {
  return estimatedLife > 0 ? `~${estimatedLife} laps` : "–";
}

function wearValueClass(wear: number): string {
  return `font-mono ${
    wear > 60 ? "text-behind" : wear > 40 ? "text-warning" : "text-zinc-300"
  }`;
}

function comparisonWearValueClass(wear: number): string {
  return `font-mono ${
    wear > 60 ? "text-behind" : wear > 40 ? "text-warning" : "text-zinc-500"
  }`;
}

function maybeComparisonValue(
  comparison: StintDetail | undefined,
  formatter: (detail: StintDetail) => string,
): string | undefined {
  return comparison ? formatter(comparison) : undefined;
}

function buildStintMetricRows(
  detail: StintDetail,
  comparison: StintDetail | undefined,
): CompoundStatCardRow[] {
  const rows: CompoundStatCardRow[] = [];

  if (detail.averageTimeMs > 0 || (comparison?.averageTimeMs ?? 0) > 0) {
    rows.push({
      label: "Average",
      value: formatLapTimeOrDash(detail.averageTimeMs),
      comparisonValue: maybeComparisonValue(comparison, (item) =>
        formatLapTimeOrDash(item.averageTimeMs),
      ),
      className: "font-mono text-zinc-300",
    });
  }

  if (
    detail.averageDeviationMs > 0 ||
    (comparison?.averageDeviationMs ?? 0) > 0
  ) {
    rows.push({
      label: "Consistency",
      value: formatConsistencyOrDash(detail.averageDeviationMs),
      comparisonValue: maybeComparisonValue(comparison, (item) =>
        formatConsistencyOrDash(item.averageDeviationMs),
      ),
      className: "font-mono text-zinc-300",
    });
  }

  if (detail.peakWear > 0 || (comparison?.peakWear ?? 0) > 0) {
    rows.push({
      label: "Peak wear",
      value: formatWearOrDash(detail.peakWear),
      comparisonValue: maybeComparisonValue(comparison, (item) =>
        formatWearOrDash(item.peakWear),
      ),
      className: wearValueClass(detail.peakWear),
      comparisonClassName: comparison
        ? comparisonWearValueClass(comparison.peakWear)
        : undefined,
      divider: true,
    });
  }

  if (detail.wearRate > 0 || (comparison?.wearRate ?? 0) > 0) {
    rows.push({
      label: "Wear rate",
      value: formatWearRateOrDash(detail.wearRate),
      comparisonValue: maybeComparisonValue(comparison, (item) =>
        formatWearRateOrDash(item.wearRate),
      ),
    });
  }

  if (detail.estimatedLife > 0 || (comparison?.estimatedLife ?? 0) > 0) {
    rows.push({
      label: "Est. max life",
      value: formatEstimatedLifeOrDash(detail.estimatedLife),
      comparisonValue: maybeComparisonValue(comparison, (item) =>
        formatEstimatedLifeOrDash(item.estimatedLife),
      ),
    });
  }

  return rows;
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
      <HStack wrap className="mt-2 gap-x-4 gap-y-1 text-xs text-zinc-400">
        {stints.map((stint, i) => (
          <HStack as="span" key={i} className="gap-1">
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
          </HStack>
        ))}
      </HStack>
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
  rivalStints,
  rivalLaps,
  rivalName,
  driverName,
}: {
  stints: TyreStint[];
  laps: LapHistoryEntry[];
  rivalStints?: TyreStint[];
  rivalLaps?: LapHistoryEntry[];
  rivalName?: string;
  driverName?: string;
}) {
  if (stints.length === 0) return null;

  const details = buildStintDetails(stints, laps);
  const rivalDetails =
    rivalStints && rivalLaps ? buildStintDetails(rivalStints, rivalLaps) : [];
  const pairedDetails = pairStintDetailsByCompound({
    details,
    comparisonDetails: rivalDetails,
  });
  const hasAnyWear = details.some((detail) => detail.wearRate > 0);
  const primaryLabel = driverColumnLabel(driverName, "Main");
  const comparisonLabel = driverColumnLabel(rivalName, "Compare");

  return (
    <div>
      <SectionHeader size="sm" title="Stints" />
      <ScrollArea
        axis="x"
        className="flex gap-2 pb-1 -mx-3 px-3 sm:mx-0 sm:px-0 sm:grid"
        style={{
          gridTemplateColumns: `repeat(${stints.length}, minmax(0, 1fr))`,
        }}
      >
        {pairedDetails.map(({ detail, comparison }, i) => {
          const { stint, compound } = detail;
          const color = getCompoundColor(compound);
          const hasComparison = Boolean(comparison);

          const hero =
            detail.bestTimeMs > 0 || (comparison?.bestTimeMs ?? 0) > 0
              ? {
                  value: formatBestLapOrDash(detail.bestTimeMs),
                  label: "Best lap",
                  comparisonValue: maybeComparisonValue(comparison, (item) =>
                    formatBestLapOrDash(item.bestTimeMs),
                  ),
                }
              : undefined;

          const rows = buildStintMetricRows(detail, comparison);

          return (
            <CompoundStatCard
              key={i}
              compound={compound}
              subtitle={`${stint["stint-length"]} laps`}
              hero={hero}
              rows={rows}
              valueLabel={hasComparison ? primaryLabel : undefined}
              comparisonLabel={hasComparison ? comparisonLabel : undefined}
              className={cn(
                hasComparison ? "min-w-[280px]" : "min-w-[200px]",
                "sm:min-w-0",
                details.length === 1 && "w-full flex-1",
              )}
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
      </ScrollArea>
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
