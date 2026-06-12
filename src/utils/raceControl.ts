import type {
  DriverData,
  OvertakeRecord,
  RaceControlDriverInfo,
  RaceControlEvent,
  TelemetrySession,
} from "../types/telemetry";
import { msToLapTime } from "./format";

const BASE_DETAIL_KEYS = new Set([
  "id",
  "lap-number",
  "timestamp",
  "message-type",
  "involved-drivers",
]);

const NESTED_INFO_KEYS = new Set([
  "driver-info",
  "driver-1-info",
  "driver-2-info",
  "other-driver-info",
  "overtaker-info",
  "overtaken-info",
  "session-fastest-driver-info",
]);

export const KEY_RACE_CONTROL_TYPES = new Set([
  "PENALTY",
  "COLLISION",
  "CAR_DAMAGE",
  "RETIREMENT",
  "PITTING",
  "WING_CHANGE",
  "TYRE_CHANGE",
  "FASTEST_LAP",
  "RACE_WINNER",
  "CHEQUERED_FLAG",
]);

export function getRaceControlEvents(session: TelemetrySession): RaceControlEvent[] {
  const topLevel = session["race-control"];
  if (topLevel?.length) return sortRaceControlEvents(topLevel);

  const deduped = new Map<string, RaceControlEvent>();
  for (const driver of session["classification-data"] ?? []) {
    for (const event of driver["race-control"] ?? []) {
      deduped.set(raceControlEventKey(event), event);
    }
  }

  return sortRaceControlEvents([...deduped.values()]);
}

export function sortRaceControlEvents(events: RaceControlEvent[]): RaceControlEvent[] {
  return [...events].sort((a, b) => {
    const timestampDelta = (a.timestamp ?? 0) - (b.timestamp ?? 0);
    if (timestampDelta !== 0) return timestampDelta;
    return (a.id ?? 0) - (b.id ?? 0);
  });
}

export function raceControlEventKey(event: RaceControlEvent): string {
  if (Number.isFinite(event.id)) return String(event.id);
  return `${event.timestamp}-${event["message-type"]}-${event["lap-number"] ?? "session"}`;
}

export function isKeyRaceControlEvent(event: RaceControlEvent): boolean {
  return KEY_RACE_CONTROL_TYPES.has(event["message-type"]);
}

export function isGlobalRaceControlEvent(event: RaceControlEvent): boolean {
  return !event["involved-drivers"]?.length;
}

export function isDriverInvolvedInRaceControlEvent(
  event: RaceControlEvent,
  driver: DriverData,
): boolean {
  if (event["involved-drivers"]?.includes(driver.index)) return true;

  const driverInfos = getRaceControlDriverInfos(event);
  return driverInfos.some(
    (info) => info.name === driver["driver-name"],
  );
}

export function eventMatchesRaceControlFocus(
  event: RaceControlEvent,
  driver: DriverData | undefined,
): boolean {
  if (!driver) return true;
  return isGlobalRaceControlEvent(event) || isDriverInvolvedInRaceControlEvent(event, driver);
}

export function raceControlEventsToOvertakes(
  events: RaceControlEvent[],
): OvertakeRecord[] {
  return events.flatMap((event) => {
    if (event["message-type"] !== "OVERTAKE") return [];
    const lap = event["lap-number"];
    const overtaker = event["overtaker-info"];
    const overtaken = event["overtaken-info"];
    if (typeof lap !== "number" || !overtaker?.name || !overtaken?.name) {
      return [];
    }

    return [{
      "overtake-id": event.id,
      "overtaking-driver-name": overtaker.name,
      "overtaken-driver-name": overtaken.name,
      "overtaking-driver-lap": lap,
      "overtaking-driver-index": event["overtaker-index"],
      "overtaken-driver-index": event["overtaken-index"],
    }];
  });
}

export function formatRaceControlLap(event: RaceControlEvent): string {
  return typeof event["lap-number"] === "number"
    ? `Lap ${event["lap-number"]}`
    : "Session";
}

export function formatRaceControlClock(
  event: RaceControlEvent,
  firstTimestamp: number | undefined,
): string | null {
  if (firstTimestamp == null || !Number.isFinite(event.timestamp)) return null;
  const seconds = Math.max(0, Math.round(event.timestamp - firstTimestamp));
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `+${minutes}:${String(remainder).padStart(2, "0")}`;
}

export function formatRaceControlEvent(event: RaceControlEvent): string {
  switch (event["message-type"]) {
    case "OVERTAKE":
      return `${driverName(event["overtaker-info"])} passed ${driverName(event["overtaken-info"])}`;
    case "SPEED_TRAP_RECORD": {
      const prefix = event["is-session-fastest"]
        ? "set the session speed trap"
        : event["is-personal-fastest"]
          ? "set a personal speed trap"
          : "speed trap";
      return `${driverName(event["driver-info"])} ${prefix} at ${formatSpeed(event.speed)}`;
    }
    case "COLLISION":
      return `${driverName(event["driver-1-info"])} and ${driverName(event["driver-2-info"])} collided`;
    case "PENALTY":
      return formatPenaltyEvent(event);
    case "CAR_DAMAGE":
      return `${driverName(event["driver-info"])} damaged ${formatDamagedPart(event["damaged-part"])}${formatDamageChange(event)}`;
    case "RETIREMENT":
      return `${driverName(event["driver-info"])} retired${event.reason ? `: ${event.reason}` : ""}`;
    case "PITTING":
      return `${driverName(event["driver-info"])} pitted`;
    case "WING_CHANGE":
      return `${driverName(event["driver-info"])} changed front wing`;
    case "TYRE_CHANGE":
      return `${driverName(event["driver-info"])} changed tyres from ${event["old-tyre-compound"] ?? "unknown"} to ${event["new-tyre-compound"] ?? "unknown"}`;
    case "FASTEST_LAP":
      return `${driverName(event["driver-info"])} set fastest lap${typeof event["lap-time-ms"] === "number" ? ` (${msToLapTime(event["lap-time-ms"])})` : ""}`;
    case "RACE_WINNER":
      return `${driverName(event["driver-info"])} won the race`;
    case "CHEQUERED_FLAG":
      return "Chequered flag";
    case "START_LIGHTS": {
      const lights = event["num-lights"];
      return typeof lights === "number"
        ? `${lights} light${lights === 1 ? "" : "s"}`
        : "Start lights";
    }
    case "LIGHTS_OUT":
      return "Lights out";
    case "FLASHBACK":
      return "Flashback used";
    case "SESSION_START":
      return "Session started";
    case "SESSION_END":
      return "Session ended";
    default:
      return humanizeRaceControlType(event["message-type"]);
  }
}

export function formatPenaltySummary(event: RaceControlEvent): string {
  return `${formatRaceControlLap(event)}: ${formatPenaltyEvent(event)}`;
}

export function getRaceControlDriverInfos(
  event: RaceControlEvent,
): RaceControlDriverInfo[] {
  const infos = [
    event["driver-info"],
    event["driver-1-info"],
    event["driver-2-info"],
    event["other-driver-info"],
    event["overtaker-info"],
    event["overtaken-info"],
  ].filter((info): info is RaceControlDriverInfo => Boolean(info?.name));

  const seen = new Set<string>();
  return infos.filter((info) => {
    const key = `${info.name}-${info.team}-${info["driver-number"]}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function getUnknownRaceControlDetails(event: RaceControlEvent): string[] {
  return Object.entries(event)
    .filter(([key, value]) => {
      if (BASE_DETAIL_KEYS.has(key) || NESTED_INFO_KEYS.has(key)) return false;
      return ["string", "number", "boolean"].includes(typeof value);
    })
    .slice(0, 3)
    .map(([key, value]) => `${humanizeRaceControlType(key)}: ${String(value)}`);
}

export function humanizeRaceControlType(type: string): string {
  return type
    .replace(/^m_/, "")
    .replace(/[-_]/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function formatPenaltyEvent(event: RaceControlEvent): string {
  const penalty = event["penalty-type"] ?? "Penalty";
  const infringement = event["infringement-type"];
  const otherDriver = event["other-driver-info"]?.name;
  const time = formatPenaltyTime(event.time);
  return [
    `${driverName(event["driver-info"])}: ${penalty}`,
    infringement ? `for ${infringement}` : null,
    otherDriver ? `with ${otherDriver}` : null,
    time,
  ].filter(Boolean).join(" ");
}

function formatPenaltyTime(time: number | undefined): string | null {
  if (time == null || time === 255 || time <= 0) return null;
  return `(+${time}s)`;
}

function formatSpeed(speed: number | undefined): string {
  return speed == null ? "unknown speed" : `${speed.toFixed(1)} km/h`;
}

function formatDamagedPart(part: string | undefined): string {
  if (!part) return "car";
  return humanizeRaceControlType(part)
    .replace(/\bDamage\b/g, "")
    .trim()
    .toLowerCase();
}

function formatDamageChange(event: RaceControlEvent): string {
  if (typeof event["old-value"] !== "number" || typeof event["new-value"] !== "number") {
    return "";
  }
  return ` (${event["old-value"]}% -> ${event["new-value"]}%)`;
}

function driverName(info: RaceControlDriverInfo | undefined): string {
  return info?.name ?? "Unknown driver";
}
