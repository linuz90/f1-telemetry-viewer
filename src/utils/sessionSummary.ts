import type {
  DriverData,
  FinalClassification,
  ParticipantData,
  PlayerRaceResult,
  PlayerStintSummary,
  RivalEntry,
  SessionSummary,
  TelemetrySession,
  TyreStintHistoryV2Entry,
} from "../types/telemetry";
import { isQualifyingSessionType, isRaceSessionType } from "./sessionTypes";
import { isAutoSaveFilename, parseFilename, resolveSessionMeta, toSlug } from "./parseFilename";

export interface BuiltSessionSummary {
  summary: SessionSummary & { fileSize: number };
  valid: boolean;
}

function getDrivers(session: TelemetrySession | undefined): DriverData[] {
  return session?.["classification-data"] ?? [];
}

function getTimedLapCount(driver: DriverData): number {
  return driver["session-history"]?.["lap-history-data"]?.filter(
    (lap) => lap["lap-time-in-ms"] > 0,
  ).length ?? 0;
}

function findFocusDriver(
  drivers: DriverData[],
): { driver: DriverData | undefined; isSpectator: boolean } {
  const player = drivers.find((driver) => driver["is-player"]);
  if (player) return { driver: player, isSpectator: false };

  let fallback: DriverData | undefined;
  let maxLaps = 0;
  for (const driver of drivers) {
    const count = getTimedLapCount(driver);
    if (count > maxLaps) {
      maxLaps = count;
      fallback = driver;
    }
  }

  return { driver: fallback, isSpectator: fallback != null };
}

function isOnlineParticipant(participant: ParticipantData | undefined): boolean {
  if (!participant) return false;

  // Online exports can mark disconnected human slots as AI-controlled later,
  // so use stable network/identity signals for field-size quality checks.
  const networkId = participant["network-id"];
  return (
    (typeof networkId === "number" && networkId !== 255) ||
    participant["show-online-names"] === true ||
    (participant.platform != null && participant.platform !== "Unknown")
  );
}

function getOnlineDriverCount(drivers: DriverData[], isOnline: boolean): number {
  if (!isOnline) return 0;
  return drivers.filter((driver) => isOnlineParticipant(driver["participant-data"])).length;
}

function getActiveHumanDriverCount(drivers: DriverData[], isOnline: boolean): number {
  if (!isOnline) return 0;
  return drivers.filter((driver) => {
    const participant = driver["participant-data"];
    return isOnlineParticipant(participant) && participant?.["ai-controlled"] === false;
  }).length;
}

function getClassifiedDriverCount(
  drivers: DriverData[],
  stintHistory: TyreStintHistoryV2Entry[] | undefined,
): number {
  const finalClassified = drivers.filter((driver) => driver["final-classification"]).length;
  return finalClassified || stintHistory?.length || drivers.length;
}

function getTotalLaps(session: TelemetrySession, drivers: DriverData[]): number | undefined {
  const sessionTotal = session["session-info"]?.["total-laps"];
  if (typeof sessionTotal === "number" && sessionTotal > 0) return sessionTotal;

  const finalLaps = drivers
    .map((driver) => driver["final-classification"]?.["num-laps"] ?? 0)
    .filter((laps) => laps > 0);
  return finalLaps.length > 0 ? Math.max(...finalLaps) : undefined;
}

function getBestLapMs(classification: FinalClassification): number | undefined {
  const newerField = classification["best-lap-time-ms"];
  if (typeof newerField === "number" && newerField > 0) return newerField;

  const olderField = classification["best-lap-time-in-ms"];
  return olderField > 0 ? olderField : undefined;
}

interface RaceTelemetryExtras {
  lapOnePosition?: number;
  topSpeedTrapRank?: number;
  topSpeedTrapTotal?: number;
  stints?: PlayerStintSummary[];
  purpleSectors?: { s1: boolean; s2: boolean; s3: boolean };
  overtakesMade?: number;
  overtakesTaken?: number;
  playerTeam?: string;
  playerLapStats?: { meanLapMs: number; stddevLapMs: number; validLapCount: number };
  rivals?: RivalEntry[];
}

function normalizeDriverKey(name: string | undefined): string {
  return (name ?? "").trim().toLowerCase();
}

function computeLapStats(driver: DriverData): {
  bestLapMs?: number;
  validLapCount: number;
  meanLapMs?: number;
  stddevLapMs?: number;
} {
  const laps = driver["session-history"]?.["lap-history-data"] ?? [];
  const validTimes: number[] = [];
  for (const lap of laps) {
    if (lap["lap-time-in-ms"] > 0 && lap["lap-valid-bit-flags"] === 15) {
      validTimes.push(lap["lap-time-in-ms"]);
    }
  }
  if (validTimes.length === 0) return { validLapCount: 0 };
  const mean = validTimes.reduce((sum, v) => sum + v, 0) / validTimes.length;
  let std = 0;
  if (validTimes.length > 1) {
    const variance =
      validTimes.reduce((sum, v) => sum + (v - mean) ** 2, 0) /
      (validTimes.length - 1);
    std = Math.sqrt(variance);
  }
  const best = Math.min(...validTimes);
  return {
    bestLapMs: best,
    validLapCount: validTimes.length,
    meanLapMs: Math.round(mean),
    stddevLapMs: Math.round(std),
  };
}

function buildPositionMap(
  history: { "lap-number": number; position: number }[] | undefined,
): Map<number, number> {
  const map = new Map<number, number>();
  if (!history) return map;
  for (const entry of history) {
    if (typeof entry.position === "number" && entry.position > 0) {
      map.set(entry["lap-number"], entry.position);
    }
  }
  return map;
}

function avgPositionGap(
  playerMap: Map<number, number>,
  rivalMap: Map<number, number>,
): { gap?: number; samples: number } {
  if (playerMap.size === 0 || rivalMap.size === 0) return { samples: 0 };
  let total = 0;
  let samples = 0;
  for (const [lapNum, playerPos] of playerMap) {
    const rivalPos = rivalMap.get(lapNum);
    if (rivalPos == null) continue;
    total += Math.abs(playerPos - rivalPos);
    samples += 1;
  }
  if (samples === 0) return { samples: 0 };
  return { gap: total / samples, samples };
}

function buildRivalsRoster(
  session: TelemetrySession,
  player: DriverData,
  isOnline: boolean,
): RivalEntry[] | undefined {
  // Rivals data is dashboard-only and the section it powers is scoped to online
  // races. Skip offline AI sessions to keep the summary slim and the cards
  // meaningful (rotating AI fields aren't "rivals" the same way).
  if (!isOnline) return undefined;

  const drivers = session["classification-data"] ?? [];
  const others = drivers.filter((d) => !d["is-player"] && d["driver-name"]);
  if (others.length === 0) return undefined;

  const playerName = player["driver-name"];
  const playerTeam = player.team;
  const positionHistory = session["position-history"] ?? [];
  const positionByName = new Map<string, Map<number, number>>();
  for (const entry of positionHistory) {
    positionByName.set(
      normalizeDriverKey(entry.name),
      buildPositionMap(entry["driver-position-history"]),
    );
  }
  const playerPositionMap = positionByName.get(normalizeDriverKey(playerName));

  const overtakes = session.overtakes?.records ?? [];
  const overtakesByDriver = new Map<string, number>();
  const overtakesOnPlayer = new Map<string, number>();
  const overtakesByPlayer = new Map<string, number>();
  for (const record of overtakes) {
    const overtaker = record["overtaking-driver-name"];
    const overtaken = record["overtaken-driver-name"];
    if (overtaker) {
      const k = normalizeDriverKey(overtaker);
      overtakesByDriver.set(k, (overtakesByDriver.get(k) ?? 0) + 1);
      if (overtaken === playerName) {
        overtakesOnPlayer.set(k, (overtakesOnPlayer.get(k) ?? 0) + 1);
      }
    }
    if (overtaker === playerName && overtaken) {
      const k = normalizeDriverKey(overtaken);
      overtakesByPlayer.set(k, (overtakesByPlayer.get(k) ?? 0) + 1);
    }
  }

  // Identify the race's overall fastest valid lap so we can flag it per rival.
  // `records.fastest.lap` carries the driver-index, but indexing rivals by name
  // (our identity key) is simpler and tolerates index drift.
  const fastestRecord = session.records?.fastest?.lap;
  const fastestDriverIndex =
    typeof fastestRecord?.["driver-index"] === "number"
      ? fastestRecord["driver-index"]
      : undefined;
  const fastestDriverName =
    fastestDriverIndex != null
      ? drivers.find((d) => d.index === fastestDriverIndex)?.["driver-name"]
      : fastestRecord?.["driver-name"];
  const fastestKey = fastestDriverName
    ? normalizeDriverKey(fastestDriverName)
    : undefined;

  const roster: RivalEntry[] = [];
  for (const driver of others) {
    const name = driver["driver-name"];
    if (!name) continue;
    const key = normalizeDriverKey(name);
    const lapStats = computeLapStats(driver);
    // A slot is an AI fill (game-roster surname like VERSTAPPEN/ANTONELLI)
    // when it carries none of the online-identity markers. We deliberately
    // do NOT rely on `ai-controlled` alone — a disconnected human can flip
    // to AI mid-session, but `isOnlineParticipant` stays true via the
    // stable network-id/platform fields. See the comment on that helper.
    const participant = driver["participant-data"];
    const isAi = participant ? !isOnlineParticipant(participant) : undefined;
    const rivalPositionMap = positionByName.get(key);
    const gapResult =
      playerPositionMap && rivalPositionMap
        ? avgPositionGap(playerPositionMap, rivalPositionMap)
        : { samples: 0 };
    const classification = driver["final-classification"];
    const bestFromClassification = classification
      ? getBestLapMs(classification)
      : undefined;
    const bestLapMs = lapStats.bestLapMs ?? bestFromClassification;

    roster.push({
      key,
      name,
      team: driver.team,
      isTeammate: Boolean(playerTeam) && driver.team === playerTeam,
      position: classification?.position,
      gridPosition: classification?.["grid-position"],
      status: classification?.["result-status"] || undefined,
      penaltyCount: classification?.["num-penalties"],
      bestLapMs,
      validLapCount: lapStats.validLapCount,
      meanLapMs: lapStats.meanLapMs,
      stddevLapMs: lapStats.stddevLapMs,
      overtakes: overtakesByDriver.get(key) ?? 0,
      overtakesOnPlayer: overtakesOnPlayer.get(key) ?? 0,
      overtakesByPlayer: overtakesByPlayer.get(key) ?? 0,
      avgPositionGap: gapResult.gap,
      positionGapSamples: gapResult.samples > 0 ? gapResult.samples : undefined,
      hadFastestLap: fastestKey != null ? key === fastestKey : undefined,
      isAi,
    });
  }

  return roster.length > 0 ? roster : undefined;
}

// Pull race-only signals (lap-1 launch, speed-trap rank, stint wear, purple
// sectors, overtakes) into the slim summary so the dashboard insights don't
// need to load full session JSON for every race.
function buildRaceTelemetryExtras(
  session: TelemetrySession,
  player: DriverData,
  isOnline: boolean,
): RaceTelemetryExtras {
  const extras: RaceTelemetryExtras = {};
  if (player.team) extras.playerTeam = player.team;

  const playerLapStats = computeLapStats(player);
  if (playerLapStats.validLapCount > 0 && playerLapStats.meanLapMs != null) {
    extras.playerLapStats = {
      meanLapMs: playerLapStats.meanLapMs,
      stddevLapMs: playerLapStats.stddevLapMs ?? 0,
      validLapCount: playerLapStats.validLapCount,
    };
  }

  const rivals = buildRivalsRoster(session, player, isOnline);
  if (rivals) extras.rivals = rivals;

  const perLap = player["per-lap-info"] ?? [];
  const lapOne = perLap[0]?.["track-position"];
  if (typeof lapOne === "number" && lapOne > 0) {
    extras.lapOnePosition = lapOne;
  }

  const trap = session["speed-trap-records"] ?? [];
  if (trap.length > 0) {
    const sorted = [...trap].sort(
      (a, b) => (b["speed-trap-record-kmph"] ?? 0) - (a["speed-trap-record-kmph"] ?? 0),
    );
    const idx = sorted.findIndex((entry) => entry.name === player["driver-name"]);
    if (idx >= 0) {
      extras.topSpeedTrapRank = idx + 1;
      extras.topSpeedTrapTotal = sorted.length;
    }
  }

  const stints = player["tyre-set-history"] ?? [];
  const stintSummaries: PlayerStintSummary[] = [];
  for (const stint of stints) {
    const laps = stint["stint-length"];
    if (!laps || laps < 1) continue;
    const wearHistory = stint["tyre-wear-history"] ?? [];
    const endWear = wearHistory.at(-1)?.average;
    if (typeof endWear !== "number") continue;
    const compound = stint["tyre-set-data"]?.["visual-tyre-compound"];
    if (!compound) continue;
    stintSummaries.push({ compound, laps, endWearAvg: endWear });
  }
  if (stintSummaries.length > 0) extras.stints = stintSummaries;

  const fastest = session.records?.fastest;
  if (fastest) {
    extras.purpleSectors = {
      s1: fastest.s1?.["driver-index"] === player.index,
      s2: fastest.s2?.["driver-index"] === player.index,
      s3: fastest.s3?.["driver-index"] === player.index,
    };
  }

  const overtakes = session.overtakes?.records ?? [];
  if (overtakes.length > 0) {
    const name = player["driver-name"];
    extras.overtakesMade = overtakes.filter(
      (record) => record["overtaking-driver-name"] === name,
    ).length;
    extras.overtakesTaken = overtakes.filter(
      (record) => record["overtaken-driver-name"] === name,
    ).length;
  }

  return extras;
}

function buildPlayerRaceResult(
  session: TelemetrySession,
  player: DriverData | undefined,
  fieldSize: number,
): PlayerRaceResult | undefined {
  if (!player || !isRaceSessionType(session["session-info"]?.["session-type"])) {
    return undefined;
  }

  const classification = player["final-classification"];
  const stintResult = session["tyre-stint-history-v2"]?.find(
    (entry) => entry.index === player.index || entry.name === player["driver-name"],
  );
  const position = classification?.position ?? stintResult?.position;
  if (!position) return undefined;

  const totalLaps = getTotalLaps(session, getDrivers(session));
  const playerLaps =
    classification?.["num-laps"] ??
    player["session-history"]?.["num-laps"] ??
    getTimedLapCount(player);
  const lapRatio = totalLaps && totalLaps > 0 ? playerLaps / totalLaps : undefined;

  return {
    position,
    gridPosition: classification?.["grid-position"] ?? stintResult?.["grid-position"],
    status: classification?.["result-status"] || stintResult?.["result-status"] || undefined,
    points: classification?.points,
    penaltiesTime: classification?.["penalties-time"],
    penaltyCount: classification?.["num-penalties"],
    playerLaps,
    totalLaps,
    lapRatio,
    fieldSize,
    bestLapTime: classification?.["best-lap-time-str"],
    bestLapTimeMs: classification ? getBestLapMs(classification) : undefined,
  };
}

export function buildSessionSummary(
  relativePath: string,
  session?: TelemetrySession,
  fileSize = 0,
): BuiltSessionSummary {
  const parsed = session
    ? resolveSessionMeta(relativePath, session["session-info"])
    : parseFilename(relativePath);
  const slug = toSlug(relativePath);
  const drivers = getDrivers(session);
  const { driver: focusDriver, isSpectator } = findFocusDriver(drivers);
  const sessionInfo = session?.["session-info"];
  const isOnline = sessionInfo?.["network-game"] === 1;
  const aiDifficulty = isOnline ? 0 : (sessionInfo?.["ai-difficulty"] ?? 0);
  const classifiedDriverCount = getClassifiedDriverCount(
    drivers,
    session?.["tyre-stint-history-v2"],
  );
  const onlineDriverCount = getOnlineDriverCount(drivers, isOnline);
  const activeHumanDriverCount = getActiveHumanDriverCount(drivers, isOnline);
  const weather = sessionInfo?.weather;
  // Records carry the fastest lap of the session — if its driver-index matches the
  // player slot, the player set the fastest lap. For uploads/older exports without
  // records, this stays undefined and Fastest Lap King simply excludes the session.
  const fastestLapDriverIndex = session?.records?.fastest?.lap?.["driver-index"];
  const playerSetFastestLap =
    focusDriver != null && typeof fastestLapDriverIndex === "number"
      ? fastestLapDriverIndex === focusDriver.index
      : undefined;

  const raceExtras =
    session && focusDriver && !isSpectator && isRaceSessionType(parsed.sessionType)
      ? buildRaceTelemetryExtras(session, focusDriver, isOnline)
      : {};

  let validLapCount = 0;
  let lapIndicators: ("valid" | "invalid" | "best")[] | undefined;
  let bestLapTime: string | undefined;
  let bestLapTimeMs: number | undefined;

  if (focusDriver) {
    const laps = focusDriver["session-history"]?.["lap-history-data"] ?? [];
    validLapCount = laps.filter((lap) => lap["lap-time-in-ms"] > 0).length;

    if (isQualifyingSessionType(parsed.sessionType)) {
      const bestLapNum = focusDriver["session-history"]?.["best-lap-time-lap-num"] ?? -1;
      lapIndicators = laps
        .filter((lap) => lap["lap-time-in-ms"] > 0)
        .map((lap, index) => {
          const lapNum = index + 1;
          if (lapNum === bestLapNum) return "best" as const;
          return lap["lap-valid-bit-flags"] === 15 ? "valid" : "invalid";
        });

      if (bestLapNum > 0) {
        const bestLap = laps[bestLapNum - 1];
        if (bestLap?.["lap-time-str"]) {
          bestLapTime = bestLap["lap-time-str"];
          bestLapTimeMs = bestLap["lap-time-in-ms"];
        }
      }
    }
  }

  return {
    summary: {
      relativePath,
      slug,
      ...parsed,
      gameYear: typeof session?.["game-year"] === "number" ? session["game-year"] : undefined,
      packetFormat: typeof session?.["packet-format"] === "number" ? session["packet-format"] : undefined,
      validLapCount,
      lapIndicators,
      bestLapTime,
      bestLapTimeMs,
      aiDifficulty,
      isOnline,
      isSpectator,
      classifiedDriverCount,
      onlineDriverCount,
      activeHumanDriverCount,
      weather,
      playerSetFastestLap,
      ...raceExtras,
      playerRaceResult: session && !isSpectator
        ? buildPlayerRaceResult(session, focusDriver, classifiedDriverCount)
        : undefined,
      fileSize,
      isAutoSave: isAutoSaveFilename(relativePath),
    },
    valid: validLapCount > 0,
  };
}
