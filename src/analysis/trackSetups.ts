import type { CarSetup } from "../types/telemetry";
import { findPlayer } from "../utils/stats/drivers";
import { summaryKind, type SessionKind } from "./sessionKind";
import type { TrackSessionData } from "./trackAnalysis";

/**
 * A track's setups as a driver uses them: the quali setup (fastest or latest),
 * the race setup, and every setup run here. Identity ignores brake bias, which
 * drivers change from the wheel mid-session (Sakhir had 41 exact setups, 25 once
 * bias is ignored), and fuel, a race-plan variable. Sessions without a complete
 * valid lap are left out, which also drops the placeholder default setup the
 * game exports for quali saves that never ran (wings 25-25, diff 60-50).
 */

const IDENTITY_KEYS: (keyof CarSetup)[] = [
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
  return IDENTITY_KEYS.map((key) => Number(setup[key]).toFixed(2)).join("|");
}

export interface TrackSetupUse {
  setup: CarSetup;
  data: TrackSessionData;
  kind: SessionKind;
}

export interface TrackSetupGroup {
  key: string;
  /** The most recent session's exact setup (its brake bias included). */
  setup: CarSetup;
  lastDate: string;
  kinds: SessionKind[];
  sessionCount: number;
  bestLapMs: number;
  bestKind: SessionKind;
}

export interface TrackSetups {
  qualiFastest: TrackSetupUse | null;
  qualiLatest: TrackSetupUse | null;
  race: TrackSetupUse | null;
  /** True when the latest race setup also set the fastest race lap here. */
  raceIsFastest: boolean;
  history: TrackSetupGroup[];
}

export function buildTrackSetups(
  data: readonly TrackSessionData[],
): TrackSetups {
  const uses: TrackSetupUse[] = [];
  for (const entry of data) {
    const player = findPlayer(entry.session);
    const setup = player?.["car-setup"];
    if (!setup?.["is-valid"] || entry.bestLapMs <= 0) continue;
    uses.push({ setup, data: entry, kind: summaryKind(entry.summary) });
  }
  uses.sort((a, b) => b.data.summary.date.localeCompare(a.data.summary.date));

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
        setup: use.setup,
        lastDate: use.data.summary.date,
        kinds: [use.kind],
        sessionCount: 1,
        bestLapMs: use.data.bestLapMs,
        bestKind: use.kind,
      });
      continue;
    }
    group.sessionCount += 1;
    if (!group.kinds.includes(use.kind)) group.kinds.push(use.kind);
    if (use.data.bestLapMs < group.bestLapMs) {
      group.bestLapMs = use.data.bestLapMs;
      group.bestKind = use.kind;
    }
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
