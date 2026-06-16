import {
  Fuel,
  Gauge,
  History,
  Swords,
  Timer,
  Trophy,
  Zap,
} from "lucide-react";
import type { TrackRaceRecommendation } from "../../utils/stats";
import type { TrackRivalBenchmark } from "../../utils/rivalStats";
import { msToLapTime, msToSectorTime } from "../../utils/format";
import { getCompoundColor } from "../../utils/colors";
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
    bestRaceLap,
    raceVsQualiDeltaMs,
    avgErsDeployMj,
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
            <div className="font-mono text-lg text-zinc-100">
              {avgErsDeployMj.toFixed(2)} MJ
            </div>
            <div className="mt-0.5 text-xs text-zinc-500">
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
      <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs text-zinc-400">
        {compound && <CompoundBadge compound={compound} />}
        {gapMs > 0 && <span>+{msToSectorTime(gapMs)} vs. theoretical</span>}
      </div>
    </InsightTile>
  );
}

function CompoundBadge({ compound }: { compound: string }) {
  const color = getCompoundColor(compound);
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-zinc-900/60 px-1.5 py-0.5 text-2xs font-medium text-zinc-300">
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
      <div className="mt-0.5 text-xs text-zinc-500">
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
    recommendedFuelKg: number;
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

  // Clean-race excess: how many laps of fuel you'd typically finish with if
  // every lap burned at the pooled green-flag rate (i.e. no SC tailwind).
  // Negative means the slider value you used would only get you home thanks
  // to safety-car saves — bad advice for next race.
  const excess = target.excessAtFinishLaps;
  const raceLabel = `${target.raceCount} race${target.raceCount === 1 ? "" : "s"}`;
  let note: string | null = null;
  if (Math.abs(excess) >= 0.4) {
    note =
      excess > 0
        ? `~${excess.toFixed(1)} laps spare in a clean race (${raceLabel})`
        : `~${Math.abs(excess).toFixed(1)} laps short in a clean race (${raceLabel})`;
  } else {
    note = `on target for a clean race (${raceLabel})`;
  }

  return (
    <InsightTile title="Rec. Initial Fuel" icon={Fuel} accent="amber">
      <div className="font-mono text-lg text-zinc-100">
        {delta >= 0 ? "+" : ""}
        {delta.toFixed(1)} laps
      </div>
      <div className="mt-0.5 text-xs text-zinc-500">
        ≈ {target.recommendedFuelKg.toFixed(1)} kg total ·{" "}
        {target.burnRateKgPerLap.toFixed(2)} kg/lap burn
      </div>
      {note && <div className="mt-1 text-xs text-zinc-500">{note}</div>}
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
      <div className="mt-0.5 text-xs text-zinc-500">
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
        <div className="mt-0.5 text-xs text-zinc-500">
          <span className={wearNote.tone}>{wearNote.value}</span>{" "}
          {wearNote.suffix}
        </div>
      )}
    </InsightTile>
  );
}
