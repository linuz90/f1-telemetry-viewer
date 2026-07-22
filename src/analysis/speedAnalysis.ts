import type { DriverData, TelemetrySession } from "../types/telemetry";
import { isRaceSession } from "../utils/sessionTypes";
import { median } from "../utils/stats/core";
import { ersDeployMjForLap } from "../utils/stats/energy";
import { compareCompoundMatchedRacePace } from "../utils/stats/matchedPace";
import type { CompoundMatchedPaceComparison } from "../utils/stats/matchedPace";
import {
  buildProfileState,
  buildProfiles,
  isRestricted,
  nearestRankPercentile,
  perLapMap,
  type ProfileBuildState,
} from "./speedProfileAnalysis";

const MIN_COMPARISON_LAPS = 3;
const MIN_AERO_LAPS = 5;
const MEDIUM_CONFIDENCE_LAPS = 8;
const NEUTRAL_DELTA_KMH = 2;
const NO_CLEAR_DIFFERENCE_KMH = 3;
const MIN_AERO_DELTA_KMH = 5;
const MIN_DIRECTION_AGREEMENT = 0.7;
const MAX_TYRE_AGE_DELTA_LAPS = 3;
const MATERIAL_ERS_DELTA_MJ = 1;
const PACE_TIE_TOLERANCE_MS = 50;

export type SpeedQuality = "good" | "limited" | "suspect";
export type SpeedSampleReason = "glitch";

export type AeroTendencyReason =
  | "not-race"
  | "wet-or-mixed"
  | "partial-session"
  | "too-few-laps"
  | "compound-or-age-mismatch"
  | "restricted-telemetry"
  | "weak-speed-difference"
  | "low-direction-agreement"
  | "signals-conflict"
  | "trap-lap-ineligible"
  | "overall-pace-advantage"
  | "unequal-cars"
  | "equal-cars-unknown"
  | "missing-trap"
  | "material-ers-difference";

export interface LapPeakSample {
  lap: number;
  kmh: number;
  accepted: boolean;
  rejectionReasons: SpeedSampleReason[];
}

export interface DriverSpeedProfile {
  driverIndex: number;
  lapPeaks: LapPeakSample[];
  sessionPeak: {
    kmh: number;
    lap?: number;
    source: "completed-lap" | "session" | "combined";
    quality: SpeedQuality;
    /** One-based competition rank; ties share a rank and skip the next place. */
    rank?: number;
    fieldSize?: number;
  } | null;
  representativeHighSpeed: {
    kmh: number;
    percentile: 80;
    eligibleLapCount: number;
    quality: SpeedQuality;
  } | null;
  speedTrap: {
    kmh: number;
    lap?: number;
    /** One-based competition rank in the authoritative trap table. */
    rank: number;
    fieldSize: number;
    quality: "good" | "unattributed" | "suspect";
  } | null;
}

export interface SessionSpeedAnalysis {
  profiles: Map<number, DriverSpeedProfile>;
}

export interface DriverSpeedComparison {
  focused: DriverSpeedProfile;
  rival: DriverSpeedProfile;
  /** Focused driver minus rival. Positive means the focused driver was faster. */
  sessionPeakDeltaKmh: number | null;
  /** Same-pool P80 values, exposed only with at least eight comparable laps. */
  pairedRepresentative: {
    focusedKmh: number;
    rivalKmh: number;
    percentile: 80;
  } | null;
  /** Median of focused-minus-rival lap-peak deltas on comparable race laps. */
  pairedMedianDeltaKmh: number | null;
  pairedDirectionAgreement: number | null;
  speedTrapDeltaKmh: number | null;
  comparableLapCount: number;
  /** Median focused-minus-rival deployment across the paired speed laps. */
  pairedErsDeltaMj: number | null;
  /** Same-compound focused-minus-rival race-pace context. */
  matchedPaceDeltaMs: number | null;
  matchedSectorDeltasMs: [number, number, number] | null;
  interpretation: {
    mode: "aero-tendency" | "straight-line-description";
    verdict:
      | "rival-lower-drag"
      | "no-clear-difference"
      | "rival-higher-load"
      | "inconclusive"
      | "unavailable";
    confidence: "low" | "medium" | null;
    reasons: AeroTendencyReason[];
  };
}

interface ComparablePair {
  lap: number;
  focusedKmh: number;
  rivalKmh: number;
  deltaKmh: number;
}

/** Reconcile raw session, completed-lap, and fixed-trap speed sources. */
export function buildSessionSpeedAnalysis(
  session: TelemetrySession,
): SessionSpeedAnalysis {
  return buildProfiles(session);
}

function equalCarPerformance(session: TelemetrySession): boolean | null {
  const value = session["session-info"]?.["equal-car-performance"];
  if (typeof value === "boolean") return value;
  if (typeof value === "number")
    return value === 1 ? true : value === 0 ? false : null;
  if (/^(?:1|true|yes|on)$/i.test(value?.trim() ?? "")) return true;
  if (/^(?:0|false|no|off)$/i.test(value?.trim() ?? "")) return false;
  return null;
}

function fullyDry(session: TelemetrySession): boolean {
  if (/rain|wet|storm/i.test(session["session-info"]?.weather ?? ""))
    return false;
  return !(session["classification-data"] ?? []).some((driver) =>
    (driver["per-lap-info"] ?? []).some((lap) =>
      /inter|wet/i.test(lap["car-status-data"]?.["visual-tyre-compound"] ?? ""),
    ),
  );
}

function isPartialRace(session: TelemetrySession): boolean {
  if (!isRaceSession(session)) return false;
  const drivers = session["classification-data"] ?? [];
  if (drivers.some((driver) => driver["final-classification"] != null)) {
    return false;
  }

  const totalLaps = session["session-info"]?.["total-laps"];
  if (!Number.isFinite(totalLaps) || (totalLaps ?? 0) <= 0) return false;
  const furthestRecordedLap = Math.max(
    0,
    ...drivers.map((driver) =>
      Math.max(
        driver["current-lap"] ?? 0,
        driver["session-history"]?.["num-laps"] ?? 0,
      ),
    ),
  );
  return furthestRecordedLap < totalLaps!;
}

function comparablePairs(
  focused: ProfileBuildState,
  rival: ProfileBuildState,
): { pairs: ComparablePair[]; excludedForTyres: number } {
  const focusedPeaks = new Map(
    focused.profile.lapPeaks
      .filter(({ accepted }) => accepted)
      .map((sample) => [sample.lap, sample.kmh]),
  );
  const rivalPeaks = new Map(
    rival.profile.lapPeaks
      .filter(({ accepted }) => accepted)
      .map((sample) => [sample.lap, sample.kmh]),
  );
  const focusedRows = perLapMap(focused.driver);
  const rivalRows = perLapMap(rival.driver);
  const requireTyreMatch =
    !isRestricted(focused.driver) && !isRestricted(rival.driver);
  const pairs: ComparablePair[] = [];
  let excludedForTyres = 0;

  for (const lap of focused.racePaceEligibleLaps) {
    if (!rival.racePaceEligibleLaps.has(lap)) continue;
    const focusedKmh = focusedPeaks.get(lap);
    const rivalKmh = rivalPeaks.get(lap);
    if (focusedKmh == null || rivalKmh == null) continue;
    if (requireTyreMatch) {
      const focusedStatus = focusedRows.get(lap)?.["car-status-data"];
      const rivalStatus = rivalRows.get(lap)?.["car-status-data"];
      const focusedCompound = focusedStatus?.["visual-tyre-compound"];
      const rivalCompound = rivalStatus?.["visual-tyre-compound"];
      const focusedAge = focusedStatus?.["tyres-age-laps"];
      const rivalAge = rivalStatus?.["tyres-age-laps"];
      if (
        !focusedCompound ||
        !rivalCompound ||
        focusedCompound !== rivalCompound ||
        !Number.isFinite(focusedAge) ||
        !Number.isFinite(rivalAge) ||
        Math.abs(focusedAge! - rivalAge!) > MAX_TYRE_AGE_DELTA_LAPS
      ) {
        excludedForTyres++;
        continue;
      }
    }
    pairs.push({
      lap,
      focusedKmh,
      rivalKmh,
      deltaKmh: focusedKmh - rivalKmh,
    });
  }
  return { pairs, excludedForTyres };
}

function pairedErsDeltaMj(
  focused: DriverData,
  rival: DriverData,
  pairs: ComparablePair[],
): number | null {
  const focusedRows = perLapMap(focused);
  const rivalRows = perLapMap(rival);
  const deltas = pairs.flatMap(({ lap }) => {
    const focusedRow = focusedRows.get(lap);
    const rivalRow = rivalRows.get(lap);
    if (!focusedRow || !rivalRow) return [];
    const focusedMj = ersDeployMjForLap(focusedRow);
    const rivalMj = ersDeployMjForLap(rivalRow);
    // Near-zero values in old car-status exports are usually lap-reset gaps.
    return focusedMj >= 0.2 && rivalMj >= 0.2 ? [focusedMj - rivalMj] : [];
  });
  return median(deltas) ?? null;
}

function overallPaceExplainsSpeed(
  pace: CompoundMatchedPaceComparison | null,
  speedDirection: number,
): boolean {
  if (!pace || Math.abs(pace.deltaMs) <= PACE_TIE_TOLERANCE_MS) return false;
  if ((pace.deltaMs < 0 ? 1 : -1) !== speedDirection) return false;
  return pace.sectorDeltasMs.every(
    (delta) => Math.abs(delta) > 1 && (delta < 0 ? 1 : -1) === speedDirection,
  );
}

function addReason(
  reasons: AeroTendencyReason[],
  reason: AeroTendencyReason,
): void {
  if (!reasons.includes(reason)) reasons.push(reason);
}

/** Build a conservative race-only straight-line and aero-tendency comparison. */
export function buildDriverSpeedComparison(
  session: TelemetrySession,
  focusedIndex: number,
  rivalIndex: number,
  analysis = buildSessionSpeedAnalysis(session),
): DriverSpeedComparison | null {
  const focusedDriver = session["classification-data"]?.find(
    ({ index }) => index === focusedIndex,
  );
  const rivalDriver = session["classification-data"]?.find(
    ({ index }) => index === rivalIndex,
  );
  const focused = analysis.profiles.get(focusedIndex);
  const rival = analysis.profiles.get(rivalIndex);
  if (!focusedDriver || !rivalDriver || !focused || !rival) return null;

  const states = [focusedDriver, rivalDriver].map((driver) =>
    buildProfileState(session, driver),
  );
  const pairResult = comparablePairs(states[0], states[1]);
  const deltas = pairResult.pairs.map(({ deltaKmh }) => deltaKmh);
  const pairedMedianDeltaKmh = median(deltas) ?? null;
  const direction =
    pairedMedianDeltaKmh == null ||
    Math.abs(pairedMedianDeltaKmh) <= NEUTRAL_DELTA_KMH
      ? 0
      : Math.sign(pairedMedianDeltaKmh);
  const directionAgreement =
    direction === 0 || deltas.length === 0
      ? null
      : deltas.filter(
          (delta) =>
            Math.abs(delta) > NEUTRAL_DELTA_KMH &&
            Math.sign(delta) === direction,
        ).length / deltas.length;
  const speedTrapDeltaKmh =
    focused.speedTrap && rival.speedTrap
      ? focused.speedTrap.kmh - rival.speedTrap.kmh
      : null;
  const pairedRepresentative =
    pairResult.pairs.length >= MEDIUM_CONFIDENCE_LAPS
      ? {
          focusedKmh: nearestRankPercentile(
            pairResult.pairs.map(({ focusedKmh }) => focusedKmh),
            80,
          ),
          rivalKmh: nearestRankPercentile(
            pairResult.pairs.map(({ rivalKmh }) => rivalKmh),
            80,
          ),
          percentile: 80 as const,
        }
      : null;
  const reasons: AeroTendencyReason[] = [];
  const restricted = isRestricted(focusedDriver) || isRestricted(rivalDriver);
  const equalCars = equalCarPerformance(session);
  const dry = fullyDry(session);
  const partial = isPartialRace(session);
  const pairedErsDelta = pairedErsDeltaMj(
    focusedDriver,
    rivalDriver,
    pairResult.pairs,
  );
  const matchedPace = compareCompoundMatchedRacePace(
    focusedDriver,
    rivalDriver,
  );

  if (!isRaceSession(session)) addReason(reasons, "not-race");
  if (!dry) addReason(reasons, "wet-or-mixed");
  if (partial) addReason(reasons, "partial-session");
  if (equalCars === false) addReason(reasons, "unequal-cars");
  if (equalCars == null) addReason(reasons, "equal-cars-unknown");
  if (deltas.length < MIN_AERO_LAPS) addReason(reasons, "too-few-laps");
  if (deltas.length < MIN_AERO_LAPS && pairResult.excludedForTyres > 0) {
    addReason(reasons, "compound-or-age-mismatch");
  }
  if (restricted) addReason(reasons, "restricted-telemetry");

  const trapMissing = !focused.speedTrap || !rival.speedTrap;
  if (trapMissing) addReason(reasons, "missing-trap");
  const trapEligible =
    !trapMissing &&
    focused.speedTrap!.quality === "good" &&
    rival.speedTrap!.quality === "good" &&
    focused.speedTrap!.lap != null &&
    rival.speedTrap!.lap != null &&
    states[0].racePaceEligibleLaps.has(focused.speedTrap!.lap) &&
    states[1].racePaceEligibleLaps.has(rival.speedTrap!.lap);
  if (!trapMissing && !trapEligible) addReason(reasons, "trap-lap-ineligible");

  const trapDirection =
    !trapEligible ||
    speedTrapDeltaKmh == null ||
    Math.abs(speedTrapDeltaKmh) <= NEUTRAL_DELTA_KMH
      ? 0
      : Math.sign(speedTrapDeltaKmh);
  if (trapEligible && direction !== 0 && trapDirection !== direction) {
    addReason(reasons, "signals-conflict");
  }

  const comparisonUnavailable =
    !isRaceSession(session) ||
    !dry ||
    partial ||
    deltas.length < MIN_COMPARISON_LAPS;
  const aeroVerdictUnavailable =
    comparisonUnavailable || deltas.length < MIN_AERO_LAPS;
  const aeroSessionBlocked = equalCars !== true;
  let verdict: DriverSpeedComparison["interpretation"]["verdict"] =
    aeroVerdictUnavailable ? "unavailable" : "inconclusive";
  let confidence: DriverSpeedComparison["interpretation"]["confidence"] = null;

  if (
    !aeroVerdictUnavailable &&
    !aeroSessionBlocked &&
    pairedMedianDeltaKmh != null
  ) {
    const magnitude = Math.abs(pairedMedianDeltaKmh);
    if (magnitude < NO_CLEAR_DIFFERENCE_KMH) {
      // A neutral paired result is only meaningful when the fixed trap is
      // present and eligible too. Missing evidence must stay inconclusive.
      if (trapEligible && trapDirection === 0) {
        verdict = "no-clear-difference";
        confidence =
          deltas.length >= MEDIUM_CONFIDENCE_LAPS && !restricted
            ? "medium"
            : "low";
      } else if (trapEligible) {
        addReason(reasons, "signals-conflict");
      }
    } else if (magnitude < MIN_AERO_DELTA_KMH) {
      addReason(reasons, "weak-speed-difference");
    } else if ((directionAgreement ?? 0) < MIN_DIRECTION_AGREEMENT) {
      addReason(reasons, "low-direction-agreement");
    } else if (trapEligible && trapDirection === direction) {
      if (
        pairedErsDelta != null &&
        Math.abs(pairedErsDelta) >= MATERIAL_ERS_DELTA_MJ
      ) {
        addReason(reasons, "material-ers-difference");
      } else if (overallPaceExplainsSpeed(matchedPace, direction)) {
        addReason(reasons, "overall-pace-advantage");
      } else {
        verdict = direction > 0 ? "rival-higher-load" : "rival-lower-drag";
        confidence =
          deltas.length >= MEDIUM_CONFIDENCE_LAPS &&
          !restricted &&
          pairedErsDelta != null
            ? "medium"
            : "low";
      }
    }
  }

  return {
    focused,
    rival,
    sessionPeakDeltaKmh:
      focused.sessionPeak && rival.sessionPeak
        ? focused.sessionPeak.kmh - rival.sessionPeak.kmh
        : null,
    pairedRepresentative,
    pairedMedianDeltaKmh,
    pairedDirectionAgreement: directionAgreement,
    speedTrapDeltaKmh,
    comparableLapCount: deltas.length,
    pairedErsDeltaMj: pairedErsDelta,
    matchedPaceDeltaMs: matchedPace?.deltaMs ?? null,
    matchedSectorDeltasMs: matchedPace?.sectorDeltasMs ?? null,
    interpretation: {
      mode:
        !comparisonUnavailable &&
        !aeroSessionBlocked &&
        deltas.length >= MIN_AERO_LAPS
          ? "aero-tendency"
          : "straight-line-description",
      verdict,
      confidence,
      reasons,
    },
  };
}
