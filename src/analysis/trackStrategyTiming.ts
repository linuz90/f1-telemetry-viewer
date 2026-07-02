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
  getDriverStints,
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

// The games do not expose a direct "lap time lost per wear %" curve. This
// deliberately simple curve keeps normal wear cheap, then makes long stints pay
// once they drift into the mid-50s where grip drop-off starts to matter.
const WEAR_LINEAR_PENALTY_MS_PER_PERCENT = 18;
const HIGH_WEAR_PENALTY_START_PERCENT = 55;
const HIGH_WEAR_PENALTY_MS_PER_PERCENT_SQUARED = 4;
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

function buildCleanLapPaceModel(
  entries: BucketRaceEntry[],
): CompoundPaceModel | null {
  const samples = entries.flatMap((entry) =>
    getRacePaceLapSamples(entry.player).filter(
      (sample) => sample.compound && isDryCompound(sample.compound),
    ),
  );
  if (samples.length < 6) return null;

  const meanLap =
    samples.reduce((sum, sample) => sum + sample.lapNumber, 0) / samples.length;
  const meanTime =
    samples.reduce((sum, sample) => sum + sample.timeMs, 0) / samples.length;
  const lapVariance = samples.reduce(
    (sum, sample) => sum + (sample.lapNumber - meanLap) ** 2,
    0,
  );
  if (lapVariance <= 0) return null;

  const covariance = samples.reduce(
    (sum, sample) =>
      sum + (sample.lapNumber - meanLap) * (sample.timeMs - meanTime),
    0,
  );
  const slope = covariance / lapVariance;
  const intercept = meanTime - slope * meanLap;

  const residuals = new Map<string, number[]>();
  for (const sample of samples) {
    const compound = sample.compound;
    if (!compound) continue;

    const compoundResiduals = residuals.get(compound) ?? [];
    compoundResiduals.push(
      sample.timeMs - (intercept + slope * sample.lapNumber),
    );
    residuals.set(compound, compoundResiduals);
  }

  const rawOffsets = new Map<string, number>();
  let eligibleCompoundCount = 0;
  for (const [compound, values] of residuals) {
    if (values.length < 3) continue;
    const compoundMedian = median(values);
    if (compoundMedian == null) continue;
    rawOffsets.set(compound, compoundMedian);
    eligibleCompoundCount += 1;
  }

  if (eligibleCompoundCount < 2) return null;

  return {
    offsetsMs: normalizeOffsets(rawOffsets),
    confidence: samples.length >= 18 ? "medium" : "low",
    source: "distance-matched clean-lap pace",
  };
}

function buildTyreSetDeltaPaceModel(
  entries: BucketRaceEntry[],
): CompoundPaceModel | null {
  const byCompound = new Map<string, number[]>();

  for (const entry of entries) {
    for (const stint of getDriverStints(entry.player)) {
      const compound = stint["tyre-set-data"]["visual-tyre-compound"];
      const deltaMs = stint["tyre-set-data"]["lap-delta-time"];
      if (!isDryCompound(compound) || !Number.isFinite(deltaMs)) continue;
      if (Math.abs(deltaMs) > 10_000) continue;

      const values = byCompound.get(compound) ?? [];
      values.push(deltaMs);
      byCompound.set(compound, values);
    }
  }

  const rawOffsets = new Map<string, number>();
  for (const [compound, values] of byCompound) {
    const compoundMedian = median(values);
    if (compoundMedian == null) continue;
    rawOffsets.set(compound, compoundMedian);
  }

  const distinctValues = new Set([...rawOffsets.values()].map(Math.round));
  if (rawOffsets.size < 2 || distinctValues.size < 2) return null;

  return {
    offsetsMs: normalizeOffsets(rawOffsets),
    confidence: "medium",
    source: "distance-matched tyre-set deltas",
  };
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
  const cleanLapModel = buildCleanLapPaceModel(entries);
  if (cleanLapModel && paceModelMatchesCompoundOrder(cleanLapModel)) {
    return cleanLapModel;
  }

  const tyreSetModel = buildTyreSetDeltaPaceModel(entries);
  if (tyreSetModel) {
    return cleanLapModel
      ? {
          ...tyreSetModel,
          source:
            "distance-matched tyre-set deltas; clean laps looked fuel-confounded",
        }
      : tyreSetModel;
  }

  return null;
}

function paceModelMatchesCompoundOrder(model: CompoundPaceModel): boolean {
  const entries = [...model.offsetsMs.entries()];
  for (let i = 0; i < entries.length; i++) {
    for (let j = i + 1; j < entries.length; j++) {
      const [aCompound, aOffset] = entries[i];
      const [bCompound, bOffset] = entries[j];
      const aPriority = DRY_COMPOUND_PRIORITY[aCompound];
      const bPriority = DRY_COMPOUND_PRIORITY[bCompound];
      if (aPriority == null || bPriority == null || aPriority === bPriority) {
        continue;
      }

      const softerOffset = aPriority < bPriority ? aOffset : bOffset;
      const harderOffset = aPriority < bPriority ? bOffset : aOffset;
      if (softerOffset > harderOffset + 100) return false;
    }
  }
  return true;
}

function resolveCompoundPaceModel(
  entries: BucketRaceEntry[],
  rankedCompounds: CompoundLifeStats[],
): CompoundPaceModel {
  // Clean race laps are distance-matched, but with thin one-stop evidence they can
  // still say the late low-fuel hard stint is "faster" than the early medium stint.
  // In that case, prefer the game's compound ordering over a misleading residual.
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

function projectedWearDegradationMs(endWearPercent: number, stintLaps: number) {
  let total = 0;
  for (let lap = 1; lap <= stintLaps; lap++) {
    const wearAtLap = (endWearPercent * lap) / stintLaps;
    const highWear = Math.max(0, wearAtLap - HIGH_WEAR_PENALTY_START_PERCENT);
    total +=
      wearAtLap * WEAR_LINEAR_PENALTY_MS_PER_PERCENT +
      highWear ** 2 * HIGH_WEAR_PENALTY_MS_PER_PERCENT_SQUARED;
  }
  return total;
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

  for (let i = 0; i < shape.compounds.length; i++) {
    const compound = shape.compounds[i];
    const stintLaps = shape.stintLaps[i];
    const endWear = shape.stintWearPercentages[i];
    tyrePaceMs +=
      (paceModel.offsetsMs.get(compound) ??
        fallbackCompoundOffsetMs(compound)) * stintLaps;
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
    paceConfidence: paceModel.confidence,
    paceSource: paceModel.source,
  };
}

function observedShapeFromEntry(
  entry: BucketRaceEntry,
): TrackStrategyShape | null {
  const stints = getDriverStints(entry.player).filter(
    (stint) => stint["stint-length"] > 0,
  );
  if (stints.length === 0) return null;
  if (
    stints.some(
      (stint) => !isDryCompound(stint["tyre-set-data"]["visual-tyre-compound"]),
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

export function findRaceTimeAnchor(
  entries: BucketRaceEntry[],
  context: StrategyTimingContext,
): StrategyTimeAnchor | null {
  for (const entry of [...entries].reverse()) {
    if (!entry.isFullDistance) continue;

    const classification = entry.player["final-classification"];
    const totalRaceTimeSeconds = classification?.["total-race-time"] ?? 0;
    if (totalRaceTimeSeconds <= 0) continue;

    const observedShape = observedShapeFromEntry(entry);
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
  const paceModel = resolveCompoundPaceModel(entries, rankedCompounds);

  return {
    pitLoss,
    paceModel,
    strategyPaceModels: buildStrategyPaceModels(entries, paceModel),
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
