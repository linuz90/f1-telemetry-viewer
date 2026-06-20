import dayjs from "dayjs";
import type {
  DriverData,
  OvertakeRecord,
  RaceControlEvent,
  TelemetrySession,
  TyreStintHistoryV2Entry,
} from "../types/telemetry";
import { isLapValid, msToLapTime, msToSectorTime } from "../utils/format";
import {
  eventMatchesRaceControlFocus,
  humanizeRaceControlType,
} from "../utils/raceControl";
import { isRaceSession, isTimeTrialSessionType } from "../utils/sessionTypes";
import type { StrategyInsight } from "../utils/stats/insightTypes";
import { getBestLapTime, getValidLaps } from "../utils/stats/laps";
import { getLapCompoundMap } from "../utils/stats/tyres";

/**
 * Raw per-session insight facts: result, best lap, incidents, weather, damage,
 * and compact metadata. Ordering/merging for the final card grid happens in
 * `sessionInsightCuration.ts` so this file stays focused on extraction.
 */

export type SessionInsightType =
  | StrategyInsight["type"]
  | "result"
  | "lap"
  | "validity"
  | "race-flow"
  | "incident"
  | "context";

export type SessionInsightTone =
  | "positive"
  | "negative"
  | "warning"
  | "best"
  | "muted"
  | "neutral";

export type SessionInsightAccent =
  | "amber"
  | "rose"
  | "cyan"
  | "emerald"
  | "violet"
  | "fuchsia"
  | "orange"
  | "sky"
  | "lime"
  | "zinc"
  | "purple";

export interface SessionInsight extends Omit<StrategyInsight, "type"> {
  type: SessionInsightType;
  tone?: SessionInsightTone;
  accent?: SessionInsightAccent;
  /** Visual tyre compound for lap-backed insights, when telemetry can map it reliably. */
  compound?: string;
}

export interface BuildSessionSummaryInsightsOptions {
  session: TelemetrySession;
  focusedDriver: DriverData | undefined;
  overtakes?: OvertakeRecord[];
  raceControlEvents?: RaceControlEvent[];
}

interface DriverResult {
  position?: number;
  gridPosition?: number;
  status?: string;
  laps?: number;
  totalLaps?: number;
  points?: number;
  penaltyCount?: number;
  penaltiesTime?: number;
  fieldSize: number;
}

interface SessionBestLap {
  timeMs: number;
  driverIndex?: number;
  driverName?: string;
}

const DAMAGE_FIELDS = [
  ["front-left-wing-damage", "front left wing"],
  ["front-right-wing-damage", "front right wing"],
  ["rear-wing-damage", "rear wing"],
  ["floor-damage", "floor"],
  ["diffuser-damage", "diffuser"],
  ["sidepod-damage", "sidepod"],
  ["engine-damage", "engine"],
  ["gear-box-damage", "gearbox"],
] as const;

function signedNumber(n: number): string {
  return n > 0 ? `+${n}` : String(n);
}

function formatResultStatus(status: string | undefined): string {
  if (!status || status === "FINISHED") return "Finished";
  if (status === "DID_NOT_FINISH") return "DNF";
  if (status === "RETIRED") return "Retired";
  return humanizeRaceControlType(status);
}

function isNegativeResultStatus(status: string | undefined): boolean {
  return Boolean(status && status !== "FINISHED");
}

function getTotalLaps(
  session: TelemetrySession,
  drivers: DriverData[],
): number | undefined {
  const configured = session["session-info"]["total-laps"];
  if (configured > 0) return configured;

  const classifiedLaps = drivers
    .map((driver) => driver["final-classification"]?.["num-laps"] ?? 0)
    .filter((laps) => laps > 0);
  if (classifiedLaps.length > 0) return Math.max(...classifiedLaps);
  return undefined;
}

function matchingStintResult(
  session: TelemetrySession,
  driver: DriverData,
): TyreStintHistoryV2Entry | undefined {
  return session["tyre-stint-history-v2"]?.find(
    (entry) =>
      entry.index === driver.index || entry.name === driver["driver-name"],
  );
}

function getFieldSize(session: TelemetrySession): number {
  const drivers = session["classification-data"] ?? [];
  const classified = drivers.filter(
    (driver) => driver["final-classification"],
  ).length;
  return (
    classified || session["tyre-stint-history-v2"]?.length || drivers.length
  );
}

function getDriverResult(
  session: TelemetrySession,
  driver: DriverData,
): DriverResult {
  const drivers = session["classification-data"] ?? [];
  const classification = driver["final-classification"];
  const stintResult = matchingStintResult(session, driver);
  const totalLaps = getTotalLaps(session, drivers);
  // Race results can be represented in either final-classification or stint
  // history, depending on export vintage. Merge both so session insight cards
  // survive older/debug telemetry without special cases in the UI.
  const laps =
    classification?.["num-laps"] ??
    driver["session-history"]?.["num-laps"] ??
    driver["session-history"]?.["lap-history-data"]?.filter(
      (lap) => lap["lap-time-in-ms"] > 0,
    ).length;

  return {
    position: classification?.position ?? stintResult?.position,
    gridPosition:
      classification?.["grid-position"] ?? stintResult?.["grid-position"],
    status:
      classification?.["result-status"] ||
      stintResult?.["result-status"] ||
      undefined,
    laps,
    totalLaps,
    points: classification?.points,
    penaltyCount: classification?.["num-penalties"],
    penaltiesTime: classification?.["penalties-time"],
    fieldSize: getFieldSize(session),
  };
}

function scanBestLap(session: TelemetrySession): SessionBestLap | undefined {
  const record = session.records?.fastest?.lap;
  if (typeof record?.time === "number" && record.time > 0) {
    return {
      timeMs: record.time,
      driverIndex: record["driver-index"],
      driverName: record["driver-name"],
    };
  }

  // Older/sparse exports may not carry records.fastest; scanning keeps the
  // summary tile useful without depending on a newer Pits n' Giggles schema.
  let best: SessionBestLap | undefined;
  for (const driver of session["classification-data"] ?? []) {
    const timeMs = getBestLapTime(
      driver["session-history"]["lap-history-data"],
    );
    if (timeMs <= 0) continue;
    if (!best || timeMs < best.timeMs) {
      best = {
        timeMs,
        driverIndex: driver.index,
        driverName: driver["driver-name"],
      };
    }
  }
  return best;
}

function bestLapNumberForDriver(
  driver: DriverData,
  bestLapMs: number,
): number | undefined {
  const laps = driver["session-history"]["lap-history-data"] ?? [];
  const matchingIndex = laps.findIndex(
    (lap) =>
      isLapValid(lap["lap-valid-bit-flags"]) &&
      Math.abs(lap["lap-time-in-ms"] - bestLapMs) < 1,
  );
  if (matchingIndex !== -1) return matchingIndex + 1;

  const reportedLap = driver["session-history"]["best-lap-time-lap-num"];
  return reportedLap > 0 ? reportedLap : undefined;
}

function compoundForLap(
  driver: DriverData,
  lapNumber: number | undefined,
): string | undefined {
  if (lapNumber == null) return undefined;
  return getLapCompoundMap(driver).get(lapNumber);
}

function buildRaceResultInsight(
  session: TelemetrySession,
  driver: DriverData,
): SessionInsight | null {
  const result = getDriverResult(session, driver);
  if (!result.position && !result.status) return null;

  const statusLabel = formatResultStatus(result.status);
  const detailParts = [statusLabel];
  if (result.laps && result.totalLaps) {
    detailParts.push(`${result.laps}/${result.totalLaps} laps`);
  }
  if (typeof result.points === "number" && result.points > 0) {
    detailParts.push(`${result.points} pts`);
  }

  const negativeStatus = isNegativeResultStatus(result.status);
  return {
    type: "result",
    label: "Result",
    value: result.position ? `P${result.position}` : statusLabel,
    detail: detailParts.join(" - "),
    tone: negativeStatus
      ? "negative"
      : result.position === 1
        ? "best"
        : "neutral",
    accent: negativeStatus ? "rose" : result.position === 1 ? "amber" : "zinc",
    rank: result.position ? result.position - 1 : undefined,
    rankTotal: result.fieldSize,
  };
}

function buildQualifyingResultInsight(
  session: TelemetrySession,
  driver: DriverData,
): SessionInsight | null {
  const isTimeTrial = isTimeTrialSessionType(
    session["session-info"]["session-type"],
  );
  const laps = driver["session-history"]["lap-history-data"];
  const timedCount = laps.filter((lap) => lap["lap-time-in-ms"] > 0).length;
  const validCount = getValidLaps(laps).length;

  if (isTimeTrial) {
    const invalidCount = Math.max(0, timedCount - validCount);
    return {
      type: "validity",
      label: "Timed Laps",
      value: timedCount > 0 ? `${validCount}/${timedCount} valid` : "No Time",
      detail:
        timedCount === 0
          ? "no timed laps recorded"
          : invalidCount === 0
            ? "all timed laps valid"
            : `${invalidCount} invalid or incomplete`,
      tone: validCount > 0 ? "positive" : "warning",
      accent: validCount > 0 ? "emerald" : "amber",
    };
  }

  const fieldSize = getFieldSize(session);
  const classification = driver["final-classification"];
  const positionFromClassification = classification?.position;
  const ranking = (session["classification-data"] ?? [])
    .map((candidate) => ({
      driver: candidate,
      bestLapMs: getBestLapTime(
        candidate["session-history"]["lap-history-data"],
      ),
    }))
    .filter((entry) => entry.bestLapMs > 0)
    .sort((a, b) => a.bestLapMs - b.bestLapMs);
  // Classification position is preferred when present, but lap-time ranking is
  // a useful fallback for incomplete qualifying exports.
  const positionFromLap =
    ranking.findIndex((entry) => entry.driver.index === driver.index) + 1 ||
    undefined;
  const position = positionFromClassification ?? positionFromLap;
  const status = formatResultStatus(classification?.["result-status"]);
  const hasValidLap = validCount > 0;

  return {
    type: "result",
    label: "Result",
    value: position ? `P${position}` : "No Time",
    detail:
      status !== "Finished"
        ? status
        : hasValidLap
          ? `${validCount} valid lap${validCount === 1 ? "" : "s"}`
          : timedCount > 0
            ? `${validCount}/${timedCount} valid laps`
            : "no timed laps recorded",
    tone: !hasValidLap ? "warning" : position === 1 ? "best" : "neutral",
    accent: !hasValidLap ? "amber" : position === 1 ? "amber" : "zinc",
    rank: position ? position - 1 : undefined,
    rankTotal: fieldSize || ranking.length,
  };
}

function buildBestLapInsight(
  session: TelemetrySession,
  driver: DriverData,
): SessionInsight | null {
  const laps = driver["session-history"]["lap-history-data"];
  const bestLapMs = getBestLapTime(laps);
  const sessionBest = scanBestLap(session);
  const isTimeTrial = isTimeTrialSessionType(
    session["session-info"]["session-type"],
  );

  if (bestLapMs <= 0) {
    return {
      type: "lap",
      label: "Best Lap",
      value: "No Time",
      detail: "no valid lap recorded",
      tone: "warning",
      accent: "amber",
    };
  }

  const isSessionBest =
    sessionBest != null &&
    (sessionBest.driverIndex === driver.index ||
      Math.abs(bestLapMs - sessionBest.timeMs) < 1);
  // A 1ms tolerance avoids treating rounded records and raw lap history as
  // different laps when they describe the same session-best lap.
  const detail =
    sessionBest && sessionBest.timeMs > 0
      ? isSessionBest
        ? isTimeTrial
          ? "best valid lap in this run"
          : "session fastest lap"
        : `+${msToSectorTime(bestLapMs - sessionBest.timeMs)} vs ${sessionBest.driverName ?? "session best"}`
      : "best valid lap";
  const compound = compoundForLap(
    driver,
    bestLapNumberForDriver(driver, bestLapMs),
  );

  return {
    type: "lap",
    label: "Best Lap",
    value: msToLapTime(bestLapMs),
    detail,
    tone: isSessionBest ? "best" : "neutral",
    accent: isSessionBest ? "purple" : "cyan",
    compound,
  };
}

function matchesFocusedDriver(
  record: OvertakeRecord,
  driver: DriverData,
  side: "overtaker" | "overtaken",
): boolean {
  const indexKey =
    side === "overtaker" ? "overtaking-driver-index" : "overtaken-driver-index";
  const nameKey =
    side === "overtaker" ? "overtaking-driver-name" : "overtaken-driver-name";
  return (
    record[indexKey] === driver.index ||
    record[nameKey] === driver["driver-name"]
  );
}

function buildRaceFlowInsight(
  session: TelemetrySession,
  driver: DriverData,
  overtakes: OvertakeRecord[],
): SessionInsight | null {
  if (!isRaceSession(session)) return null;

  // `overtakes` is intentionally caller-supplied so RaceSessionView can reuse
  // the same pit-affected-lap filter as PositionChart before we count passes.
  const result = getDriverResult(session, driver);
  const hasGridMove =
    result.position != null &&
    result.gridPosition != null &&
    result.gridPosition > 0 &&
    result.position > 0;
  const gridMove = hasGridMove ? result.gridPosition! - result.position! : 0;
  const made = overtakes.filter((record) =>
    matchesFocusedDriver(record, driver, "overtaker"),
  ).length;
  const lost = overtakes.filter((record) =>
    matchesFocusedDriver(record, driver, "overtaken"),
  ).length;
  const netPasses = made - lost;

  if (!hasGridMove && made === 0 && lost === 0) return null;

  const primary = hasGridMove ? gridMove : netPasses;
  const detailParts = [];
  if (hasGridMove)
    detailParts.push(`P${result.gridPosition} to P${result.position}`);
  if (made > 0 || lost > 0) detailParts.push(`${made} overtakes, ${lost} lost`);

  return {
    type: "race-flow",
    label: "Race Flow",
    value: hasGridMove
      ? `${signedNumber(gridMove)} pos`
      : `${signedNumber(netPasses)} net`,
    detail: detailParts.join(" · "),
    tone: primary > 0 ? "positive" : primary < 0 ? "negative" : "neutral",
    accent: primary > 0 ? "emerald" : primary < 0 ? "rose" : "zinc",
  };
}

function buildPenaltyInsight(
  session: TelemetrySession,
  driver: DriverData,
  raceControlEvents: RaceControlEvent[],
): SessionInsight | null {
  const result = getDriverResult(session, driver);
  const raceControlPenalties = raceControlEvents.filter(
    (event) =>
      event["message-type"] === "PENALTY" &&
      eventMatchesRaceControlFocus(event, driver),
  ).length;
  const penaltyCount = Math.max(result.penaltyCount ?? 0, raceControlPenalties);
  const penaltiesTime = result.penaltiesTime ?? 0;
  if (penaltyCount <= 0 && penaltiesTime <= 0) return null;

  return {
    type: "incident",
    label: "Penalties",
    value: penaltiesTime > 0 ? `+${penaltiesTime}s` : String(penaltyCount),
    detail: `${penaltyCount} penalt${penaltyCount === 1 ? "y" : "ies"} applied`,
    tone: "warning",
    accent: "amber",
  };
}

function buildSafetyCarInsight(driver: DriverData): SessionInsight | null {
  const safetyLaps = (driver["per-lap-info"] ?? []).filter(
    (lap) =>
      (lap["max-safety-car-status"] ?? "NO_SAFETY_CAR") !== "NO_SAFETY_CAR",
  );
  if (safetyLaps.length === 0) return null;

  const labels = [
    ...new Set(
      safetyLaps.map((lap) =>
        humanizeRaceControlType(lap["max-safety-car-status"]),
      ),
    ),
  ];

  return {
    type: "context",
    label: "Neutralized Laps",
    value: `${safetyLaps.length} lap${safetyLaps.length === 1 ? "" : "s"}`,
    detail: labels.join(", "),
    tone: "warning",
    accent: "amber",
  };
}

function buildDamageInsight(driver: DriverData): SessionInsight | null {
  let peak = 0;
  let peakLabel = "";
  // Final damage alone can miss transient damage/faults from partial debug
  // saves, so scan both final and per-lap damage snapshots.
  const samples = [
    driver["car-damage"],
    ...(driver["per-lap-info"] ?? []).map((lap) => lap["car-damage-data"]),
  ].filter(Boolean);

  for (const damage of samples) {
    for (const [field, label] of DAMAGE_FIELDS) {
      const value = damage[field] ?? 0;
      if (value > peak) {
        peak = value;
        peakLabel = label;
      }
    }
  }

  const finalDamage = driver["car-damage"];
  const faults = [
    finalDamage?.["drs-fault"] ? "DRS fault" : null,
    finalDamage?.["ers-fault"] ? "ERS fault" : null,
    finalDamage?.["engine-blown"] ? "engine blown" : null,
    finalDamage?.["engine-seized"] ? "engine seized" : null,
  ].filter(Boolean);

  if (peak < 15 && faults.length === 0) return null;

  return {
    type: "incident",
    label: "Car Damage",
    value: peak >= 15 ? `${Math.round(peak)}%` : "Fault",
    detail: [peak >= 15 ? `${peakLabel} peak` : null, ...faults]
      .filter(Boolean)
      .join(" - "),
    tone: "negative",
    accent: "rose",
  };
}

function buildWeatherInsight(session: TelemetrySession): SessionInsight | null {
  const info = session["session-info"];
  const weather = info.weather ?? "";
  if (!/(rain|storm|wet)/i.test(weather)) return null;

  return {
    type: "context",
    label: "Conditions",
    value: weather,
    detail: `Track ${info["track-temperature"]}°C - Air ${info["air-temperature"]}°C`,
    tone: "warning",
    accent: /storm/i.test(weather) ? "rose" : "sky",
  };
}

function buildRaceControlIncidentInsight(
  driver: DriverData,
  raceControlEvents: RaceControlEvent[],
): SessionInsight | null {
  const focusedEvents = raceControlEvents.filter((event) =>
    eventMatchesRaceControlFocus(event, driver),
  );
  const collisionCount = focusedEvents.filter(
    (event) => event["message-type"] === "COLLISION",
  ).length;
  const wingChangeCount = focusedEvents.filter(
    (event) => event["message-type"] === "WING_CHANGE",
  ).length;
  const retirementCount = focusedEvents.filter(
    (event) => event["message-type"] === "RETIREMENT",
  ).length;
  const total = collisionCount + wingChangeCount + retirementCount;
  if (total === 0) return null;

  const parts = [
    collisionCount > 0
      ? `${collisionCount} collision${collisionCount === 1 ? "" : "s"}`
      : null,
    wingChangeCount > 0
      ? `${wingChangeCount} wing change${wingChangeCount === 1 ? "" : "s"}`
      : null,
    retirementCount > 0 ? "retirement" : null,
  ].filter(Boolean);

  return {
    type: "incident",
    label: "Race Control",
    value: String(total),
    detail: parts.join(" - "),
    tone: "negative",
    accent: "rose",
  };
}

export function buildSessionSummaryInsights({
  session,
  focusedDriver,
  overtakes = [],
  raceControlEvents = [],
}: BuildSessionSummaryInsightsOptions): SessionInsight[] {
  if (!focusedDriver) return [];

  // Keep the "what happened?" story separate from the existing analytical
  // insight generators. Callers prepend these before pace/tyre/sector tiles.
  const insights: (SessionInsight | null)[] = [
    isRaceSession(session)
      ? buildRaceResultInsight(session, focusedDriver)
      : buildQualifyingResultInsight(session, focusedDriver),
    buildBestLapInsight(session, focusedDriver),
    isRaceSession(session)
      ? buildRaceFlowInsight(session, focusedDriver, overtakes)
      : null,
    buildWeatherInsight(session),
    isRaceSession(session) ? buildSafetyCarInsight(focusedDriver) : null,
    buildPenaltyInsight(session, focusedDriver, raceControlEvents),
    buildDamageInsight(focusedDriver),
    isRaceSession(session)
      ? buildRaceControlIncidentInsight(focusedDriver, raceControlEvents)
      : null,
  ];

  return insights.filter(
    (insight): insight is SessionInsight => insight != null,
  );
}

export function buildSessionInsightsHint(session: TelemetrySession): string {
  const info = session["session-info"];
  const parts: string[] = [];
  const rawTs = session.debug.timestamp.replace(/\s+[A-Z].*$/, "");
  // Pits n' Giggles timestamps may include a trailing timezone label that dayjs
  // does not consistently parse in all environments.
  const date = dayjs(rawTs);
  if (date.isValid()) {
    parts.push(`${date.format("ddd, D MMM YYYY")} · ${date.format("HH:mm")}`);
  }

  if (info.weather) {
    parts.push(`${info.weather}, track ${info["track-temperature"]}°C`);
  }

  if (info["network-game"] === 1) {
    parts.push("Online");
  } else if (info["ai-difficulty"] > 0) {
    parts.push(`AI ${info["ai-difficulty"]}`);
  }

  if (info["total-laps"] > 0) {
    parts.push(
      `${info["total-laps"]} lap${info["total-laps"] === 1 ? "" : "s"}`,
    );
  }

  return parts.join(" - ");
}

export function formatQualifyingTableTitle(session: TelemetrySession): string {
  const type = session["session-info"]["session-type"];
  if (isTimeTrialSessionType(type)) return "Time Trial Laps";
  if (/shootout/i.test(type)) return "Shootout Results";
  return "Qualifying Results";
}
