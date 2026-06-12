/**
 * Builds synthetic online race summary entries for the prod (no-data) demo.
 *
 * These entries are listed in `public/demo/sessions.json` but have NO backing
 * detail JSON file. They power the Dashboard's Rivals & Teammates aggregation
 * so the no-data demo doesn't look empty. The `isSynthetic` flag lets list
 * surfaces render them as static demo rows, and lets `SessionPage` show a
 * friendly placeholder if a dashboard chart links to one.
 *
 * Deterministic — uses a seeded PRNG so output is stable across runs and
 * across machines without an upstream telemetry directory.
 */

import type {
  PlayerStintSummary,
  RivalEntry,
  SessionSummary,
} from "../src/types/telemetry.ts";

const POINTS_BY_POSITION: Record<number, number> = {
  1: 25, 2: 18, 3: 15, 4: 12, 5: 10, 6: 8, 7: 6, 8: 4, 9: 2, 10: 1,
};

// --- PRNG ---

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rng = mulberry32(0xf1de60);

function jitter(magnitude: number): number {
  return (rng() * 2 - 1) * magnitude;
}

function pickN<T>(arr: T[], n: number): T[] {
  const pool = [...arr];
  const out: T[] = [];
  while (out.length < n && pool.length) {
    const i = Math.floor(rng() * pool.length);
    out.push(pool.splice(i, 1)[0]!);
  }
  return out;
}

// --- Cast of recurring drivers ---

interface DriverProfile {
  name: string;
  team: string;
  /** Lower = faster; 1.0 = baseline player pace, 0.96 = ~4% faster than player. */
  paceFactor: number;
  /** Stddev multiplier (1.0 = average noise). */
  consistency: number;
  /** Aggression — affects overtake counts. */
  aggression: number;
}

// Player drives Ferrari (matches the existing real Spa race in the demo).
const PLAYER_TEAM = "Ferrari";

// Fully fictional gamertags — the demo must not surface the user's actual
// online rivals' handles. Slugs intentionally evoke common racing-online name
// patterns (acronyms, numeric tails, bracketed clans) so the Rivals section
// still reads like a real lobby.
const PLAYER_TEAMMATES: DriverProfile[] = [
  { name: "AlpineWraith", team: "Ferrari", paceFactor: 1.005, consistency: 1.25, aggression: 0.5 },
];

const STARS: DriverProfile[] = [
  { name: "VRT_Apex91", team: "Red Bull Racing", paceFactor: 0.962, consistency: 0.85, aggression: 1.4 },
  { name: "NeonCometX", team: "Mclaren", paceFactor: 0.968, consistency: 0.88, aggression: 1.1 },
  { name: "Astralis_47", team: "Aston Martin", paceFactor: 0.971, consistency: 0.9, aggression: 0.9 },
  { name: "BlazePilot", team: "Mclaren", paceFactor: 0.974, consistency: 0.95, aggression: 1.6 },
  { name: "PhantomDrift", team: "Mercedes", paceFactor: 0.978, consistency: 0.78, aggression: 0.95 },
];

const MIDFIELD: DriverProfile[] = [
  { name: "GTX_Falcon", team: "Haas", paceFactor: 0.985, consistency: 1.0, aggression: 1.5 },
  { name: "MercuryRise", team: "Alpine", paceFactor: 0.99, consistency: 0.95, aggression: 1.3 },
  { name: "Vapor_Lane", team: "Sauber", paceFactor: 0.992, consistency: 1.0, aggression: 0.9 },
  { name: "NightBlitz", team: "RB", paceFactor: 0.995, consistency: 1.1, aggression: 1.0 },
  { name: "ChromeShade", team: "Williams", paceFactor: 1.002, consistency: 1.05, aggression: 1.0 },
  { name: "Halftrack_K", team: "Alpine", paceFactor: 1.005, consistency: 1.15, aggression: 1.4 },
  { name: "OniRunner", team: "Williams", paceFactor: 1.01, consistency: 1.1, aggression: 0.7 },
  { name: "[SR] Embertide", team: "Aston Martin", paceFactor: 1.012, consistency: 1.1, aggression: 0.6 },
];

const PLACEHOLDERS: DriverProfile[] = [
  { name: "Haas #2", team: "Haas", paceFactor: 1.018, consistency: 1.2, aggression: 0.6 },
  { name: "Sauber #2", team: "Sauber", paceFactor: 1.022, consistency: 1.25, aggression: 0.7 },
  { name: "RB #67", team: "RB", paceFactor: 1.025, consistency: 1.2, aggression: 0.6 },
];

const ALL_PROFILES: DriverProfile[] = [
  ...PLAYER_TEAMMATES,
  ...STARS,
  ...MIDFIELD,
  ...PLACEHOLDERS,
];

// --- Track scenarios ---

interface RaceScenario {
  track: string;
  date: string; // ISO local
  totalLaps: number;
  /** Baseline best-lap (ms) the player would manage on a clean lap. */
  playerBestMs: number;
  weather: string;
  /** Player's grid position. */
  playerGrid: number;
  /** Player's final position (1..fieldSize, or "DNF"). */
  playerFinish: number | "DNF";
  /** Driver name who set the overall fastest lap. Omit when `playerSetFastestLap` is true. */
  fastestLapDriver?: string;
  /** Driver name who started from pole. */
  poleDriver: string;
  /** Race winner driver name. */
  winnerDriver: string;
  /** Driver names who DNF'd. */
  dnfDrivers?: string[];
  /** Map of driver name → penalty count for this race. */
  penalties?: Record<string, number>;
  /** Penalty count for the player. */
  playerPenaltyCount?: number;
  /** Player's speed-trap rank (1 = fastest). */
  playerTopSpeedTrapRank?: number;
  /** Player owned purple S1/S2/S3 sectors. */
  playerPurpleSectors?: { s1?: boolean; s2?: boolean; s3?: boolean };
  /** True when the player set the overall fastest lap of the race. */
  playerSetFastestLap?: boolean;
  /** Tyre stints the player completed (compound + laps + endWearAvg %). */
  playerStints?: PlayerStintSummary[];
  /** Optional override for player's mean lap time. */
  playerMeanMs?: number;
  /** Optional override for player's stddev. */
  playerStddevMs?: number;
}

const SCENARIOS: RaceScenario[] = [
  {
    track: "Bahrain",
    date: "2026-06-08T21:15:00",
    totalLaps: 19,
    playerBestMs: 92840,
    weather: "Clear",
    // Pole-to-victory in the season's most recent race — drives the dashboard
    // hero's "Best P1" stat and seeds the race-by-race chart's most-recent bar.
    playerGrid: 1,
    playerFinish: 1,
    poleDriver: "VRT_Apex91",
    winnerDriver: "VRT_Apex91", // placeholder; overridden when playerFinish === 1
    dnfDrivers: ["NightBlitz"],
    penalties: { "Haas #2": 1, Halftrack_K: 2 },
    playerSetFastestLap: true,
    playerTopSpeedTrapRank: 1,
    playerPurpleSectors: { s1: true, s2: true, s3: true },
    playerStints: [
      { compound: "Soft", laps: 9, endWearAvg: 48 },
      { compound: "Hard", laps: 10, endWearAvg: 22 },
    ],
  },
  {
    track: "Jeddah",
    date: "2026-06-04T20:45:00",
    totalLaps: 17,
    playerBestMs: 90120,
    weather: "Clear",
    playerGrid: 8,
    playerFinish: 6,
    fastestLapDriver: "NeonCometX",
    poleDriver: "Astralis_47",
    winnerDriver: "VRT_Apex91",
    penalties: { GTX_Falcon: 2, BlazePilot: 1 },
  },
  {
    track: "Imola",
    date: "2026-05-30T19:30:00",
    totalLaps: 18,
    playerBestMs: 78340,
    weather: "Light Cloud",
    playerGrid: 4,
    playerFinish: 3,
    fastestLapDriver: "BlazePilot",
    poleDriver: "NeonCometX",
    winnerDriver: "NeonCometX",
    dnfDrivers: ["Halftrack_K", "RB #67"],
    penalties: { Halftrack_K: 1 },
    playerTopSpeedTrapRank: 2,
    playerPurpleSectors: { s2: true },
    playerStints: [
      { compound: "Medium", laps: 11, endWearAvg: 42 },
      { compound: "Hard", laps: 7, endWearAvg: 28 },
    ],
  },
  {
    track: "Monaco",
    date: "2026-05-24T20:00:00",
    totalLaps: 20,
    playerBestMs: 72980,
    weather: "Clear",
    playerGrid: 11,
    playerFinish: 9,
    fastestLapDriver: "Astralis_47",
    poleDriver: "Astralis_47",
    winnerDriver: "Astralis_47",
    dnfDrivers: ["MercuryRise", "Sauber #2"],
    penalties: { GTX_Falcon: 1 },
  },
  {
    track: "Catalunya",
    date: "2026-05-18T21:00:00",
    totalLaps: 16,
    playerBestMs: 78500,
    weather: "Clear",
    // Front-row start that converted into the player's second win — bumps the
    // hero "front row %" stat and gives the chart a second win bar.
    playerGrid: 2,
    playerFinish: 1,
    fastestLapDriver: "VRT_Apex91",
    poleDriver: "VRT_Apex91",
    winnerDriver: "VRT_Apex91", // placeholder; overridden when playerFinish === 1
    penalties: { "Haas #2": 1 },
    playerTopSpeedTrapRank: 2,
    playerPurpleSectors: { s1: true },
  },
  {
    track: "Miami",
    date: "2026-05-10T19:45:00",
    totalLaps: 18,
    playerBestMs: 90460,
    weather: "Light Cloud",
    playerGrid: 9,
    playerFinish: 8,
    fastestLapDriver: "VRT_Apex91",
    poleDriver: "BlazePilot",
    winnerDriver: "VRT_Apex91",
    dnfDrivers: ["NightBlitz", "OniRunner"],
    penalties: { Halftrack_K: 2, GTX_Falcon: 1 },
  },
  {
    track: "Silverstone",
    date: "2026-05-03T21:30:00",
    totalLaps: 17,
    playerBestMs: 88240,
    weather: "Light Rain",
    playerGrid: 2,
    playerFinish: 2,
    poleDriver: "VRT_Apex91",
    winnerDriver: "PhantomDrift",
    dnfDrivers: ["Halftrack_K"],
    penalties: { BlazePilot: 1 },
    playerSetFastestLap: true,
    playerTopSpeedTrapRank: 3,
    playerPurpleSectors: { s1: true, s3: true },
    playerStints: [
      { compound: "Inters", laps: 9, endWearAvg: 35 },
      { compound: "Medium", laps: 8, endWearAvg: 22 },
    ],
  },
  {
    track: "Hungaroring",
    date: "2026-04-26T20:15:00",
    totalLaps: 19,
    playerBestMs: 77900,
    weather: "Clear",
    playerGrid: 3,
    playerFinish: "DNF",
    fastestLapDriver: "Astralis_47",
    poleDriver: "NeonCometX",
    winnerDriver: "NeonCometX",
    dnfDrivers: ["NightBlitz", "Sauber #2"],
    penalties: { GTX_Falcon: 2 },
  },
  {
    track: "Monza",
    date: "2026-04-19T22:00:00",
    totalLaps: 18,
    playerBestMs: 81750,
    weather: "Clear",
    playerGrid: 5,
    playerFinish: 7,
    fastestLapDriver: "VRT_Apex91",
    poleDriver: "VRT_Apex91",
    winnerDriver: "Astralis_47",
    penalties: { "Haas #2": 2, Halftrack_K: 1 },
  },
  {
    track: "Suzuka",
    date: "2026-04-11T20:30:00",
    totalLaps: 17,
    playerBestMs: 92840,
    weather: "Light Cloud",
    playerGrid: 6,
    playerFinish: 5,
    fastestLapDriver: "VRT_Apex91",
    poleDriver: "PhantomDrift",
    winnerDriver: "VRT_Apex91",
    dnfDrivers: ["Halftrack_K", "ChromeShade"],
    penalties: { GTX_Falcon: 1 },
  },
  {
    track: "Austin",
    date: "2026-04-04T21:45:00",
    totalLaps: 19,
    playerBestMs: 94120,
    weather: "Clear",
    playerGrid: 10,
    playerFinish: 8,
    fastestLapDriver: "BlazePilot",
    poleDriver: "Astralis_47",
    winnerDriver: "NeonCometX",
    penalties: { Halftrack_K: 2, BlazePilot: 1 },
  },
  {
    track: "Mexico",
    date: "2026-03-28T22:30:00",
    totalLaps: 18,
    playerBestMs: 77640,
    weather: "Clear",
    playerGrid: 7,
    playerFinish: 6,
    fastestLapDriver: "VRT_Apex91",
    poleDriver: "VRT_Apex91",
    winnerDriver: "VRT_Apex91",
    dnfDrivers: ["NightBlitz"],
    penalties: { "Haas #2": 1 },
    playerPenaltyCount: 1,
    playerTopSpeedTrapRank: 4,
    playerPurpleSectors: { s2: true },
  },
  {
    track: "Singapore",
    date: "2026-03-15T20:00:00",
    totalLaps: 19,
    playerBestMs: 92560,
    weather: "Clear",
    playerGrid: 4,
    playerFinish: 4,
    fastestLapDriver: "PhantomDrift",
    poleDriver: "BlazePilot",
    winnerDriver: "BlazePilot",
    dnfDrivers: ["Halftrack_K"],
    penalties: { GTX_Falcon: 2, "[SR] Embertide": 1 },
  },
  {
    track: "Las Vegas",
    date: "2026-03-01T22:00:00",
    totalLaps: 17,
    playerBestMs: 95210,
    weather: "Clear",
    playerGrid: 8,
    playerFinish: 7,
    fastestLapDriver: "NeonCometX",
    poleDriver: "VRT_Apex91",
    winnerDriver: "NeonCometX",
    dnfDrivers: ["NightBlitz", "RB #67"],
    penalties: { Halftrack_K: 1, GTX_Falcon: 1 },
  },
  {
    track: "Abu Dhabi",
    date: "2026-02-20T21:15:00",
    totalLaps: 18,
    playerBestMs: 85360,
    weather: "Clear",
    playerGrid: 9,
    playerFinish: 5,
    fastestLapDriver: "VRT_Apex91",
    poleDriver: "VRT_Apex91",
    winnerDriver: "VRT_Apex91",
    dnfDrivers: ["ChromeShade"],
    penalties: { "Haas #2": 1, BlazePilot: 1 },
  },
];

// --- Per-race rival generation ---

interface RankedDriver {
  profile: DriverProfile;
  bestMs: number;
  meanMs: number;
  stddevMs: number;
  position: number;
  gridPosition: number;
  isDNF: boolean;
}

function buildRivalsForRace(scenario: RaceScenario): {
  rivals: RivalEntry[];
  playerLapStats: { meanLapMs: number; stddevLapMs: number; validLapCount: number };
  playerMeanMs: number;
  fieldSize: number;
} {
  // Always include core stars + teammate; mix some midfield + a couple placeholders.
  const cast: DriverProfile[] = [
    ...PLAYER_TEAMMATES,
    ...STARS,
    ...pickN(MIDFIELD, 5),
    ...pickN(PLACEHOLDERS, 2),
  ];

  // Generate lap stats per driver scaled to their pace factor vs the player's best.
  const playerStddev = scenario.playerStddevMs ?? 1900 + Math.round(jitter(400));
  const playerMean =
    scenario.playerMeanMs ?? scenario.playerBestMs + 2200 + Math.round(jitter(500));

  const ranked: RankedDriver[] = cast.map((profile) => {
    const bestMs = Math.round(
      scenario.playerBestMs * profile.paceFactor + jitter(220),
    );
    const stddevMs = Math.round(playerStddev * profile.consistency + jitter(250));
    const meanMs = bestMs + Math.round(2100 * profile.consistency + jitter(420));
    return {
      profile,
      bestMs,
      meanMs,
      stddevMs,
      position: 0,
      gridPosition: 0,
      isDNF: false,
    };
  });

  // Sort by best lap → preliminary running order, then shuffle slightly.
  ranked.sort((a, b) => a.bestMs - b.bestMs);

  // Promote scenario winner / pole / fastest-lap driver into position 1 / pole / etc.
  const byName = new Map(ranked.map((r) => [r.profile.name, r] as const));
  const winner = byName.get(scenario.winnerDriver);
  const pole = byName.get(scenario.poleDriver);

  // Assign finishing positions: ranked order, but ensure winner is P1 and DNFs
  // fall to the back of the running order.
  const dnfSet = new Set(scenario.dnfDrivers ?? []);
  const finishers = ranked.filter((r) => !dnfSet.has(r.profile.name));
  const dnfs = ranked.filter((r) => dnfSet.has(r.profile.name));
  for (const d of dnfs) d.isDNF = true;

  if (winner && finishers.includes(winner)) {
    const idx = finishers.indexOf(winner);
    finishers.splice(idx, 1);
    finishers.unshift(winner);
  }

  // Assign player's finishing position by inserting a virtual player slot.
  // Field size = cast (others) + player + 4 extra silent AI/online filler.
  const fieldSize = cast.length + 1 + 4;

  // Player finishes at scenario.playerFinish; others fill the remaining slots.
  const finisherPositions: number[] = [];
  let cursor = 1;
  for (let i = 0; i < finishers.length; i++) {
    if (cursor === scenario.playerFinish) cursor++; // reserve player slot
    finisherPositions.push(cursor);
    cursor++;
  }
  // Assign DNF positions at the back.
  let dnfCursor = fieldSize;
  for (const _ of dnfs) {
    void _;
    dnfCursor--;
  }
  finishers.forEach((r, i) => {
    r.position = finisherPositions[i]!;
  });
  let dnfPosCursor = fieldSize;
  for (const r of dnfs) {
    r.position = dnfPosCursor--;
  }

  // Grid: pole driver to P1, winner gets a randomized grid slot 1..6,
  // others get jittered based on their pace.
  ranked
    .slice()
    .sort((a, b) => a.bestMs - b.bestMs + jitter(800))
    .forEach((r, i) => {
      r.gridPosition = Math.min(fieldSize, i + 1 + Math.round(jitter(1.5)));
    });
  if (pole) pole.gridPosition = 1;

  // Build RivalEntry per non-player driver.
  const rivals: RivalEntry[] = ranked.map((r) => {
    const isTeammate = r.profile.team === PLAYER_TEAM;
    const finalPosition =
      typeof scenario.playerFinish === "number" ? scenario.playerFinish : fieldSize;
    const positionGap = Math.abs(r.position - finalPosition);
    // avg gap drifts a bit from the final-classification gap.
    const avgPositionGap = Math.max(
      0,
      positionGap + jitter(Math.max(1, positionGap * 0.5)),
    );
    // Overtakes scale with aggression + how much they moved through the field.
    const gridDelta = Math.max(0, r.gridPosition - r.position);
    const baseOvertakes = Math.round(
      (3 + gridDelta * 1.8 + r.profile.aggression * 4) + jitter(2.2),
    );
    const overtakes = Math.max(0, baseOvertakes);
    // Player ↔ this driver overtakes: more likely when they finished near the player.
    const nearPlayer = positionGap <= 3;
    const overtakesOnPlayer = nearPlayer ? Math.max(0, Math.round(rng() * 3)) : 0;
    const overtakesByPlayer = nearPlayer ? Math.max(0, Math.round(rng() * 3)) : 0;

    return {
      key: r.profile.name.trim().toLowerCase(),
      name: r.profile.name,
      team: r.profile.team,
      isTeammate,
      position: r.position,
      gridPosition: r.gridPosition,
      status: r.isDNF ? "DNF" : "FINISHED",
      penaltyCount: scenario.penalties?.[r.profile.name] ?? 0,
      bestLapMs: r.bestMs,
      validLapCount: r.isDNF
        ? Math.max(1, Math.round(scenario.totalLaps * (0.3 + rng() * 0.4)))
        : scenario.totalLaps,
      meanLapMs: r.meanMs,
      stddevLapMs: Math.max(400, r.stddevMs),
      overtakes,
      overtakesOnPlayer,
      overtakesByPlayer,
      avgPositionGap,
      positionGapSamples: scenario.totalLaps,
      hadFastestLap:
        !scenario.playerSetFastestLap && r.profile.name === scenario.fastestLapDriver,
    };
  });

  return {
    rivals,
    playerLapStats: {
      meanLapMs: playerMean,
      stddevLapMs: playerStddev,
      validLapCount:
        typeof scenario.playerFinish === "number"
          ? scenario.totalLaps
          : Math.max(1, Math.round(scenario.totalLaps * 0.55)),
    },
    playerMeanMs: playerMean,
    fieldSize,
  };
}

// --- Summary entry construction ---

function trackUnderscore(track: string): string {
  return track.replace(/ /g, "_");
}

function buildSummaryForRace(scenario: RaceScenario): SessionSummary {
  const { rivals, playerLapStats, fieldSize } = buildRivalsForRace(scenario);

  // Filename format mirrors real exports: Race_<Track>_YYYY_MM_DD_HH_mm_ss.json
  const d = new Date(scenario.date);
  const pad = (n: number) => String(n).padStart(2, "0");
  const stamp = `${d.getFullYear()}_${pad(d.getMonth() + 1)}_${pad(d.getDate())}_${pad(d.getHours())}_${pad(d.getMinutes())}_${pad(d.getSeconds())}`;
  const filename = `Race_${trackUnderscore(scenario.track)}_${stamp}.json`;
  const slug = filename.replace(/\.json$/, "").toLowerCase().replace(/_/g, "-");

  const playerFinishedNum =
    typeof scenario.playerFinish === "number" ? scenario.playerFinish : undefined;
  const playerBestStr = formatLapTime(scenario.playerBestMs);

  // Derive insight-friendly fields. Defaults are sensible mid-pack values so
  // recurring insights always have a track-level candidate, with scenario
  // overrides letting specific races spike (player FL, P2 finish, etc.).
  const lapOnePosition = clamp(
    scenario.playerGrid + Math.round(jitter(1.5)),
    1,
    fieldSize,
  );
  const topSpeedTrapRank =
    scenario.playerTopSpeedTrapRank ?? Math.max(1, Math.round(5 + jitter(3)));
  const overtakesMade = Math.max(
    0,
    typeof scenario.playerFinish === "number"
      ? scenario.playerGrid - scenario.playerFinish + Math.round(jitter(2))
      : Math.round(2 + jitter(2)),
  );
  const overtakesTaken = rivals.reduce(
    (sum, r) => sum + r.overtakesOnPlayer,
    0,
  );
  const stints =
    scenario.playerStints ?? [
      { compound: "Medium", laps: Math.ceil(scenario.totalLaps * 0.55), endWearAvg: 38 },
      { compound: "Hard", laps: Math.floor(scenario.totalLaps * 0.45), endWearAvg: 24 },
    ];
  const purpleSectors = {
    s1: scenario.playerPurpleSectors?.s1 ?? false,
    s2: scenario.playerPurpleSectors?.s2 ?? false,
    s3: scenario.playerPurpleSectors?.s3 ?? false,
  };
  const finishPoints =
    playerFinishedNum != null ? (POINTS_BY_POSITION[playerFinishedNum] ?? 0) : 0;
  const playerPenaltyCount = scenario.playerPenaltyCount ?? 0;
  const playerSetFastestLap = scenario.playerSetFastestLap ?? false;

  return {
    relativePath: `synthetic/${filename}`,
    slug,
    sessionType: "Race",
    track: scenario.track,
    formula: "F1 Modern",
    date: scenario.date,
    gameYear: 25,
    packetFormat: 2025,
    validLapCount: playerLapStats.validLapCount,
    bestLapTime: playerBestStr,
    bestLapTimeMs: scenario.playerBestMs,
    aiDifficulty: 0,
    isOnline: true,
    isSpectator: false,
    classifiedDriverCount: fieldSize,
    onlineDriverCount: fieldSize,
    activeHumanDriverCount: fieldSize,
    weather: scenario.weather,
    playerSetFastestLap,
    lapOnePosition,
    topSpeedTrapRank,
    topSpeedTrapTotal: fieldSize,
    stints,
    purpleSectors,
    overtakesMade,
    overtakesTaken,
    playerTeam: PLAYER_TEAM,
    playerLapStats,
    rivals,
    playerRaceResult: playerFinishedNum
      ? {
          position: playerFinishedNum,
          gridPosition: scenario.playerGrid,
          status: "FINISHED",
          points: finishPoints,
          penaltyCount: playerPenaltyCount,
          playerLaps: scenario.totalLaps,
          totalLaps: scenario.totalLaps,
          fieldSize,
          bestLapTime: playerBestStr,
          bestLapTimeMs: scenario.playerBestMs,
        }
      : {
          position: fieldSize,
          gridPosition: scenario.playerGrid,
          status: "DNF",
          points: 0,
          penaltyCount: playerPenaltyCount,
          playerLaps: playerLapStats.validLapCount,
          totalLaps: scenario.totalLaps,
          fieldSize,
          bestLapTime: playerBestStr,
          bestLapTimeMs: scenario.playerBestMs,
        },
    isAutoSave: false,
    isSynthetic: true,
  };
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

function formatLapTime(ms: number): string {
  const m = Math.floor(ms / 60000);
  const s = (ms % 60000) / 1000;
  return `${String(m).padStart(2, "0")}:${s.toFixed(3).padStart(6, "0")}`;
}

export function buildSyntheticOnlineRaces(): SessionSummary[] {
  // Sanity check — every referenced driver should exist in the cast pools.
  const knownNames = new Set(ALL_PROFILES.map((p) => p.name));
  for (const s of SCENARIOS) {
    const refs = [
      s.fastestLapDriver,
      s.poleDriver,
      s.winnerDriver,
      ...(s.dnfDrivers ?? []),
      ...Object.keys(s.penalties ?? {}),
    ];
    for (const name of refs) {
      if (name == null) continue;
      if (!knownNames.has(name)) {
        throw new Error(`Synthetic scenario references unknown driver: ${name}`);
      }
    }
  }
  return SCENARIOS.map(buildSummaryForRace);
}
