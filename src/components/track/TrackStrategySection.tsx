import { Award, Disc } from "lucide-react";
import { cn } from "../../utils/cn";
import type { TrackStrategySuggestion } from "../../utils/stats";
import { PUNCTURE_THRESHOLD } from "../../utils/stats";
import { cardClass } from "../Card";
import { SectionHeader } from "../ui/SectionHeader";
import { stintChipStyle, stintChipTextStyle } from "../ui/StintChip";

/**
 * F1 broadcast-style strategy visualization for the Race tab. Shows the
 * recommended and alternative one-stop shapes as stacked equal-weight ribbons,
 * with stints scaled to their lap counts and a pit window shaded ±1 lap
 * around the target pit lap.
 *
 * Both shapes come from the same wear-data synthesis (`synthesizeStrategies`
 * in `utils/stats.ts`) — the recommended row is the "fast start" pairing
 * (softer compound first, undercut bias) and the alternative is its mirror
 * (durable start, fast finish). The alternative row is hidden when the
 * mirror isn't feasible under the puncture-risk cap.
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
    `${sampleCount} ${sampleKind}${sampleCount === 1 ? "" : "s"} of tyre data`,
  );

  return (
    <section className={cn(cardClass, "space-y-7")}>
      <SectionHeader title="Strategy" hint={subtitleParts.join(" · ")} />

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

        {/* Footer footnote — separated by a faint hairline so it reads as
            "context about the algorithm" instead of crowding the alternative
            row's pit-detail line directly above. */}
      <p className="border-t border-white/[0.04] pt-4 text-xs leading-relaxed text-zinc-500">
        Pit lap is balanced so both stints reach the same fraction of their
        tyre life, then nudged one lap earlier to bank a small undercut. Both
        stints stay under the {PUNCTURE_THRESHOLD}% puncture-risk threshold.
      </p>
    </section>
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
  const Icon = isRecommended ? Award : Disc;
  // Recommended = amber/gold — broadcast convention for the "winning" or
  // "podium" strategy callout. Alternative stays neutral zinc so the eye
  // tracks Recommended first without dimming the alternative's data.
  const labelTone = isRecommended ? "text-amber-300" : "text-zinc-300";
  const tagline =
    strategy.fastStart === true
      ? "Fast start, durable finish"
      : strategy.fastStart === false
        ? "Durable start, fast finisher"
        : "Two-stop sandwich";

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={cn("inline-flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider", labelTone)}
        >
          <Icon className="h-3.5 w-3.5" />
          {isRecommended ? "Recommended" : "Alternative"}
        </span>
        <span className="text-xs text-zinc-500">· {tagline}</span>
      </div>

      <StintRibbon
        compounds={strategy.compounds}
        stintLaps={strategy.stintLaps}
        pitWindows={strategy.pitWindows}
        totalLaps={totalLaps}
      />

      <PitDetail pitWindows={strategy.pitWindows} totalLaps={totalLaps} />
    </div>
  );
}

/** Stacked horizontal stint ribbon — each segment's width is proportional to
 *  its stint length, styled with the shared `stintChipStyle` so the chip
 *  family matches the race-view StintTimeline. Pit windows are shaded onto
 *  the bar as ±1 lap zones; the exact target pit lap is a thin white line.
 *  Lap-axis ticks render at the start, each pit target, and the flag. */
function StintRibbon({
  compounds,
  stintLaps,
  pitWindows,
  totalLaps,
}: {
  compounds: string[];
  stintLaps: number[];
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
                  "flex h-full items-center justify-center overflow-hidden text-xs font-semibold",
                  isFirst && "rounded-l-md",
                  isLast && "rounded-r-md",
                )}
                style={{
                  flexGrow: laps,
                  flexBasis: 0,
                  ...stintChipStyle(compound),
                }}
                title={`${compound} · ${laps} laps`}
              >
                <span className="truncate px-1" style={stintChipTextStyle(compound)}>
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
      <div className="relative mt-2 h-3.5 text-xs text-zinc-500">
        {lapMarks.map((lap, i) => {
          const pct = (lap / totalLaps) * 100;
          // Anchor: leftmost label flush left, rightmost flush right, the rest centered.
          const isFirst = i === 0;
          const isLast = i === lapMarks.length - 1;
          const transform = isFirst
            ? "translateX(0)"
            : isLast
              ? "translateX(-100%)"
              : "translateX(-50%)";
          return (
            <span
              key={`tick-${i}`}
              className="absolute font-mono"
              style={{ left: `${pct}%`, transform }}
            >
              L{lap}
            </span>
          );
        })}
      </div>
    </div>
  );
}

function PitDetail({
  pitWindows,
  totalLaps,
}: {
  pitWindows: { earliest: number; latest: number; target: number }[];
  totalLaps: number;
}) {
  if (pitWindows.length === 0) {
    return (
      <p className="text-xs text-zinc-500">No-stop — run to the flag.</p>
    );
  }
  return (
    <p className="text-xs text-zinc-500">
      {pitWindows
        .map((w, i) => {
          const label =
            pitWindows.length > 1 ? `Pit ${i + 1}` : "Pit window";
          return `${label} target lap ${w.target} (${w.earliest}–${w.latest} of ${totalLaps})`;
        })
        .join(" · ")}
    </p>
  );
}
