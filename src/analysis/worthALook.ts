import type {
  DriverData,
  LapHistoryEntry,
  TelemetrySession,
} from "../types/telemetry";
import type { TrackPBs } from "./trackPbs";
import { msToLapTime, sectorTimeMs } from "../utils/format";
import { ordinal } from "../utils/stats/core";
import {
  driverBestLapTimeMs,
  sessionDriverBestLapTimeMs,
} from "../utils/stats/drivers";
import { hasCompleteLapTiming, isCompleteValidLap } from "../utils/stats/laps";
import {
  getCompletedStints,
  getDriverStints,
  getNeutralisedLaps,
  stintGreenLife,
} from "../utils/stats/tyres";
import { buildRaceDriverStats } from "./resultsAnalysis";
import {
  detailNamesFade,
  gapTurn,
  stintCompareDetail,
  stintDeltaClaim,
  type ComparableStint,
  type StintComparison,
} from "./stintCompare";
import {
  describeMoment,
  significantMoments,
  type RaceHeadline,
  type RaceStory,
} from "./raceStory";

/**
 * "Worth a look": the ranked list under every session hero. Each item is a
 * bold claim, the evidence, and the tab that proves it. Everything that clears
 * its bar qualifies; the page shows the first five. Items that changed the
 * driver's position rank first (by places), then time items (by seconds), so
 * gains and losses compete on size. Only findings that meet the existing
 * evidence bars get in, and items state what happened: advice belongs to the
 * lap-telemetry tips. Thresholds live in the Tuning section below.
 */

export type WorthTone = "loss" | "gain" | "note";

/** Where an item's evidence lives: a session or track tab, or the track page. */
export type WorthTarget =
  | "overview"
  | "laps"
  | "tyres"
  | "lap-telemetry"
  | "results"
  | "setup"
  | "track"
  | "race"
  | "qualifying"
  | "setups";

export interface WorthItem {
  id: string;
  tone: WorthTone;
  claim: string;
  evidence?: string;
  target: WorthTarget;
  targetLabel: string;
  /** Places items: 1000 + places; time items: seconds. Higher ranks first. */
  weight: number;
}

// --- Tuning -----------------------------------------------------------------

/** Race pace rank and finish must differ by this much to be a story. */
export const PACE_RESULT_MIN_GAP = 2;
/** Best-lap gap to the race's fastest lap worth explaining (seconds). */
export const FASTEST_LAP_GAP_MIN_S = 0.1;
/** Sector holding the gap to pole (seconds). */
export const POLE_SECTOR_MIN_S = 0.05;
/** Time left in your own laps: best sectors vs best lap (seconds). */
export const IDEAL_LAP_MIN_S = 0.1;
/** Gap to a track PB worth naming (seconds). */
export const PB_GAP_MIN_S = 0.1;
/** Tyre wear off the field median on the same compound (%/lap). */
export const WEAR_VS_FIELD_MIN = 0.5;
/** Laps a compound needs before its wear rate is evidence. */
export const WEAR_MIN_STINT_LAPS = 5;
/** Stint pace difference vs an earlier stint worth naming (seconds a lap). */
export const LONG_RUN_PACE_MIN_S = 0.1;
/** Clean-lap fade within one stint worth naming (seconds per lap). */
export const STINT_FADE_MIN_S_PER_LAP = 0.15;
/** Time a stint gave back after its gap to another peaked (seconds). */
export const GAP_TURN_MIN_S = 0.5;
/** ...and the share of the peak that is, so a long stint's wobble is not a turn. */
export const GAP_TURN_MIN_SHARE = 0.3;

const PLACES_WEIGHT = 1000;

// --- Shared helpers ---------------------------------------------------------

export function rankWorthItems(items: WorthItem[]): WorthItem[] {
  return [...items].sort((a, b) => b.weight - a.weight);
}

function seconds(ms: number, digits = 3): string {
  return (ms / 1000).toFixed(digits);
}

const SECTORS = [1, 2, 3] as const;

function lapSectors(lap: LapHistoryEntry): [number, number, number] {
  return [sectorTimeMs(lap, 1), sectorTimeMs(lap, 2), sectorTimeMs(lap, 3)];
}

function bestCompleteLap(driver: DriverData): {
  lap: LapHistoryEntry;
  lapNumber: number;
} | null {
  const laps = driver["session-history"]["lap-history-data"];
  let best: { lap: LapHistoryEntry; lapNumber: number } | null = null;
  laps.forEach((lap, index) => {
    if (!isCompleteValidLap(lap)) return;
    if (!best || lap["lap-time-in-ms"] < best.lap["lap-time-in-ms"]) {
      best = { lap, lapNumber: index + 1 };
    }
  });
  return best;
}

function biggestSectorDelta(
  own: [number, number, number],
  ref: [number, number, number],
): { sector: 1 | 2 | 3; deltaMs: number } | null {
  let result: { sector: 1 | 2 | 3; deltaMs: number } | null = null;
  for (const sector of SECTORS) {
    const a = own[sector - 1];
    const b = ref[sector - 1];
    if (a <= 0 || b <= 0) return null;
    const delta = a - b;
    if (!result || delta > result.deltaMs) result = { sector, deltaMs: delta };
  }
  return result;
}

// --- Race -------------------------------------------------------------------

export interface RacePaceRank {
  rank: number;
  field: number;
  paceMs: number;
  /** Gap per lap to the fastest eligible race pace. */
  gapToBestMs: number;
  sampleCount: number;
}

export function buildRacePaceRank(
  session: TelemetrySession,
  driver: DriverData,
): RacePaceRank | null {
  const stats = buildRaceDriverStats(session);
  const own = stats.get(driver.index);
  if (!own || !own.racePaceRankEligible || own.racePace <= 0) return null;
  const eligible = [...stats.values()]
    .filter((s) => s.racePaceRankEligible && s.racePace > 0)
    .map((s) => s.racePace)
    .sort((a, b) => a - b);
  return {
    rank: eligible.indexOf(own.racePace) + 1,
    field: eligible.length,
    paceMs: own.racePace,
    gapToBestMs: own.racePace - eligible[0],
    sampleCount: own.racePaceLapCount,
  };
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function compoundWearRates(driver: DriverData): Map<string, number[]> {
  const rates = new Map<string, number[]>();
  // Green-flag wear: SC/VSC laps barely wear the tyres.
  const neutralised = getNeutralisedLaps(driver["per-lap-info"]);
  for (const stint of getCompletedStints(getDriverStints(driver))) {
    const { greenLaps, wearPerLap: rate } = stintGreenLife(stint, neutralised);
    if (greenLaps < WEAR_MIN_STINT_LAPS || rate <= 0) continue;
    const compound = stint["tyre-set-data"]["visual-tyre-compound"];
    rates.set(compound, [...(rates.get(compound) ?? []), rate]);
  }
  return rates;
}

export function buildRaceWorthALook({
  session,
  driver,
  story,
  headline,
  pace,
  pbs,
  stintHistory = [],
}: {
  session: TelemetrySession;
  driver: DriverData;
  story: RaceStory;
  headline: RaceHeadline;
  pace: RacePaceRank | null;
  pbs: TrackPBs | null;
  /** Each race stint against the latest earlier stint on its tyre here. */
  stintHistory?: LabelledStintComparison[];
}): WorthItem[] {
  const items: WorthItem[] = [];
  const drivers = session["classification-data"] ?? [];
  const classification = driver["final-classification"];

  for (const moment of significantMoments(story)) {
    if (moment === headline.moment) continue;
    const contacts = moment.contacts.flatMap((c) => c.others);
    const evidence =
      moment.kind === "start" && moment.contacts.length > 0
        ? `Contact with ${[...new Set(contacts)].join(" and ")} on lap 1.`
        : moment.kind === "pit-cycle"
          ? `Measured from lap ${moment.lap - 1} to lap ${moment.settledLap}, once the cars around you had stopped too.`
          : contacts.length > 0
            ? `Contact with ${[...new Set(contacts)].join(" and ")}.`
            : undefined;
    items.push({
      id: `moment-${moment.kind}-${moment.lap}`,
      tone: moment.places < 0 ? "loss" : "gain",
      claim: `${describeMoment(moment)}.`,
      evidence,
      target: "laps",
      targetLabel: "Laps",
      weight: PLACES_WEIGHT + Math.abs(moment.places),
    });
  }

  // Penalties and pace against the result only mean something once the
  // driver took the flag; a retirement or an early save has no result.
  const penaltyS = classification?.["penalties-time"] ?? 0;
  if (penaltyS > 0 && story.finished) {
    const road = story.trace[story.lastLap];
    const lost = story.classified - road;
    items.push({
      id: "penalty",
      tone: "loss",
      claim:
        lost > 0
          ? `A ${penaltyS} s time penalty cost ${lost} place${lost === 1 ? "" : "s"}, P${road} to P${story.classified}.`
          : `A ${penaltyS} s time penalty, with no places lost.`,
      target: "laps",
      targetLabel: "Laps",
      weight: lost > 0 ? PLACES_WEIGHT + lost : penaltyS,
    });
  }

  if (
    pace &&
    story.finished &&
    !headline.usesPace &&
    Math.abs(pace.rank - story.classified) >= PACE_RESULT_MIN_GAP
  ) {
    const faster = pace.rank < story.classified;
    items.push({
      id: "pace-vs-result",
      tone: faster ? "note" : "gain",
      claim: faster
        ? `${ordinal(pace.rank)}-fastest race pace, finished P${story.classified}.`
        : `Finished P${story.classified} with the ${ordinal(pace.rank)}-fastest race pace.`,
      evidence: `${msToLapTime(pace.paceMs)} average over ${pace.sampleCount} clean laps.`,
      target: "results",
      targetLabel: "Results",
      // A whole-race comparison, so it ranks under single moments of a
      // similar size rather than above them.
      weight: PLACES_WEIGHT + Math.abs(pace.rank - story.classified) / 2,
    });
  }

  // Best lap against the race's fastest lap, located by sector.
  const ownBest = bestCompleteLap(driver);
  const fastest = drivers
    .map((d) => ({ d, ms: driverBestLapTimeMs(d) }))
    .filter(({ ms }) => ms > 0)
    .sort((a, b) => a.ms - b.ms)[0];
  if (ownBest && fastest) {
    if (fastest.d.index === driver.index) {
      items.push({
        id: "fastest-lap",
        tone: "gain",
        claim: `Fastest lap of the race: ${msToLapTime(fastest.ms)}, on lap ${ownBest.lapNumber}.`,
        target: "laps",
        targetLabel: "Laps",
        weight: 0.5,
      });
    } else {
      const gapMs = ownBest.lap["lap-time-in-ms"] - fastest.ms;
      const ref = bestCompleteLap(fastest.d);
      const sector = ref
        ? biggestSectorDelta(lapSectors(ownBest.lap), lapSectors(ref.lap))
        : null;
      if (
        gapMs >= FASTEST_LAP_GAP_MIN_S * 1000 &&
        sector &&
        sector.deltaMs > 0
      ) {
        const share = sector.deltaMs / gapMs;
        items.push({
          id: "fastest-lap-gap",
          tone: "loss",
          // The other sectors can claw time back, so one sector can hold
          // more than the whole gap.
          claim:
            share > 1
              ? `Sector ${sector.sector} holds the gap to the fastest lap: +${seconds(sector.deltaMs)}, more than your whole ${seconds(gapMs)} s.`
              : share >= 0.5
                ? `Most of your gap to the fastest lap is in Sector ${sector.sector}: +${seconds(sector.deltaMs)} of the ${seconds(gapMs)} s.`
                : `Your best lap was ${seconds(gapMs)} s off the fastest, spread across the lap.`,
          evidence: `${fastest.d["driver-name"]}'s ${msToLapTime(fastest.ms)} against your ${msToLapTime(ownBest.lap["lap-time-in-ms"])}.`,
          target: "lap-telemetry",
          targetLabel: "Compare laps",
          weight: gapMs / 1000,
        });
      }
    }
  }

  if (ownBest && pbs && pbs.bestRaceLapMs > 0) {
    const gain = pbs.bestRaceLapMs - ownBest.lap["lap-time-in-ms"];
    if (gain > 0) {
      items.push({
        id: "race-lap-pb",
        tone: "gain",
        claim: `New race-lap PB here: ${msToLapTime(ownBest.lap["lap-time-in-ms"])}, ${seconds(gain)} s better than before.`,
        evidence: `Lap ${ownBest.lapNumber}.`,
        target: "laps",
        targetLabel: "Laps",
        weight: gain / 1000,
      });
    }
  }

  // Wear against the field's median on the same compound.
  const ownRates = compoundWearRates(driver);
  for (const [compound, rates] of ownRates) {
    const field = drivers
      .filter((d) => d.index !== driver.index)
      .flatMap((d) => compoundWearRates(d).get(compound) ?? []);
    if (field.length < 3) continue;
    const own = rates.reduce((a, b) => a + b, 0) / rates.length;
    const delta = own - median(field);
    if (Math.abs(delta) < WEAR_VS_FIELD_MIN) continue;
    items.push({
      id: `wear-${compound}`,
      tone: delta > 0 ? "loss" : "gain",
      claim: `${compound}s wore ${Math.abs(delta).toFixed(1)}%/lap ${delta > 0 ? "faster" : "slower"} than the field.`,
      evidence: `${own.toFixed(1)}%/lap against a ${median(field).toFixed(1)}%/lap median over ${field.length} stints.`,
      target: "tyres",
      targetLabel: "Tyres",
      weight: Math.abs(delta) / 10,
    });
  }

  // Did practice pace hold up in the race, or did this race beat the last?
  for (const { comparison: c, label } of stintHistory) {
    if (c.deltaMs == null || Math.abs(c.deltaMs) < LONG_RUN_PACE_MIN_S * 1000)
      continue;
    items.push({
      id: `stint-history-${c.a.id}`,
      tone: c.deltaMs > 0 ? "loss" : "gain",
      claim: stintDeltaClaim(c, label)!,
      evidence:
        [
          `${c.pairs.length} laps paired by tyre age${c.fuelCorrected ? " on equal fuel" : ""}.`,
          stintCompareDetail(c),
        ]
          .filter(Boolean)
          .join(" ") || undefined,
      target: "tyres",
      targetLabel: "Tyres",
      weight: Math.abs(c.deltaMs) / 1000,
    });
  }

  return rankWorthItems(items);
}

// --- Qualifying and time trial -----------------------------------------------

export interface QualiSummary {
  position: number | null;
  bestMs: number;
  poleMs: number;
  /** Closest margin to the car ahead or behind, when under 0.1 s. */
  closest: { position: number; gapMs: number; ahead: boolean } | null;
  idealMs: number;
  /** The best lap's sectors, or zeros when history lacks that lap. */
  sectors: [number, number, number];
  /** 0 when history lacks the lap that set the classified time. */
  bestLapNumber: number;
}

function idealLapMs(driver: DriverData): number {
  const laps =
    driver["session-history"]["lap-history-data"].filter(isCompleteValidLap);
  if (laps.length === 0) return 0;
  return SECTORS.reduce(
    (sum, sector) =>
      sum + Math.min(...laps.map((lap) => sectorTimeMs(lap, sector))),
    0,
  );
}

export function buildQualiSummary(
  session: TelemetrySession,
  driver: DriverData,
): QualiSummary | null {
  const drivers = session["classification-data"] ?? [];
  // Time Trial classification holds the stored ghost, never a grid slot.
  const isTimeTrial = /time\s*trial/i.test(
    session["session-info"]["session-type"],
  );
  // The classified best lap is the result (history can miss the lap that set
  // it); Time Trial reads history only, since its classification is a ghost.
  const ownMs = sessionDriverBestLapTimeMs(session, driver);
  if (!ownMs) return null;
  // The history lap that set that time carries its sectors and lap number,
  // when the export kept it.
  const best =
    driver["session-history"]["lap-history-data"]
      .map((lap, index) => ({ lap, lapNumber: index + 1 }))
      .find(
        ({ lap }) =>
          hasCompleteLapTiming(lap) && lap["lap-time-in-ms"] === ownMs,
      ) ?? null;
  const position = isTimeTrial
    ? null
    : driver["final-classification"]?.position || null;
  const field = drivers
    .map((d) => ({
      position: d["final-classification"]?.position ?? 0,
      ms: driverBestLapTimeMs(d),
    }))
    .filter((d) => d.ms > 0 && d.position > 0)
    .sort((a, b) => a.ms - b.ms);
  const poleMs = field[0]?.ms ?? ownMs;
  const ideal = idealLapMs(driver);
  let closest: QualiSummary["closest"] = null;
  if (position) {
    for (const other of field) {
      if (Math.abs(other.position - position) !== 1) continue;
      const gapMs = Math.abs(other.ms - ownMs);
      if (gapMs < 100 && (!closest || gapMs < closest.gapMs)) {
        closest = {
          position: other.position,
          gapMs,
          ahead: other.position < position,
        };
      }
    }
  }
  return {
    position,
    bestMs: ownMs,
    poleMs,
    closest,
    // History can miss the lap that set the classified time, and an ideal
    // slower than the real best is no ideal.
    idealMs: ideal > 0 && ideal <= ownMs ? ideal : 0,
    sectors: best ? lapSectors(best.lap) : [0, 0, 0],
    bestLapNumber: best?.lapNumber ?? 0,
  };
}

export function qualiHeadline(summary: QualiSummary): string {
  const { position, bestMs, poleMs, closest } = summary;
  const margin = closest
    ? closest.ahead
      ? `, ${seconds(closest.gapMs)} s behind P${closest.position}`
      : `, ${seconds(closest.gapMs)} s clear of P${closest.position}`
    : "";
  if (position === 1) return `Pole${margin}.`;
  if (position === 2) return `Front row${margin}.`;
  if (!position) return `Best lap ${msToLapTime(bestMs)}.`;
  return `P${position}, ${seconds(bestMs - poleMs)} s off pole${margin}.`;
}

export function timeTrialHeadline(
  summary: QualiSummary,
  pbs: TrackPBs | null,
  lapCount: number,
): string {
  const previous =
    pbs && pbs.bestTimeTrialLapMs > 0 ? pbs.bestTimeTrialLapMs : 0;
  if (!previous) {
    return `Best lap on lap ${summary.bestLapNumber} of ${lapCount}, your first timed laps here.`;
  }
  const delta = summary.bestMs - previous;
  return delta < 0
    ? `New PB on lap ${summary.bestLapNumber} of ${lapCount}, ${seconds(-delta)} s under your previous best.`
    : `${seconds(delta)} s off your PB of ${msToLapTime(previous)}.`;
}

function bestValidSectorMs(driver: DriverData, sector: 1 | 2 | 3): number {
  const times = driver["session-history"]["lap-history-data"]
    .filter(isCompleteValidLap)
    .map((lap) => sectorTimeMs(lap, sector))
    .filter((ms) => ms > 0);
  return times.length > 0 ? Math.min(...times) : 0;
}

function deletedFasterLaps(
  driver: DriverData,
  bestMs: number,
): { lapNumber: number; ms: number }[] {
  return driver["session-history"]["lap-history-data"]
    .map((lap, index) => ({ lap, lapNumber: index + 1 }))
    .filter(
      ({ lap }) =>
        hasCompleteLapTiming(lap) &&
        !isCompleteValidLap(lap) &&
        lap["lap-time-in-ms"] < bestMs,
    )
    .map(({ lap, lapNumber }) => ({ lapNumber, ms: lap["lap-time-in-ms"] }))
    .sort((a, b) => a.ms - b.ms);
}

/** The rest of the deleted laps behind one item, since only the quickest one
 *  changes the result: with times when there are a few, lap numbers when
 *  there are many. */
function otherDeletedLaps(
  rest: readonly { lapNumber: number; ms: number }[],
): string | undefined {
  if (rest.length === 0) return undefined;
  if (rest.length <= 3) {
    return `Also ${rest
      .map((d) => `lap ${d.lapNumber} (${msToLapTime(d.ms)})`)
      .join(", ")}.`;
  }
  const laps = rest.map((d) => d.lapNumber);
  return `Also laps ${laps.slice(0, -1).join(", ")} and ${laps[laps.length - 1]}.`;
}

export function buildQualiWorthALook({
  session,
  driver,
  summary,
  pbs,
  trackName,
}: {
  session: TelemetrySession;
  driver: DriverData;
  summary: QualiSummary;
  pbs: TrackPBs | null;
  trackName: string;
}): WorthItem[] {
  const items: WorthItem[] = [];
  const drivers = session["classification-data"] ?? [];
  const pole = drivers.find((d) => d["final-classification"]?.position === 1);

  if (summary.position && summary.position > 1 && pole) {
    const poleLap = bestCompleteLap(pole);
    const sector = poleLap
      ? biggestSectorDelta(summary.sectors, lapSectors(poleLap.lap))
      : null;
    const gapMs = summary.bestMs - summary.poleMs;
    if (sector && sector.deltaMs >= POLE_SECTOR_MIN_S * 1000) {
      items.push({
        id: "pole-sector",
        tone: "loss",
        claim: `Sector ${sector.sector} holds the gap to pole: +${seconds(sector.deltaMs)} to ${pole["driver-name"]}${sector.deltaMs > gapMs ? `, more than your whole ${seconds(gapMs)}` : ` of your ${seconds(gapMs)}`}.`,
        target: "lap-telemetry",
        targetLabel: "Compare with pole",
        weight: sector.deltaMs / 1000,
      });
    }
  }

  const leftMs = summary.idealMs > 0 ? summary.bestMs - summary.idealMs : 0;
  if (leftMs >= IDEAL_LAP_MIN_S * 1000) {
    items.push({
      id: "ideal-lap",
      tone: "loss",
      claim: `${seconds(leftMs)} s left in your own laps: your best sectors add up to ${msToLapTime(summary.idealMs)}.`,
      target: "laps",
      targetLabel: "Laps",
      weight: leftMs / 1000,
    });
  }

  const field = drivers
    .filter((d) => d.index !== driver.index)
    .map((d) => driverBestLapTimeMs(d))
    .filter((ms) => ms > 0);
  const [deleted, ...otherDeleted] = deletedFasterLaps(driver, summary.bestMs);
  if (deleted && summary.position) {
    const wouldBe = field.filter((ms) => ms < deleted.ms).length + 1;
    if (wouldBe < summary.position) {
      items.push({
        id: "deleted-lap",
        tone: "loss",
        claim: `Lap ${deleted.lapNumber} was ${msToLapTime(deleted.ms)} before it was deleted: P${wouldBe} if it had counted.`,
        evidence: otherDeletedLaps(otherDeleted),
        target: "laps",
        targetLabel: "Laps",
        weight: (summary.bestMs - deleted.ms) / 1000 + 0.01,
      });
    }
  }

  if (pbs && pbs.bestQualiLapMs > 0) {
    const delta = summary.bestMs - pbs.bestQualiLapMs;
    if (delta < 0) {
      items.push({
        id: "quali-pb",
        tone: "gain",
        claim: `New ${trackName} quali PB: ${msToLapTime(summary.bestMs)}, ${seconds(-delta)} s under your previous best.`,
        target: "track",
        targetLabel: trackName,
        weight: -delta / 1000,
      });
    } else if (delta >= PB_GAP_MIN_S * 1000) {
      items.push({
        id: "quali-pb-gap",
        tone: "loss",
        claim: `${seconds(delta)} s off your ${trackName} PB of ${msToLapTime(pbs.bestQualiLapMs)}.`,
        target: "track",
        targetLabel: trackName,
        weight: delta / 1000,
      });
    }
  }

  // Session-best sectors, as a positive: every complete valid lap counts,
  // not only each driver's best lap, which can hide a quicker sector.
  for (const sector of SECTORS) {
    const own = bestValidSectorMs(driver, sector);
    const others = drivers
      .filter((d) => d.index !== driver.index)
      .map((d) => bestValidSectorMs(d, sector))
      .filter((ms) => ms > 0);
    if (own <= 0 || others.length === 0) continue;
    const bestOther = Math.min(...others);
    if (own < bestOther) {
      items.push({
        id: `best-sector-${sector}`,
        tone: "gain",
        claim: `Fastest Sector ${sector} of the session: ${seconds(own)}, ${seconds(bestOther - own)} s up on the next best.`,
        target: "laps",
        targetLabel: "Laps",
        weight: (bestOther - own) / 1000,
      });
    }
  }

  return rankWorthItems(items);
}

export function buildTimeTrialWorthALook({
  driver,
  summary,
  pbs,
}: {
  driver: DriverData;
  summary: QualiSummary;
  pbs: TrackPBs | null;
}): WorthItem[] {
  const items: WorthItem[] = [];
  const previousPb =
    pbs && pbs.bestTimeTrialLapMs > 0 ? pbs.bestTimeTrialLapMs : 0;
  const reference = previousPb
    ? Math.min(previousPb, summary.bestMs)
    : summary.bestMs;

  const [deleted, ...otherDeleted] = deletedFasterLaps(driver, summary.bestMs);
  if (deleted) {
    const underPb = reference - deleted.ms;
    const count =
      otherDeleted.length > 0
        ? ` One of ${otherDeleted.length + 1} deleted laps under your best valid lap.`
        : "";
    items.push({
      id: "deleted-lap",
      tone: "loss",
      claim:
        (underPb > 0
          ? `Lap ${deleted.lapNumber} was ${msToLapTime(deleted.ms)} before it was deleted: ${seconds(underPb)} s under your ${previousPb && summary.bestMs < previousPb ? "new " : ""}PB.`
          : `Lap ${deleted.lapNumber} was ${msToLapTime(deleted.ms)} before it was deleted, your quickest of the session.`) +
        count,
      evidence: otherDeletedLaps(otherDeleted),
      target: "laps",
      targetLabel: "Laps",
      weight: (summary.bestMs - deleted.ms) / 1000 + 0.01,
    });
  }

  const leftMs = summary.idealMs > 0 ? summary.bestMs - summary.idealMs : 0;
  if (leftMs >= IDEAL_LAP_MIN_S * 1000) {
    items.push({
      id: "ideal-lap",
      tone: "loss",
      claim: `${seconds(leftMs)} s left in your own laps: your best sectors add up to ${msToLapTime(summary.idealMs)}.`,
      target: "laps",
      targetLabel: "Laps",
      weight: leftMs / 1000,
    });
  }

  if (previousPb && summary.bestMs > previousPb) {
    const gapMs = summary.bestMs - previousPb;
    const pbSectors: [number, number, number] = [
      pbs!.bestTimeTrialS1Ms,
      pbs!.bestTimeTrialS2Ms,
      pbs!.bestTimeTrialS3Ms,
    ];
    const sector = biggestSectorDelta(summary.sectors, pbSectors);
    if (gapMs >= PB_GAP_MIN_S * 1000) {
      items.push({
        id: "tt-pb-gap",
        tone: "loss",
        claim:
          sector && sector.deltaMs > 0
            ? `${seconds(gapMs)} s off your PB, most of it in Sector ${sector.sector} (+${seconds(sector.deltaMs)} on your best S${sector.sector}).`
            : `${seconds(gapMs)} s off your PB of ${msToLapTime(previousPb)}.`,
        target: "lap-telemetry",
        targetLabel: "Compare laps",
        weight: gapMs / 1000,
      });
    }
  }

  return rankWorthItems(items);
}

// --- Long runs --------------------------------------------------------------

/** One stint comparison as Worth a look reads it: the label names the other
 *  stint ("18:24 run"), which takes the page's date context. */
export interface LabelledStintComparison {
  comparison: StintComparison;
  label: string;
}

/** A gap that peaked and turned back: "You were 2.65 s up on your 18:24 run
 *  after lap 6, then gave 1.33 s back by lap 8." */
function gapTurnItem({
  comparison,
  label,
}: LabelledStintComparison): WorthItem | null {
  const turn = gapTurn(comparison);
  if (!turn) return null;
  const peakS = Math.abs(turn.peak.gapMs) / 1000;
  const backS = turn.givenBackMs / 1000;
  if (backS < GAP_TURN_MIN_S || backS / peakS < GAP_TURN_MIN_SHARE) return null;
  const up = turn.peak.gapMs < 0;
  const endS = Math.abs(turn.last.gapMs) / 1000;
  // A lead that became a deficit (or the reverse) says where it ended.
  const flipped = up ? turn.last.gapMs > 0 : turn.last.gapMs < 0;
  return {
    id: `gap-turn-${comparison.a.id}`,
    tone: up ? "loss" : "gain",
    claim: `You were ${peakS.toFixed(2)} s ${up ? "up on" : "down on"} your ${label} after lap ${turn.peak.lapA}, then ${up ? "gave" : "took"} ${backS.toFixed(2)} s back by lap ${turn.last.lapA}${flipped ? `, ending ${endS.toFixed(2)} s ${up ? "down" : "up"}` : ""}.`,
    evidence: `${comparison.pairs.length} laps paired by tyre age.`,
    target: "laps",
    targetLabel: "Laps",
    weight: backS / comparison.pairs.length,
  };
}

export function buildLongRunWorthALook({
  stints,
  comparisons,
  headline,
}: {
  stints: ComparableStint[];
  /** Each stint against its default (the latest earlier run on its tyre). */
  comparisons: LabelledStintComparison[];
  /** The comparison the headline already tells, never repeated. */
  headline: StintComparison | null;
}): WorthItem[] {
  const items: WorthItem[] = [];
  for (const entry of comparisons) {
    const { comparison: c, label } = entry;
    const turn = gapTurnItem(entry);
    if (turn) items.push(turn);
    if (c === headline || c.deltaMs == null) continue;
    if (Math.abs(c.deltaMs) < LONG_RUN_PACE_MIN_S * 1000) continue;
    items.push({
      id: `compare-${c.a.id}`,
      tone: c.deltaMs > 0 ? "loss" : "gain",
      claim: stintDeltaClaim(c, label)!,
      evidence: stintCompareDetail(c) || undefined,
      target: "laps",
      targetLabel: "Laps",
      weight: Math.abs(c.deltaMs) / 1000,
    });
  }
  for (const stint of stints) {
    if (
      stint.fadeSPerLap == null ||
      stint.fadeSPerLap < STINT_FADE_MIN_S_PER_LAP
    )
      continue;
    // The headline's detail already set this fade against the other run's.
    if (headline?.a.id === stint.id && detailNamesFade(headline)) continue;
    items.push({
      id: `fade-${stint.startLap}`,
      tone: "loss",
      claim: `${stint.compound}s faded ${stint.fadeSPerLap.toFixed(2)} s a lap over laps ${stint.startLap}–${stint.endLap}.`,
      evidence: `${stint.cleanLaps} clean laps.`,
      target: "laps",
      targetLabel: "Laps",
      weight: stint.fadeSPerLap * stint.cleanLaps,
    });
  }
  return rankWorthItems(items);
}
