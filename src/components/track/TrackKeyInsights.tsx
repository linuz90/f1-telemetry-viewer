import {
  Award,
  Disc,
  Fuel,
  Gauge,
  History,
  Info,
  Swords,
  Timer,
  Trophy,
  Zap,
} from "lucide-react";
import type { TrackRaceRecommendation, TrackStrategySuggestion } from "../../utils/stats";
import type { TrackRivalBenchmark } from "../../utils/rivalStats";
import { msToLapTime, msToSectorTime } from "../../utils/format";
import { getCompoundColor } from "../../utils/colors";
import { cardClass, dynamicAccentCardStyle } from "../Card";
import { InsightTile } from "../ui/InsightTile";
import { SectionHeader } from "../ui/SectionHeader";

/**
 * Race-tab "Key Insights" — a synthesis block that opens the Race tab and
 * answers "what should I actually do here?". Pure presentation: all
 * derivations come from `buildTrackRaceRecommendation()`.
 *
 * Evidence gate: recommended + alternative strategy cards only render when the
 * helper reports `hasEvidence` (≥1 near-full-distance multi-stint race in the
 * selected race-length bucket). The always-on chips (best race lap,
 * race-vs-quali, ERS, fuel, since-last-race) render whenever their respective
 * data is available, so a track with only short repros still gives useful
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
    hasEvidence,
    bestRaceLap,
    raceVsQualiDeltaMs,
    avgErsDeployMj,
    recommended,
    alternative,
    fuelTarget,
    sinceLastRace,
  } = recommendation;

  // Section subtitle: race count moves here (replaces the dead "Races: N" tile).
  const subtitleParts: string[] = [];
  subtitleParts.push(`${raceCount} race${raceCount === 1 ? "" : "s"}`);
  if (fullDistanceRaceCount > 0 && fullDistanceRaceCount !== raceCount) {
    subtitleParts.push(`${fullDistanceRaceCount} full-distance`);
  }
  if (raceLengthLabel) subtitleParts.push(raceLengthLabel);
  const subtitle = subtitleParts.join(" · ");

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <SectionHeader>Key Insights</SectionHeader>
        <span className="text-[11px] text-zinc-500">{subtitle}</span>
      </div>

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
            <div className="font-mono text-lg text-zinc-100">
              {avgErsDeployMj.toFixed(2)} MJ
            </div>
            <div className="mt-0.5 text-[11px] text-zinc-500">
              per lap, green-flag avg
            </div>
          </InsightTile>
        )}

        {fuelTarget && <FuelTargetTile target={fuelTarget} />}

        {sinceLastRace && (sinceLastRace.bestLapDeltaMs !== 0 || sinceLastRace.wearRateDelta !== 0) && (
          <VsLastRaceTile
            bestLapDeltaMs={sinceLastRace.bestLapDeltaMs}
            wearRateDelta={sinceLastRace.wearRateDelta}
          />
        )}

        {rivalBenchmark && <FastestRivalTile benchmark={rivalBenchmark} />}

        {hasEvidence && recommended ? (
          <>
            <StrategyTile kind="recommended" strategy={recommended} />
            {alternative && (
              <StrategyTile kind="alternative" strategy={alternative} />
            )}
          </>
        ) : (
          <div className={`${cardClass} flex items-start gap-2 text-xs text-zinc-500`}>
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-zinc-600" />
            <span>
              Not enough race data yet. Finish a multi-stint race at this track
              to unlock a strategy recommendation.
            </span>
          </div>
        )}
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
    <InsightTile title="Best Race Lap" icon={Timer} accent="purple">
      <div className="font-mono text-xl font-semibold text-purple-300">
        {msToLapTime(bestLapMs)}
      </div>
      <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px] text-zinc-400">
        {compound && <CompoundBadge compound={compound} />}
        {gapMs > 0 && <span>+{msToSectorTime(gapMs)} vs. theoretical</span>}
      </div>
    </InsightTile>
  );
}

function CompoundBadge({ compound }: { compound: string }) {
  const color = getCompoundColor(compound);
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-zinc-900/60 px-1.5 py-0.5 text-[10px] font-medium text-zinc-300">
      <span
        className="inline-block h-1.5 w-1.5 rounded-sm"
        style={{ backgroundColor: color }}
      />
      {compound}
    </span>
  );
}

function RaceVsQualiTile({ deltaMs }: { deltaMs: number }) {
  // Race laps are almost always slower than quali — this is descriptive, not
  // judgmental, so render in neutral type rather than red/green.
  const abs = Math.abs(deltaMs);
  const isRaceFaster = deltaMs < 0;
  return (
    <InsightTile title="Race vs. Quali" icon={Gauge}>
      <div className="font-mono text-lg text-zinc-100">
        {isRaceFaster ? "-" : "+"}
        {msToSectorTime(abs)}
      </div>
      <div className="mt-0.5 text-[11px] text-zinc-500">
        best race lap vs. best quali lap
      </div>
    </InsightTile>
  );
}

function FuelTargetTile({
  target,
}: {
  target: {
    recommendedDeltaLaps: number;
    burnRateKgPerLap: number;
    excessAtFinishLaps: number;
    raceCount: number;
  };
}) {
  // Recommended delta is "carry +X laps worth of fuel beyond the bare minimum".
  // Negative = you should carry less; ~0 = on target. The amber tile accent
  // already conveys the "fuel" category — keep the number itself neutral so it
  // reads as data, not a verdict.
  const delta = target.recommendedDeltaLaps;

  // Over-/under-fuel note from observed excess at finish (positive = over-fuel).
  const excess = target.excessAtFinishLaps;
  let note: string | null = null;
  if (Math.abs(excess) >= 0.4) {
    note =
      excess > 0
        ? `You usually over-fuel by ${excess.toFixed(1)} laps`
        : `You usually under-fuel by ${Math.abs(excess).toFixed(1)} laps`;
  }

  return (
    <InsightTile title="Fuel Target" icon={Fuel} accent="amber">
      <div className="font-mono text-lg text-zinc-100">
        {delta >= 0 ? "+" : ""}
        {delta.toFixed(1)} laps initial fuel
      </div>
      <div className="mt-0.5 text-[11px] text-zinc-500">
        {target.burnRateKgPerLap.toFixed(2)} kg/lap burn
      </div>
      {note && <div className="mt-1 text-[11px] text-zinc-500">{note}</div>}
    </InsightTile>
  );
}

function StrategyTile({
  kind,
  strategy,
}: {
  kind: "recommended" | "alternative";
  strategy: TrackStrategySuggestion;
}) {
  const isAlt = kind === "alternative";
  const pitSummary =
    strategy.pitWindows.length > 0
      ? strategy.pitWindows
          .map((w) => `lap ${w.earliest}–${w.latest}`)
          .join(", ")
      : "no-stop";
  // Both recommended and alternative are synthesized from the same compound
  // pace + wear data, so the sub-line shows the underlying race sample size
  // honestly instead of pretending the alternative is "what someone else
  // tried." Falls back to total race count when none of them were full.
  const raceCount =
    strategy.fullDistanceRaceCount > 0
      ? strategy.fullDistanceRaceCount
      : strategy.raceCount;
  const raceKind =
    strategy.fullDistanceRaceCount > 0 ? "full-distance race" : "race";
  const sub = `Based on ${raceCount} ${raceKind}${raceCount === 1 ? "" : "s"} of tyre data`;

  return (
    <InsightTile
      title={isAlt ? "Alternative Strategy" : "Recommended Strategy"}
      icon={isAlt ? Disc : Award}
      accent={isAlt ? "zinc" : "emerald"}
    >
      <div className="flex flex-wrap items-center gap-1.5">
        {strategy.compounds.map((compound, i) => (
          <CompoundLeg
            key={`${compound}-${i}`}
            compound={compound}
            laps={strategy.stintLaps[i]}
            isLast={i === strategy.compounds.length - 1}
          />
        ))}
      </div>
      <div className="mt-1.5 text-[11px] text-zinc-500">
        Pit: {pitSummary} · {sub}
      </div>
    </InsightTile>
  );
}

function CompoundLeg({
  compound,
  laps,
  isLast,
}: {
  compound: string;
  laps: number;
  isLast: boolean;
}) {
  const color = getCompoundColor(compound);
  return (
    <>
      <span
        className="inline-flex items-center gap-1.5 rounded-full px-2 py-1 text-xs text-zinc-100"
        style={dynamicAccentCardStyle(color)}
      >
        <span
          className="inline-block h-2 w-2 rounded-sm"
          style={{ backgroundColor: color }}
        />
        {compound}
        {laps > 0 && (
          <span className="font-mono text-[11px] text-zinc-400">{laps}L</span>
        )}
      </span>
      {!isLast && <span className="text-zinc-500">→</span>}
    </>
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
  const sampleParts = [`${raceCount} race${raceCount === 1 ? "" : "s"}`];
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
      <div className="font-mono text-lg text-zinc-100">
        {matched ? (
          <>Matched <span className="text-sm text-zinc-300">vs. {driverName}</span></>
        ) : (
          <>
            <span className={valueTone}>{sign}{seconds}s</span>
            <span className="ml-2 text-sm text-zinc-300">
              {playerLeads ? `ahead of ${driverName}` : `vs. ${driverName}`}
            </span>
          </>
        )}
      </div>
      <div className="mt-0.5 text-[11px] text-zinc-500">
        {sampleParts.join(" · ")}
      </div>
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
      <div className="font-mono text-lg text-zinc-100">
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
      </div>
      {wearNote && (
        <div className="mt-0.5 text-[11px] text-zinc-500">
          <span className={wearNote.tone}>{wearNote.value}</span>{" "}
          {wearNote.suffix}
        </div>
      )}
    </InsightTile>
  );
}
