import type { DriverData } from "../types/telemetry";
import {
  F1_PIT_LOSS_FAMILY_MEDIAN_MS,
  getF1PitLossDefaultMs,
} from "../constants/pitLoss";
import { getFormulaComparisonKey } from "../utils/sessionTypes";
import { median } from "../utils/stats/core";
import type { CompoundLifeStats } from "../utils/stats/trackAggregates";
import { getRacePaceLapSamples } from "../utils/stats/laps";
import {
  buildWorstWearByLap,
  getDriverStints,
  getNeutralisedLaps,
  getWorstStintEndWear,
  PUNCTURE_THRESHOLD,
} from "../utils/stats/tyres";
import {
  DEFAULT_COMPOUND_STEP_MS,
  DRY_COMPOUND_PRIORITY,
  isDryCompound,
} from "./trackStrategyCompounds";
import type {
  BucketRaceEntry,
  TrackStrategyShape,
  TrackStrategyTimeEstimate,
} from "./trackStrategyTypes";

type StrategyEstimateConfidence = TrackStrategyTimeEstimate["confidence"];

// Lap time lost per % of worst-wheel wear, with driver-race fixed effects:
// the player 22–37 ms/% (Hard to Medium), the whole field 34–54 ms/% by
// compound. The loss stays linear right up to the puncture cap (43, 38 and
// 41 ms/% below 30%, 30–55% and above 55%), so there is no high-wear surcharge.
// Fresh-tyre pace offsets are corrected at the same rate, so wear is charged
// once.
const WEAR_LAP_TIME_MS_PER_PERCENT = 30;
const MANAGED_RISK_PENALTY_MS_PER_PERCENT = 3000;
const PIT_LOSS_MIN_MS = 10_000;
const PIT_LOSS_MAX_MS = 45_000;
const PIT_LOSS_LOOKAROUND_LAPS = 6;
const PIT_LOSS_NEIGHBOR_SAMPLE_COUNT = 3;
const PIT_LOSS_REFERENCE_OUTLIER_MS = 7_000;
const PIT_LOSS_REFERENCE_OUTLIER_RATIO = 0.3;
const PIT_LOSS_SAMPLE_OUTLIER_MS = 5_000;
const PIT_LOSS_SAMPLE_OUTLIER_RATIO = 0.18;
const PIT_LOSS_HIGH_CONFIDENCE_SPREAD_MS = 3_000;
// Lap-time cost of fuel: 0.028 ± 0.004 s/kg with driver-race fixed effects
// over 352 human driver-races in F1 25, F1 26 and F2 (the player alone,
// 0.021 ± 0.011 over 69 races). Per-track values ranged 0.017–0.053.
const FUEL_LAP_TIME_MS_PER_KG = 30;
// A compound's clean laps only count as pace evidence from more than one race
// and more than a handful of laps. One short stint carries that race's fuel
// load and conditions: Sakhir's only Soft laps came after a late Safety Car on
// ~5 kg of fuel and read 1.4 s/lap faster than Medium and Hard.
const MIN_PACE_EVIDENCE_LAPS = 6;
const MIN_PACE_EVIDENCE_RACES = 2;
// Clean laps one race needs on a compound before its median counts.
const MIN_PACE_CELL_LAPS = 2;
// A softer compound may measure up to this much slower than a harder one
// before the pair counts as inverted rather than noise.
const COMPOUND_ORDER_TOLERANCE_MS = 100;

interface PitLossEstimate {
  ms: number;
  confidence: StrategyEstimateConfidence;
  source: string;
}

interface PitLossSample {
  lossMs: number;
}

interface CompoundPaceModel {
  offsetsMs: Map<string, number>;
  confidence: StrategyEstimateConfidence;
  source: string;
  /** Compounds placed by compound order, not by their own laps. */
  assumedCompounds?: Set<string>;
}

export interface StrategyTimingContext {
  pitLoss: PitLossEstimate;
  paceModel: CompoundPaceModel;
  strategyPaceModels: Map<number, CompoundPaceModel>;
}

export interface StrategyScore {
  totalScoreMs: number;
  tyrePaceMs: number;
  wearDegradationMs: number;
  pitLossMs: number;
  managedRiskPenaltyMs: number;
  paceConfidence: StrategyEstimateConfidence;
  paceSource: string;
}

interface StrategyTimeAnchor {
  observedTotalRaceMs: number;
  observedStrategyScoreMs: number;
  confidence: StrategyEstimateConfidence;
  source: string;
}

function confidenceRank(confidence: StrategyEstimateConfidence): number {
  if (confidence === "high") return 2;
  if (confidence === "medium") return 1;
  return 0;
}

function lowerConfidence(
  a: StrategyEstimateConfidence,
  b: StrategyEstimateConfidence,
): StrategyEstimateConfidence {
  return confidenceRank(a) < confidenceRank(b) ? a : b;
}

function getLapTimeMs(player: DriverData, lapNumber: number): number {
  const lap = player["session-history"]["lap-history-data"][lapNumber - 1];
  return lap?.["lap-time-in-ms"] ?? 0;
}

function isGreenFlagLap(player: DriverData, lapNumber: number): boolean {
  const lap = player["per-lap-info"]?.find(
    (p) => p["lap-number"] === lapNumber,
  );
  return (
    (lap?.["max-safety-car-status"] ?? "NO_SAFETY_CAR") === "NO_SAFETY_CAR"
  );
}

function nearbyCleanMedianLapTime(
  samples: ReturnType<typeof getRacePaceLapSamples>,
  targetLap: number,
  direction: -1 | 1,
): number | null {
  const values = samples
    .filter((sample) =>
      direction < 0
        ? sample.lapNumber < targetLap
        : sample.lapNumber > targetLap,
    )
    .map((sample) => ({
      distance: Math.abs(sample.lapNumber - targetLap),
      timeMs: sample.timeMs,
    }))
    .filter((sample) => sample.distance <= PIT_LOSS_LOOKAROUND_LAPS)
    .sort((a, b) => a.distance - b.distance)
    .slice(0, PIT_LOSS_NEIGHBOR_SAMPLE_COUNT)
    .map((sample) => sample.timeMs);

  return median(values) ?? null;
}

function isNearReferencePitLoss(lossMs: number, referenceMs: number): boolean {
  const tolerance = Math.max(
    PIT_LOSS_REFERENCE_OUTLIER_MS,
    referenceMs * PIT_LOSS_REFERENCE_OUTLIER_RATIO,
  );
  return Math.abs(lossMs - referenceMs) <= tolerance;
}

function filterPitLossOutliers(
  samples: PitLossSample[],
  referenceMs: number | null,
): PitLossSample[] {
  let eligible = referenceMs
    ? samples.filter((sample) =>
        isNearReferencePitLoss(sample.lossMs, referenceMs),
      )
    : samples;

  if (eligible.length <= 1) return eligible;

  if (eligible.length === 2) {
    const spread = Math.abs(eligible[0].lossMs - eligible[1].lossMs);
    // With only two stops, a wide disagreement is more likely traffic/impeding
    // than real pit-lane geometry. Prefer the sourced/default fallback instead
    // of averaging one clean stop with one compromised stop.
    return spread <= PIT_LOSS_SAMPLE_OUTLIER_MS ? eligible : [];
  }

  const center = median(eligible.map((sample) => sample.lossMs));
  if (center == null) return [];

  const tolerance = Math.max(
    PIT_LOSS_SAMPLE_OUTLIER_MS,
    center * PIT_LOSS_SAMPLE_OUTLIER_RATIO,
  );
  const filtered = eligible.filter(
    (sample) => Math.abs(sample.lossMs - center) <= tolerance,
  );

  // If the robust pass rejects everything, none of the samples are meaningful
  // enough to beat the track default.
  eligible = filtered;
  return eligible;
}

function pitLossSource(usedCount: number, totalCount: number): string {
  const ignoredCount = totalCount - usedCount;
  const stopLabel = `user pit stop${totalCount === 1 ? "" : "s"}`;
  if (ignoredCount <= 0) return `inferred from ${usedCount} ${stopLabel}`;

  return `inferred from ${usedCount} of ${totalCount} ${stopLabel}; ignored ${ignoredCount} outlier${ignoredCount === 1 ? "" : "s"}`;
}

function inferPitLoss(
  entries: BucketRaceEntry[],
  referenceMs: number | null,
): PitLossEstimate | null {
  const samples: PitLossSample[] = [];

  for (const entry of entries) {
    const stints = getDriverStints(entry.player);
    if (stints.length < 2) continue;

    const cleanSamples = getRacePaceLapSamples(entry.player);
    if (cleanSamples.length < 4) continue;

    for (let i = 0; i < stints.length - 1; i++) {
      const pitInLap = stints[i]["end-lap"];
      const pitOutLap = pitInLap + 1;
      if (!isGreenFlagLap(entry.player, pitInLap)) continue;
      if (!isGreenFlagLap(entry.player, pitOutLap)) continue;

      const pitInMs = getLapTimeMs(entry.player, pitInLap);
      const pitOutMs = getLapTimeMs(entry.player, pitOutLap);
      if (pitInMs <= 0 || pitOutMs <= 0) continue;

      const expectedInMs = nearbyCleanMedianLapTime(cleanSamples, pitInLap, -1);
      const expectedOutMs = nearbyCleanMedianLapTime(
        cleanSamples,
        pitOutLap,
        1,
      );
      if (expectedInMs == null || expectedOutMs == null) continue;

      const lossMs = pitInMs + pitOutMs - expectedInMs - expectedOutMs;
      if (lossMs >= PIT_LOSS_MIN_MS && lossMs <= PIT_LOSS_MAX_MS) {
        samples.push({ lossMs });
      }
    }
  }

  const filteredSamples = filterPitLossOutliers(samples, referenceMs);
  const losses = filteredSamples.map((sample) => sample.lossMs);
  const pitLossMs = median(losses);
  if (pitLossMs == null) return null;
  const spread =
    losses.length > 1 ? Math.max(...losses) - Math.min(...losses) : 0;

  return {
    ms: pitLossMs,
    confidence:
      losses.length >= 2 && spread <= PIT_LOSS_HIGH_CONFIDENCE_SPREAD_MS
        ? "high"
        : "medium",
    source: pitLossSource(losses.length, samples.length),
  };
}

function resolvePitLoss(
  pitLossEntries: BucketRaceEntry[],
  representative: BucketRaceEntry,
): PitLossEstimate | null {
  const formulaKey = getFormulaComparisonKey(
    representative.session["session-info"].formula,
    representative.session["game-year"],
  );
  const trackId = representative.session["session-info"]["track-id"];
  const defaultMs = formulaKey.startsWith("f1-")
    ? getF1PitLossDefaultMs(trackId)
    : null;
  const inferred = inferPitLoss(pitLossEntries, defaultMs);
  if (inferred) return inferred;

  if (!formulaKey.startsWith("f1-")) return null;

  if (defaultMs != null) {
    return {
      ms: defaultMs,
      confidence: "medium",
      source: `Pits n' Giggles ${trackId} default`,
    };
  }

  return {
    ms: F1_PIT_LOSS_FAMILY_MEDIAN_MS,
    confidence: "low",
    source: "F1 pit-loss default median",
  };
}

function normalizeOffsets(
  rawOffsets: Map<string, number>,
): Map<string, number> {
  const values = [...rawOffsets.values()];
  const min = Math.min(...values);
  const normalized = new Map<string, number>();
  for (const [compound, offset] of rawOffsets) {
    normalized.set(compound, offset - min);
  }
  return normalized;
}

interface CorrectedPaceSample {
  compound: string;
  /** Lap time with the fuel and tyre wear on board taken off. */
  freshEmptyMs: number;
}

/** Clean laps put on one footing: an empty tank and fresh tyres. A lap-number
 *  trend can't do this: in-stint degradation cancels the fuel gain, so the
 *  late, light stint's tyre reads fastest. */
function correctedPaceSamples(entry: BucketRaceEntry): CorrectedPaceSample[] {
  const player = entry.player;
  const fuelByLap = new Map<number, number>();
  for (const lap of player["per-lap-info"] ?? []) {
    const fuelKg = lap["car-status-data"]?.["fuel-in-tank"];
    if (Number.isFinite(fuelKg) && fuelKg >= 0) {
      fuelByLap.set(lap["lap-number"], fuelKg);
    }
  }
  const wearByLap = buildWorstWearByLap(getDriverStints(player));
  const neutralisedLaps = getNeutralisedLaps(player["per-lap-info"]);

  return getRacePaceLapSamples(player).flatMap((sample) => {
    const { compound, lapNumber } = sample;
    if (!compound || !isDryCompound(compound)) return [];
    // Tyres and brakes cool behind the Safety Car, so the first green lap
    // after it is not a representative racing lap.
    if (neutralisedLaps.has(lapNumber - 1)) return [];
    // Per-lap snapshots are taken as each lap ends, so the lap ran on the
    // average of its own and the previous snapshot.
    const fuelStart = fuelByLap.get(lapNumber - 1);
    const fuelEnd = fuelByLap.get(lapNumber);
    const wearStart = wearByLap.get(lapNumber - 1);
    const wearEnd = wearByLap.get(lapNumber);
    if (
      fuelStart == null ||
      fuelEnd == null ||
      wearStart == null ||
      wearEnd == null
    ) {
      return [];
    }
    return [
      {
        compound,
        freshEmptyMs:
          sample.timeMs -
          ((fuelStart + fuelEnd) / 2) * FUEL_LAP_TIME_MS_PER_KG -
          ((wearStart + wearEnd) / 2) * WEAR_LAP_TIME_MS_PER_PERCENT,
      },
    ];
  });
}

/** One race's median corrected lap on one compound. */
interface PaceCell {
  race: string;
  compound: string;
  medianMs: number;
  lapCount: number;
}

/** One cell per race and dry compound, each race counted once. Track
 *  Progress keeps several saves of one session, which would otherwise pass
 *  the two-race evidence floor on their own. Races that put on a wet tyre
 *  are left out: slick laps on a drying track are not dry pace. */
function buildPaceCells(entries: BucketRaceEntry[]): PaceCell[] {
  const samplesByRace = new Map<string, CorrectedPaceSample[]>();
  for (const [index, entry] of entries.entries()) {
    const hasWetStint = getDriverStints(entry.player).some(
      (stint) => !isDryCompound(stint["tyre-set-data"]["visual-tyre-compound"]),
    );
    if (hasWetStint) continue;
    const race = String(
      entry.session.debug?.["session-uid"] ?? `entry-${index}`,
    );
    const samples = correctedPaceSamples(entry);
    // Later saves of a session hold every lap the earlier ones did.
    if (samples.length > (samplesByRace.get(race)?.length ?? -1)) {
      samplesByRace.set(race, samples);
    }
  }

  const cells: PaceCell[] = [];
  for (const [race, samples] of samplesByRace) {
    const byCompound = new Map<string, number[]>();
    for (const sample of samples) {
      const lapTimes = byCompound.get(sample.compound) ?? [];
      lapTimes.push(sample.freshEmptyMs);
      byCompound.set(sample.compound, lapTimes);
    }
    for (const [compound, lapTimes] of byCompound) {
      if (lapTimes.length < MIN_PACE_CELL_LAPS) continue;
      cells.push({
        race,
        compound,
        medianMs: median(lapTimes)!,
        lapCount: lapTimes.length,
      });
    }
  }
  return cells;
}

/** Compound effects with each race compared only with itself: alternate race
 *  and compound medians until they settle (median polish). A race's driver
 *  form, setup and track state cancel out of its own compound differences. */
function fitCompoundEffects(cells: PaceCell[]): Map<string, number> {
  const compoundEffects = new Map(cells.map((cell) => [cell.compound, 0]));
  const raceEffects = new Map<string, number>();
  for (let pass = 0; pass < 20; pass++) {
    for (const race of new Set(cells.map((cell) => cell.race))) {
      raceEffects.set(
        race,
        median(
          cells
            .filter((cell) => cell.race === race)
            .map((cell) => cell.medianMs - compoundEffects.get(cell.compound)!),
        )!,
      );
    }
    for (const compound of compoundEffects.keys()) {
      compoundEffects.set(
        compound,
        median(
          cells
            .filter((cell) => cell.compound === compound)
            .map((cell) => cell.medianMs - raceEffects.get(cell.race)!),
        )!,
      );
    }
  }
  return compoundEffects;
}

/** The first softer/harder pair whose measured pace inverts the compound
 *  order by more than noise. */
function findOrderInversion(
  offsets: Map<string, number>,
): [softer: string, harder: string] | null {
  for (const [softer, softerOffset] of offsets) {
    for (const [harder, harderOffset] of offsets) {
      const softerPriority = DRY_COMPOUND_PRIORITY[softer];
      const harderPriority = DRY_COMPOUND_PRIORITY[harder];
      if (
        softerPriority == null ||
        harderPriority == null ||
        softerPriority >= harderPriority
      ) {
        continue;
      }
      if (softerOffset > harderOffset + COMPOUND_ORDER_TOLERANCE_MS) {
        return [softer, harder];
      }
    }
  }
  return null;
}

function buildCleanLapPaceModel(
  entries: BucketRaceEntry[],
): CompoundPaceModel | null {
  const allCells = buildPaceCells(entries);
  const active = new Set(allCells.map((cell) => cell.compound));

  // Drop compounds until the rest are measured and in order: thin ones first,
  // then, while the order inverts, whichever of the pair has fewer laps.
  // Dropped compounds are placed by compound order downstream.
  while (active.size >= 2) {
    const usable = allCells.filter((cell) => active.has(cell.compound));
    const compoundsPerRace = new Map<string, number>();
    for (const cell of usable) {
      compoundsPerRace.set(
        cell.race,
        (compoundsPerRace.get(cell.race) ?? 0) + 1,
      );
    }
    // Only a race that ran two compounds can compare them.
    const cells = usable.filter(
      (cell) => (compoundsPerRace.get(cell.race) ?? 0) >= 2,
    );
    const lapCounts = new Map<string, number>();
    const raceCounts = new Map<string, number>();
    for (const cell of cells) {
      lapCounts.set(
        cell.compound,
        (lapCounts.get(cell.compound) ?? 0) + cell.lapCount,
      );
      raceCounts.set(cell.compound, (raceCounts.get(cell.compound) ?? 0) + 1);
    }
    const thin = [...active].filter(
      (compound) =>
        (lapCounts.get(compound) ?? 0) < MIN_PACE_EVIDENCE_LAPS ||
        (raceCounts.get(compound) ?? 0) < MIN_PACE_EVIDENCE_RACES,
    );
    if (thin.length > 0) {
      for (const compound of thin) active.delete(compound);
      continue;
    }

    const offsetsMs = normalizeOffsets(fitCompoundEffects(cells));
    const inversion = findOrderInversion(offsetsMs);
    if (inversion) {
      const [softer, harder] = inversion;
      active.delete(
        lapCounts.get(softer)! <= lapCounts.get(harder)! ? softer : harder,
      );
      continue;
    }

    const sampleCount = [...lapCounts.values()].reduce((a, b) => a + b, 0);
    return {
      offsetsMs,
      confidence: sampleCount >= 18 ? "medium" : "low",
      source:
        "distance-matched clean-lap pace within races, fuel and wear corrected",
    };
  }
  return null;
}

function buildDefaultPaceModel(
  rankedCompounds: CompoundLifeStats[],
): CompoundPaceModel {
  const priorities = rankedCompounds.map(
    (compound) => DRY_COMPOUND_PRIORITY[compound.compound] ?? 2,
  );
  const minPriority = Math.min(...priorities);
  const offsets = new Map<string, number>();
  for (const compound of rankedCompounds) {
    const priority = DRY_COMPOUND_PRIORITY[compound.compound] ?? 2;
    offsets.set(
      compound.compound,
      (priority - minPriority) * DEFAULT_COMPOUND_STEP_MS,
    );
  }

  return {
    offsetsMs: offsets,
    confidence: "low",
    source: "compound-order fallback",
  };
}

function resolveEvidenceCompoundPaceModel(
  entries: BucketRaceEntry[],
): CompoundPaceModel | null {
  // The game's tyre-set `lap-delta-time` is no fallback: each stint's value is
  // measured against whichever set was fitted when PnG saved and includes the
  // set's own wear, and even new sets' deltas (~0.5 s a compound step) are a
  // fresh-tyre ideal, about three times the gap races actually show.
  return buildCleanLapPaceModel(entries);
}

function resolveCompoundPaceModel(
  entries: BucketRaceEntry[],
  rankedCompounds: CompoundLifeStats[],
): CompoundPaceModel {
  // Without two measured compounds, the game's compound order is the only
  // honest ranking.
  return (
    resolveEvidenceCompoundPaceModel(entries) ??
    buildDefaultPaceModel(rankedCompounds)
  );
}

function observedStopCount(entry: BucketRaceEntry): number {
  return Math.max(0, getDriverStints(entry.player).length - 1);
}

function strategyStopCountLabel(stopCount: number): string {
  if (stopCount === 0) return "no-stop";
  if (stopCount === 1) return "one-stop";
  if (stopCount === 2) return "two-stop";
  return `${stopCount}-stop`;
}

function alignPaceModelToSharedScale(
  model: CompoundPaceModel,
  sharedModel: CompoundPaceModel,
): CompoundPaceModel | null {
  const shifts = [...model.offsetsMs.entries()]
    .map(([compound, offset]) => {
      const sharedOffset = sharedModel.offsetsMs.get(compound);
      return sharedOffset == null ? null : sharedOffset - offset;
    })
    .filter((value): value is number => value != null);
  const shift = median(shifts);
  if (shift == null) return null;

  const offsetsMs = new Map<string, number>();
  for (const [compound, offset] of model.offsetsMs) {
    offsetsMs.set(compound, offset + shift);
  }

  return {
    ...model,
    offsetsMs,
    source: `${model.source}; aligned to shared compound scale`,
  };
}

function buildStrategyPaceModels(
  entries: BucketRaceEntry[],
  sharedModel: CompoundPaceModel,
): Map<number, CompoundPaceModel> {
  const models = new Map<number, CompoundPaceModel>();
  const stopCounts = new Set(entries.map((entry) => observedStopCount(entry)));

  for (const stopCount of stopCounts) {
    const matchingEntries = entries.filter(
      (entry) => observedStopCount(entry) === stopCount,
    );
    const evidenceModel = resolveEvidenceCompoundPaceModel(matchingEntries);
    if (!evidenceModel) continue;
    const alignedModel = alignPaceModelToSharedScale(
      evidenceModel,
      sharedModel,
    );
    if (!alignedModel) continue;

    models.set(stopCount, {
      ...alignedModel,
      source: `${strategyStopCountLabel(stopCount)} matched ${alignedModel.source}`,
    });
  }

  return models;
}

function fallbackCompoundOffsetMs(compound: string): number {
  return (DRY_COMPOUND_PRIORITY[compound] ?? 2) * DEFAULT_COMPOUND_STEP_MS;
}

/** Places compounds the model has no evidence for: between two measured
 *  neighbours by interpolation, otherwise one default compound step per rung
 *  past the nearest measured compound, so a thinly run Soft sits just ahead
 *  of a measured Medium instead of at the scale's zero. */
function withAssumedCompounds(
  model: CompoundPaceModel,
  rankedCompounds: CompoundLifeStats[],
): CompoundPaceModel {
  const measured = [...model.offsetsMs.entries()].filter(
    ([compound]) => DRY_COMPOUND_PRIORITY[compound] != null,
  );
  if (measured.length === 0) return model;

  const offsetsMs = new Map(model.offsetsMs);
  const assumedCompounds = new Set<string>();
  for (const { compound } of rankedCompounds) {
    const priority = DRY_COMPOUND_PRIORITY[compound];
    if (offsetsMs.has(compound) || priority == null) continue;
    const nearestOn = (side: -1 | 1) =>
      measured
        .filter(
          ([measuredCompound]) =>
            Math.sign(DRY_COMPOUND_PRIORITY[measuredCompound]! - priority) ===
            side,
        )
        .sort(
          (a, b) =>
            Math.abs(DRY_COMPOUND_PRIORITY[a[0]]! - priority) -
            Math.abs(DRY_COMPOUND_PRIORITY[b[0]]! - priority),
        )[0];
    const softer = nearestOn(-1);
    const harder = nearestOn(1);
    let offsetMs: number;
    if (softer && harder) {
      const softerPriority = DRY_COMPOUND_PRIORITY[softer[0]]!;
      const progress =
        (priority - softerPriority) /
        (DRY_COMPOUND_PRIORITY[harder[0]]! - softerPriority);
      offsetMs = softer[1] + (harder[1] - softer[1]) * progress;
    } else {
      const [anchorCompound, anchorOffset] = (softer ?? harder)!;
      offsetMs =
        anchorOffset +
        (priority - DRY_COMPOUND_PRIORITY[anchorCompound]!) *
          DEFAULT_COMPOUND_STEP_MS;
    }
    offsetsMs.set(compound, offsetMs);
    assumedCompounds.add(compound);
  }
  if (assumedCompounds.size === 0) return model;

  return { ...model, offsetsMs: normalizeOffsets(offsetsMs), assumedCompounds };
}

/** Lap time a stint loses to its own wear, with wear rising evenly to
 *  `endWearPercent`. Each lap pays for its mid-lap wear, as the pace model
 *  measures it, which sums to half the end wear on every lap. */
function projectedWearDegradationMs(endWearPercent: number, stintLaps: number) {
  return (WEAR_LAP_TIME_MS_PER_PERCENT * endWearPercent * stintLaps) / 2;
}

export function scoreShape(
  shape: TrackStrategyShape,
  context: StrategyTimingContext,
): StrategyScore {
  let tyrePaceMs = 0;
  let wearDegradationMs = 0;
  const stopCount = Math.max(0, shape.compounds.length - 1);
  const paceModel =
    context.strategyPaceModels.get(stopCount) ?? context.paceModel;

  const assumedCompounds = new Set<string>();
  let paceConfidence = paceModel.confidence;
  for (let i = 0; i < shape.compounds.length; i++) {
    const compound = shape.compounds[i];
    const stintLaps = shape.stintLaps[i];
    const endWear = shape.stintWearPercentages[i];
    // A stop-count model only covers compounds its own races ran; the shared
    // model fills the rest on the same scale.
    const sourceModel = paceModel.offsetsMs.has(compound)
      ? paceModel
      : context.paceModel;
    const offsetMs =
      sourceModel.offsetsMs.get(compound) ?? fallbackCompoundOffsetMs(compound);
    if (sourceModel.assumedCompounds?.has(compound)) {
      assumedCompounds.add(compound);
    }
    paceConfidence = lowerConfidence(paceConfidence, sourceModel.confidence);
    tyrePaceMs += offsetMs * stintLaps;
    wearDegradationMs += projectedWearDegradationMs(endWear, stintLaps);
  }

  const pitLossMs =
    context.pitLoss.ms * Math.max(0, shape.compounds.length - 1);
  const projectedMaxWear = Math.max(...shape.stintWearPercentages);
  const overThreshold =
    shape.risk?.overThreshold ??
    Math.max(0, projectedMaxWear - PUNCTURE_THRESHOLD);
  const managedRiskPenaltyMs =
    overThreshold * MANAGED_RISK_PENALTY_MS_PER_PERCENT;

  return {
    totalScoreMs:
      tyrePaceMs + wearDegradationMs + pitLossMs + managedRiskPenaltyMs,
    tyrePaceMs,
    wearDegradationMs,
    pitLossMs,
    managedRiskPenaltyMs,
    // A plan resting on a compound with no pace evidence of its own is a
    // guess about that tyre, whatever the model's other compounds say.
    paceConfidence: assumedCompounds.size > 0 ? "low" : paceConfidence,
    paceSource:
      assumedCompounds.size > 0
        ? `${paceModel.source}; ${[...assumedCompounds].join(", ")} pace assumed from compound order`
        : paceModel.source,
  };
}

function observedShapeFromEntry(
  entry: BucketRaceEntry,
  isPlanCompound: (compound: string) => boolean,
): TrackStrategyShape | null {
  const stints = getDriverStints(entry.player).filter(
    (stint) => stint["stint-length"] > 0,
  );
  if (stints.length === 0) return null;
  if (
    stints.some(
      (stint) =>
        !isPlanCompound(stint["tyre-set-data"]["visual-tyre-compound"]),
    )
  ) {
    return null;
  }

  const observedLaps = stints.reduce(
    (sum, stint) => sum + stint["stint-length"],
    0,
  );
  if (observedLaps < entry.totalLaps - 1) return null;

  const stintWearPercentages = stints.map(getWorstStintEndWear);
  if (stintWearPercentages.some((wear) => wear <= 0)) return null;

  return {
    compounds: stints.map(
      (stint) => stint["tyre-set-data"]["visual-tyre-compound"],
    ),
    stintLaps: stints.map((stint) => stint["stint-length"]),
    stintWearPercentages,
  };
}

/** Anchors absolute durations on the latest completed race run entirely on
 *  the plan's compounds, so a wet race never anchors a dry plan or vice versa. */
export function findRaceTimeAnchor(
  entries: BucketRaceEntry[],
  context: StrategyTimingContext,
  isPlanCompound: (compound: string) => boolean,
): StrategyTimeAnchor | null {
  for (const entry of [...entries].reverse()) {
    if (!entry.isFullDistance) continue;

    const classification = entry.player["final-classification"];
    const totalRaceTimeSeconds = classification?.["total-race-time"] ?? 0;
    if (totalRaceTimeSeconds <= 0) continue;

    const observedShape = observedShapeFromEntry(entry, isPlanCompound);
    if (!observedShape) continue;

    return {
      observedTotalRaceMs: totalRaceTimeSeconds * 1000,
      observedStrategyScoreMs: scoreShape(observedShape, context).totalScoreMs,
      confidence: "medium",
      source: "latest completed race anchor",
    };
  }

  return null;
}

export function buildTimingContext(
  entries: BucketRaceEntry[],
  pitLossEntries: BucketRaceEntry[],
  rankedCompounds: CompoundLifeStats[],
): StrategyTimingContext | null {
  const representative = entries[0];
  if (!representative) return null;

  const pitLoss = resolvePitLoss(pitLossEntries, representative);
  if (!pitLoss) return null;
  const paceModel = withAssumedCompounds(
    resolveCompoundPaceModel(entries, rankedCompounds),
    rankedCompounds,
  );

  return {
    pitLoss,
    paceModel,
    strategyPaceModels: buildStrategyPaceModels(entries, paceModel),
  };
}

/** Wet plans compare stop counts on a single compound, so compound pace
 *  offsets cancel out and only pit loss plus wear degradation separate the
 *  candidates. */
export function buildSingleCompoundTimingContext(
  entries: BucketRaceEntry[],
  pitLossEntries: BucketRaceEntry[],
  compound: string,
): StrategyTimingContext | null {
  const representative = entries[0];
  if (!representative) return null;

  const pitLoss = resolvePitLoss(pitLossEntries, representative);
  if (!pitLoss) return null;

  return {
    pitLoss,
    paceModel: {
      offsetsMs: new Map([[compound, 0]]),
      // Rain intensity and drying rate change wet tyre wear from race to race,
      // so wet evidence never earns high confidence.
      confidence: "medium",
      source: `${compound}-only stop-count comparison`,
    },
    strategyPaceModels: new Map(),
  };
}

export function timeEstimateForCandidate(
  candidate: { score?: StrategyScore },
  fastestScoreMs: number,
  context: StrategyTimingContext,
  anchor: StrategyTimeAnchor | null,
): TrackStrategyTimeEstimate | undefined {
  if (!candidate.score) return undefined;

  const deltaToFastestMs = Math.max(
    0,
    candidate.score.totalScoreMs - fastestScoreMs,
  );
  const baseConfidence = lowerConfidence(
    context.pitLoss.confidence,
    candidate.score.paceConfidence,
  );
  const confidence = anchor
    ? lowerConfidence(baseConfidence, anchor.confidence)
    : baseConfidence;
  const predictedTotalRaceMs = anchor
    ? anchor.observedTotalRaceMs +
      candidate.score.totalScoreMs -
      anchor.observedStrategyScoreMs
    : undefined;

  return {
    predictedTotalRaceMs:
      predictedTotalRaceMs != null
        ? Math.round(predictedTotalRaceMs)
        : undefined,
    deltaToFastestMs: Math.round(deltaToFastestMs),
    pitLossMs: Math.round(context.pitLoss.ms),
    confidence,
    source: anchor
      ? "anchored to your completed race"
      : "relative tyre/wear/pit model",
    details: {
      pitLossSource: context.pitLoss.source,
      paceSource: candidate.score.paceSource,
      anchorSource: anchor?.source,
    },
  };
}
