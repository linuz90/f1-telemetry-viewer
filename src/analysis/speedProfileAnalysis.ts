import type {
  CarDamage,
  DriverData,
  PerLapInfo,
  SpeedTrapRecord,
  TelemetrySession,
} from "../types/telemetry";
import { isRaceSession } from "../utils/sessionTypes";
import { median } from "../utils/stats/core";
import {
  getRacePaceLapSamples,
  hasCompleteLapTiming,
} from "../utils/stats/laps";
import type {
  DriverSpeedProfile,
  LapPeakSample,
  SessionSpeedAnalysis,
} from "./speedAnalysis";

const GLITCH_MULTIPLIER = 1.15;
// A one-lap/partial export has no useful median baseline. Keep a generous
// physical ceiling so the known 486 km/h UDP spike cannot become canonical.
const MAX_PLAUSIBLE_SPEED_KMH = 450;
const MIN_REPRESENTATIVE_LAPS = 8;
const VALUE_MATCH_TOLERANCE_KMH = 0.01;

export interface ProfileBuildState {
  driver: DriverData;
  profile: DriverSpeedProfile;
  glitchCap?: number;
  racePaceEligibleLaps: Set<number>;
}

function positiveFinite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

export function isRestricted(driver: DriverData): boolean {
  return (
    driver["participant-data"]?.["telemetry-setting"]?.trim().toLowerCase() ===
    "restricted"
  );
}

function hasAeroOrPowerFault(damage: CarDamage | undefined): boolean {
  if (!damage) return false;
  return (
    damage["front-left-wing-damage"] > 0 ||
    damage["front-right-wing-damage"] > 0 ||
    damage["rear-wing-damage"] > 0 ||
    damage["floor-damage"] > 0 ||
    damage["diffuser-damage"] > 0 ||
    damage["sidepod-damage"] > 0 ||
    damage["drs-fault"] === true ||
    damage["ers-fault"] === true
  );
}

export function perLapMap(driver: DriverData): Map<number, PerLapInfo> {
  return new Map(
    (driver["per-lap-info"] ?? [])
      .filter((lap) => lap["lap-number"] > 0)
      .map((lap) => [lap["lap-number"], lap]),
  );
}

export function nearestRankPercentile(
  values: number[],
  percentile: number,
): number {
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil((percentile / 100) * sorted.length);
  return sorted[Math.max(0, rank - 1)]!;
}

export function buildProfileState(
  session: TelemetrySession,
  driver: DriverData,
): ProfileBuildState {
  const completeRawPeaks: Array<{ lap: number; kmh: number }> = [];
  for (const row of driver["per-lap-info"] ?? []) {
    const lap = row["lap-number"];
    const history = driver["session-history"]?.["lap-history-data"]?.[lap - 1];
    const kmh = row["top-speed-kmph"];
    // Track-limit validity does not change whether a speed was genuinely
    // reached. Structural completeness is enough for descriptive peak data.
    if (
      lap <= 0 ||
      !positiveFinite(kmh) ||
      !history ||
      !hasCompleteLapTiming(history)
    ) {
      continue;
    }
    completeRawPeaks.push({ lap, kmh });
  }

  const baseline = median(completeRawPeaks.map(({ kmh }) => kmh));
  const glitchCap = baseline == null ? undefined : baseline * GLITCH_MULTIPLIER;
  const lapPeaks = completeRawPeaks.map<LapPeakSample>(({ lap, kmh }) => {
    const glitch =
      kmh > MAX_PLAUSIBLE_SPEED_KMH || (glitchCap != null && kmh > glitchCap);
    return {
      lap,
      kmh,
      accepted: !glitch,
      rejectionReasons: glitch ? ["glitch"] : [],
    };
  });
  const acceptedPeaks = lapPeaks.filter(({ accepted }) => accepted);
  const completedPeak = acceptedPeaks.reduce<LapPeakSample | undefined>(
    (best, sample) =>
      !best ||
      sample.kmh > best.kmh ||
      (sample.kmh === best.kmh && sample.lap < best.lap)
        ? sample
        : best,
    undefined,
  );
  const rawSessionPeak = driver["top-speed-kmph"];
  const credibleSessionPeak =
    positiveFinite(rawSessionPeak) &&
    rawSessionPeak <= MAX_PLAUSIBLE_SPEED_KMH &&
    (glitchCap == null || rawSessionPeak <= glitchCap)
      ? rawSessionPeak
      : undefined;

  let sessionPeak: DriverSpeedProfile["sessionPeak"] = null;
  if (completedPeak && credibleSessionPeak != null) {
    if (
      Math.abs(completedPeak.kmh - credibleSessionPeak) <=
      VALUE_MATCH_TOLERANCE_KMH
    ) {
      sessionPeak = {
        kmh: Math.max(completedPeak.kmh, credibleSessionPeak),
        lap: completedPeak.lap,
        source: "combined",
        quality: "good",
      };
    } else if (completedPeak.kmh > credibleSessionPeak) {
      sessionPeak = {
        kmh: completedPeak.kmh,
        lap: completedPeak.lap,
        source: "completed-lap",
        quality: "good",
      };
    } else {
      sessionPeak = {
        kmh: credibleSessionPeak,
        source: "session",
        quality: "limited",
      };
    }
  } else if (completedPeak) {
    sessionPeak = {
      kmh: completedPeak.kmh,
      lap: completedPeak.lap,
      source: "completed-lap",
      quality: "good",
    };
  } else if (credibleSessionPeak != null) {
    sessionPeak = {
      kmh: credibleSessionPeak,
      source: "session",
      quality: "limited",
    };
  }

  const lapRows = perLapMap(driver);
  const acceptedByLap = new Map(
    acceptedPeaks.map((sample) => [sample.lap, sample]),
  );
  const eligibleSamples = isRaceSession(session)
    ? getRacePaceLapSamples(driver).filter((sample) => {
        const row = lapRows.get(sample.lapNumber);
        return (
          acceptedByLap.has(sample.lapNumber) &&
          !hasAeroOrPowerFault(row?.["car-damage-data"])
        );
      })
    : [];
  const eligibleSpeeds = eligibleSamples.map(
    ({ lapNumber }) => acceptedByLap.get(lapNumber)!.kmh,
  );

  return {
    driver,
    glitchCap,
    racePaceEligibleLaps: new Set(
      eligibleSamples.map(({ lapNumber }) => lapNumber),
    ),
    profile: {
      driverIndex: driver.index,
      lapPeaks,
      sessionPeak,
      representativeHighSpeed:
        eligibleSpeeds.length >= MIN_REPRESENTATIVE_LAPS
          ? {
              kmh: nearestRankPercentile(eligibleSpeeds, 80),
              percentile: 80,
              eligibleLapCount: eligibleSpeeds.length,
              quality: isRestricted(driver) ? "limited" : "good",
            }
          : null,
      speedTrap: null,
    },
  };
}

function assignCompetitionRanks(states: ProfileBuildState[]): void {
  const ranked = states
    .filter(
      ({ profile }) =>
        profile.sessionPeak?.source === "completed-lap" ||
        profile.sessionPeak?.source === "combined",
    )
    .sort((a, b) => b.profile.sessionPeak!.kmh - a.profile.sessionPeak!.kmh);
  ranked.forEach(({ profile }) => {
    const kmh = profile.sessionPeak!.kmh;
    profile.sessionPeak!.rank =
      ranked.findIndex(
        ({ profile: candidate }) => candidate.sessionPeak!.kmh === kmh,
      ) + 1;
    profile.sessionPeak!.fieldSize = ranked.length;
  });
}

function normalizedName(value: string): string {
  return value
    .normalize("NFKC")
    .trim()
    .replace(/\s+/g, " ")
    .toLocaleLowerCase("en-US");
}

function driverForTrapRecord(
  record: SpeedTrapRecord,
  drivers: DriverData[],
): DriverData | undefined {
  const exact = drivers.filter(
    (driver) => driver["driver-name"] === record.name,
  );
  if (exact.length === 1) return exact[0];
  if (exact.length > 1) return undefined;
  const key = normalizedName(record.name);
  const normalized = drivers.filter(
    (driver) => normalizedName(driver["driver-name"]) === key,
  );
  return normalized.length === 1 ? normalized[0] : undefined;
}

function attachSpeedTraps(
  session: TelemetrySession,
  states: ProfileBuildState[],
): void {
  const drivers = states.map(({ driver }) => driver);
  const stateByDriverIndex = new Map(
    states.map((state) => [state.driver.index, state]),
  );
  const records = (session["speed-trap-records"] ?? []).filter((record) => {
    const kmh = record["speed-trap-record-kmph"];
    if (!positiveFinite(kmh) || kmh > MAX_PLAUSIBLE_SPEED_KMH) return false;
    const driver = driverForTrapRecord(record, drivers);
    const glitchCap =
      driver == null
        ? undefined
        : stateByDriverIndex.get(driver.index)?.glitchCap;
    return glitchCap == null || kmh <= glitchCap;
  });
  const recordsByDriver = new Map<number, SpeedTrapRecord[]>();
  for (const record of records) {
    const driver = driverForTrapRecord(record, drivers);
    if (!driver) continue;
    const matches = recordsByDriver.get(driver.index) ?? [];
    matches.push(record);
    recordsByDriver.set(driver.index, matches);
  }

  for (const state of states) {
    const matches = recordsByDriver.get(state.driver.index);
    // Multiple old records for one display name cannot be disambiguated
    // without the car index that future recorder versions should export.
    if (matches?.length !== 1) continue;
    const record = matches[0];
    const kmh = record["speed-trap-record-kmph"];
    const lapDataSpeed = state.driver["lap-data"]?.["speed-trap-fastest-speed"];
    const lapDataLap = state.driver["lap-data"]?.["speed-trap-fastest-lap"];
    const lapMatches =
      positiveFinite(lapDataSpeed) &&
      Number.isInteger(lapDataLap) &&
      (lapDataLap ?? 0) > 0 &&
      Math.abs(lapDataSpeed - kmh) <= VALUE_MATCH_TOLERANCE_KMH;
    state.profile.speedTrap = {
      kmh,
      ...(lapMatches ? { lap: lapDataLap } : {}),
      rank:
        records.filter((candidate) => candidate["speed-trap-record-kmph"] > kmh)
          .length + 1,
      fieldSize: records.length,
      quality: lapMatches ? "good" : "unattributed",
    };
  }
}

export function buildProfiles(session: TelemetrySession): SessionSpeedAnalysis {
  const states = (session["classification-data"] ?? []).map((driver) =>
    buildProfileState(session, driver),
  );
  assignCompetitionRanks(states);
  attachSpeedTraps(session, states);
  return {
    profiles: new Map(
      states.map(({ profile }) => [profile.driverIndex, profile]),
    ),
  };
}
