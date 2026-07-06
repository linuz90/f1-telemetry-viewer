import type { DriverData, RaceControlEvent } from "../types/telemetry";
import {
  formatRaceControlLocation,
  isDriverInvolvedInRaceControlEvent,
} from "../utils/raceControl";

/** A single slice of a location-breakdown pie chart. */
export interface LocationSlice {
  label: string;
  count: number;
}

export interface EventLocationBreakdown {
  /** Located buckets (capped, biggest first), then optional "Other"/"Unknown". */
  slices: LocationSlice[];
  /** Every event of the requested type (located or not). */
  total: number;
  /** Events with a resolved track location. */
  locatedCount: number;
}

/**
 * How a "focus driver" filter matches events for a given chart:
 * - "overtaker": overtakes are directional — keep only passes the driver *made*
 *   (driver is the overtaker, not the overtaken).
 * - "involved": collisions are commutative — keep any the driver took part in.
 */
export type EventFocusMode = "overtaker" | "involved";

/** Whether an event should survive the focus-driver filter for the given mode. */
export function eventMatchesDriverFocus(
  event: RaceControlEvent,
  driver: DriverData,
  mode: EventFocusMode,
): boolean {
  if (mode === "overtaker") {
    return (
      event["overtaker-index"] === driver.index ||
      event["overtaker-info"]?.name === driver["driver-name"]
    );
  }
  return isDriverInvolvedInRaceControlEvent(event, driver);
}

/** Keep the pie readable — beyond this, the long tail folds into "Other". */
const MAX_LOCATED_SLICES = 7;
export const OTHER_LABEL = "Other";
export const UNKNOWN_LABEL = "Unknown";

interface LocatedBucket {
  label: string;
  count: number;
  /** Raw event sector ("S1" | "S2" | "S3" …) — used to fold the tail by sector. */
  sector: string | null;
}

/** "S1" -> "Sector 1", mirroring the race-control timeline's sector label. */
function sectorLabel(sector: string): string {
  const match = /^S([1-3])$/.exec(sector);
  return match ? `Sector ${match[1]}` : sector;
}

/** True for any aggregate bucket ("Other", "Other · Sector N", "Unknown"). */
export function isAggregateLocationLabel(label: string): boolean {
  return (
    label === UNKNOWN_LABEL ||
    label === OTHER_LABEL ||
    label.startsWith(`${OTHER_LABEL} · `)
  );
}

/**
 * Fold the long tail into per-sector "Other · Sector N" buckets so the remainder
 * still tells you which part of the track it was on. Tail events with no sector
 * fall back to a plain "Other" bucket, kept last.
 */
function foldTailBySector(tail: LocatedBucket[]): LocationSlice[] {
  const bySector = new Map<string, number>();
  for (const bucket of tail) {
    const key = bucket.sector ?? "";
    bySector.set(key, (bySector.get(key) ?? 0) + bucket.count);
  }

  return [...bySector.entries()]
    .sort(([a], [b]) => {
      // Plain "Other" (no sector) sorts last; sectors go S1, S2, S3…
      if (a === "") return 1;
      if (b === "") return -1;
      return a.localeCompare(b);
    })
    .map(([key, count]) => ({
      label: key === "" ? OTHER_LABEL : `${OTHER_LABEL} · ${sectorLabel(key)}`,
      count,
    }));
}

/**
 * Bucket race-control events of a single type (e.g. OVERTAKE, COLLISION) by the
 * track location the race-control timeline shows for them
 * (`formatRaceControlLocation`: corner/segment name, falling back to sector).
 *
 * Events without location data (older exports that carry no `segment-info`) are
 * counted as "Unknown" and reported via `locatedCount` so callers can hide the
 * chart when nothing has a resolvable location.
 */
export function buildEventLocationBreakdown(
  events: RaceControlEvent[],
  messageType: string,
): EventLocationBreakdown {
  const located = new Map<string, LocatedBucket>();
  let unknown = 0;
  let total = 0;

  for (const event of events) {
    if (event["message-type"] !== messageType) continue;
    total += 1;
    const label = formatRaceControlLocation(event);
    if (!label) {
      unknown += 1;
      continue;
    }
    const existing = located.get(label);
    if (existing) {
      existing.count += 1;
    } else {
      located.set(label, { label, count: 1, sector: event.sector ?? null });
    }
  }

  const sorted = [...located.values()].sort(
    (a, b) => b.count - a.count || a.label.localeCompare(b.label),
  );

  let slices: LocationSlice[];
  if (sorted.length > MAX_LOCATED_SLICES) {
    const head = sorted
      .slice(0, MAX_LOCATED_SLICES - 1)
      .map(({ label, count }) => ({ label, count }));
    const folded = foldTailBySector(sorted.slice(MAX_LOCATED_SLICES - 1));
    slices = [...head, ...folded];
  } else {
    slices = sorted.map(({ label, count }) => ({ label, count }));
  }

  if (unknown > 0) {
    slices = [...slices, { label: UNKNOWN_LABEL, count: unknown }];
  }

  return { slices, total, locatedCount: total - unknown };
}

const INCIDENT_TYPES = new Set(["OVERTAKE", "COLLISION"]);

function hasIncidents(events: RaceControlEvent[]): boolean {
  return events.some((event) => INCIDENT_TYPES.has(event["message-type"]));
}

function hasLocatedIncident(events: RaceControlEvent[]): boolean {
  return events.some(
    (event) =>
      INCIDENT_TYPES.has(event["message-type"]) &&
      formatRaceControlLocation(event) != null,
  );
}

export interface TrackLocationBreakdown {
  overtakes: EventLocationBreakdown;
  collisions: EventLocationBreakdown;
  /** Races contributing to the pies (have located incidents). */
  locatedRaceCount: number;
  /** Races with incidents but no location data, excluded from the pies. */
  excludedRaceCount: number;
}

/**
 * Aggregate overtake/collision locations across a track's races. Location data
 * is all-or-nothing per session (added in Pits n' Giggles v4.3.0), so a race
 * either fully has it or not — mixing them would dump whole older races into one
 * huge "Unknown" wedge. Instead we bucket only the races that have location and
 * report `excludedRaceCount` so the UI can note the coverage.
 *
 * When no race has location, we fall back to every race's events so the charts
 * still surface the "needs v4.3.0" explanation rather than reading "no events".
 */
export function buildTrackLocationBreakdowns(
  raceEventLists: RaceControlEvent[][],
): TrackLocationBreakdown {
  const locatedRaces: RaceControlEvent[][] = [];
  let excludedRaceCount = 0;

  for (const events of raceEventLists) {
    if (!hasIncidents(events)) continue;
    if (hasLocatedIncident(events)) {
      locatedRaces.push(events);
    } else {
      excludedRaceCount += 1;
    }
  }

  const source = locatedRaces.length > 0 ? locatedRaces : raceEventLists;
  const events = source.flat();

  return {
    overtakes: buildEventLocationBreakdown(events, "OVERTAKE"),
    collisions: buildEventLocationBreakdown(events, "COLLISION"),
    locatedRaceCount: locatedRaces.length,
    excludedRaceCount,
  };
}
