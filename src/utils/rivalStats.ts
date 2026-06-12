import type { SessionSummary } from "../types/telemetry";
import { isRaceSessionType } from "./sessionTypes";

/**
 * Per-race driver rosters live on each {@link SessionSummary} as `rivals[]`.
 * This module aggregates them across the formula-scoped online races to produce
 * the cards rendered by the dashboard's Rivals & Teammates section.
 *
 * Scope is **online race sessions only** — AI grids and qualifying single-lap
 * pace don't yield meaningful rival deltas across sessions.
 */

export type RivalCardKind =
  | "closest-teammate"
  | "frequent-rival"
  | "pace-benchmark"
  | "most-consistent-rival"
  | "overtake-king"
  | "nemesis"
  | "fastest-lap-king"
  | "pole-position-king"
  | "dnf-king"
  | "penalty-magnet";

export interface RivalCard {
  kind: RivalCardKind;
  /** Display name of the rival driver. */
  driverName: string;
  /** Raw team identifier from the most-recent shared race, when known. */
  team?: string;
  /** Big number rendered on the right side of the card. */
  headline: string;
  /** Supporting detail line under the rival name. */
  detail: string;
  /** Number of shared races this card is derived from (drives ranking ties). */
  sampleSize: number;
}

/**
 * Per-rival aggregated stats across the scoped online races. Most fields
 * have BOTH a raw count (used in card detail text — "13 races") AND a
 * recency-weighted version (used for ranking — so a teammate from last week
 * outranks one from 6 months ago). See {@link RECENCY_HALF_LIFE_RACES}.
 */
interface RivalAggregate {
  key: string;
  name: string;
  team?: string;
  /** Number of online races shared with the player in scope. */
  races: number;
  /** Recency-weighted version of `races` — sum of session weights. */
  weightedRaces: number;
  /** Races where this rival was the player's teammate. */
  teammateRaces: number;
  /** Recency-weighted teammate-races. */
  weightedTeammateRaces: number;
  /**
   * Per-race samples of (rival.bestLap - player.bestLap) in ms, only when both
   * have a valid best. Kept as a list (not just a sum) so cards can use a
   * weighted median instead of a mean — a single fluke race no longer drags
   * the headline gap. Each sample carries the session's recency weight so the
   * median still favors recent form.
   */
  bestLapDeltas: { deltaMs: number; weight: number }[];
  /** Sum of rival lap stddev ms across races where they had ≥5 valid laps. */
  stddevSumMs: number;
  stddevSamples: number;
  weightedStddevSumMs: number;
  weightedStddevWeight: number;
  /** Total overtakes this rival completed in those races (all targets). */
  totalOvertakes: number;
  /** Races where this rival's overtake count was tracked (i.e. roster present). */
  overtakeRaceSamples: number;
  weightedOvertakes: number;
  weightedOvertakeRaceWeight: number;
  /** Sum of avg position gap to the player across races. */
  positionGapSum: number;
  positionGapSamples: number;
  weightedPositionGapSum: number;
  weightedPositionGapWeight: number;
  /** Races where this rival set the overall fastest lap. */
  fastestLapCount: number;
  weightedFastestLapCount: number;
  /** Pole positions (grid position 1) in shared races. */
  polePositions: number;
  weightedPolePositions: number;
  /** DNFs (any non-finished classification) in shared races. */
  dnfs: number;
  weightedDnfs: number;
  /** Sum of penalty counts across shared races. */
  totalPenalties: number;
  weightedPenalties: number;
  /** H2H race wins for the rival (rival finished ahead of player). */
  h2hWinsForRival: number;
  /** H2H race wins for the player vs this rival. */
  h2hWinsForPlayer: number;
  /** Latest race the rival appeared in. */
  latestRaceTime: number;
  latestRaceTrack: string;
  /** Latest seen team (in case it changes session-to-session). */
  latestTeam?: string;
  /**
   * Count of shared races where this driver appeared as an AI-filled slot
   * (no online-identity markers — e.g. game-roster surnames like VERSTAPPEN
   * the lobby inserts for empty seats). A driver is treated as AI for
   * ranking purposes when AT LEAST HALF of their appearances were AI fills —
   * this catches the "always AI" case without writing off a real player
   * whose name happens to share a surname with the F1 grid.
   */
  aiRaces: number;
}

export interface RivalStats {
  cards: RivalCard[];
  /** Total online races aggregated — used to decide whether to show the section at all. */
  raceCount: number;
}

const MIN_SHARED_RACES = 2;
const MIN_PACE_RACES = 2;
const MIN_VALID_LAPS_PER_RIVAL_RACE = 5;
const MIN_POSITION_GAP_SAMPLES = 10;
/**
 * Higher races floor applied ONLY to non-human entries (constructor-slot
 * placeholders like "Mercedes #66" and AI-filled lobby seats). A two-race
 * placeholder is almost certainly a one-off empty seat and shouldn't outrank
 * any real opponent. The threshold is high enough to wash out random fills
 * but still admits a persistent league-wide placeholder pattern
 * (e.g. a #2 seat that's empty every weekend).
 */
const MIN_PLACEHOLDER_RACES = 5;

/**
 * Decay half-life in races (not days) — every N races the contribution of an
 * older race halves. With ~6 months of online racing in the user's library,
 * 14 races is roughly "last 2 months count strongly; 4+ months ago is faint".
 * Lets recurring league rivals dominate while old one-off opponents fade.
 */
const RECENCY_HALF_LIFE_RACES = 14;
/** Sessions older than this many races ago are clamped to weight 0 for ranking. */
const RECENCY_FLOOR_RACES = 60;
/** Rivals with a cumulative recency score below this are dropped from quality cards. */
const MIN_RECENCY_SCORE = 0.6;

// How many cards each kind can produce. Some categories (teammate, pace
// benchmark) plateau quickly; others (frequent rival, overtakes, nemesis) reward
// a leaderboard feel. Caps + display order are tuned together with
// MAX_TOTAL_CARDS so that every kind that qualifies still gets at least one card
// in the typical case (sum of "1 each" = 10 ≤ MAX_TOTAL_CARDS).
const MAX_PER_KIND: Record<RivalCardKind, number> = {
  "closest-teammate": 2,
  "frequent-rival": 3,
  "pace-benchmark": 2,
  nemesis: 2,
  "pole-position-king": 2,
  "fastest-lap-king": 1,
  "overtake-king": 1,
  "dnf-king": 1,
  "penalty-magnet": 1,
  "most-consistent-rival": 1,
};

const MAX_TOTAL_CARDS = 14;

/**
 * Match "<Team Name> #<n>" placeholder slots that Pits n' Giggles fills in for
 * empty seats in online lobbies (e.g. "McLaren #2", "Ferrari #24", "Red Bull
 * Racing #67"). Real gamertags don't follow this format, so we use this to
 * de-prioritize placeholders behind named humans on every card ranking.
 */
function isConstructorPlaceholder(name: string): boolean {
  return /\s#\d+\s*$/.test(name);
}

/**
 * True when the majority of this driver's appearances were AI-filled slots —
 * i.e. the game-roster surnames (VERSTAPPEN, ANTONELLI, …) that the lobby
 * inserts for empty seats. Real players whose telemetry was occasionally
 * non-public don't trip this because they still have human-identified races.
 */
function isMostlyAi(aggregate: RivalAggregate): boolean {
  return aggregate.races > 0 && aggregate.aiRaces * 2 >= aggregate.races;
}

/**
 * Combined deprioritization rank for every leaderboard. AI fills sit BELOW
 * constructor-slot placeholders ("Mclaren #2") because at least those are
 * unambiguous empty-seat markers; an AI named "VERSTAPPEN" reads as a real
 * person at a glance and is more misleading on a leaderboard.
 */
function placeholderRank(aggregate: RivalAggregate): number {
  if (isMostlyAi(aggregate)) return 2;
  if (isConstructorPlaceholder(aggregate.name)) return 1;
  return 0;
}

/** Take the top N items after sorting; tie-break: smaller is better. */
function takeTop<T>(items: T[], n: number, cmp: (a: T, b: T) => number): T[] {
  return [...items].sort(cmp).slice(0, n);
}

function getPlayerBestLapMs(session: SessionSummary): number | undefined {
  const value = session.playerRaceResult?.bestLapTimeMs;
  return typeof value === "number" && value > 0 ? value : undefined;
}

function getPlayerPosition(session: SessionSummary): number | undefined {
  return session.playerRaceResult?.position;
}

function getOnlineRaceSessions(
  sessions: SessionSummary[],
  formulaKey: string | undefined,
  scopeKeyFor: (s: SessionSummary) => string,
): SessionSummary[] {
  return sessions.filter((session) => {
    if (formulaKey && scopeKeyFor(session) !== formulaKey) return false;
    if (!isRaceSessionType(session.sessionType)) return false;
    if (session.isOnline !== true) return false;
    if (session.isSpectator) return false;
    if (!session.rivals || session.rivals.length === 0) return false;
    return true;
  });
}

function isDnfStatus(status: string | undefined): boolean {
  if (!status) return false;
  const normalized = status.toUpperCase().replace(/[\s-]+/g, "_");
  return (
    normalized === "DNF" ||
    normalized === "DID_NOT_FINISH" ||
    normalized === "RETIRED" ||
    normalized === "DISQUALIFIED" ||
    normalized === "DSQ"
  );
}

function newAggregate(rival: { key: string; name: string; team?: string }, fallbackTrack: string): RivalAggregate {
  return {
    key: rival.key,
    name: rival.name,
    team: rival.team,
    races: 0,
    weightedRaces: 0,
    teammateRaces: 0,
    weightedTeammateRaces: 0,
    bestLapDeltas: [],
    stddevSumMs: 0,
    stddevSamples: 0,
    weightedStddevSumMs: 0,
    weightedStddevWeight: 0,
    totalOvertakes: 0,
    overtakeRaceSamples: 0,
    weightedOvertakes: 0,
    weightedOvertakeRaceWeight: 0,
    positionGapSum: 0,
    positionGapSamples: 0,
    weightedPositionGapSum: 0,
    weightedPositionGapWeight: 0,
    fastestLapCount: 0,
    weightedFastestLapCount: 0,
    polePositions: 0,
    weightedPolePositions: 0,
    dnfs: 0,
    weightedDnfs: 0,
    totalPenalties: 0,
    weightedPenalties: 0,
    h2hWinsForRival: 0,
    h2hWinsForPlayer: 0,
    latestRaceTime: 0,
    latestRaceTrack: fallbackTrack,
    aiRaces: 0,
  };
}

function aggregateRivals(sessions: SessionSummary[]): Map<string, RivalAggregate> {
  const map = new Map<string, RivalAggregate>();
  // Assign a recency weight per session — newest race = 1.0, decaying with
  // half-life RECENCY_HALF_LIFE_RACES. Drops to 0 once older than the floor so
  // ancient sessions don't keep contributing tiny biases.
  const sorted = [...sessions].sort(
    (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime(),
  );
  const recencyByPath = new Map<string, number>();
  sorted.forEach((session, idx) => {
    const weight =
      idx > RECENCY_FLOOR_RACES
        ? 0
        : Math.pow(0.5, idx / RECENCY_HALF_LIFE_RACES);
    recencyByPath.set(session.relativePath, weight);
  });

  for (const session of sessions) {
    const playerBest = getPlayerBestLapMs(session);
    const playerPos = getPlayerPosition(session);
    const time = new Date(session.date).getTime();
    const weight = recencyByPath.get(session.relativePath) ?? 0;
    for (const rival of session.rivals ?? []) {
      const existing = map.get(rival.key) ?? newAggregate(rival, session.track);

      existing.races += 1;
      existing.weightedRaces += weight;
      if (rival.isAi === true) existing.aiRaces += 1;
      if (rival.isTeammate) {
        existing.teammateRaces += 1;
        existing.weightedTeammateRaces += weight;
      }
      if (rival.bestLapMs != null && playerBest != null) {
        existing.bestLapDeltas.push({
          deltaMs: rival.bestLapMs - playerBest,
          weight,
        });
      }
      if (
        rival.stddevLapMs != null &&
        rival.validLapCount >= MIN_VALID_LAPS_PER_RIVAL_RACE
      ) {
        existing.stddevSumMs += rival.stddevLapMs;
        existing.stddevSamples += 1;
        existing.weightedStddevSumMs += rival.stddevLapMs * weight;
        existing.weightedStddevWeight += weight;
      }
      existing.totalOvertakes += rival.overtakes;
      existing.overtakeRaceSamples += 1;
      existing.weightedOvertakes += rival.overtakes * weight;
      existing.weightedOvertakeRaceWeight += weight;
      if (rival.avgPositionGap != null && rival.positionGapSamples != null) {
        existing.positionGapSum += rival.avgPositionGap;
        existing.positionGapSamples += 1;
        existing.weightedPositionGapSum += rival.avgPositionGap * weight;
        existing.weightedPositionGapWeight += weight;
      }
      if (rival.hadFastestLap) {
        existing.fastestLapCount += 1;
        existing.weightedFastestLapCount += weight;
      }
      if (rival.gridPosition === 1) {
        existing.polePositions += 1;
        existing.weightedPolePositions += weight;
      }
      if (isDnfStatus(rival.status)) {
        existing.dnfs += 1;
        existing.weightedDnfs += weight;
      }
      if (typeof rival.penaltyCount === "number" && rival.penaltyCount > 0) {
        existing.totalPenalties += rival.penaltyCount;
        existing.weightedPenalties += rival.penaltyCount * weight;
      }
      if (rival.position != null && playerPos != null) {
        if (rival.position < playerPos) existing.h2hWinsForRival += 1;
        else if (rival.position > playerPos) existing.h2hWinsForPlayer += 1;
      }
      if (time > existing.latestRaceTime) {
        existing.latestRaceTime = time;
        existing.latestRaceTrack = session.track;
        existing.latestTeam = rival.team;
      }
      map.set(rival.key, existing);
    }
  }
  return map;
}

/**
 * Weighted median over `(value, weight)` samples. Returns the smallest value
 * whose cumulative weight reaches half the total — robust to single-race
 * outliers (one fluke slipstream lap can't pull the headline gap) while still
 * giving recent races more pull than ancient ones. Falls back to a plain
 * median if every weight is zero (e.g. all samples sit past the recency floor).
 */
function weightedMedian(samples: { value: number; weight: number }[]): number | undefined {
  if (samples.length === 0) return undefined;
  const sorted = [...samples].sort((a, b) => a.value - b.value);
  const totalWeight = sorted.reduce((sum, s) => sum + s.weight, 0);
  if (totalWeight <= 0) {
    const mid = Math.floor(sorted.length / 2);
    if (sorted.length % 2 === 0) {
      return (sorted[mid - 1]!.value + sorted[mid]!.value) / 2;
    }
    return sorted[mid]!.value;
  }
  const target = totalWeight / 2;
  let cumulative = 0;
  for (const s of sorted) {
    cumulative += s.weight;
    if (cumulative >= target) return s.value;
  }
  return sorted[sorted.length - 1]!.value;
}

function bestLapMedianMs(aggregate: RivalAggregate): number | undefined {
  return weightedMedian(
    aggregate.bestLapDeltas.map((s) => ({ value: s.deltaMs, weight: s.weight })),
  );
}

function formatDeltaSeconds(ms: number): string {
  const sign = ms > 0 ? "+" : ms < 0 ? "−" : "";
  const seconds = Math.abs(ms) / 1000;
  return `${sign}${seconds.toFixed(3)}s`;
}

/**
 * Human-readable direction word for the detail line. The big number already
 * carries the magnitude and a colored sign; this gives the footer an
 * unambiguous English read of who's faster so the user never has to
 * mentally translate the sign convention.
 */
function relationToYou(deltaMs: number): "faster than you" | "slower than you" | undefined {
  if (deltaMs > 0) return "slower than you";
  if (deltaMs < 0) return "faster than you";
  return undefined;
}

function buildClosestTeammateCards(aggregates: RivalAggregate[]): RivalCard[] {
  const teammates = aggregates.filter(
    (rival) => rival.teammateRaces >= MIN_SHARED_RACES,
  );
  const top = takeTop(teammates, MAX_PER_KIND["closest-teammate"], (a, b) => {
    const ph = placeholderRank(a) - placeholderRank(b);
    if (ph !== 0) return ph;
    if (b.weightedTeammateRaces !== a.weightedTeammateRaces) {
      return b.weightedTeammateRaces - a.weightedTeammateRaces;
    }
    return b.teammateRaces - a.teammateRaces;
  });
  return top.map((winner) => {
    const medianDeltaMs = bestLapMedianMs(winner);
    const headline =
      medianDeltaMs != null
        ? formatDeltaSeconds(medianDeltaMs)
        : `${winner.teammateRaces}×`;
    const detailParts: string[] = [`${winner.teammateRaces} races`];
    if (winner.h2hWinsForPlayer + winner.h2hWinsForRival > 0) {
      detailParts.push(
        `H2H ${winner.h2hWinsForPlayer}-${winner.h2hWinsForRival}`,
      );
    }
    const relation = medianDeltaMs != null ? relationToYou(medianDeltaMs) : undefined;
    if (relation) detailParts.push(relation);
    return {
      kind: "closest-teammate",
      driverName: winner.name,
      team: winner.latestTeam ?? winner.team,
      headline,
      detail: detailParts.join(" · "),
      sampleSize: winner.teammateRaces,
    };
  });
}

function buildFrequentRivalCards(aggregates: RivalAggregate[]): RivalCard[] {
  // "Rival" here means: more races as opponents than as teammate, so the same
  // driver doesn't double-up as both teammate and "frequent rival".
  const rivals = aggregates.filter(
    (r) =>
      r.races - r.teammateRaces >= MIN_SHARED_RACES &&
      r.races - r.teammateRaces >= r.teammateRaces,
  );
  const top = takeTop(rivals, MAX_PER_KIND["frequent-rival"], (a, b) => {
    const ph = placeholderRank(a) - placeholderRank(b);
    if (ph !== 0) return ph;
    const wOppA = a.weightedRaces - a.weightedTeammateRaces;
    const wOppB = b.weightedRaces - b.weightedTeammateRaces;
    if (wOppB !== wOppA) return wOppB - wOppA;
    return b.races - b.teammateRaces - (a.races - a.teammateRaces);
  });
  return top.map((winner) => {
    const opponentRaces = winner.races - winner.teammateRaces;
    const medianDeltaMs = bestLapMedianMs(winner);
    // Use the magnitude + a direction word in the footer ("0.052s faster
     // than you") so the slim format reads in plain English — no sign
     // convention to mentally translate.
    const gapPhrase =
      medianDeltaMs != null
        ? `${(Math.abs(medianDeltaMs) / 1000).toFixed(3)}s ${relationToYou(medianDeltaMs)}`
        : undefined;
    const detail = [
      `${winner.races} races`,
      gapPhrase,
      `last at ${winner.latestRaceTrack}`,
    ]
      .filter(Boolean)
      .join(" · ");
    return {
      kind: "frequent-rival",
      driverName: winner.name,
      team: winner.latestTeam ?? winner.team,
      headline: `${opponentRaces}×`,
      detail,
      sampleSize: opponentRaces,
    };
  });
}

function buildPaceBenchmarkCards(aggregates: RivalAggregate[]): RivalCard[] {
  // Annotate each candidate with its weighted-median delta once so we don't
  // recompute it inside the filter + sort + map (median is O(n log n) per call).
  type Annotated = RivalAggregate & { medianDeltaMs: number };
  const annotated = aggregates.flatMap<Annotated>((r) => {
    if (r.bestLapDeltas.length < MIN_PACE_RACES) return [];
    if (r.races - r.teammateRaces < 1) return [];
    if (r.weightedRaces < MIN_RECENCY_SCORE) return [];
    const medianDeltaMs = bestLapMedianMs(r);
    if (medianDeltaMs == null || medianDeltaMs >= 0) return [];
    return [{ ...r, medianDeltaMs }];
  });
  const top = takeTop(annotated, MAX_PER_KIND["pace-benchmark"], (a, b) => {
    const ph = placeholderRank(a) - placeholderRank(b);
    if (ph !== 0) return ph;
    return a.medianDeltaMs - b.medianDeltaMs;
  });
  return top.map((winner) => ({
    kind: "pace-benchmark",
    driverName: winner.name,
    team: winner.latestTeam ?? winner.team,
    headline: formatDeltaSeconds(winner.medianDeltaMs),
    detail: `${winner.bestLapDeltas.length} races · faster than you`,
    sampleSize: winner.bestLapDeltas.length,
  }));
}

function buildMostConsistentRivalCards(
  aggregates: RivalAggregate[],
): RivalCard[] {
  const candidates = aggregates.filter(
    (r) =>
      r.stddevSamples >= MIN_PACE_RACES &&
      r.weightedRaces >= MIN_RECENCY_SCORE &&
      r.weightedStddevWeight > 0,
  );
  const top = takeTop(
    candidates,
    MAX_PER_KIND["most-consistent-rival"],
    (a, b) => {
      const ph = placeholderRank(a) - placeholderRank(b);
      if (ph !== 0) return ph;
      const sa = a.weightedStddevSumMs / a.weightedStddevWeight;
      const sb = b.weightedStddevSumMs / b.weightedStddevWeight;
      return sa - sb;
    },
  );
  return top.map((winner) => {
    const avgStddevSec =
      winner.weightedStddevSumMs / winner.weightedStddevWeight / 1000;
    return {
      kind: "most-consistent-rival",
      driverName: winner.name,
      team: winner.latestTeam ?? winner.team,
      headline: `±${avgStddevSec.toFixed(2)}s`,
      detail: `${winner.stddevSamples} races · avg lap spread`,
      sampleSize: winner.stddevSamples,
    };
  });
}

function buildOvertakeKingCards(aggregates: RivalAggregate[]): RivalCard[] {
  const candidates = aggregates.filter(
    (r) =>
      r.overtakeRaceSamples >= MIN_SHARED_RACES &&
      r.totalOvertakes >= 3 &&
      r.weightedOvertakeRaceWeight > 0,
  );
  const top = takeTop(candidates, MAX_PER_KIND["overtake-king"], (a, b) => {
    const ph = placeholderRank(a) - placeholderRank(b);
    if (ph !== 0) return ph;
    const pa = a.weightedOvertakes / a.weightedOvertakeRaceWeight;
    const pb = b.weightedOvertakes / b.weightedOvertakeRaceWeight;
    if (pb !== pa) return pb - pa;
    return b.totalOvertakes - a.totalOvertakes;
  });
  return top.map((winner) => {
    const avgPerRace = winner.totalOvertakes / winner.overtakeRaceSamples;
    return {
      kind: "overtake-king",
      driverName: winner.name,
      team: winner.latestTeam ?? winner.team,
      headline: avgPerRace.toFixed(1),
      detail: `avg overtakes · ${winner.totalOvertakes} total in ${winner.overtakeRaceSamples} races`,
      sampleSize: winner.overtakeRaceSamples,
    };
  });
}

function buildNemesisCards(aggregates: RivalAggregate[]): RivalCard[] {
  const candidates = aggregates.filter((r) => {
    if (r.positionGapSamples < MIN_SHARED_RACES) return false;
    if (r.positionGapSamples * 5 < MIN_POSITION_GAP_SAMPLES) return false;
    if (r.weightedRaces < MIN_RECENCY_SCORE) return false;
    if (r.weightedPositionGapWeight <= 0) return false;
    const weightedAvg = r.weightedPositionGapSum / r.weightedPositionGapWeight;
    return weightedAvg <= 3;
  });
  const top = takeTop(candidates, MAX_PER_KIND.nemesis, (a, b) => {
    const ph = placeholderRank(a) - placeholderRank(b);
    if (ph !== 0) return ph;
    const ga = a.weightedPositionGapSum / a.weightedPositionGapWeight;
    const gb = b.weightedPositionGapSum / b.weightedPositionGapWeight;
    return ga - gb;
  });
  return top.map((winner) => {
    const avgGap =
      winner.weightedPositionGapSum / winner.weightedPositionGapWeight;
    return {
      kind: "nemesis",
      driverName: winner.name,
      team: winner.latestTeam ?? winner.team,
      headline: avgGap < 1 ? avgGap.toFixed(2) : avgGap.toFixed(1),
      detail: `avg position gap · ${winner.positionGapSamples} races`,
      sampleSize: winner.positionGapSamples,
    };
  });
}

function buildFastestLapKingCards(aggregates: RivalAggregate[]): RivalCard[] {
  // Threshold drops to 1 here so the leaderboard still surfaces even if no
  // single rival owns multiple fastest laps.
  const candidates = aggregates.filter((r) => r.fastestLapCount >= 1);
  const top = takeTop(candidates, MAX_PER_KIND["fastest-lap-king"], (a, b) => {
    const ph = placeholderRank(a) - placeholderRank(b);
    if (ph !== 0) return ph;
    if (b.weightedFastestLapCount !== a.weightedFastestLapCount) {
      return b.weightedFastestLapCount - a.weightedFastestLapCount;
    }
    return b.fastestLapCount - a.fastestLapCount;
  });
  return top.map((winner) => ({
    kind: "fastest-lap-king",
    driverName: winner.name,
    team: winner.latestTeam ?? winner.team,
    headline: `${winner.fastestLapCount}`,
    detail:
      winner.fastestLapCount === 1
        ? `fastest lap · ${winner.races} races shared`
        : `fastest laps · ${winner.races} races shared`,
    sampleSize: winner.fastestLapCount,
  }));
}

function buildPolePositionKingCards(aggregates: RivalAggregate[]): RivalCard[] {
  const candidates = aggregates.filter((r) => r.polePositions >= 1);
  const top = takeTop(candidates, MAX_PER_KIND["pole-position-king"], (a, b) => {
    const ph = placeholderRank(a) - placeholderRank(b);
    if (ph !== 0) return ph;
    if (b.weightedPolePositions !== a.weightedPolePositions) {
      return b.weightedPolePositions - a.weightedPolePositions;
    }
    return b.polePositions - a.polePositions;
  });
  return top.map((winner) => ({
    kind: "pole-position-king",
    driverName: winner.name,
    team: winner.latestTeam ?? winner.team,
    headline: `${winner.polePositions}`,
    detail:
      winner.polePositions === 1
        ? `pole · ${winner.races} races shared`
        : `poles · ${winner.races} races shared`,
    sampleSize: winner.polePositions,
  }));
}

function buildDnfKingCards(aggregates: RivalAggregate[]): RivalCard[] {
  const candidates = aggregates.filter((r) => r.dnfs >= 2);
  const top = takeTop(candidates, MAX_PER_KIND["dnf-king"], (a, b) => {
    const ph = placeholderRank(a) - placeholderRank(b);
    if (ph !== 0) return ph;
    if (b.weightedDnfs !== a.weightedDnfs) return b.weightedDnfs - a.weightedDnfs;
    return b.dnfs - a.dnfs;
  });
  return top.map((winner) => {
    const rate = winner.dnfs / winner.races;
    return {
      kind: "dnf-king",
      driverName: winner.name,
      team: winner.latestTeam ?? winner.team,
      headline: `${winner.dnfs}`,
      detail: `DNFs · ${Math.round(rate * 100)}% of ${winner.races} races`,
      sampleSize: winner.dnfs,
    };
  });
}

function buildPenaltyMagnetCards(aggregates: RivalAggregate[]): RivalCard[] {
  const candidates = aggregates.filter(
    (r) => r.totalPenalties >= 3 && r.races >= MIN_SHARED_RACES,
  );
  const top = takeTop(candidates, MAX_PER_KIND["penalty-magnet"], (a, b) => {
    const ph = placeholderRank(a) - placeholderRank(b);
    if (ph !== 0) return ph;
    if (b.weightedPenalties !== a.weightedPenalties) {
      return b.weightedPenalties - a.weightedPenalties;
    }
    return b.totalPenalties - a.totalPenalties;
  });
  return top.map((winner) => {
    const avg = winner.totalPenalties / winner.races;
    return {
      kind: "penalty-magnet",
      driverName: winner.name,
      team: winner.latestTeam ?? winner.team,
      headline: `${winner.totalPenalties}`,
      detail: `penalties · ${avg.toFixed(1)} per race · ${winner.races} shared`,
      sampleSize: winner.totalPenalties,
    };
  });
}

// Display order — cards group together by kind so each kind reads as a mini
// leaderboard. Funnier "negative" kinds (DNF, penalty) come after the headline
// stats so the section reads serious-first, then ribs the chaos.
const RIVAL_CARD_ORDER: RivalCardKind[] = [
  "closest-teammate",
  "frequent-rival",
  "pace-benchmark",
  "nemesis",
  "pole-position-king",
  "fastest-lap-king",
  "overtake-king",
  "dnf-king",
  "penalty-magnet",
  "most-consistent-rival",
];

export function buildRivalStats(
  sessions: SessionSummary[],
  formulaKey: string | undefined,
  scopeKeyFor: (session: SessionSummary) => string,
): RivalStats {
  const scoped = getOnlineRaceSessions(sessions, formulaKey, scopeKeyFor);
  if (scoped.length === 0) return { cards: [], raceCount: 0 };
  // Drop non-human entries that don't clear MIN_PLACEHOLDER_RACES before any
  // card builder sees them — a 2-race "Mercedes #66" or one-off AI surname
  // shouldn't crowd out a real opponent just because no real opponent
  // qualified for that exact category. Persistent placeholder patterns
  // (recurring empty league seat) still survive past the higher floor.
  const aggregates = [...aggregateRivals(scoped).values()].filter((r) => {
    if (placeholderRank(r) === 0) return true;
    return r.races >= MIN_PLACEHOLDER_RACES;
  });

  const byKind: Record<RivalCardKind, RivalCard[]> = {
    "closest-teammate": buildClosestTeammateCards(aggregates),
    "frequent-rival": buildFrequentRivalCards(aggregates),
    "pace-benchmark": buildPaceBenchmarkCards(aggregates),
    nemesis: buildNemesisCards(aggregates),
    "pole-position-king": buildPolePositionKingCards(aggregates),
    "fastest-lap-king": buildFastestLapKingCards(aggregates),
    "overtake-king": buildOvertakeKingCards(aggregates),
    "dnf-king": buildDnfKingCards(aggregates),
    "penalty-magnet": buildPenaltyMagnetCards(aggregates),
    "most-consistent-rival": buildMostConsistentRivalCards(aggregates),
  };

  const cards: RivalCard[] = [];
  for (const kind of RIVAL_CARD_ORDER) {
    cards.push(...byKind[kind]);
    if (cards.length >= MAX_TOTAL_CARDS) break;
  }

  return {
    cards: cards.slice(0, MAX_TOTAL_CARDS),
    raceCount: scoped.length,
  };
}
