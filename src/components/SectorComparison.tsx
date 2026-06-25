import { useState } from "react";
import { buildSectorBreakdownModel } from "../analysis/sectorAnalysis";
import { PERF_COLORS, type PerformanceTone } from "../constants/colors";
import { TIME_MATCH_TOLERANCE_SECONDS } from "../constants/timing";
import type {
  LapHistoryEntry,
  PerLapInfo,
  TyreStintBasic,
} from "../types/telemetry";
import { cn } from "../utils/cn";
import { msToLapTime, msToSectorTime } from "../utils/format";
import { Badge } from "./ui/Badge";
import { CompoundSwatchLabel } from "./ui/CompoundSwatchLabel";
import { Eyebrow } from "./ui/Eyebrow";
import { FocusToggle } from "./ui/FocusToggle";
import { SectionHeader } from "./ui/SectionHeader";

interface SectorComparisonProps {
  laps: LapHistoryEntry[];
  stints?: TyreStintBasic[];
  perLapInfo?: PerLapInfo[];
}

type SectorTone = PerformanceTone;

const SECTOR_TONE_CLASS: Record<SectorTone, string> = {
  best: "bg-purple-500/10 ring-purple-400/25",
  worst: "bg-amber-500/10 ring-amber-400/20",
  normal: "bg-white/[0.03] ring-white/[0.06]",
  invalid: "bg-white/[0.03] ring-white/[0.06]",
};

const SECTOR_LABEL_CLASS: Record<SectorTone, string> = {
  best: "text-purple-200/60",
  worst: "text-amber-200/60",
  normal: "text-zinc-500",
  invalid: "text-zinc-500",
};

const SECTOR_VALUE_CLASS: Record<SectorTone, string> = {
  best: "text-white font-semibold",
  worst: "text-amber-50",
  normal: "text-zinc-100",
  invalid: "text-zinc-100",
};

function sectorTone({
  valid,
  isBestSector,
  isWorstSector,
}: {
  valid: boolean;
  isBestSector: boolean;
  isWorstSector: boolean;
}): SectorTone {
  if (!valid) return "invalid";
  if (isBestSector) return "best";
  if (isWorstSector) return "worst";
  return "normal";
}

/**
 * Compact lap-by-lap sector breakdown.
 *
 * TT and qualifying runs often have many invalid laps; mark them explicitly
 * without dimming the whole row so sector timing still stays easy to scan.
 */
export function SectorComparison({
  laps,
  stints,
  perLapInfo,
}: SectorComparisonProps) {
  const [showInvalidLaps, setShowInvalidLaps] = useState(false);
  const model = buildSectorBreakdownModel({ laps, stints, perLapInfo });
  if (!model.laps.length) {
    return <p className="text-sm text-zinc-500">No lap data for comparison.</p>;
  }

  const invalidLapCount = model.laps.filter((lap) => !lap.valid).length;
  const canFilterInvalidLaps =
    invalidLapCount > 0 && invalidLapCount < model.laps.length;
  const displayedLaps =
    canFilterInvalidLaps && !showInvalidLaps
      ? model.laps.filter((lap) => lap.valid)
      : model.laps;
  const toggleInvalidLaps = () => setShowInvalidLaps((value) => !value);

  return (
    <div>
      <SectionHeader
        size="sm"
        title="Your Lap Breakdown"
        action={
          canFilterInvalidLaps ? (
            <FocusToggle
              label={`Show invalid (${invalidLapCount})`}
              value={showInvalidLaps}
              onChange={toggleInvalidLaps}
            />
          ) : undefined
        }
      />

      <div className="space-y-5">
        {displayedLaps.map((d) => {
          const isBest =
            model.bestTime !== null &&
            d.valid &&
            Math.abs(d.total - model.bestTime) < TIME_MATCH_TOLERANCE_SECONDS;
          const delta =
            model.bestTime !== null && d.valid
              ? d.total - model.bestTime
              : null;

          return (
            <div key={d.lap}>
              <div className="mb-2 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <span className="text-sm font-semibold text-zinc-300">
                    Lap {d.lap}
                  </span>
                  {d.compound && (
                    <CompoundSwatchLabel
                      compound={d.compound}
                      labelClassName="text-zinc-400"
                    />
                  )}
                  {!d.valid && (
                    <Badge tone="zinc" size="xs" shape="square">
                      Invalid
                    </Badge>
                  )}
                </div>

                <div className="grid shrink-0 grid-cols-[5.75rem_4.5rem] items-center gap-3 self-end text-right font-mono text-sm sm:self-auto">
                  <span
                    className={cn(
                      "font-semibold",
                      isBest ? "text-best" : "text-zinc-200",
                    )}
                  >
                    {msToLapTime(d.total * 1000)}
                  </span>
                  <span className="flex justify-end">
                    {isBest ? (
                      <Badge tone="purple" size="xs" shape="square">
                        BEST
                      </Badge>
                    ) : delta !== null ? (
                      <span className="text-zinc-500">+{delta.toFixed(3)}</span>
                    ) : (
                      <span className="text-zinc-700">–</span>
                    )}
                  </span>
                </div>
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

              <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-3">
                {(["s1", "s2", "s3"] as const).map((key) => {
                  const sectorKey = key.toUpperCase() as "S1" | "S2" | "S3";
                  const time = d[key];
                  const best = model.bestBySector[key];
                  const worst = model.worstBySector[key];
                  const isBestSector =
                    d.valid &&
                    Math.abs(time - best) < TIME_MATCH_TOLERANCE_SECONDS;
                  const isWorstSector =
                    d.valid &&
                    model.validLapCount > 1 &&
                    Math.abs(time - worst) < TIME_MATCH_TOLERANCE_SECONDS;
                  const tone = sectorTone({
                    valid: d.valid,
                    isBestSector,
                    isWorstSector,
                  });

                  return (
                    <div
                      key={key}
                      className={cn(
                        "relative min-h-10 overflow-hidden rounded-lg px-3 py-2 font-mono ring-1 ring-inset",
                        SECTOR_TONE_CLASS[tone],
                      )}
                    >
                      <span
                        className="absolute inset-y-2 left-0 w-0.75 rounded-r-full"
                        style={{ backgroundColor: PERF_COLORS[tone] }}
                      />
                      <div className="flex items-center justify-between gap-3 h-full">
                        <span
                          className={cn(
                            "text-sm font-semibold uppercase tracking-normal",
                            SECTOR_LABEL_CLASS[tone],
                          )}
                        >
                          {sectorKey}
                        </span>
                        <span
                          className={cn(
                            "text-sm sm:text-md tabular-nums",
                            SECTOR_VALUE_CLASS[tone],
                          )}
                        >
                          {msToSectorTime(time * 1000)}
                        </span>
                      </div>
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
