import { AlertTriangle, Award, CircleHelp, Disc } from "lucide-react";
import type { TrackStrategySuggestion } from "../../analysis/trackStrategyTypes";
import { cn } from "../../utils/cn";
import { PUNCTURE_THRESHOLD } from "../../utils/stats/tyres";
import { formatSignedSeconds } from "../../utils/format";
import { cardClass } from "../Card";
import { Tooltip } from "../Tooltip";
import { SectionHeader } from "../ui/SectionHeader";
import { HStack } from "../ui/Stack";
import { stintChipStyle, stintChipTextStyle } from "../ui/StintChip";

const STRATEGY_EVIDENCE_TOOLTIP = `Pace and wear come from this race-length bucket. Ranking blends distance-matched compound pace, projected worst-wheel wear, pit-loss cost, and managed-tyre risk; pit loss uses same-track player stops when available, then F1 defaults. Stints still target the ${PUNCTURE_THRESHOLD}% cap.`;

/**
 * F1 broadcast-style strategy visualization for the Race tab. Shows the
 * recommended and alternative strategy shapes as stacked equal-weight ribbons,
 * with stints scaled to their lap counts and pit windows shaded ±1 lap around
 * the target pit lap.
 *
 * Shapes come from the same selected race-length tyre-wear synthesis in
 * `analysis/trackStrategySynthesis.ts`, then get ranked by the timing model. The
 * alternative row prefers a different stop count only when that tradeoff stays
 * time-competitive.
 */
export function TrackStrategySection({
  recommended,
  alternative,
  totalLaps,
  raceLengthLabel,
}: {
  recommended: TrackStrategySuggestion;
  alternative: TrackStrategySuggestion | null;
  totalLaps: number;
  /** Optional race-length bucket label (e.g. "33-lap") shown in the subtitle */
  raceLengthLabel?: string;
}) {
  const sampleCount =
    recommended.fullDistanceRaceCount > 0
      ? recommended.fullDistanceRaceCount
      : recommended.raceCount;
  const sampleKind =
    recommended.fullDistanceRaceCount > 0 ? "full-distance race" : "race";
  const subtitleParts: string[] = [];
  if (raceLengthLabel) subtitleParts.push(raceLengthLabel);
  subtitleParts.push(
    `based on ${sampleCount} ${sampleKind}${sampleCount === 1 ? "" : "s"} in this bucket`,
  );

  return (
    <section className={cn(cardClass, "space-y-7")}>
      <SectionHeader
        title="Strategy"
        hint={subtitleParts.join(" · ")}
        action={<StrategyEvidenceHelp />}
      />

      <StrategyRow
        kind="recommended"
        strategy={recommended}
        totalLaps={totalLaps}
      />
      {alternative && (
        <StrategyRow
          kind="alternative"
          strategy={alternative}
          totalLaps={totalLaps}
        />
      )}
    </section>
  );
}

function StrategyEvidenceHelp() {
  return (
    <Tooltip text={STRATEGY_EVIDENCE_TOOLTIP}>
      <button
        type="button"
        className="inline-flex size-7 items-center justify-center rounded-full text-zinc-600 transition-colors hover:bg-white/[0.03] hover:text-zinc-300 focus-visible:outline focus-visible:outline-1 focus-visible:outline-zinc-500"
        aria-label="How strategy is calculated"
      >
        <CircleHelp className="size-4" aria-hidden="true" />
      </button>
    </Tooltip>
  );
}

function StrategyRow({
  kind,
  strategy,
  totalLaps,
}: {
  kind: "recommended" | "alternative";
  strategy: TrackStrategySuggestion;
  totalLaps: number;
}) {
  const isRecommended = kind === "recommended";
  const isManaged = strategy.risk?.kind === "managed-tyres";
  const Icon = isManaged ? AlertTriangle : isRecommended ? Award : Disc;
  // Recommended = amber/gold — broadcast convention for the "winning" or
  // "podium" strategy callout. Alternative stays neutral zinc so the eye
  // tracks Recommended first without dimming the alternative's data.
  const labelTone = isRecommended ? "text-amber-300" : "text-zinc-300";
  const label = isRecommended ? "Recommended" : "Alternative";
  const tagline = isManaged
    ? "One-stop, tyre management required"
    : strategy.fastStart === true
      ? "Fast start, durable finish"
      : strategy.fastStart === false
        ? "Durable start, fast finisher"
        : "Two-stop sandwich";
  const timingLabel = formatStrategyTiming(kind, strategy.timeEstimate);

  return (
    <div className="space-y-3">
      <HStack wrap className="gap-2">
        <span
          className={cn(
            "inline-flex items-center gap-1.5 font-mono text-xs font-medium uppercase tracking-wider",
            labelTone,
          )}
        >
          <Icon className="h-3.5 w-3.5" />
          {label}
        </span>
        <span className="text-xs text-zinc-500">· {tagline}</span>
        {timingLabel && (
          <Tooltip text={formatTimingTooltip(strategy)}>
            <span
              className={cn(
                "inline-flex items-center rounded px-1.5 py-0.5 font-mono text-[10px] font-semibold leading-none ring-1",
                strategy.timeEstimate?.confidence === "low"
                  ? "text-zinc-400 ring-white/10"
                  : isRecommended
                    ? "text-amber-200 ring-amber-300/30"
                    : "text-zinc-200 ring-white/15",
              )}
            >
              {timingLabel}
            </span>
          </Tooltip>
        )}
      </HStack>

      <StintRibbon
        compounds={strategy.compounds}
        stintLaps={strategy.stintLaps}
        stintWearPercentages={strategy.stintWearPercentages}
        pitWindows={strategy.pitWindows}
        totalLaps={totalLaps}
      />

      <PitDetail pitWindows={strategy.pitWindows} totalLaps={totalLaps} />
    </div>
  );
}

function formatStrategyTiming(
  kind: "recommended" | "alternative",
  estimate: TrackStrategySuggestion["timeEstimate"],
): string | null {
  if (!estimate) return null;

  const deltaLabel =
    estimate.deltaToFastestMs <= 250
      ? kind === "recommended"
        ? "fastest"
        : "even"
      : formatSignedSeconds(estimate.deltaToFastestMs, 1);

  if (estimate.predictedTotalRaceMs && estimate.confidence !== "low") {
    return `~${formatRaceDuration(estimate.predictedTotalRaceMs)} · ${deltaLabel}`;
  }

  return kind === "recommended" && estimate.deltaToFastestMs <= 250
    ? "fastest by model"
    : deltaLabel;
}

function formatRaceDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }

  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function formatTimingTooltip(strategy: TrackStrategySuggestion): string {
  const estimate = strategy.timeEstimate;
  if (!estimate) return STRATEGY_EVIDENCE_TOOLTIP;

  const detailParts = [
    estimate.details?.pitLossSource,
    estimate.details?.paceSource,
    estimate.details?.anchorSource,
  ].filter(Boolean);
  const stopCount = strategy.pitWindows.length;
  const pitLoss = formatPitLossTooltip(estimate.pitLossMs, stopCount);

  return `${pitLoss}${estimate.confidence} confidence · ${estimate.source}${detailParts.length ? ` · ${detailParts.join(" · ")}` : ""}`;
}

function formatPitLossTooltip(
  pitLossMs: number | undefined,
  stopCount: number,
): string {
  if (pitLossMs == null || stopCount === 0) return "";

  const perStop = formatSignedSeconds(pitLossMs, 1).replace("+", "");
  if (stopCount === 1) return `Pit loss ${perStop}. `;

  const total = formatSignedSeconds(pitLossMs * stopCount, 1).replace("+", "");
  return `Pit loss ${perStop}/stop (${total} total). `;
}

/** Stacked horizontal stint ribbon — each segment's width is proportional to
 *  its stint length, styled with the shared `stintChipStyle` so the chip
 *  family matches the race-view StintTimeline. Pit windows are shaded onto
 *  the bar as ±1 lap zones; the exact target pit lap is a thin white line.
 *  Lap-axis ticks render at the start, each pit target, and the flag. */
function StintRibbon({
  compounds,
  stintLaps,
  stintWearPercentages,
  pitWindows,
  totalLaps,
}: {
  compounds: string[];
  stintLaps: number[];
  stintWearPercentages: number[];
  pitWindows: { earliest: number; latest: number; target: number }[];
  totalLaps: number;
}) {
  // Cumulative lap counts at each pit so axis labels can render absolute laps.
  const lapMarks: number[] = [0];
  let acc = 0;
  for (let i = 0; i < stintLaps.length; i++) {
    acc += stintLaps[i];
    lapMarks.push(acc);
  }

  return (
    <div>
      <div className="relative h-9 rounded-md ring-1 ring-white/5">
        <div className="flex h-full">
          {compounds.map((compound, i) => {
            const laps = stintLaps[i];
            const isFirst = i === 0;
            const isLast = i === compounds.length - 1;
            return (
              <div
                key={`${compound}-${i}`}
                className={cn(
                  "relative flex h-full items-center justify-center overflow-hidden text-xs font-semibold",
                  isFirst && "rounded-l-md",
                  isLast && "rounded-r-md",
                )}
                style={{
                  flexGrow: laps,
                  flexBasis: 0,
                  ...stintChipStyle(compound),
                }}
                title={`${compound} · ${laps} laps · projected ${formatWearPercent(stintWearPercentages[i])} worst-wheel wear`}
              >
                <span
                  className="truncate px-1"
                  style={stintChipTextStyle(compound)}
                >
                  {compound} · {laps}L
                </span>
              </div>
            );
          })}
        </div>

        {/* Pit window shading + exact-target line. A dark tint reads on both
            the amber Medium and pale Hard chips (white/10 was invisible on
            light compounds). Bracketed by thin white edges so the earliest /
            latest boundaries are unambiguous, with the target lap as a
            brighter, slightly wider center line. */}
        {pitWindows.map((w, i) => {
          const windowSpan = w.latest - w.earliest + 1;
          return (
            <span key={`window-${i}`}>
              <span
                className="pointer-events-none absolute inset-y-0 bg-black/20 shadow-[inset_1px_0_0_rgba(255,255,255,0.35),inset_-1px_0_0_rgba(255,255,255,0.35)]"
                style={{
                  left: `${(w.earliest / totalLaps) * 100}%`,
                  width: `${(windowSpan / totalLaps) * 100}%`,
                }}
              />
              <span
                className="pointer-events-none absolute inset-y-0 w-px bg-white/90"
                style={{ left: `${(w.target / totalLaps) * 100}%` }}
              />
            </span>
          );
        })}
      </div>

      {/* Lap axis — start / each pit target / flag. Position labels at the
          same percentages as the bar segments so the eye can trace pit lap to
          stint boundary directly. */}
      <div className="relative mt-2 h-5 text-xs text-zinc-500">
        {lapMarks.map((lap, i) => {
          const pct = (lap / totalLaps) * 100;
          // Anchor: leftmost label flush left, rightmost flush right, the rest centered.
          const isFirst = i === 0;
          const isLast = i === lapMarks.length - 1;
          const wear = isFirst ? null : stintWearPercentages[i - 1];
          const transform = isFirst
            ? "translateX(0)"
            : isLast
              ? "translateX(-100%)"
              : "translateX(-50%)";
          return (
            <span
              key={`tick-${i}`}
              className="absolute flex items-center gap-2 whitespace-nowrap font-mono"
              style={{ left: `${pct}%`, transform }}
            >
              {wear != null && <StintWearBadge wear={wear} />}
              <span>L{lap}</span>
            </span>
          );
        })}
      </div>
    </div>
  );
}

function StintWearBadge({ wear }: { wear: number }) {
  if (!Number.isFinite(wear) || wear <= 0) return null;

  return (
    <span
      className={cn(
        "pointer-events-none inline-flex rounded px-1.5 py-0.5 font-mono text-[10px] font-bold leading-none ring-1",
        wearBadgeTone(wear),
      )}
    >
      {formatWearPercent(wear)}
    </span>
  );
}

function formatWearPercent(wear: number): string {
  if (!Number.isFinite(wear) || wear <= 0) return "--%";
  return `${Math.round(wear)}%`;
}

function wearBadgeTone(wear: number): string {
  if (wear >= 75) return "bg-zinc-950/85 text-red-300 ring-red-300/45";
  if (wear >= 65) return "bg-zinc-950/85 text-amber-300 ring-amber-300/40";
  return "bg-zinc-950/55 text-white/80 ring-white/15";
}

function PitDetail({
  pitWindows,
  totalLaps,
}: {
  pitWindows: { earliest: number; latest: number; target: number }[];
  totalLaps: number;
}) {
  if (pitWindows.length === 0) {
    return <p className="text-xs text-zinc-500">No-stop — run to the flag.</p>;
  }
  return (
    <p className="text-xs text-zinc-500">
      {pitWindows
        .map((w, i) => {
          const label = pitWindows.length > 1 ? `Pit ${i + 1}` : "Pit window";
          return `${label} target lap ${w.target} (${w.earliest}–${w.latest} of ${totalLaps})`;
        })
        .join(" · ")}
    </p>
  );
}
