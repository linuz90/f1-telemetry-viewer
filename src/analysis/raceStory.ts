import type {
  DriverData,
  RaceControlEvent,
  TelemetrySession,
} from "../types/telemetry";
import {
  formatRaceControlLocation,
  getRaceControlEvents,
} from "../utils/raceControl";
import { ordinal } from "../utils/stats/core";
import { findStintResult } from "../utils/stats/drivers";
import { getCompletedStints, getDriverStints } from "../utils/stats/tyres";

/**
 * The race told as position changes: a lap-by-lap trace, the places breakdown
 * the hero chips show, the single moments that moved the driver, and the
 * one-sentence headline. Pit cycles are measured once they settle, so your
 * own stop and the field's stops net out instead of reading as "lost 4 places
 * on lap 9, gained 3 on lap 13".
 */

/** Positions by lap: index 0 is the grid, index n the end of lap n. */
export type PositionTrace = number[];

export type RaceMomentKind = "start" | "final-lap" | "pit-cycle" | "lap";

export interface RaceContact {
  lap: number;
  /** "Turn 1", "Sector 2", or null without location data. */
  location: string | null;
  others: string[];
}

export interface RaceMoment {
  kind: RaceMomentKind;
  /** Lap the moment ends on (1 for the start, the in-lap for a pit cycle). */
  lap: number;
  /** Lap the cycle settled on (pit cycles only). */
  settledLap?: number;
  /** First lap of a multi-lap run (lap moments only). */
  fromLap?: number;
  from: number;
  to: number;
  /** Positive = places gained. */
  places: number;
  contacts: RaceContact[];
}

export interface PlacesChip {
  key: string;
  label: string;
  places: number;
  /** Extra text after the delta, e.g. the start reaction time. */
  note?: string;
}

/**
 * How the race ended for the driver: took the flag, retired (DNF, DSQ), or a
 * save made before the flag (no final classification yet).
 */
export type RaceOutcome = "finished" | "retired" | "unfinished";

export interface RaceStory {
  trace: PositionTrace;
  grid: number;
  /** Final classification, or the last running position when unfinished. */
  classified: number;
  /** Last lap the trace covers. */
  lastLap: number;
  /** Lap the race ended on: the last lap, or the lap a retirement came on. */
  endLap: number;
  outcome: RaceOutcome;
  finished: boolean;
  chips: PlacesChip[];
  moments: RaceMoment[];
  /** Laps spent at or above `topN.position`, when the driver got there. */
  topN: { position: number; laps: number; atBest: number; best: number } | null;
}

/** A moment worth a sentence. */
export const MOMENT_MIN_PLACES = 2;
/** A moment big enough to be the hero headline. */
export const HEADLINE_MIN_PLACES = 3;
/** Drivers within this many places before your stop define "the cycle". */
const PIT_CYCLE_NEIGHBOURS = 3;
/** A pit cycle never spans more than this many laps past your in-lap. */
const PIT_CYCLE_MAX_LAPS = 8;
/** Share of laps the position history must cover before it tells a story:
 *  some exports carry only the final lap, which would read as P0 everywhere. */
const MIN_TRACE_COVERAGE = 0.5;

export function buildPositionTrace(
  session: TelemetrySession,
  driver: DriverData,
): PositionTrace {
  const raceNumber = driver["participant-data"]?.["race-number"];
  const entries = session["position-history"] ?? [];
  const byName = entries.filter((e) => e.name === driver["driver-name"]);
  const candidates =
    byName.length > 0
      ? byName
      : entries.filter(
          (e) => raceNumber != null && e["driver-number"] === raceNumber,
        );
  // Hidden online names can repeat ("Ferrari" twice); the exporter lists
  // both in driver order, so the k-th namesake takes the k-th entry.
  const namesakes = (session["classification-data"] ?? [])
    .filter((d) => d["driver-name"] === driver["driver-name"])
    .sort((a, b) => a.index - b.index);
  const rank = Math.max(
    0,
    namesakes.findIndex((d) => d.index === driver.index),
  );
  const history = candidates[rank] ?? candidates[0];
  const trace: PositionTrace = [];
  let known = 0;
  for (const point of history?.["driver-position-history"] ?? []) {
    // Position 0 is the exporter's "unknown", not a place.
    if (point["lap-number"] >= 0 && point.position > 0) {
      trace[point["lap-number"]] = point.position;
      known++;
    }
  }
  if (known < 2 || known < trace.length * MIN_TRACE_COVERAGE) return [];
  // Fill gaps from the previous known position, and leading gaps from the
  // first known one, so lengths line up.
  const first = trace.find((p) => p != null)!;
  for (let i = 0; i < trace.length; i++) {
    if (trace[i] == null) trace[i] = trace[i - 1] ?? first;
  }
  return trace;
}

function pitInLaps(driver: DriverData): number[] {
  // A stint starting on lap s means the in-lap was s - 1.
  return getCompletedStints(getDriverStints(driver))
    .slice(1)
    .map((stint) => stint["start-lap"] - 1)
    .filter((lap) => lap > 0);
}

/** "Turn 1", "Turns 5–7", a straight's name, or the sector. */
export function contactLocation(event: RaceControlEvent): string | null {
  const segment = event["segment-info"];
  if (segment && segment.type !== "straight") {
    if (typeof segment.corner_number === "number") {
      return `Turn ${segment.corner_number}`;
    }
    const corners = segment.corner_numbers?.filter(Number.isFinite) ?? [];
    if (corners.length > 0) {
      const first = corners[0];
      const last = corners[corners.length - 1];
      return first === last ? `Turn ${first}` : `Turns ${first}–${last}`;
    }
  }
  return formatRaceControlLocation(event);
}

function contactsOnLap(
  events: RaceControlEvent[],
  driver: DriverData,
  lap: number,
  drivers: DriverData[],
): RaceContact[] {
  const nameByIndex = new Map(drivers.map((d) => [d.index, d["driver-name"]]));
  return events
    .filter(
      (event) =>
        event["message-type"] === "COLLISION" &&
        event["lap-number"] === lap &&
        event["involved-drivers"]?.includes(driver.index),
    )
    .map((event) => ({
      lap,
      location: contactLocation(event),
      others: event["involved-drivers"]
        .filter((index) => index !== driver.index)
        .map((index) => nameByIndex.get(index))
        .filter((name): name is string => Boolean(name)),
    }));
}

/**
 * Lap on which the cycle around the driver's stop settled: the last matching
 * stop among the drivers who decide it, so their stops cancel against yours.
 * Those are the cars within a few places before your stop, plus any car that
 * is ahead of you at the provisional settle point without having stopped as
 * often as you (it stayed out and will drop back when it pits).
 */
function pitCycleSettledLap(
  trace: PositionTrace,
  drivers: DriverData[],
  self: DriverData,
  sessionTraces: Map<number, PositionTrace>,
  stopIndex: number,
  inLap: number,
  lastLap: number,
): number {
  const before = trace[inLap - 1] ?? trace[inLap];
  const cap = Math.min(inLap + PIT_CYCLE_MAX_LAPS, lastLap - 1);
  const stops = new Map(drivers.map((d) => [d.index, pitInLaps(d)]));
  let settled = Math.min(inLap + 1, cap);
  for (let pass = 0; pass < 4; pass++) {
    let next = settled;
    for (const other of drivers) {
      if (other.index === self.index) continue;
      const otherTrace = sessionTraces.get(other.index);
      const otherStop = stops.get(other.index)?.[stopIndex];
      if (
        !otherTrace ||
        otherStop == null ||
        Math.abs(otherStop - inLap) > PIT_CYCLE_MAX_LAPS
      ) {
        continue;
      }
      const otherBefore = otherTrace[inLap - 1];
      const near =
        otherBefore != null &&
        Math.abs(otherBefore - before) <= PIT_CYCLE_NEIGHBOURS;
      const stillOut =
        otherStop >= settled &&
        (otherTrace[settled] ?? Infinity) < (trace[settled] ?? 0);
      if (near || stillOut) next = Math.max(next, otherStop + 1);
    }
    next = Math.min(next, cap);
    if (next === settled) break;
    settled = next;
  }
  return settled;
}

export function buildRaceStory(
  session: TelemetrySession,
  driver: DriverData,
): RaceStory | null {
  const trace = buildPositionTrace(session, driver);
  if (trace.length < 2) return null;
  const drivers = session["classification-data"] ?? [];
  const classification = driver["final-classification"];
  // Same sources as the session summary, so the log and the page agree.
  const stintResult = findStintResult(session, driver);
  const status = (
    classification?.["result-status"] ||
    stintResult?.["result-status"] ||
    ""
  ).toUpperCase();
  const classifiedPosition =
    classification?.position || stintResult?.position || 0;
  // Lapped cars take the flag with fewer laps, so the status alone decides.
  const outcome: RaceOutcome =
    status === "FINISHED" ? "finished" : status ? "retired" : "unfinished";
  const finished = outcome === "finished";
  const endLap = trace.length - 1;
  // PnG writes a retired car's classification slot onto its retirement lap
  // (P12, P12, P12, then P21), so that lap is not places lost on track.
  if (
    outcome === "retired" &&
    endLap >= 2 &&
    trace[endLap] === classifiedPosition &&
    trace[endLap - 1] !== trace[endLap]
  ) {
    trace.pop();
  }
  const lastLap = trace.length - 1;
  const grid =
    classification?.["grid-position"] ||
    stintResult?.["grid-position"] ||
    trace[0];
  trace[0] = grid;
  const classified =
    (outcome !== "unfinished" && classifiedPosition) || trace[lastLap];
  const events = getRaceControlEvents(session);
  const traces = new Map(
    drivers.map((d) => [d.index, buildPositionTrace(session, d)]),
  );

  const moments: RaceMoment[] = [];
  const claimed = new Set<number>([1]);
  moments.push({
    kind: "start",
    lap: 1,
    from: grid,
    to: trace[1],
    places: grid - trace[1],
    contacts: contactsOnLap(events, driver, 1, drivers),
  });

  pitInLaps(driver).forEach((inLap, stopIndex) => {
    if (inLap >= lastLap) return;
    const settledLap = pitCycleSettledLap(
      trace,
      drivers,
      driver,
      traces,
      stopIndex,
      inLap,
      lastLap,
    );
    for (let lap = inLap; lap <= settledLap; lap++) claimed.add(lap);
    const from = trace[inLap - 1] ?? trace[inLap];
    const to = trace[settledLap];
    moments.push({
      kind: "pit-cycle",
      lap: inLap,
      settledLap,
      from,
      to,
      places: from - to,
      contacts: [],
    });
  });

  if (finished && lastLap >= 2) {
    claimed.add(lastLap);
    moments.push({
      kind: "final-lap",
      lap: lastLap,
      from: trace[lastLap - 1],
      to: trace[lastLap],
      places: trace[lastLap - 1] - trace[lastLap],
      contacts: contactsOnLap(events, driver, lastLap, drivers),
    });
  }

  // Single-lap moments. Traffic swapping places back and forth stays out:
  // an excursion that returns to the prior position within two laps is
  // flattened, consecutive same-direction laps merge into one run, and a run
  // counts only if the change still holds two laps later.
  const steady = [...trace];
  for (let lap = 2; lap <= lastLap; lap++) {
    if (steady[lap] === steady[lap - 1]) continue;
    for (const back of [lap + 1, lap + 2]) {
      if (back <= lastLap && trace[back] === steady[lap - 1]) {
        for (let k = lap; k < back; k++) steady[k] = steady[lap - 1];
        break;
      }
    }
  }
  for (let lap = 2; lap <= lastLap; lap++) {
    if (claimed.has(lap)) continue;
    const sign = Math.sign(steady[lap - 1] - steady[lap]);
    if (sign === 0) continue;
    let end = lap;
    while (
      end + 1 <= lastLap &&
      !claimed.has(end + 1) &&
      Math.sign(steady[end] - steady[end + 1]) === sign
    ) {
      end++;
    }
    const from = steady[lap - 1];
    const to = steady[end];
    const later = steady[Math.min(end + 2, lastLap)];
    const held =
      Math.sign(from - later) === sign &&
      Math.abs(from - later) >= MOMENT_MIN_PLACES;
    if (Math.abs(from - to) >= MOMENT_MIN_PLACES && held) {
      const contacts: RaceContact[] = [];
      for (let l = lap; l <= end; l++) {
        contacts.push(...contactsOnLap(events, driver, l, drivers));
      }
      moments.push({
        kind: "lap",
        lap: end,
        fromLap: lap,
        from,
        to,
        places: from - to,
        contacts,
      });
    }
    lap = end;
  }

  const chips: PlacesChip[] = [
    { key: "start", label: "Start", places: grid - trace[1] },
  ];
  const middleEnd = finished ? lastLap - 1 : lastLap;
  const finalLapPlaces = finished ? trace[lastLap - 1] - trace[lastLap] : 0;
  if (finished && finalLapPlaces !== 0) {
    chips.push({
      key: "middle",
      label: `Laps 2–${middleEnd}`,
      places: trace[1] - trace[middleEnd],
    });
    chips.push({ key: "final", label: "Final lap", places: finalLapPlaces });
  } else if (lastLap >= 2) {
    chips.push({
      key: "middle",
      label: `Laps 2–${lastLap}`,
      places: trace[1] - trace[lastLap],
    });
  }
  // A retirement's classified place is not a penalty.
  const classificationPlaces =
    outcome === "retired" ? 0 : trace[lastLap] - classified;
  if (classificationPlaces !== 0) {
    const ownPenalty = (classification?.["penalties-time"] ?? 0) > 0;
    chips.push({
      key: "classification",
      label:
        classificationPlaces > 0 && !ownPenalty
          ? "Others' penalties"
          : ownPenalty && classificationPlaces < 0
            ? "Your penalty"
            : "Penalties",
      places: classificationPlaces,
    });
  }

  let topN: RaceStory["topN"] = null;
  const racedLaps = trace.slice(1);
  const best = Math.min(...racedLaps);
  for (const position of [3, 10]) {
    const laps = racedLaps.filter((p) => p <= position).length;
    if (laps > 0) {
      topN = {
        position,
        laps,
        best,
        atBest: racedLaps.filter((p) => p === best).length,
      };
      break;
    }
  }

  return {
    trace,
    grid,
    classified,
    lastLap,
    // A retirement ends on the lap the car stopped, which the history may
    // not reach (it retired mid-lap); the summary counts laps the same way.
    endLap:
      outcome === "retired"
        ? Math.max(
            endLap,
            classification?.["num-laps"] ??
              driver["session-history"]?.["num-laps"] ??
              0,
          )
        : endLap,
    outcome,
    finished,
    chips,
    moments,
    topN,
  };
}

/** Moments worth a sentence, largest first. */
export function significantMoments(story: RaceStory): RaceMoment[] {
  return story.moments
    .filter((moment) => Math.abs(moment.places) >= MOMENT_MIN_PLACES)
    .sort((a, b) => Math.abs(b.places) - Math.abs(a.places) || a.lap - b.lap);
}

function contactPhrase(contacts: RaceContact[]): string | null {
  const contact = contacts[0];
  if (!contact) return null;
  return contact.location ? `contact at ${contact.location}` : "contact";
}

/** Sentence for a moment, as a headline or a "Worth a look" claim. */
export function describeMoment(moment: RaceMoment): string {
  const n = Math.abs(moment.places);
  const places = `${n} place${n === 1 ? "" : "s"}`;
  const contact = contactPhrase(moment.contacts);
  switch (moment.kind) {
    case "start":
      return moment.places < 0
        ? `The start cost ${places}, P${moment.from} to P${moment.to}`
        : `Up ${places} at the start, P${moment.from} to P${moment.to}`;
    case "final-lap":
      if (moment.places < 0) {
        return contact
          ? `Running P${moment.from} until ${contact} on the final lap`
          : `Lost ${places} on the final lap, P${moment.from} to P${moment.to}`;
      }
      return `Up ${places} on the final lap, P${moment.from} to P${moment.to}`;
    case "pit-cycle":
      return moment.places < 0
        ? `The pit cycle from lap ${moment.lap} cost ${places}, P${moment.from} to P${moment.to}`
        : `The pit cycle from lap ${moment.lap} gained ${places}, P${moment.from} to P${moment.to}`;
    case "lap": {
      const laps =
        moment.fromLap && moment.fromLap !== moment.lap
          ? `laps ${moment.fromLap}–${moment.lap}`
          : `lap ${moment.lap}`;
      return moment.places < 0
        ? `Lost ${places} on ${laps}${contact ? ` after ${contact}` : ""}, P${moment.from} to P${moment.to}`
        : `Up ${places} on ${laps}, P${moment.from} to P${moment.to}`;
    }
  }
}

export interface RaceHeadline {
  text: string;
  /** Moment the headline used, so the list never repeats it. */
  moment?: RaceMoment;
  usesPace: boolean;
}

export function buildRaceHeadline(
  session: TelemetrySession,
  driver: DriverData,
  story: RaceStory,
  pace: { rank: number; field: number } | null,
): RaceHeadline {
  const running = `running P${story.trace[story.lastLap]}`;
  if (story.outcome === "retired") {
    return {
      text: `Retired on lap ${story.endLap}, ${running}.`,
      usesPace: false,
    };
  }
  if (story.outcome === "unfinished") {
    const total = session["session-info"]["total-laps"];
    return {
      text: `Saved on lap ${story.endLap}${total > story.endLap ? ` of ${total}` : ""}, ${running}.`,
      usesPace: false,
    };
  }

  const [biggest] = significantMoments(story);
  if (biggest && Math.abs(biggest.places) >= HEADLINE_MIN_PLACES) {
    return {
      text: `${describeMoment(biggest)}.`,
      moment: biggest,
      usesPace: false,
    };
  }

  if (pace && Math.abs(pace.rank - story.classified) >= 2) {
    return {
      text: `${ordinal(pace.rank)}-fastest race pace, finished P${story.classified}.`,
      usesPace: true,
    };
  }

  const drivers = session["classification-data"] ?? [];
  const totalTime = (d: DriverData) => {
    const fc = d["final-classification"];
    return fc && fc["total-race-time"] > 0
      ? fc["total-race-time"] + (fc["penalties-time"] ?? 0)
      : null;
  };
  const byPosition = (position: number) =>
    drivers.find((d) => d["final-classification"]?.position === position);
  const ownLaps = driver["final-classification"]?.["num-laps"];
  // A time gap only means something over the same distance: a lapped car's
  // total is shorter, which read as "-66.1 s behind P11" at Spa.
  const gapTo = (other: DriverData | undefined) => {
    const own = totalTime(driver);
    const theirs = other ? totalTime(other) : null;
    return own != null &&
      theirs != null &&
      other!["final-classification"]?.["num-laps"] === ownLaps
      ? Math.abs(own - theirs)
      : null;
  };
  if (story.classified === 1) {
    const gap = gapTo(byPosition(2));
    return {
      text:
        gap != null
          ? `Won from P${story.grid}, ${gap.toFixed(1)} s clear.`
          : `Won from P${story.grid}.`,
      usesPace: false,
    };
  }
  const behind = gapTo(byPosition(story.classified - 1));
  return {
    text:
      behind != null
        ? `P${story.classified} from P${story.grid}, ${behind.toFixed(1)} s behind P${story.classified - 1}.`
        : `P${story.classified} from P${story.grid}.`,
    usesPace: false,
  };
}
