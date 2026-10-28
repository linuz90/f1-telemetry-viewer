import type { TrackRaceRecommendation } from "./trackStrategyTypes";
import type { CompoundLifeStats } from "../utils/stats/trackAggregates";
import type { TrackSessionData } from "./trackAnalysis";
import { getRaceControlEvents } from "../utils/raceControl";
import { findPlayer } from "../utils/stats/drivers";
import { msToLapTime } from "../utils/format";
import { summaryKind } from "./sessionKind";
import {
  buildRaceHeadline,
  buildRaceStory,
  contactLocation,
} from "./raceStory";
import {
  buildRacePaceRank,
  rankWorthItems,
  type WorthItem,
} from "./worthALook";

/**
 * "Before you race here": what to prepare at a track, from its history. The
 * top lesson of the last online race, gaps in the race plan's evidence (the
 * one place a "missing data" item belongs, since it says what to practise),
 * corners where your own contacts cluster, and a stalled quali trend.
 */

/** Your own contacts at one location, across races, before it is a pattern:
 *  one first-lap pile-up is a moment, not a habit. */
export const CONTACT_CLUSTER_MIN = 3;
export const CONTACT_CLUSTER_MIN_RACES = 2;
/** A plan stint this much longer than your longest real stint is a projection. */
const PROJECTION_RATIO = 0.6;
/** Quali runs without a new PB before the trend reads as stalled. */
export const STALLED_RUNS_MIN = 3;

export interface TrackBriefingItem extends WorthItem {
  /** Session the item points at, for a direct link. */
  sessionSlug?: string;
}

export function buildTrackBriefing({
  data,
  recommendation,
  compoundLife,
}: {
  data: readonly TrackSessionData[];
  recommendation: TrackRaceRecommendation | null;
  compoundLife: CompoundLifeStats[];
}): TrackBriefingItem[] {
  const items: TrackBriefingItem[] = [];
  const byDate = [...data].sort((a, b) =>
    b.summary.date.localeCompare(a.summary.date),
  );

  const lastRace = byDate.find(
    (d) => summaryKind(d.summary) === "race" && d.summary.isOnline,
  );
  const lastPlayer = lastRace ? findPlayer(lastRace.session) : undefined;
  if (lastRace && lastPlayer) {
    const story = buildRaceStory(lastRace.session, lastPlayer);
    if (story) {
      const headline = buildRaceHeadline(
        lastRace.session,
        lastPlayer,
        story,
        buildRacePaceRank(lastRace.session, lastPlayer),
      );
      // The result line, unless the headline already is the result.
      const result =
        story.outcome === "retired"
          ? `DNF from P${story.grid}`
          : `P${story.classified} from P${story.grid}`;
      items.push({
        id: "last-race",
        tone: "note",
        claim: `Your last online race here: ${headline.text}`,
        evidence:
          headline.text.includes(result) ||
          headline.text.startsWith("Won from") ||
          story.outcome === "unfinished"
            ? undefined
            : `${result}.`,
        target: "overview",
        targetLabel: "Debrief",
        weight: 1000,
        sessionSlug: lastRace.summary.slug,
      });
    }
  }

  const plan = recommendation?.recommended;
  if (plan) {
    plan.compounds.forEach((compound, i) => {
      const planned = plan.stintLaps[i];
      const life = compoundLife.find((c) => c.compound === compound);
      // Green-flag laps only: a stint run partly behind the Safety Car says
      // little about how long the set lasts when racing.
      const longest = life?.longestGreenRun ?? 0;
      if (planned > 0 && longest < planned * PROJECTION_RATIO) {
        items.push({
          id: `evidence-${compound}-${i}`,
          tone: "note",
          claim:
            longest > 0
              ? `${compound}s: your longest green-flag run here is ${longest} laps, the plan asks for ${planned}.`
              : `${compound}s: no stint here yet, the plan's ${planned} laps are projected.`,
          evidence: `A long run on ${compound}s would confirm the stint length.`,
          target: "race",
          targetLabel: "Tyre life",
          weight: 900 + planned - longest,
        });
      }
    });
  }

  const contacts = new Map<string, { count: number; races: Set<string> }>();
  for (const entry of data) {
    if (summaryKind(entry.summary) !== "race") continue;
    const player = findPlayer(entry.session);
    if (!player) continue;
    for (const event of getRaceControlEvents(entry.session)) {
      if (
        event["message-type"] !== "COLLISION" ||
        !event["involved-drivers"]?.includes(player.index)
      )
        continue;
      const location = contactLocation(event);
      if (!location) continue;
      const bucket = contacts.get(location) ?? { count: 0, races: new Set() };
      bucket.count += 1;
      bucket.races.add(entry.summary.slug);
      contacts.set(location, bucket);
    }
  }
  const [hotspot] = [...contacts].sort((a, b) => b[1].count - a[1].count);
  if (
    hotspot &&
    hotspot[1].count >= CONTACT_CLUSTER_MIN &&
    hotspot[1].races.size >= CONTACT_CLUSTER_MIN_RACES
  ) {
    items.push({
      id: "contact-cluster",
      tone: "loss",
      claim: `${hotspot[0]} is where your contacts happen: ${hotspot[1].count} of them, in ${hotspot[1].races.size} race${hotspot[1].races.size === 1 ? "" : "s"}.`,
      target: "race",
      targetLabel: "Races",
      weight: 800 + hotspot[1].count,
    });
  }

  const quali = [...data]
    .filter((d) => summaryKind(d.summary) === "qualifying" && d.bestLapMs > 0)
    .sort((a, b) => a.summary.date.localeCompare(b.summary.date));
  if (quali.length > STALLED_RUNS_MIN) {
    const pbIndex = quali.reduce(
      (best, d, i) => (d.bestLapMs < quali[best].bestLapMs ? i : best),
      0,
    );
    const since = quali.slice(pbIndex + 1);
    if (since.length >= STALLED_RUNS_MIN) {
      const bestSince = Math.min(...since.map((d) => d.bestLapMs));
      const pb = quali[pbIndex];
      items.push({
        id: "quali-stalled",
        tone: "note",
        claim: `No new quali PB in ${since.length} runs since ${new Date(pb.summary.date).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}.`,
        evidence: `Best since then is ${msToLapTime(bestSince)}, ${((bestSince - pb.bestLapMs) / 1000).toFixed(3)} s off your ${msToLapTime(pb.bestLapMs)}.`,
        target: "qualifying",
        targetLabel: "Qualifying",
        weight: 700,
      });
    }
  }

  return rankWorthItems(items);
}
