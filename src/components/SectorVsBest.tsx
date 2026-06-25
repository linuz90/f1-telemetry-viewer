import { Crosshair } from "lucide-react";
import type { TelemetrySession } from "../types/telemetry";
import { buildSectorVsBestModel } from "../analysis/sectorAnalysis";
import type { TrackPBs } from "../hooks/useTrackHistory";
import { cn } from "../utils/cn";
import { getTeamColor } from "../utils/colors";
import { msToLapTime, msToSectorTime, pluralize } from "../utils/format";
import { isTimeTrialSessionType } from "../utils/sessionTypes";
import { InsightValue } from "./ui/InsightText";
import { InsightTile } from "./ui/InsightTile";
import { SectionHeader } from "./ui/SectionHeader";

interface SectorVsBestProps {
  session: TelemetrySession;
  focusedDriverIndex: number;
  trackPbs?: TrackPBs | null;
}

interface BenchmarkRowProps {
  label: string;
  value: string;
  detail?: string;
  tone?: string;
  swatchColor?: string;
}

interface BenchmarkMetric {
  label: "Lap" | "S1" | "S2" | "S3";
  kind: "lap" | "sector";
  focusedBest: number | null;
  focusedBestLapNumber: number | null;
  sessionBest: number;
  sessionBestDriver: string;
  sessionBestTeam: string;
  isFocusedBest: boolean;
  deltaMs: number | null;
  historicalBest: number;
}

function formatMetricTime(metric: BenchmarkMetric, value: number): string {
  return metric.kind === "lap" ? msToLapTime(value) : msToSectorTime(value);
}

function formatDelta(deltaMs: number): string {
  const sign = deltaMs >= 0 ? "+" : "-";
  return `${sign}${(Math.abs(deltaMs) / 1000).toFixed(3)}s`;
}

function deltaTone(deltaMs: number): string {
  if (deltaMs <= 0) return "text-ahead";
  if (deltaMs < 100) return "text-warning";
  return "text-behind";
}

function benchmarkHint(
  isTimeTrial: boolean,
  timeTrialSessionCount: number,
): string {
  if (!isTimeTrial) return "focused driver vs session benchmarks";
  if (timeTrialSessionCount > 0) {
    return `this run vs ${pluralize(timeTrialSessionCount, "prior TT")}`;
  }
  return "current run sector sources";
}

function lapSource(lapNumber: number | null): string {
  return lapNumber ? `Lap ${lapNumber}` : "No valid lap";
}

function runComparison(
  metric: BenchmarkMetric,
  isTimeTrial: boolean,
): BenchmarkRowProps | null {
  if (metric.focusedBest === null) {
    return {
      label: isTimeTrial ? "This run" : "Session",
      value: "No time",
      tone: "text-zinc-500",
    };
  }

  if (metric.isFocusedBest || metric.deltaMs === null) {
    return {
      label: isTimeTrial ? "This run" : "Session",
      value: isTimeTrial ? "Best" : "Session best",
      tone: "text-best",
    };
  }

  return {
    label: "Session",
    value: formatDelta(metric.deltaMs),
    detail: `${metric.sessionBestDriver} ${formatMetricTime(metric, metric.sessionBest)}`,
    tone: deltaTone(metric.deltaMs),
    swatchColor: getTeamColor(metric.sessionBestTeam),
  };
}

function trackTimeTrialComparison(
  metric: BenchmarkMetric,
): BenchmarkRowProps | null {
  if (metric.focusedBest === null) return null;

  if (metric.historicalBest <= 0) {
    return null;
  }

  const deltaMs = metric.focusedBest - metric.historicalBest;
  if (Math.abs(deltaMs) < 1) {
    return {
      label: "Track TT",
      value: "Matched TT best",
      detail: formatMetricTime(metric, metric.historicalBest),
      tone: "text-ahead",
    };
  }

  if (deltaMs < 0) {
    return {
      label: "Track TT",
      value: "New TT best",
      detail: `${formatDelta(deltaMs)} vs previous`,
      tone: "text-ahead",
    };
  }

  return {
    label: "Track TT",
    value: formatDelta(deltaMs),
    detail: `PB ${formatMetricTime(metric, metric.historicalBest)}`,
    tone: deltaTone(deltaMs),
  };
}

function BenchmarkRow({
  label,
  value,
  detail,
  tone = "text-zinc-300",
  swatchColor,
}: BenchmarkRowProps) {
  return (
    <div className="min-w-0">
      <div className="flex min-w-0 items-center justify-between gap-3 font-mono text-xs tabular-nums">
        <span className="shrink-0 text-zinc-500">{label}</span>
        <span className={cn("min-w-0 truncate text-right", tone)}>{value}</span>
      </div>
      {detail && (
        <div className="mt-0.5 flex min-w-0 items-center justify-end gap-1.5 font-mono text-2xs tabular-nums text-zinc-500">
          {swatchColor && (
            <span
              className="size-1.5 shrink-0 rounded-full"
              style={{ backgroundColor: swatchColor }}
            />
          )}
          <span className="truncate">{detail}</span>
        </div>
      )}
    </div>
  );
}

function BenchmarkTile({
  metric,
  isTimeTrial,
  showTrackTimeTrial,
}: {
  metric: BenchmarkMetric;
  isTimeTrial: boolean;
  showTrackTimeTrial: boolean;
}) {
  const run = runComparison(metric, isTimeTrial);
  const track = showTrackTimeTrial ? trackTimeTrialComparison(metric) : null;
  const value =
    metric.focusedBest !== null
      ? formatMetricTime(metric, metric.focusedBest)
      : "–";
  const badge = (
    <span className="font-mono text-2xs tabular-nums text-zinc-500">
      {lapSource(metric.focusedBestLapNumber)}
    </span>
  );

  return (
    <InsightTile
      title={metric.label}
      icon={Crosshair}
      badge={badge}
      className="h-full min-h-[9.75rem]"
    >
      <InsightValue size="md" className="mt-1.5 text-zinc-100">
        {value}
      </InsightValue>

      <div className="mt-4 space-y-2.5 border-t border-white/[0.06] pt-3">
        {run && <BenchmarkRow {...run} />}
        {track && <BenchmarkRow {...track} />}
      </div>
    </InsightTile>
  );
}

function LapHeaderSummary({
  metric,
  isTimeTrial,
  showTrackTimeTrial,
}: {
  metric: BenchmarkMetric;
  isTimeTrial: boolean;
  showTrackTimeTrial: boolean;
}) {
  const run = runComparison(metric, isTimeTrial);
  const track = showTrackTimeTrial ? trackTimeTrialComparison(metric) : null;
  const summary = track ?? run;
  const value =
    metric.focusedBest !== null
      ? formatMetricTime(metric, metric.focusedBest)
      : "–";

  return (
    <div className="min-w-0 text-right">
      <div className="flex min-w-0 flex-wrap items-baseline justify-end gap-x-2 gap-y-0.5 font-mono tabular-nums">
        <span className="text-2xs text-zinc-500">
          {lapSource(metric.focusedBestLapNumber)}
        </span>
        <span className="text-sm font-semibold text-zinc-100">{value}</span>
        {summary && (
          <span className={cn("text-xs", summary.tone)}>{summary.value}</span>
        )}
      </div>
      {summary?.detail && (
        <div className="mt-0.5 truncate font-mono text-2xs tabular-nums text-zinc-500">
          {summary.detail}
        </div>
      )}
    </div>
  );
}

/**
 * Compares the focused driver's best sector times against the session-best sectors,
 * showing deltas and who holds the best in each sector.
 */
export function SectorVsBest({
  session,
  focusedDriverIndex,
  trackPbs,
}: SectorVsBestProps) {
  const model = buildSectorVsBestModel({
    session,
    focusedDriverIndex,
  });
  if (!model) return null;

  const isTimeTrial = isTimeTrialSessionType(
    session["session-info"]["session-type"],
  );
  const timeTrialSessionCount = trackPbs?.timeTrialSessionCount ?? 0;
  const showTrackTimeTrial = isTimeTrial && timeTrialSessionCount > 0;
  const lapMetric: BenchmarkMetric = {
    label: "Lap",
    kind: "lap",
    focusedBest: model.focusedBestLap,
    focusedBestLapNumber: model.focusedBestLapNumber,
    sessionBest: model.sessionBestLap,
    sessionBestDriver: model.sessionBestLapDriver,
    sessionBestTeam: model.sessionBestLapTeam,
    isFocusedBest: model.isFocusedBestLap,
    deltaMs: model.lapDeltaMs,
    historicalBest: trackPbs?.bestTimeTrialLapMs ?? 0,
  };
  const sectorMetrics: BenchmarkMetric[] = model.sectors.map((sector) => ({
    label: sector.label,
    kind: "sector" as const,
    focusedBest: sector.focusedBest,
    focusedBestLapNumber: sector.focusedBestLapNumber,
    sessionBest: sector.sessionBest,
    sessionBestDriver: sector.sessionBestDriver,
    sessionBestTeam: sector.sessionBestTeam,
    isFocusedBest: sector.isFocusedBest,
    deltaMs: sector.deltaMs,
    historicalBest:
      sector.label === "S1"
        ? (trackPbs?.bestTimeTrialS1Ms ?? 0)
        : sector.label === "S2"
          ? (trackPbs?.bestTimeTrialS2Ms ?? 0)
          : (trackPbs?.bestTimeTrialS3Ms ?? 0),
  }));

  return (
    <div>
      <SectionHeader
        size="sm"
        title={isTimeTrial ? "Sector Benchmarks" : "Sectors vs Best"}
        hint={benchmarkHint(isTimeTrial, timeTrialSessionCount)}
        action={
          <LapHeaderSummary
            metric={lapMetric}
            isTimeTrial={isTimeTrial}
            showTrackTimeTrial={showTrackTimeTrial}
          />
        }
        className="mb-4"
      />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {sectorMetrics.map((metric) => (
          <BenchmarkTile
            key={metric.label}
            metric={metric}
            isTimeTrial={isTimeTrial}
            showTrackTimeTrial={showTrackTimeTrial}
          />
        ))}
      </div>
    </div>
  );
}
