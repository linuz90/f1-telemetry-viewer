import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import type {
  RaceSetupCandidate,
  RaceSetupStrength,
} from "../utils/setupComparison";
import { msToLapTime, formatDate, formatSessionType } from "../utils/format";
import { sessionFormulaPath } from "../utils/routes";
import { cardClass } from "./Card";
import { CarSetupCard } from "./CarSetupCard";
import { Badge, type BadgeTone } from "./ui/Badge";

interface RaceSetupComparisonProps {
  candidates: RaceSetupCandidate[];
  activeFormulaKey: string;
  raceLengthLabel?: string;
}

const STRENGTH_META: Record<
  RaceSetupStrength,
  { label: string; tone: BadgeTone }
> = {
  "fastest-lap": { label: "Fastest lap", tone: "sky" },
  "best-pace": { label: "Best pace", tone: "green" },
  "best-stint": { label: "Best stint", tone: "amber" },
  "lowest-deg": { label: "Lowest deg", tone: "green" },
};

function formatLapMetric(value: number | null): string {
  return value ? msToLapTime(value) : "–";
}

function formatWearMetric(value: number | null): string {
  return value ? `${value.toFixed(1)}%/lap` : "–";
}

function pluralizeRace(count: number): string {
  return count === 1 ? "race" : "races";
}

function SourceLink({
  candidate,
  activeFormulaKey,
}: {
  candidate: RaceSetupCandidate;
  activeFormulaKey: string;
}) {
  const { summary, bestLapMs } = candidate.source;

  return (
    <Link
      to={sessionFormulaPath(summary.slug, activeFormulaKey)}
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
  className,
}: {
  value: string;
  detail?: string;
  className?: string;
}) {
  return (
    <div className="min-w-0">
      <div className={`font-mono text-xs tabular-nums ${className ?? "text-zinc-200"}`}>
        {value}
      </div>
      {detail && (
        <div className="mt-0.5 truncate text-[10px] text-zinc-600">{detail}</div>
      )}
    </div>
  );
}

function getDefaultCandidateId(candidates: RaceSetupCandidate[]): string {
  return (
    candidates.find((candidate) =>
      candidate.strengths.includes("fastest-lap"),
    )?.id ??
    candidates[0]?.id ??
    ""
  );
}

export function RaceSetupComparison({
  candidates,
  activeFormulaKey,
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
        <h3 className="text-sm font-semibold text-zinc-300 mb-1">
          Your Best Race Setup
        </h3>
        <p className="text-xs text-zinc-500 mb-4">
          From{" "}
          <SourceLink
            candidate={candidate}
            activeFormulaKey={activeFormulaKey}
          />
        </p>
        <CarSetupCard setup={candidate.setup} />
      </section>
    );
  }

  const totalSamples = candidates.reduce(
    (sum, candidate) => sum + candidate.sampleCount,
    0,
  );
  const raceScope = raceLengthLabel ? `${raceLengthLabel} ` : "";

  return (
    <section className={cardClass}>
      <div className="mb-4">
        <h3 className="text-sm font-semibold text-zinc-300">
          Race Setup Comparison
        </h3>
        <p className="mt-1 text-xs text-zinc-500">
          Observed across {totalSamples} {raceScope}
          {pluralizeRace(totalSamples)}.
        </p>
      </div>

      <div className="-mx-1 overflow-x-auto px-1">
        <div className="min-w-[760px]">
          <div className="grid grid-cols-[minmax(260px,1.6fr)_repeat(5,minmax(88px,0.7fr))] gap-3 px-3 pb-2 text-[10px] font-medium uppercase tracking-wider text-zinc-600">
            <div>Setup</div>
            <div>Best lap</div>
            <div>Clean pace</div>
            <div>Best stint</div>
            <div>Wear</div>
            <div>Races</div>
          </div>
          <div className="space-y-1">
            {candidates.map((candidate) => {
              const selected = candidate.id === selectedCandidate.id;

              return (
                <button
                  key={candidate.id}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => setSelectedId(candidate.id)}
                  className={`grid w-full grid-cols-[minmax(260px,1.6fr)_repeat(5,minmax(88px,0.7fr))] gap-3 rounded-lg px-3 py-3 text-left transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-zinc-600 ${
                    selected
                      ? "bg-zinc-800/70 text-zinc-100"
                      : "text-zinc-400 hover:bg-zinc-800/35 hover:text-zinc-200"
                  }`}
                >
                  <div className="min-w-0">
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="shrink-0 text-xs font-semibold text-zinc-200">
                        {candidate.name}
                      </span>
                      <div className="flex min-w-0 flex-wrap gap-1">
                        {candidate.strengths.map((strength) => {
                          const meta = STRENGTH_META[strength];
                          return (
                            <Badge key={strength} tone={meta.tone}>
                              {meta.label}
                            </Badge>
                          );
                        })}
                      </div>
                    </div>
                    <div className="mt-1 truncate text-[11px] text-zinc-500">
                      {candidate.setupSummary}
                    </div>
                  </div>

                  <MetricCell
                    value={formatLapMetric(candidate.bestLapMs)}
                    className="text-purple-300"
                  />
                  <MetricCell
                    value={formatLapMetric(candidate.avgCleanPaceMs)}
                    detail={
                      candidate.cleanLapCount > 0
                        ? `${candidate.cleanLapCount} clean laps`
                        : undefined
                    }
                    className="text-cyan-300"
                  />
                  <MetricCell
                    value={formatLapMetric(candidate.bestStintPaceMs)}
                    detail={candidate.bestStintLabel ?? undefined}
                    className="text-amber-300"
                  />
                  <MetricCell
                    value={formatWearMetric(candidate.avgWearRatePerLap)}
                    className="text-emerald-300"
                  />
                  <MetricCell
                    value={String(candidate.sampleCount)}
                    detail={pluralizeRace(candidate.sampleCount)}
                  />
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <div className="mt-5 border-t border-white/[0.06] pt-5">
        <p className="text-xs text-zinc-500 mb-4">
          Detail from{" "}
          <SourceLink
            candidate={selectedCandidate}
            activeFormulaKey={activeFormulaKey}
          />
        </p>
        <CarSetupCard setup={selectedCandidate.setup} />
      </div>
    </section>
  );
}
