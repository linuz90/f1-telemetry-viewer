import type {
  CarSetup,
  DriverData,
  SessionSummary,
  TelemetrySession,
} from "../types/telemetry";
import {
  avgWearRate,
  filterOutlierLaps,
  findPlayer,
  getBestLapTime,
  getCleanRaceLaps,
  getCompletedStints,
  getDriverStints,
  isRaceSession,
} from "./stats";

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

export type RaceSetupStrength =
  | "fastest-lap"
  | "best-pace"
  | "best-stint"
  | "lowest-deg";

export interface RaceSetupRunInput {
  summary: SessionSummary;
  session: TelemetrySession;
}

export interface RaceSetupRunSource {
  summary: SessionSummary;
  bestLapMs: number | null;
}

export interface RaceSetupCandidate {
  id: string;
  name: string;
  setup: CarSetup;
  setupSummary: string;
  sampleCount: number;
  cleanLapCount: number;
  bestLapMs: number | null;
  avgCleanPaceMs: number | null;
  bestStintPaceMs: number | null;
  bestStintLabel: string | null;
  avgWearRatePerLap: number | null;
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
  bestStintPaceMs: number | null;
  bestStintLabel: string | null;
  wearSamples: number[];
  fallbackSource: RaceSetupRunSource;
}

interface BestStintPace {
  paceMs: number;
  label: string;
}

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

function averageCleanPace(player: DriverData): { paceMs: number | null; lapCount: number } {
  const cleanLaps = getCleanRaceLaps(player);
  if (cleanLaps.length === 0) return { paceMs: null, lapCount: 0 };

  return {
    paceMs:
      cleanLaps.reduce((sum, lap) => sum + lap["lap-time-in-ms"], 0) /
      cleanLaps.length,
    lapCount: cleanLaps.length,
  };
}

function getBestStintPace(player: DriverData): BestStintPace | null {
  const laps = player["session-history"]["lap-history-data"];
  const stints = getCompletedStints(getDriverStints(player));
  let best: BestStintPace | null = null;

  stints.forEach((stint, index) => {
    const rawStartLap = stint["start-lap"];
    const rawEndLap = Math.min(stint["end-lap"], laps.length);
    // Stint boundaries are usually lap 1, pit-out, or pit-in laps, so trim
    // them before comparing "fastest stint" pace between setups.
    const startLap = rawStartLap <= 1 ? 2 : rawStartLap + 1;
    const endLap = index < stints.length - 1 ? rawEndLap - 1 : rawEndLap;

    if (endLap - startLap + 1 < 3) return;

    const cleanStintLaps = filterOutlierLaps(laps.slice(startLap - 1, endLap));
    if (cleanStintLaps.length < 3) return;

    const paceMs =
      cleanStintLaps.reduce((sum, lap) => sum + lap["lap-time-in-ms"], 0) /
      cleanStintLaps.length;
    const compound = stint["tyre-set-data"]["visual-tyre-compound"];
    const label = `${compound} L${startLap}-${endLap}`;

    if (!best || paceMs < best.paceMs) {
      best = { paceMs, label };
    }
  });

  return best;
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

function withStrengths(candidates: RaceSetupCandidate[]): RaceSetupCandidate[] {
  const fastestLap = minValue(candidates, (candidate) => candidate.bestLapMs);
  const bestPace = minValue(candidates, (candidate) => candidate.avgCleanPaceMs);
  const bestStint = minValue(candidates, (candidate) => candidate.bestStintPaceMs);
  const lowestDeg = minValue(candidates, (candidate) => candidate.avgWearRatePerLap);

  return candidates.map((candidate) => {
    const strengths: RaceSetupStrength[] = [];
    if (hasWinningValue(candidate.bestLapMs, fastestLap)) strengths.push("fastest-lap");
    if (hasWinningValue(candidate.avgCleanPaceMs, bestPace)) strengths.push("best-pace");
    if (hasWinningValue(candidate.bestStintPaceMs, bestStint)) strengths.push("best-stint");
    if (hasWinningValue(candidate.avgWearRatePerLap, lowestDeg)) strengths.push("lowest-deg");
    return { ...candidate, strengths };
  });
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
    const cleanPace = averageCleanPace(player);
    const bestStint = getBestStintPace(player);
    const wearRate = avgWearRate(player);

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
        bestStintPaceMs: null,
        bestStintLabel: null,
        wearSamples: [],
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

    if (cleanPace.paceMs !== null) {
      accumulator.cleanPaceSamples.push(cleanPace.paceMs);
    }

    if (
      bestStint &&
      (accumulator.bestStintPaceMs === null ||
        bestStint.paceMs < accumulator.bestStintPaceMs)
    ) {
      accumulator.bestStintPaceMs = bestStint.paceMs;
      accumulator.bestStintLabel = bestStint.label;
    }

    if (wearRate > 0) {
      accumulator.wearSamples.push(wearRate);
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
    avgCleanPaceMs: average(accumulator.cleanPaceSamples),
    bestStintPaceMs: accumulator.bestStintPaceMs,
    bestStintLabel: accumulator.bestStintLabel,
    avgWearRatePerLap: average(accumulator.wearSamples),
    source: accumulator.bestLapSource ?? accumulator.fallbackSource,
    strengths: [],
  }));

  return withStrengths(candidates)
    .sort((a, b) => {
      const lapDiff = sortableMetric(a.bestLapMs) - sortableMetric(b.bestLapMs);
      if (lapDiff !== 0) return lapDiff;
      const paceDiff = sortableMetric(a.avgCleanPaceMs) - sortableMetric(b.avgCleanPaceMs);
      if (paceDiff !== 0) return paceDiff;
      const wearDiff = sortableMetric(a.avgWearRatePerLap) - sortableMetric(b.avgWearRatePerLap);
      if (wearDiff !== 0) return wearDiff;
      return b.sampleCount - a.sampleCount;
    })
    .map((candidate, index) => ({
      ...candidate,
      name: `Setup ${index + 1}`,
    }));
}
