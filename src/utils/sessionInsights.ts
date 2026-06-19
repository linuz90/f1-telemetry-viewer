import dayjs from "dayjs";
import type {
  DriverData,
  OvertakeRecord,
  RaceControlEvent,
  TelemetrySession,
  TyreStintHistoryV2Entry,
} from "../types/telemetry";
import { isLapValid, msToLapTime, msToSectorTime } from "./format";
import {
  getBestLapTime,
  getLapCompoundMap,
  getValidLaps,
  type StrategyInsight,
} from "./stats";
import { isRaceSession, isTimeTrialSessionType } from "./sessionTypes";
import {
  eventMatchesRaceControlFocus,
  humanizeRaceControlType,
} from "./raceControl";

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

const MAX_SESSION_INSIGHTS = 9;

function compactMetricLine(prefix: string, insight: SessionInsight): string {
  return `${prefix}: ${insight.value}${insight.detail ? ` (${insight.detail})` : ""}`;
}

function uniqueLines(lines: (string | undefined)[]): string[] {
  return [...new Set(lines.filter((line): line is string => Boolean(line)))];
}

function startsWithLabel(insight: SessionInsight, label: string): boolean {
  return insight.label.toLowerCase().startsWith(label.toLowerCase());
}

function findByLabel(
  insights: SessionInsight[],
  label: string,
): SessionInsight | undefined {
  return insights.find((insight) => insight.label === label);
}

function takeByLabel(
  insights: SessionInsight[],
  label: string,
): SessionInsight | undefined {
  const index = insights.findIndex((insight) => insight.label === label);
  if (index === -1) return undefined;
  return insights.splice(index, 1)[0];
}

function takeWhere(
  insights: SessionInsight[],
  predicate: (insight: SessionInsight) => boolean,
): SessionInsight[] {
  const taken: SessionInsight[] = [];
  for (let index = insights.length - 1; index >= 0; index--) {
    const insight = insights[index];
    if (predicate(insight)) {
      taken.unshift(...insights.splice(index, 1));
    }
  }
  return taken;
}

function extractSectorLabel(label: string): string {
  return label.match(/S[1-3]/)?.[0] ?? label;
}

function extractSpeedValue(insight: SessionInsight): string | undefined {
  return insight.detail.match(/\b\d+\s*km\/h\b/)?.[0];
}

function extractTimeDelta(text: string): string | undefined {
  return text.match(/[+-]\d+(?:\.\d+)?s(?:\/lap)?/)?.[0];
}

function rankPosition(value: string): number | undefined {
  return Number(value.match(/\d+/)?.[0]) || undefined;
}

function compactRank(value: string, total?: number | string): string {
  const position = rankPosition(value);
  const suffix = total ? `/${total}` : "";
  return position ? `P${position}${suffix}` : `${value}${suffix}`;
}

function insightRank(
  insight: SessionInsight,
  totalOverride?: number | string,
): string {
  if (insight.rank != null) {
    const total = totalOverride ?? insight.rankTotal;
    return `P${insight.rank + 1}${total ? `/${total}` : ""}`;
  }
  return compactRank(insight.value, totalOverride);
}

function comparisonTarget(detail: string): string | undefined {
  return detail.match(/\b(?:vs|ahead of)\s+(.+)$/)?.[1];
}

function comparisonSuffix(detail: string): string | undefined {
  const target = comparisonTarget(detail);
  return target ? `vs ${target}` : undefined;
}

function rankedMetricLine(prefix: string, insight: SessionInsight): string {
  const rankedMetric = insight.detail.match(/^of\s+(\d+)\s+[—-]\s+(.+)$/);
  if (rankedMetric) {
    return `${prefix} ${rankedMetric[2]} · ${insightRank(insight, rankedMetric[1])}`;
  }

  return compactMetricLine(prefix, insight);
}

function sectorContext(
  insight: SessionInsight,
  role: "strongest" | "weakest",
): string {
  const comparison = comparisonSuffix(insight.detail);
  const roleLabel = role === "strongest" ? "best" : "weak";
  return `${extractSectorLabel(insight.label)} ${roleLabel} · ${insightRank(insight)}${comparison ? ` ${comparison}` : ""}`;
}

function compactFuelLoadLine(initial: SessionInsight): string {
  if (initial.value === "—") return initial.detail;
  const kg = initial.detail.match(/\b\d+(?:\.\d+)?\s*kg\b/)?.[0];
  return `Current ${initial.value}${kg ? ` · ${kg}` : ""}`;
}

function compactFuelRecommendationLine(
  recommended: SessionInsight | undefined,
): string | undefined {
  if (!recommended?.detail) return undefined;
  const spare = recommended.detail.match(
    /([+−-]?\d+(?:\.\d+)?)\s+laps?\s+spare/i,
  );
  if (spare) return `Clean buffer ${spare[1]} laps`;
  const short = recommended.detail.match(
    /([+−-]?\d+(?:\.\d+)?)\s+laps?\s+short/i,
  );
  if (short)
    return `Clean buffer −${Math.abs(Number(short[1])).toFixed(1)} laps`;
  if (/on target/i.test(recommended.detail)) return "Clean race on target";
  return recommended.detail.replace(/\s*\([^)]*\)\s*$/, "");
}

function mergeBestLapInsight(
  bestLap: SessionInsight | undefined,
  theoreticalBest: SessionInsight | undefined,
): SessionInsight | undefined {
  if (!bestLap) return theoreticalBest;
  if (!theoreticalBest) return bestLap;

  return {
    ...bestLap,
    extraDetails: uniqueLines([
      ...(bestLap.extraDetails ?? []),
      compactMetricLine("Theoretical", theoreticalBest),
    ]),
  };
}

function mergeFuelInsights(
  fuelInsights: SessionInsight[],
): SessionInsight | undefined {
  const initial = findByLabel(fuelInsights, "Initial Fuel");
  const recommended = findByLabel(fuelInsights, "Recommended Fuel");
  const primary = recommended ?? initial;
  if (!primary) return undefined;

  const hasRecommendation = recommended && recommended.value !== "—";
  return {
    type: "fuel",
    label: "Fuel Plan",
    value: hasRecommendation ? recommended.value : primary.value,
    detail: hasRecommendation ? "recommended start fuel" : "fuel data missing",
    tooltip: recommended?.tooltip ?? initial?.tooltip,
    accent: "amber",
    extraDetails: uniqueLines([
      initial ? compactFuelLoadLine(initial) : undefined,
      compactFuelRecommendationLine(recommended),
    ]),
  };
}

function mergeSectorInsights(
  sectorInsights: SessionInsight[],
): SessionInsight | undefined {
  if (sectorInsights.length === 0) return undefined;
  if (sectorInsights.length === 1) {
    const insight = sectorInsights[0];
    const isWeakest = startsWithLabel(insight, "Weakest");
    const isStrongest = startsWithLabel(insight, "Strongest");
    if (!isWeakest && !isStrongest) return insight;

    const sector = extractSectorLabel(insight.label);
    const delta = extractTimeDelta(insight.detail);
    return {
      ...insight,
      label: "Sector Split",
      value: isWeakest ? (delta ?? `${sector} weakest`) : `${sector} strongest`,
      detail: sectorContext(insight, isWeakest ? "weakest" : "strongest"),
      accent: "cyan",
    };
  }

  const strongest = sectorInsights.find((insight) =>
    startsWithLabel(insight, "Strongest"),
  );
  const weakest = sectorInsights.find((insight) =>
    startsWithLabel(insight, "Weakest"),
  );
  if (!strongest && !weakest) return sectorInsights[0];

  const primary = strongest ?? weakest;
  if (!primary) return sectorInsights[0];
  const primarySector = extractSectorLabel(primary.label);
  const weakestSector = weakest ? extractSectorLabel(weakest.label) : undefined;
  const weakestDelta = weakest ? extractTimeDelta(weakest.detail) : undefined;
  const weakestContext = weakest
    ? sectorContext(weakest, "weakest")
    : undefined;
  const strongestContext = strongest
    ? sectorContext(strongest, "strongest")
    : undefined;

  return {
    type: "sector",
    label: "Sector Split",
    value:
      weakestDelta ??
      (weakest ? `${weakestSector} weakest` : `${primarySector} strongest`),
    detail: weakestContext ?? primary.detail,
    tooltip: primary.tooltip,
    rank: weakest?.rank ?? primary.rank,
    rankTotal: weakest?.rankTotal ?? primary.rankTotal,
    accent: "cyan",
    extraDetails: uniqueLines([strongestContext]),
  };
}

function mergePowerInsights(
  speed: SessionInsight | undefined,
  ersInsights: SessionInsight[],
): SessionInsight | undefined {
  const deploy = findByLabel(ersInsights, "ERS Deploy");
  const harvest = findByLabel(ersInsights, "ERS Harv");
  const primary = speed ?? deploy ?? harvest;
  if (!primary) return undefined;

  if (!speed) {
    return {
      ...primary,
      label: deploy && harvest ? "ERS Usage" : primary.label,
      value: deploy ? deploy.value : primary.value,
      detail:
        deploy && harvest
          ? rankedMetricLine("Harvest", harvest)
          : primary.detail,
      extraDetails: uniqueLines([
        deploy ? rankedMetricLine("Deploy", deploy) : undefined,
      ]),
    };
  }

  const speedValue = extractSpeedValue(speed) ?? speed.value;
  const speedRank =
    speed.rank != null && speed.rankTotal != null
      ? `${insightRank(speed)}`
      : speed.detail;
  return {
    type: "speed",
    label: deploy || harvest ? "Speed & ERS" : "Top Speed",
    value: speedValue,
    detail: `${speedRank} top speed`,
    tooltip: speed.tooltip ?? deploy?.tooltip ?? harvest?.tooltip,
    rank: speed.rank,
    rankTotal: speed.rankTotal,
    accent: "sky",
    extraDetails: uniqueLines([
      deploy ? rankedMetricLine("Deploy", deploy) : undefined,
      harvest ? rankedMetricLine("Harvest", harvest) : undefined,
    ]),
  };
}

function mergeHistoryInsights(
  historyInsights: SessionInsight[],
): SessionInsight | undefined {
  if (historyInsights.length === 0) return undefined;
  if (historyInsights.length === 1) {
    const insight = historyInsights[0];
    const isPersonalBest = isHighValueHistory(insight);
    return {
      ...insight,
      label: "Personal Bests",
      value:
        insight.value === "New PB!" && /matched/i.test(insight.detail)
          ? "Matched PB"
          : insight.value,
      tone: isPersonalBest ? "best" : "neutral",
      accent: isPersonalBest ? "purple" : "zinc",
    };
  }

  const lap = historyInsights.find(
    (insight) =>
      insight.label === "vs Personal Best" ||
      insight.label === "vs Best Race Lap",
  );
  const highValue = historyInsights.find(isHighValueHistory);
  const primary = highValue ?? lap ?? historyInsights[0];
  const isPersonalBest = historyInsights.some(isHighValueHistory);

  return {
    type: "history",
    label: "Personal Bests",
    value:
      primary.value === "New PB!" && /matched/i.test(primary.detail)
        ? "Matched PB"
        : primary.value,
    detail: primary.detail,
    tooltip: primary.tooltip,
    tone: isPersonalBest ? "best" : "neutral",
    accent: isPersonalBest ? "purple" : "zinc",
    extraDetails: historyInsights
      .filter((insight) => insight !== primary)
      .map((insight) =>
        compactMetricLine(insight.label.replace(/^vs\s+/i, ""), insight),
      ),
  };
}

function mergeEventInsights(events: SessionInsight[]): SessionInsight[] {
  if (events.length <= 1) return events;

  const priority = [
    "Penalties",
    "Car Damage",
    "Race Control",
    "Neutralized Laps",
    "Conditions",
  ];
  const eventRank = (label: string) => {
    const index = priority.indexOf(label);
    return index === -1 ? priority.length : index;
  };
  const sorted = [...events].sort(
    (a, b) => eventRank(a.label) - eventRank(b.label),
  );
  const primary = sorted[0];
  const hasNegativeEvent = sorted.some(
    (insight) => insight.tone === "negative",
  );
  return [
    {
      type: primary.type,
      label: "Session Events",
      value: `${events.length} ${hasNegativeEvent ? "issues" : "notes"}`,
      detail: sorted
        .map((insight) => `${insight.label}: ${insight.value}`)
        .join(" - "),
      tooltip: primary.tooltip,
      tone: hasNegativeEvent ? "negative" : "warning",
      accent: sorted.some((insight) => insight.accent === "rose")
        ? "rose"
        : "amber",
      extraDetails: sorted.map((insight) =>
        compactMetricLine(insight.label, insight),
      ),
    },
  ];
}

function isHighValueHistory(insight: SessionInsight | undefined): boolean {
  if (!insight) return false;

  const value = insight.value.toLowerCase();
  const detail = insight.detail.toLowerCase();
  return (
    /new pb|new best|matched pb|all-time bests/.test(value) ||
    /improvement|matched your best|gained across sectors/.test(detail)
  );
}

function appendIfPresent(
  target: SessionInsight[],
  insight: SessionInsight | undefined,
) {
  if (insight) target.push(insight);
}

export function curateSessionInsights(
  session: TelemetrySession,
  insights: SessionInsight[],
  limit = MAX_SESSION_INSIGHTS,
): SessionInsight[] {
  const isTimeTrial = isTimeTrialSessionType(
    session["session-info"]["session-type"],
  );
  const remaining = insights.filter(
    (insight) => insight.label !== "Lap Quality",
  );
  const result =
    takeByLabel(remaining, "Result") ??
    takeByLabel(remaining, "Timed Laps") ??
    takeByLabel(remaining, "Run Status");
  const bestLap = takeByLabel(remaining, "Best Lap");
  const theoreticalBest = takeByLabel(remaining, "Theoretical Best");
  const lap = mergeBestLapInsight(bestLap, theoreticalBest);
  const raceFlow = takeByLabel(remaining, "Race Flow");
  const events = mergeEventInsights(
    takeWhere(
      remaining,
      (insight) => insight.type === "incident" || insight.type === "context",
    ),
  );
  const racePace = takeByLabel(remaining, "Race Pace");
  const tyre = takeByLabel(remaining, "Tyre Management");
  const qualifying = takeByLabel(remaining, "Qualifying");
  takeByLabel(remaining, "Consistency");
  const firstPit = takeByLabel(remaining, "First Pit Stop");
  const fuel = mergeFuelInsights(
    takeWhere(remaining, (insight) => insight.type === "fuel"),
  );
  const sectors = mergeSectorInsights(
    takeWhere(remaining, (insight) => insight.type === "sector"),
  );
  const power = mergePowerInsights(
    takeByLabel(remaining, "Top Speed"),
    takeWhere(remaining, (insight) => insight.type === "ers"),
  );
  const history = mergeHistoryInsights(
    takeWhere(remaining, (insight) => insight.type === "history"),
  );

  const curated: SessionInsight[] = [];
  appendIfPresent(curated, result);
  appendIfPresent(curated, lap);
  appendIfPresent(curated, raceFlow);
  curated.push(...events);

  if (isRaceSession(session)) {
    appendIfPresent(curated, racePace);
    appendIfPresent(curated, tyre);
    appendIfPresent(curated, fuel);
    appendIfPresent(curated, sectors);
    appendIfPresent(curated, power);
    appendIfPresent(curated, firstPit);
    if (isHighValueHistory(history)) appendIfPresent(curated, history);
  } else if (isTimeTrial) {
    curated.length = 0;
    appendIfPresent(curated, lap);
    appendIfPresent(curated, history);
    appendIfPresent(curated, result);
    appendIfPresent(curated, sectors);
    appendIfPresent(curated, power);
    curated.push(...events);
  } else {
    appendIfPresent(curated, sectors);
    appendIfPresent(curated, power);
    appendIfPresent(curated, history);
    if (!result) appendIfPresent(curated, qualifying);
  }

  curated.push(...remaining);

  return curated.slice(0, limit);
}

export function buildSessionInsightsHint(session: TelemetrySession): string {
  const info = session["session-info"];
  const parts: string[] = [];
  const rawTs = session.debug.timestamp.replace(/\s+[A-Z].*$/, "");
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
