import { Fuel, Gauge, History, Swords, Timer, Trophy, Zap } from "lucide-react";
import {
  formatEnergyMj,
  formatFuelKg,
  formatKgPerLap,
  joinMetaParts,
  msToLapTime,
  msToSectorTime,
  pluralize,
} from "../../utils/format";
import type { TrackRivalBenchmark } from "../../analysis/rivalStats";
import type {
  TrackFuelTarget,
  TrackRaceRecommendation,
} from "../../analysis/trackStrategyTypes";
import { Tooltip } from "../Tooltip";
import { Badge } from "../ui/Badge";
import { CompoundBadge } from "../ui/CompoundBadge";
import { highlightDetailValues } from "../ui/HighlightedDetailText";
import { InsightDetail, InsightValue } from "../ui/InsightText";
import { InsightTile } from "../ui/InsightTile";
import { SectionHeader } from "../ui/SectionHeader";

/**
 * Race-tab "Key Insights" — a synthesis block that opens the Race tab and
 * answers "what should I actually do here?". Pure presentation: all
 * derivations come from `buildTrackRaceRecommendation()`.
 *
 * Strategy shapes render in `TrackStrategySection`, not here. Each chip (best
 * clean race lap, race-vs-quali, ERS, fuel, since-last-race) renders whenever
 * its data is available, so a track with only short repros still gives useful
 * signal.
 *
 * Each tile uses the shared `InsightTile` shell so this section reads as the
 * same family as the dashboard `Insights` cards (icon + uppercase mono eyebrow
 * + accent surface).
 */
export function TrackKeyInsights({
  recommendation,
  raceLengthLabel,
  rivalBenchmark,
}: {
  recommendation: TrackRaceRecommendation;
  raceLengthLabel?: string;
  /**
   * Fastest online rival the player has raced at this track. Scoped to all
   * online races at the track (not the race-length bucket) since pace
   * comparisons stay valid across short and long races. Undefined when no
   * qualifying rival exists.
   */
  rivalBenchmark?: TrackRivalBenchmark | null;
}) {
  const {
    raceCount,
    fullDistanceRaceCount,
    bestRaceLap,
    raceVsQualiDeltaMs,
    avgErsDeployMj,
    fuelTarget,
    sinceLastRace,
  } = recommendation;

  // Section subtitle: race count moves here (replaces the dead "Races: N" tile).
  const subtitle = joinMetaParts([
    pluralize(raceCount, "race"),
    fullDistanceRaceCount > 0 && fullDistanceRaceCount !== raceCount
      ? `${fullDistanceRaceCount} full-distance`
      : null,
    raceLengthLabel,
  ]);

  return (
    <div>
      <SectionHeader title="Key Insights" hint={subtitle} />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {bestRaceLap && bestRaceLap.bestLapMs > 0 && (
          <BestRaceLapTile
            bestLapMs={bestRaceLap.bestLapMs}
            compound={bestRaceLap.compound}
            gapMs={bestRaceLap.gapToTheoreticalMs}
          />
        )}

        {raceVsQualiDeltaMs !== 0 && (
          <RaceVsQualiTile deltaMs={raceVsQualiDeltaMs} />
        )}

        {avgErsDeployMj > 0 && (
          <InsightTile title="Avg ERS Deployed" icon={Zap} accent="cyan">
            <InsightValue>{formatEnergyMj(avgErsDeployMj, 2)}</InsightValue>
            <InsightDetail className="mt-1.5">
              per lap, green-flag avg
            </InsightDetail>
          </InsightTile>
        )}

        {fuelTarget && <FuelTargetTile target={fuelTarget} />}

        {sinceLastRace &&
          (sinceLastRace.bestLapDeltaMs !== 0 ||
            sinceLastRace.wearRateDelta !== 0) && (
            <VsLastRaceTile
              bestLapDeltaMs={sinceLastRace.bestLapDeltaMs}
              wearRateDelta={sinceLastRace.wearRateDelta}
            />
          )}

        {rivalBenchmark && <FastestRivalTile benchmark={rivalBenchmark} />}
      </div>
    </div>
  );
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function BestRaceLapTile({
  bestLapMs,
  compound,
  gapMs,
}: {
  bestLapMs: number;
  compound: string | null;
  gapMs: number;
}) {
  return (
    <InsightTile
      title="Best Clean Race Lap"
      icon={Timer}
      accent="purple"
      badge={compound ? <CompoundBadge compound={compound} /> : undefined}
    >
      <InsightValue tone="text-best">{msToLapTime(bestLapMs)}</InsightValue>
      {gapMs > 0 && (
        <InsightDetail className="mt-1.5">
          {highlightDetailValues(`+${msToSectorTime(gapMs)} vs. theoretical`)}
        </InsightDetail>
      )}
    </InsightTile>
  );
}

function RaceVsQualiTile({ deltaMs }: { deltaMs: number }) {
  // Race laps are almost always slower than quali — this is descriptive, not
  // judgmental, so render in neutral type rather than red/green.
  const abs = Math.abs(deltaMs);
  const isRaceFaster = deltaMs < 0;
  return (
    <InsightTile title="Race vs. Quali" icon={Gauge}>
      <InsightValue>
        {isRaceFaster ? "-" : "+"}
        {msToSectorTime(abs)}
      </InsightValue>
      <InsightDetail className="mt-1.5">
        best clean race lap vs. best quali lap
      </InsightDetail>
    </InsightTile>
  );
}

function FuelTargetTile({ target }: { target: TrackFuelTarget }) {
  // Hero is the game's fuel-slider value: laps carried beyond the bare minimum
  // at lights out. The amber accent already says "fuel", so the number stays
  // neutral data rather than a verdict. Sample sizes and the P75 burn sit
  // behind the confidence badge to keep this tile as compact as its siblings.
  const delta = target.recommendedDeltaLaps;

  // Clean-race excess: laps of fuel past starts would have finished with had
  // every lap burned at the pooled green-flag rate. Negative means those loads
  // only got home thanks to safety-car saves. Near zero says nothing the hero
  // doesn't, so it only earns a line when it's off.
  const excess = target.excessAtFinishLaps;
  const pastNote =
    Math.abs(excess) >= 0.4
      ? `past starts ~${Math.abs(excess).toFixed(1)} laps ${excess > 0 ? "heavy" : "short"}`
      : null;

  const { confidence, completedRaceCount } = target;
  const finished = completedRaceCount === 0 ? "none" : completedRaceCount;
  const evidence = [
    `Based on ${pluralize(target.eligibleAttemptCount, "race")} here (${finished} finished) and ${pluralize(target.consecutiveGreenPairCount, "green-flag lap")}.`,
    `Burn is the 75th percentile, ${formatKgPerLap(target.burnRateKgPerLap)}, so push laps are covered.`,
    confidence !== "high" && "Finish more races here to raise confidence.",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <InsightTile
      title="Fuel Plan"
      icon={Fuel}
      accent="amber"
      badge={
        <Tooltip text={evidence}>
          <Badge tone="zinc">
            {confidence[0]!.toUpperCase()}
            {confidence.slice(1)} confidence
          </Badge>
        </Tooltip>
      }
    >
      <InsightValue>
        {delta >= 0 ? "+" : ""}
        {delta.toFixed(1)} laps
      </InsightValue>
      <InsightDetail className="mt-1.5">
        {highlightDetailValues(
          `start fuel · ${formatFuelKg(target.recommendedFuelKg)}`,
        )}
      </InsightDetail>
      {pastNote && (
        <InsightDetail size="sm" tone="text-zinc-500" className="mt-1">
          {highlightDetailValues(pastNote)}
        </InsightDetail>
      )}
    </InsightTile>
  );
}

function FastestRivalTile({ benchmark }: { benchmark: TrackRivalBenchmark }) {
  // Mirror the dashboard pace-benchmark sign convention: delta is `rival − you`,
  // so a negative number means the rival was faster than you. Color only the
  // delta itself by who came out ahead — red when the rival has your number,
  // green when you're holding the benchmark.
  const { driverName, paceDeltaMs, basis, raceCount, lapSamples } = benchmark;
  const rivalFaster = paceDeltaMs < 0;
  const matched = paceDeltaMs === 0;
  // When the player is faster than the fastest rival, reframe the tile as a
  // flex: title says "you're fastest", accent/icon shift away from the
  // adversarial rose+Swords pair, and the detail line spells out that we're
  // now showing the next-fastest driver instead of "the one beating you".
  const playerLeads = paceDeltaMs > 0;
  const valueTone = matched
    ? "text-zinc-100"
    : rivalFaster
      ? "text-behind"
      : "text-ahead";
  const sign = paceDeltaMs > 0 ? "+" : paceDeltaMs < 0 ? "−" : "";
  const seconds = (Math.abs(paceDeltaMs) / 1000).toFixed(3);

  // Detail: who they are + sample size + which evidence stream.
  const sampleParts = [pluralize(raceCount, "race")];
  if (basis === "same-compound pace" && lapSamples && lapSamples > 0) {
    sampleParts.push(`${lapSamples} laps · same tyres`);
  } else if (basis === "best-lap fallback") {
    sampleParts.push("best-lap basis");
  }
  if (playerLeads) sampleParts.unshift("next fastest");

  return (
    <InsightTile
      title={playerLeads ? "You're Fastest Here" : "Fastest Online Rival"}
      icon={playerLeads ? Trophy : Swords}
      accent={playerLeads ? "purple" : "rose"}
    >
      <InsightValue>
        {matched ? (
          <>
            Matched{" "}
            <span className="text-sm text-zinc-300">vs. {driverName}</span>
          </>
        ) : (
          <>
            <span className={valueTone}>
              {sign}
              {seconds}s
            </span>
            <span className="ml-2 text-sm text-zinc-300">
              {playerLeads ? `ahead of ${driverName}` : `vs. ${driverName}`}
            </span>
          </>
        )}
      </InsightValue>
      <InsightDetail size="sm" tone="text-zinc-500" className="mt-1.5">
        {highlightDetailValues(sampleParts.join(" · "))}
      </InsightDetail>
    </InsightTile>
  );
}

function VsLastRaceTile({
  bestLapDeltaMs,
  wearRateDelta,
}: {
  bestLapDeltaMs: number;
  wearRateDelta: number;
}) {
  // Hero line: best-lap delta. Verb + magnitude reads at a glance and avoids
  // making the reader interpret a signed number. Only the number itself is
  // tinted — the surrounding prose stays neutral so the tile reads as
  // "data + label" instead of a wall of red/green text.
  const faster = bestLapDeltaMs < 0;
  const matched = bestLapDeltaMs === 0;
  const heroVerb = matched ? "Matched" : faster ? "Faster by" : "Slower by";
  const heroValueTone = matched
    ? "text-zinc-100"
    : faster
      ? "text-ahead"
      : "text-behind";

  // Sub-line: tyre wear change. Negative = gentler on tyres (good).
  let wearNote: { value: string; tone: string; suffix: string } | null = null;
  if (wearRateDelta !== 0) {
    const gentler = wearRateDelta < 0;
    wearNote = {
      value: `${Math.abs(wearRateDelta).toFixed(2)}%/lap`,
      tone: gentler ? "text-ahead" : "text-behind",
      suffix: gentler ? "gentler on tyres" : "harsher on tyres",
    };
  }

  return (
    <InsightTile title="vs. Last Race Here" icon={History}>
      <InsightValue size="md">
        {matched ? (
          <span className="text-zinc-100">Matched last best lap</span>
        ) : (
          <>
            {heroVerb}{" "}
            <span className={heroValueTone}>
              {msToSectorTime(Math.abs(bestLapDeltaMs))}
            </span>
          </>
        )}
      </InsightValue>
      {wearNote && (
        <InsightDetail className="mt-1.5">
          <span className={wearNote.tone}>{wearNote.value}</span>{" "}
          {wearNote.suffix}
        </InsightDetail>
      )}
    </InsightTile>
  );
}
