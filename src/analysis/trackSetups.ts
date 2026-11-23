import type { CarSetup } from "../types/telemetry";
import { findPlayer } from "../utils/stats/drivers";
import { summaryKind, type SessionKind } from "./sessionKind";
import { isWetCompound } from "./trackStrategyCompounds";
import type { TrackSessionData } from "./trackAnalysis";

/**
 * A track's setups as a driver uses them, per conditions (dry or wet): the
 * quali setup (fastest or latest), the race setup, and every setup run here. Identity ignores brake bias, which
 * drivers change from the wheel mid-session (Sakhir had 41 exact setups, 25 once
 * bias is ignored), and fuel, a race-plan variable. Sessions without a complete
 * valid lap are left out, which also drops the placeholder default setup the
 * game exports for quali saves that never ran (wings 25-25, diff 60-50).
 */

export const SETUP_IDENTITY_KEYS: (keyof CarSetup)[] = [
  "front-wing",
  "rear-wing",
  "on-throttle",
  "off-throttle",
  "front-camber",
  "rear-camber",
  "front-toe",
  "rear-toe",
  "front-suspension",
  "rear-suspension",
  "front-anti-roll-bar",
  "rear-anti-roll-bar",
  "front-suspension-height",
  "rear-suspension-height",
  "brake-pressure",
  "front-left-tyre-pressure",
  "front-right-tyre-pressure",
  "rear-left-tyre-pressure",
  "rear-right-tyre-pressure",
];

export function setupIdentity(setup: CarSetup): string {
  return SETUP_IDENTITY_KEYS.map((key) => Number(setup[key]).toFixed(2)).join(
    "|",
  );
}

/** Setups split by track conditions: a wet setup (more wing, softer car)
 *  is a different answer from a dry one, so the two never mix. */
export type SetupConditions = "dry" | "wet";

/**
 * Wet when the player ran Inters or Wets, or the save reports rain. The tyres
 * come first: `session-info.weather` is the weather when the save was written,
 * so a race that dried out (or started dry) can still read "Clear".
 */
export function sessionConditions(
  session: TrackSessionData["session"],
): SetupConditions {
  const player = findPlayer(session);
  const compounds = [
    ...(player?.["tyre-set-history"] ?? [])
      .filter((stint) => stint["stint-length"] > 0)
      .map((stint) => stint["tyre-set-data"]?.["visual-tyre-compound"]),
    ...(player?.["per-lap-info"] ?? []).map(
      (lap) => lap["car-status-data"]?.["visual-tyre-compound"],
    ),
  ];
  if (compounds.some((c) => c && isWetCompound(c))) return "wet";
  return /rain|storm/i.test(session["session-info"]?.weather ?? "")
    ? "wet"
    : "dry";
}

export interface TrackSetupUse {
  setup: CarSetup;
  data: TrackSessionData;
  kind: SessionKind;
  conditions: SetupConditions;
}

export interface TrackSetupGroup {
  key: string;
  /** The most recent session run on it; its exact setup (brake bias
   *  included) is the one shown. */
  latest: TrackSetupUse;
  /** The session that set its best lap. */
  best: TrackSetupUse;
  kinds: SessionKind[];
  sessionCount: number;
}

export interface ConditionSetups {
  qualiFastest: TrackSetupUse | null;
  qualiLatest: TrackSetupUse | null;
  race: TrackSetupUse | null;
  /** True when the latest race setup also set the fastest race lap here. */
  raceIsFastest: boolean;
  /** Newest first. */
  history: TrackSetupGroup[];
}

/** Null for conditions the driver never ran here. */
export type TrackSetups = Record<SetupConditions, ConditionSetups | null>;

export function buildTrackSetups(
  data: readonly TrackSessionData[],
): TrackSetups {
  const uses: TrackSetupUse[] = [];
  for (const entry of data) {
    const player = findPlayer(entry.session);
    const setup = player?.["car-setup"];
    if (!setup?.["is-valid"] || entry.bestLapMs <= 0) continue;
    uses.push({
      setup,
      data: entry,
      kind: summaryKind(entry.summary),
      conditions: sessionConditions(entry.session),
    });
  }
  uses.sort((a, b) => b.data.summary.date.localeCompare(a.data.summary.date));
  const dry = uses.filter((u) => u.conditions === "dry");
  const wet = uses.filter((u) => u.conditions === "wet");
  return {
    dry: dry.length > 0 ? buildConditionSetups(dry) : null,
    wet: wet.length > 0 ? buildConditionSetups(wet) : null,
  };
}

/** `uses` newest first, all in one condition. */
function buildConditionSetups(uses: TrackSetupUse[]): ConditionSetups {
  const quali = uses.filter((u) => u.kind === "qualifying");
  const race = uses.filter((u) => u.kind === "race" || u.kind === "long-run");
  const fastest = (list: TrackSetupUse[]) =>
    list.reduce<TrackSetupUse | null>(
      (best, u) => (!best || u.data.bestLapMs < best.data.bestLapMs ? u : best),
      null,
    );
  const fastestRace = fastest(race);

  const groups = new Map<string, TrackSetupGroup>();
  for (const use of uses) {
    const key = setupIdentity(use.setup);
    const group = groups.get(key);
    if (!group) {
      groups.set(key, {
        key,
        latest: use,
        best: use,
        kinds: [use.kind],
        sessionCount: 1,
      });
      continue;
    }
    group.sessionCount += 1;
    if (!group.kinds.includes(use.kind)) group.kinds.push(use.kind);
    if (use.data.bestLapMs < group.best.data.bestLapMs) group.best = use;
  }

  return {
    qualiFastest: fastest(quali),
    qualiLatest: quali[0] ?? null,
    race: race[0] ?? null,
    raceIsFastest:
      race[0] != null &&
      fastestRace != null &&
      setupIdentity(race[0].setup) === setupIdentity(fastestRace.setup),
    history: [...groups.values()],
  };
}
