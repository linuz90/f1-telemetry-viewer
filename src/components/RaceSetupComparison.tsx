import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import type {
  RaceSetupComparableMetric,
  RaceSetupCandidate,
  RaceSetupStrength,
  RaceSetupStrengthKind,
} from "../utils/setupComparison";
import { msToLapTime, formatDate, formatSessionType } from "../utils/format";
import { cn } from "../utils/cn";
import { sessionSummaryPath } from "../utils/routes";
import { cardClass } from "./Card";
import { CarSetupCard } from "./CarSetupCard";
import { Badge } from "./ui/Badge";
import { SectionHeader } from "./ui/SectionHeader";

interface RaceSetupComparisonProps {
  candidates: RaceSetupCandidate[];
  raceLengthLabel?: string;
}

type SetupMetricKey = "bestLap" | "medianPace" | "bestStint" | "wear";

interface MetricExtremes {
  best: number | null;
  worst: number | null;
}

const STRENGTH_META: Record<
  RaceSetupStrengthKind,
  { label: string; className: string }
> = {
  "most-promising": {
    label: "Most promising",
    className: "bg-sky-400/[0.08] text-sky-200/70 ring-sky-400/10",
  },
  "fastest-lap": {
    label: "Fastest lap",
    className: "bg-sky-400/[0.08] text-sky-200/70 ring-sky-400/10",
  },
  "best-pace": {
    label: "Best pace",
    className: "bg-emerald-400/[0.08] text-emerald-200/70 ring-emerald-400/10",
  },
  "best-stint": {
    label: "Best stint",
    className: "bg-amber-400/[0.08] text-amber-200/70 ring-amber-400/10",
  },
  "lowest-deg": {
    label: "Lowest deg",
    className: "bg-emerald-400/[0.08] text-emerald-200/70 ring-emerald-400/10",
  },
};

function formatLapMetric(value: number | null): string {
  return value ? msToLapTime(value) : "–";
}

function formatWearMetric(value: number | null): string {
  return value ? `${value.toFixed(1)}%/lap` : "–";
}

function formatLapDelta(value: number | null | undefined): string | undefined {
  if (value == null) return undefined;
  if (Math.abs(value) < 1) return "Best";
  return `+${(value / 1000).toFixed(3)}`;
}

function formatWearDelta(value: number | null | undefined): string | undefined {
  if (value == null) return undefined;
  if (Math.abs(value) < 0.05) return "Best";
  return `+${value.toFixed(1)}`;
}

function getMetricValue(
  candidate: RaceSetupCandidate,
  metric: SetupMetricKey,
): number | null {
  switch (metric) {
    case "bestLap":
      return candidate.bestLapMs;
    case "medianPace":
      return getComparisonValue(candidate.comparablePace, candidate.medianCleanPaceMs);
    case "bestStint":
      return getComparisonValue(candidate.comparableStint, candidate.bestStintPaceMs);
    case "wear":
      return getComparisonValue(candidate.comparableWear, candidate.avgWearRatePerLap);
  }
}

function metricExtremes(
  candidates: RaceSetupCandidate[],
  metric: SetupMetricKey,
): MetricExtremes {
  const values = candidates
    .map((candidate) => getMetricValue(candidate, metric))
    .filter((value): value is number => value !== null && value > 0);

  if (values.length === 0) return { best: null, worst: null };

  const best = Math.min(...values);
  const worst = Math.max(...values);

  return {
    best,
    worst:
      candidates.length > 2 && values.length > 2 && Math.abs(worst - best) > 0.001
        ? worst
        : null,
  };
}

function metricValueClassName(
  value: number | null,
  extremes: MetricExtremes,
): string {
  if (value !== null && extremes.best !== null && Math.abs(value - extremes.best) < 0.001) {
    return "text-purple-300";
  }

  if (
    value !== null &&
    extremes.worst !== null &&
    Math.abs(value - extremes.worst) < 0.001
  ) {
    return "text-red-300";
  }

  return "text-zinc-200";
}

function pluralizeRace(count: number): string {
  return count === 1 ? "race" : "races";
}

function SourceLink({
  candidate,
}: {
  candidate: RaceSetupCandidate;
}) {
  const { summary, bestLapMs } = candidate.source;

  return (
    <Link
      to={sessionSummaryPath(summary)}
      className="text-zinc-400 hover:text-zinc-200 transition-colors"
    >
      {formatSessionType(summary.sessionType, summary.formula)} ·{" "}
      {formatDate(summary.date)}
      {bestLapMs ? ` · ${msToLapTime(bestLapMs)}` : ""}
    </Link>
  );
}

function MetricCell({
  value,
  detail,
  delta,
  className,
}: {
  value: string;
  detail?: string;
  delta?: string;
  className?: string;
}) {
  return (
    <div className="min-w-0">
      <div className={cn("font-mono text-xs tabular-nums", className ?? "text-zinc-200")}>
        {value}
      </div>
      {delta && (
        <div
          className={cn(
            "mt-0.5 font-mono text-2xs tabular-nums",
            delta === "Best" ? "text-zinc-600" : "text-zinc-500",
          )}
        >
          {delta}
        </div>
      )}
      {detail && (
        <div className="mt-0.5 truncate text-2xs text-zinc-600">{detail}</div>
      )}
    </div>
  );
}

function StrengthBadge({ strength }: { strength: RaceSetupStrength }) {
  const meta = STRENGTH_META[strength.kind];

  return (
    <span
      className={cn("inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-2xs font-medium leading-4 ring-1", meta.className)}
    >
      {getStrengthLabel(strength)}
    </span>
  );
}

function getDefaultCandidateId(candidates: RaceSetupCandidate[]): string {
  // The rows are already sorted by the comparison model. Defaulting to the
  // first visible row keeps selection, details, and user expectation aligned;
  // otherwise a raw fastest-lap badge can unexpectedly select a lower-ranked
  // setup after navigating between tracks.
  return candidates[0]?.id ?? "";
}

function getStrengthLabel(strength: RaceSetupStrength): string {
  const base = STRENGTH_META[strength.kind].label;
  if (!strength.compound) return base;

  switch (strength.kind) {
    case "best-pace":
      return `Best ${strength.compound} pace`;
    case "best-stint":
      return `Best ${strength.compound} stint`;
    case "lowest-deg":
      return `Lowest ${strength.compound} deg`;
    default:
      return base;
  }
}

function getDisplayStrengths(candidate: RaceSetupCandidate): RaceSetupStrength[] {
  const hasOverallVerdict = candidate.strengths.some(
    (strength) => strength.kind === "most-promising",
  );
  if (!hasOverallVerdict) return candidate.strengths;

  return candidate.strengths.filter(
    (strength) =>
      strength.kind === "most-promising" || strength.kind === "fastest-lap",
  );
}

function getComparisonValue(
  comparable: RaceSetupComparableMetric | null,
  fallback: number | null,
): number | null {
  return comparable?.value ?? fallback;
}

function getPaceDetail(candidate: RaceSetupCandidate): string | undefined {
  if (candidate.comparablePace) {
    return `${candidate.comparablePace.compound} · ${candidate.comparablePace.sampleCount} clean laps`;
  }

  return candidate.cleanLapCount > 0
    ? `${candidate.cleanLapCount} clean laps`
    : undefined;
}

function getWearDetail(candidate: RaceSetupCandidate): string | undefined {
  if (!candidate.comparableWear) return undefined;
  const unit = candidate.comparableWear.sampleCount === 1 ? "stint" : "stints";
  return `${candidate.comparableWear.compound} · ${candidate.comparableWear.sampleCount} ${unit}`;
}

export function RaceSetupComparison({
  candidates,
  raceLengthLabel,
}: RaceSetupComparisonProps) {
  const defaultCandidateId = useMemo(
    () => getDefaultCandidateId(candidates),
    [candidates],
  );
  const [selectedId, setSelectedId] = useState(defaultCandidateId);
  const previousCandidates = useRef(candidates);

  useEffect(() => {
    if (previousCandidates.current !== candidates) {
      previousCandidates.current = candidates;
      setSelectedId(defaultCandidateId);
      return;
    }

    if (!candidates.some((candidate) => candidate.id === selectedId)) {
      setSelectedId(defaultCandidateId);
    }
  }, [candidates, defaultCandidateId, selectedId]);

  if (candidates.length === 0) return null;

  const selectedCandidate =
    candidates.find((candidate) => candidate.id === selectedId) ??
    candidates[0];

  if (candidates.length === 1) {
    const candidate = candidates[0];

    return (
      <section className={cardClass}>
        <SectionHeader
          title="Your Best Race Setup"
          hint={
            <>
              From <SourceLink candidate={candidate} />
            </>
          }
        />
        <CarSetupCard setup={candidate.setup} />
      </section>
    );
  }

  const totalSamples = candidates.reduce(
    (sum, candidate) => sum + candidate.sampleCount,
    0,
  );
  const raceScope = raceLengthLabel ? `${raceLengthLabel} ` : "";
  const metricColors: Record<SetupMetricKey, MetricExtremes> = {
    bestLap: metricExtremes(candidates, "bestLap"),
    medianPace: metricExtremes(candidates, "medianPace"),
    bestStint: metricExtremes(candidates, "bestStint"),
    wear: metricExtremes(candidates, "wear"),
  };

  return (
    <section className={cardClass}>
      <SectionHeader
        title="Race Setup Comparison"
        hint={
          <>
            Observed across {totalSamples} {raceScope}
            {pluralizeRace(totalSamples)}. Awards use same-compound evidence.
          </>
        }
        className="mb-4"
      />

      <div className="-mx-1 overflow-x-auto px-1">
        <div className="min-w-[920px]">
          <div className="grid grid-cols-[minmax(500px,2.4fr)_repeat(4,minmax(90px,0.55fr))] gap-3 px-3 pb-2 text-2xs font-medium uppercase tracking-wider text-zinc-600">
            <div>Setup</div>
            <div>Best lap</div>
            <div>Median pace</div>
            <div>Best stint</div>
            <div>Wear</div>
          </div>
          <div className="space-y-1">
            {candidates.map((candidate) => {
              const selected = candidate.id === selectedCandidate.id;
              const displayStrengths = getDisplayStrengths(candidate);
              const bestLapValue = getMetricValue(candidate, "bestLap");
              const medianPaceValue = getMetricValue(candidate, "medianPace");
              const bestStintValue = getMetricValue(candidate, "bestStint");
              const wearValue = getMetricValue(candidate, "wear");

              return (
                <button
                  key={candidate.id}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => setSelectedId(candidate.id)}
                  className={cn(
                    "grid w-full grid-cols-[minmax(500px,2.4fr)_repeat(4,minmax(90px,0.55fr))] gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-zinc-600",
                    selected
                      ? "border-sky-400/30 bg-zinc-800/80 text-zinc-100"
                      : "border-transparent text-zinc-400 hover:bg-zinc-800/35 hover:text-zinc-200",
                  )}
                >
                  <div className="min-w-0">
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="shrink-0 text-xs font-semibold text-zinc-200">
                        {candidate.name}
                      </span>
                      {selected && (
                        <Badge size="xs" tone="zinc" className="uppercase tracking-wide">
                          Selected
                        </Badge>
                      )}
                    </div>
                    {displayStrengths.length > 0 && (
                      <div className="mt-1 flex min-w-0 flex-wrap gap-1">
                        {displayStrengths.map((strength) => (
                          <StrengthBadge
                            key={`${strength.kind}-${strength.compound ?? "all"}`}
                            strength={strength}
                          />
                        ))}
                      </div>
                    )}
                  </div>

                  <MetricCell
                    value={formatLapMetric(bestLapValue)}
                    delta={formatLapDelta(
                      bestLapValue && metricColors.bestLap.best !== null
                        ? bestLapValue - metricColors.bestLap.best
                        : undefined,
                    )}
                    className={metricValueClassName(bestLapValue, metricColors.bestLap)}
                  />
                  <MetricCell
                    value={formatLapMetric(medianPaceValue)}
                    delta={formatLapDelta(candidate.comparablePace?.delta)}
                    detail={getPaceDetail(candidate)}
                    className={metricValueClassName(
                      medianPaceValue,
                      metricColors.medianPace,
                    )}
                  />
                  <MetricCell
                    value={formatLapMetric(bestStintValue)}
                    delta={formatLapDelta(candidate.comparableStint?.delta)}
                    detail={
                      candidate.comparableStint?.label ??
                      candidate.bestStintLabel ??
                      undefined
                    }
                    className={metricValueClassName(
                      bestStintValue,
                      metricColors.bestStint,
                    )}
                  />
                  <MetricCell
                    value={formatWearMetric(wearValue)}
                    delta={formatWearDelta(candidate.comparableWear?.delta)}
                    detail={getWearDetail(candidate)}
                    className={metricValueClassName(wearValue, metricColors.wear)}
                  />
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <div className="mt-5 border-t border-white/[0.06] pt-5">
        <SectionHeader
          title={`${selectedCandidate.name} Details`}
          hint={
            <>
              From <SourceLink candidate={selectedCandidate} />
            </>
          }
          className="mb-4"
        />
        <CarSetupCard setup={selectedCandidate.setup} />
      </div>
    </section>
  );
}
