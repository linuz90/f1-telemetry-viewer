import type {
  CarSetup,
  DriverData,
  SessionSummary,
  TelemetrySession,
} from "../types/telemetry";
import { findPlayer, isRaceSession } from "../utils/stats/drivers";
import { getBestLapTime, getCleanRaceLapSamples } from "../utils/stats/laps";
import { medianPaceInRange } from "../utils/stats/pace";
import {
  getCompletedStints,
  getDriverStints,
  stintWearRate,
} from "../utils/stats/tyres";

/**
 * Race setup analysis groups sessions by identical mechanical setup, then ranks
 * them on same-compound pace, stint pace, and degradation. UI components render
 * the returned candidates; setup identity/scoring belongs here.
 */

type SetupFingerprintKey = Exclude<keyof CarSetup, "fuel-load" | "is-valid">;

const SETUP_FINGERPRINT_KEYS: readonly SetupFingerprintKey[] = [
  "front-wing",
  "rear-wing",
  "on-throttle",
  "off-throttle",
  "front-camber",
  "rear-camber",
  "front-toe",
  "rear-toe",
  "front-suspension",
  "rear-suspension",
  "front-anti-roll-bar",
  "rear-anti-roll-bar",
  "front-suspension-height",
  "rear-suspension-height",
  "brake-pressure",
  "brake-bias",
  "engine-braking",
  "rear-left-tyre-pressure",
  "rear-right-tyre-pressure",
  "front-left-tyre-pressure",
  "front-right-tyre-pressure",
  "ballast",
];

// Fuel load is excluded from identity on purpose: it is a race-plan variable,
// not a mechanical setup. Validity is also excluded because it describes the
// export, not the car.

export type RaceSetupStrengthKind =
  | "most-promising"
  | "fastest-lap"
  | "best-pace"
  | "best-stint"
  | "lowest-deg";

export interface RaceSetupStrength {
  kind: RaceSetupStrengthKind;
  compound?: string;
}

export interface RaceSetupRunInput {
  summary: SessionSummary;
  session: TelemetrySession;
}

export interface RaceSetupRunSource {
  summary: SessionSummary;
  bestLapMs: number | null;
}

export interface RaceSetupCompoundMetric {
  compound: string;
  value: number;
  sampleCount: number;
  label?: string;
}

export interface RaceSetupComparableMetric {
  compound: string;
  value: number;
  delta: number;
  sampleCount: number;
  label?: string;
}

export interface RaceSetupCandidate {
  id: string;
  name: string;
  setup: CarSetup;
  setupSummary: string;
  sampleCount: number;
  cleanLapCount: number;
  bestLapMs: number | null;
  medianCleanPaceMs: number | null;
  bestStintPaceMs: number | null;
  bestStintLabel: string | null;
  avgWearRatePerLap: number | null;
  medianCleanPaceByCompound: RaceSetupCompoundMetric[];
  bestStintPaceByCompound: RaceSetupCompoundMetric[];
  wearRateByCompound: RaceSetupCompoundMetric[];
  comparablePace: RaceSetupComparableMetric | null;
  comparableStint: RaceSetupComparableMetric | null;
  comparableWear: RaceSetupComparableMetric | null;
  fairScore: number | null;
  fairScoreWeight: number;
  fairMetricCount: number;
  rankScore: number;
  source: RaceSetupRunSource;
  strengths: RaceSetupStrength[];
}

interface RaceSetupAccumulator {
  id: string;
  setup: CarSetup;
  setupSummary: string;
  sampleCount: number;
  cleanLapCount: number;
  bestLapMs: number | null;
  bestLapSource: RaceSetupRunSource | null;
  cleanPaceSamples: number[];
  cleanPaceSamplesByCompound: Map<string, number[]>;
  bestStintPaceMs: number | null;
  bestStintLabel: string | null;
  bestStintPaceByCompound: Map<string, BestStintPace>;
  wearSamples: number[];
  wearSamplesByCompound: Map<string, number[]>;
  fallbackSource: RaceSetupRunSource;
}

interface BestStintPace {
  paceMs: number;
  label: string;
  compound: string;
}

const MIN_CLEAN_LAPS_FOR_SETUP_PACE = 3;
const MIN_FAIR_COMPARISON_SETUPS = 2;

type ComparableMetricField =
  | "comparablePace"
  | "comparableStint"
  | "comparableWear";

type CompoundMetricField =
  | "medianCleanPaceByCompound"
  | "bestStintPaceByCompound"
  | "wearRateByCompound";

const FAIR_SCORE_WEIGHTS: Record<ComparableMetricField, number> = {
  comparablePace: 2,
  comparableStint: 1,
  comparableWear: 1.5,
};

const RANK_STRENGTH_POINTS: Record<RaceSetupStrengthKind, number> = {
  "most-promising": 0,
  "fastest-lap": 2,
  "best-pace": 4,
  "best-stint": 3,
  "lowest-deg": 0.5,
};

const RANK_DELTA_PENALTIES = {
  bestLapPerSecond: 0.75,
  pacePerSecond: 2,
  stintPerSecond: 1.25,
  wearPerPercent: 0.35,
} as const;

function isUsableSetup(setup: CarSetup | null | undefined): setup is CarSetup {
  if (!setup?.["is-valid"]) return false;

  return SETUP_FINGERPRINT_KEYS.some((key) => getSetupNumber(setup, key) !== 0);
}

function getSetupNumber(setup: CarSetup, key: SetupFingerprintKey): number {
  const value = setup[key];
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function normalizeSetupValue(value: number): string {
  if (Number.isInteger(value)) return String(value);
  return String(Number(value.toFixed(3)));
}

function getSetupFingerprint(setup: CarSetup): string {
  return SETUP_FINGERPRINT_KEYS.map(
    (key) => `${key}:${normalizeSetupValue(getSetupNumber(setup, key))}`,
  ).join("|");
}

function formatPsi(value: number): string {
  return value.toFixed(1);
}

function summarizeSetup(setup: CarSetup): string {
  const engineBraking = getSetupNumber(setup, "engine-braking");
  const ballast = getSetupNumber(setup, "ballast");
  const parts = [
    `Wing ${setup["front-wing"]}/${setup["rear-wing"]}`,
    `Susp ${setup["front-suspension"]}/${setup["rear-suspension"]}`,
    `ARB ${setup["front-anti-roll-bar"]}/${setup["rear-anti-roll-bar"]}`,
    `Ride ${setup["front-suspension-height"]}/${setup["rear-suspension-height"]}`,
    `PSI ${formatPsi(setup["front-left-tyre-pressure"])}/${formatPsi(setup["front-right-tyre-pressure"])} ${formatPsi(setup["rear-left-tyre-pressure"])}/${formatPsi(setup["rear-right-tyre-pressure"])}`,
  ];

  if (engineBraking > 0) {
    parts.push(`EB ${engineBraking}`);
  }
  if (ballast > 0) {
    parts.push(`Ballast ${ballast}`);
  }

  return parts.join(" · ");
}

function average(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function medianValue(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1]! + sorted[mid]!) / 2
    : sorted[mid]!;
}

function cleanPaceSamples(player: DriverData): {
  lapTimesMs: number[];
  lapCount: number;
  byCompound: Map<string, number[]>;
} {
  const cleanLaps = getCleanRaceLapSamples(player);
  const byCompound = new Map<string, number[]>();

  cleanLaps.forEach((sample) => {
    if (!sample.compound) return;
    const lapTimes = byCompound.get(sample.compound) ?? [];
    lapTimes.push(sample.timeMs);
    byCompound.set(sample.compound, lapTimes);
  });

  return {
    lapTimesMs: cleanLaps.map((lap) => lap.timeMs),
    lapCount: cleanLaps.length,
    byCompound,
  };
}

function getBestStintPaces(player: DriverData): BestStintPace[] {
  const laps = player["session-history"]["lap-history-data"];
  const stints = getCompletedStints(getDriverStints(player));
  const bestByCompound = new Map<string, BestStintPace>();

  stints.forEach((stint, index) => {
    const rawStartLap = stint["start-lap"];
    const rawEndLap = Math.min(stint["end-lap"], laps.length);
    // Stint boundaries are usually lap 1, pit-out, or pit-in laps, so trim
    // them before comparing "fastest stint" pace between setups.
    const startLap = rawStartLap <= 1 ? 2 : rawStartLap + 1;
    const endLap = index < stints.length - 1 ? rawEndLap - 1 : rawEndLap;

    if (endLap - startLap + 1 < 3) return;

    const paceMs = medianPaceInRange(laps, startLap, endLap);
    if (paceMs <= 0) return;
    const compound = stint["tyre-set-data"]["visual-tyre-compound"];
    const label = `${compound} L${startLap}-${endLap}`;
    const best = bestByCompound.get(compound);

    if (!best || paceMs < best.paceMs) {
      bestByCompound.set(compound, { paceMs, label, compound });
    }
  });

  return [...bestByCompound.values()];
}

function getBestStintPace(player: DriverData): BestStintPace | null {
  return (
    getBestStintPaces(player).sort((a, b) => a.paceMs - b.paceMs)[0] ?? null
  );
}

function wearSamplesByCompound(player: DriverData): Map<string, number[]> {
  const byCompound = new Map<string, number[]>();

  for (const stint of getCompletedStints(getDriverStints(player))) {
    const wearRate = stintWearRate(stint);
    if (wearRate <= 0) continue;
    const compound = stint["tyre-set-data"]["visual-tyre-compound"];
    const samples = byCompound.get(compound) ?? [];
    samples.push(wearRate);
    byCompound.set(compound, samples);
  }

  return byCompound;
}

function minValue(
  candidates: RaceSetupCandidate[],
  getValue: (candidate: RaceSetupCandidate) => number | null,
): number | null {
  const values = candidates
    .map(getValue)
    .filter((value): value is number => value !== null && value > 0);
  if (values.length === 0) return null;
  return Math.min(...values);
}

function hasWinningValue(
  value: number | null,
  winningValue: number | null,
): boolean {
  if (value === null || winningValue === null) return false;
  return Math.abs(value - winningValue) < 0.001;
}

function compoundMetricsFromSamples(
  samplesByCompound: Map<string, number[]>,
  minSamples: number,
): RaceSetupCompoundMetric[] {
  return [...samplesByCompound.entries()]
    .map(([compound, samples]) => ({
      compound,
      value: medianValue(samples),
      sampleCount: samples.length,
    }))
    .filter(
      (metric): metric is RaceSetupCompoundMetric =>
        metric.value !== null && metric.sampleCount >= minSamples,
    )
    .sort((a, b) => a.compound.localeCompare(b.compound));
}

function bestStintMetricsFromMap(
  bestByCompound: Map<string, BestStintPace>,
): RaceSetupCompoundMetric[] {
  return [...bestByCompound.values()]
    .map((stint) => ({
      compound: stint.compound,
      value: stint.paceMs,
      sampleCount: 1,
      label: stint.label,
    }))
    .sort((a, b) => a.compound.localeCompare(b.compound));
}

function addMapSamples(
  target: Map<string, number[]>,
  source: Map<string, number[]>,
): void {
  source.forEach((values, compound) => {
    const samples = target.get(compound) ?? [];
    samples.push(...values);
    target.set(compound, samples);
  });
}

function addBestStints(
  target: Map<string, BestStintPace>,
  stints: BestStintPace[],
): void {
  stints.forEach((stint) => {
    const current = target.get(stint.compound);
    if (!current || stint.paceMs < current.paceMs) {
      target.set(stint.compound, stint);
    }
  });
}

function strengthKey(strength: RaceSetupStrength): string {
  return `${strength.kind}:${strength.compound ?? ""}`;
}

function pushStrength(
  strengths: RaceSetupStrength[],
  strength: RaceSetupStrength,
): void {
  if (
    strengths.some(
      (existing) => strengthKey(existing) === strengthKey(strength),
    )
  ) {
    return;
  }

  strengths.push(strength);
}

function hasFairWin(
  candidate: RaceSetupCandidate,
  kind: RaceSetupStrengthKind,
): boolean {
  return candidate.strengths.some((strength) => strength.kind === kind);
}

function strengthCount(
  candidate: RaceSetupCandidate,
  kind: RaceSetupStrengthKind,
): number {
  return candidate.strengths.filter((strength) => strength.kind === kind)
    .length;
}

function chooseComparableMetric(
  current: RaceSetupComparableMetric | null,
  next: RaceSetupComparableMetric,
): RaceSetupComparableMetric {
  if (!current) return next;
  if (next.delta !== current.delta)
    return next.delta < current.delta ? next : current;
  if (next.sampleCount !== current.sampleCount) {
    return next.sampleCount > current.sampleCount ? next : current;
  }
  return next.value < current.value ? next : current;
}

function applyFairCompoundComparison(
  candidates: RaceSetupCandidate[],
  metricField: CompoundMetricField,
  comparableField: ComparableMetricField,
  strengthKind: RaceSetupStrengthKind,
): RaceSetupCandidate[] {
  // Fair comparisons happen within compound buckets. A medium stint and hard
  // stint can both be useful, but ranking them directly would mostly compare
  // tyre choice and fuel phase instead of setup quality.
  const nextCandidates = candidates.map((candidate) => ({
    ...candidate,
    strengths: [...candidate.strengths],
  }));
  const candidateById = new Map(
    nextCandidates.map((candidate) => [candidate.id, candidate]),
  );
  const entriesByCompound = new Map<
    string,
    { candidate: RaceSetupCandidate; metric: RaceSetupCompoundMetric }[]
  >();

  for (const candidate of nextCandidates) {
    for (const metric of candidate[metricField]) {
      const entries = entriesByCompound.get(metric.compound) ?? [];
      entries.push({ candidate, metric });
      entriesByCompound.set(metric.compound, entries);
    }
  }

  entriesByCompound.forEach((entries) => {
    const candidateCount = new Set(entries.map((entry) => entry.candidate.id))
      .size;
    if (candidateCount < MIN_FAIR_COMPARISON_SETUPS) return;

    const winningValue = Math.min(
      ...entries.map((entry) => entry.metric.value),
    );

    entries.forEach(({ candidate, metric }) => {
      const target = candidateById.get(candidate.id);
      if (!target) return;
      const comparable: RaceSetupComparableMetric = {
        compound: metric.compound,
        value: metric.value,
        delta: metric.value - winningValue,
        sampleCount: metric.sampleCount,
        label: metric.label,
      };

      target[comparableField] = chooseComparableMetric(
        target[comparableField],
        comparable,
      );

      if (hasWinningValue(metric.value, winningValue)) {
        pushStrength(target.strengths, {
          kind: strengthKind,
          compound: metric.compound,
        });
      }
    });
  });

  return nextCandidates;
}

function withComparisonMetadata(
  candidates: RaceSetupCandidate[],
): RaceSetupCandidate[] {
  const fastestLap = minValue(candidates, (candidate) => candidate.bestLapMs);
  let nextCandidates: RaceSetupCandidate[] = candidates.map((candidate) => ({
    ...candidate,
    strengths: hasWinningValue(candidate.bestLapMs, fastestLap)
      ? ([{ kind: "fastest-lap" }] satisfies RaceSetupStrength[])
      : [],
  }));

  nextCandidates = applyFairCompoundComparison(
    nextCandidates,
    "medianCleanPaceByCompound",
    "comparablePace",
    "best-pace",
  );
  nextCandidates = applyFairCompoundComparison(
    nextCandidates,
    "bestStintPaceByCompound",
    "comparableStint",
    "best-stint",
  );
  nextCandidates = applyFairCompoundComparison(
    nextCandidates,
    "wearRateByCompound",
    "comparableWear",
    "lowest-deg",
  );

  nextCandidates = nextCandidates.map((candidate) => {
    let score = 0;
    let weight = 0;
    let metricCount = 0;

    (["comparablePace", "comparableStint", "comparableWear"] as const).forEach(
      (field) => {
        const metric = candidate[field];
        if (!metric) return;
        const metricWeight = FAIR_SCORE_WEIGHTS[field];
        // Lower is better for all three fair setup dimensions. This keeps the
        // score relative to an actually comparable same-compound benchmark
        // instead of mixing Soft pace with Hard degradation and overclaiming.
        score +=
          Math.min(1, (metric.value - metric.delta) / metric.value) *
          metricWeight;
        weight += metricWeight;
        metricCount += 1;
      },
    );

    return {
      ...candidate,
      fairScore: weight > 0 ? Math.round((score / weight) * 100) : null,
      fairScoreWeight: weight,
      fairMetricCount: metricCount,
    };
  });

  nextCandidates = nextCandidates.map((candidate) => {
    let rankScore = 0;

    (["fastest-lap", "best-pace", "best-stint", "lowest-deg"] as const).forEach(
      (kind) => {
        rankScore +=
          strengthCount(candidate, kind) * RANK_STRENGTH_POINTS[kind];
      },
    );

    // Ranking is intentionally speed-first. Tyre degradation is useful, but a
    // low-deg setup should not appear above a setup that is clearly faster on
    // same-compound pace/stint evidence. These penalties are in driver-sized
    // units (seconds and %/lap), avoiding the old ratio score where tyre wear
    // dwarfed half-second pace gaps because lap times are ~80 seconds long.
    if (candidate.bestLapMs !== null && fastestLap !== null) {
      rankScore -=
        ((candidate.bestLapMs - fastestLap) / 1000) *
        RANK_DELTA_PENALTIES.bestLapPerSecond;
    }
    if (candidate.comparablePace) {
      rankScore -=
        (candidate.comparablePace.delta / 1000) *
        RANK_DELTA_PENALTIES.pacePerSecond;
    }
    if (candidate.comparableStint) {
      rankScore -=
        (candidate.comparableStint.delta / 1000) *
        RANK_DELTA_PENALTIES.stintPerSecond;
    }
    if (candidate.comparableWear) {
      rankScore -=
        candidate.comparableWear.delta * RANK_DELTA_PENALTIES.wearPerPercent;
    }

    return { ...candidate, rankScore };
  });

  const rankedCandidates = nextCandidates.filter(
    (candidate) =>
      candidate.rankScore > 0 &&
      (hasFairWin(candidate, "fastest-lap") ||
        hasFairWin(candidate, "best-pace") ||
        hasFairWin(candidate, "best-stint")),
  );
  const bestRankScore = Math.max(
    ...rankedCandidates.map((candidate) => candidate.rankScore),
    0,
  );
  const bestRankedCandidates = rankedCandidates.filter(
    (candidate) => Math.abs(candidate.rankScore - bestRankScore) < 0.001,
  );
  const mostPromising = bestRankedCandidates.find(
    (candidate) =>
      hasFairWin(candidate, "fastest-lap") ||
      hasFairWin(candidate, "best-pace") ||
      hasFairWin(candidate, "best-stint"),
  );

  // Only elevate a "most promising" setup when one candidate clearly wins the
  // speed-sensitive evidence. If there is a tie, keep individual strengths
  // visible without over-claiming a single recommendation.
  if (mostPromising && bestRankedCandidates.length === 1) {
    nextCandidates = nextCandidates.map((candidate) => ({
      ...candidate,
      strengths:
        candidate.id === mostPromising.id
          ? [{ kind: "most-promising" as const }, ...candidate.strengths]
          : candidate.strengths,
    }));
  }

  return nextCandidates;
}

function sortableMetric(value: number | null): number {
  return value ?? Number.POSITIVE_INFINITY;
}

/** Group race setups and aggregate observed outcomes without treating fuel load as setup identity. */
export function buildRaceSetupComparison(
  runs: readonly RaceSetupRunInput[],
): RaceSetupCandidate[] {
  const bySetup = new Map<string, RaceSetupAccumulator>();

  for (const run of runs) {
    if (!isRaceSession(run.session)) continue;

    const player = findPlayer(run.session);
    const setup = player?.["car-setup"];
    if (!player || !isUsableSetup(setup)) continue;

    const id = getSetupFingerprint(setup);
    const laps = player["session-history"]["lap-history-data"];
    const bestLapMs = getBestLapTime(laps) || null;
    const source: RaceSetupRunSource = {
      summary: run.summary,
      bestLapMs,
    };
    const cleanPace = cleanPaceSamples(player);
    const bestStint = getBestStintPace(player);
    const bestStintsByCompound = getBestStintPaces(player);
    const compoundWearSamples = wearSamplesByCompound(player);
    const wearRates = [...compoundWearSamples.values()].flat();

    let accumulator = bySetup.get(id);
    if (!accumulator) {
      accumulator = {
        id,
        setup,
        setupSummary: summarizeSetup(setup),
        sampleCount: 0,
        cleanLapCount: 0,
        bestLapMs: null,
        bestLapSource: null,
        cleanPaceSamples: [],
        cleanPaceSamplesByCompound: new Map(),
        bestStintPaceMs: null,
        bestStintLabel: null,
        bestStintPaceByCompound: new Map(),
        wearSamples: [],
        wearSamplesByCompound: new Map(),
        fallbackSource: source,
      };
      bySetup.set(id, accumulator);
    }

    accumulator.sampleCount += 1;
    accumulator.cleanLapCount += cleanPace.lapCount;

    if (
      bestLapMs !== null &&
      (accumulator.bestLapMs === null || bestLapMs < accumulator.bestLapMs)
    ) {
      accumulator.bestLapMs = bestLapMs;
      accumulator.bestLapSource = source;
    }

    accumulator.cleanPaceSamples.push(...cleanPace.lapTimesMs);
    addMapSamples(accumulator.cleanPaceSamplesByCompound, cleanPace.byCompound);
    addBestStints(accumulator.bestStintPaceByCompound, bestStintsByCompound);
    addMapSamples(accumulator.wearSamplesByCompound, compoundWearSamples);

    if (
      bestStint &&
      (accumulator.bestStintPaceMs === null ||
        bestStint.paceMs < accumulator.bestStintPaceMs)
    ) {
      accumulator.bestStintPaceMs = bestStint.paceMs;
      accumulator.bestStintLabel = bestStint.label;
    }

    if (wearRates.length > 0) {
      accumulator.wearSamples.push(...wearRates);
    }
  }

  const candidates = [...bySetup.values()].map((accumulator) => ({
    id: accumulator.id,
    name: "",
    setup: accumulator.setup,
    setupSummary: accumulator.setupSummary,
    sampleCount: accumulator.sampleCount,
    cleanLapCount: accumulator.cleanLapCount,
    bestLapMs: accumulator.bestLapMs,
    // A one- or two-lap run can be representative of a hotlap, not race pace.
    // Keep the lap count visible, but only rank setup pace once there is at
    // least a short stint's worth of clean evidence.
    medianCleanPaceMs:
      accumulator.cleanPaceSamples.length >= MIN_CLEAN_LAPS_FOR_SETUP_PACE
        ? medianValue(accumulator.cleanPaceSamples)
        : null,
    bestStintPaceMs: accumulator.bestStintPaceMs,
    bestStintLabel: accumulator.bestStintLabel,
    avgWearRatePerLap: average(accumulator.wearSamples),
    medianCleanPaceByCompound: compoundMetricsFromSamples(
      accumulator.cleanPaceSamplesByCompound,
      MIN_CLEAN_LAPS_FOR_SETUP_PACE,
    ),
    bestStintPaceByCompound: bestStintMetricsFromMap(
      accumulator.bestStintPaceByCompound,
    ),
    wearRateByCompound: compoundMetricsFromSamples(
      accumulator.wearSamplesByCompound,
      1,
    ),
    comparablePace: null,
    comparableStint: null,
    comparableWear: null,
    fairScore: null,
    fairScoreWeight: 0,
    fairMetricCount: 0,
    rankScore: 0,
    source: accumulator.bestLapSource ?? accumulator.fallbackSource,
    strengths: [],
  }));

  return withComparisonMetadata(candidates)
    .sort((a, b) => {
      const rankDiff = b.rankScore - a.rankScore;
      if (rankDiff !== 0) return rankDiff;
      const scoreDiff = (b.fairScore ?? -1) - (a.fairScore ?? -1);
      if (scoreDiff !== 0) return scoreDiff;
      const lapDiff = sortableMetric(a.bestLapMs) - sortableMetric(b.bestLapMs);
      if (lapDiff !== 0) return lapDiff;
      const paceDiff =
        sortableMetric(a.medianCleanPaceMs) -
        sortableMetric(b.medianCleanPaceMs);
      if (paceDiff !== 0) return paceDiff;
      const wearDiff =
        sortableMetric(a.avgWearRatePerLap) -
        sortableMetric(b.avgWearRatePerLap);
      if (wearDiff !== 0) return wearDiff;
      return b.sampleCount - a.sampleCount;
    })
    .map((candidate, index) => ({
      ...candidate,
      name: `Setup ${index + 1}`,
    }));
}
