import type { TrackSessionKind } from "./trackAnalysis";
import { isEligibleBestLap } from "../utils/lapRecording/reader";
import type {
  LapRecordingManifest,
  LapRecordingSummary,
} from "../utils/lapRecording/types";
import { trackTabForSessionType } from "../utils/routes";
import {
  getFormulaComparisonKey,
  isRaceSessionType,
} from "../utils/sessionTypes";
import { isSameTrack } from "../utils/tracks";

/**
 * Which laps the Lap Telemetry section shows, and the candidates it offers.
 *
 * Selection lives in `?laps=` as comma-separated `recordingSlug~driver~lap`
 * refs, A first, so entry points are plain links and a comparison survives a
 * reload. Without the param (or with only A) the comparison is filled in by
 * `defaultComparison`; `ref,solo` keeps A alone.
 */

/** A and B: tips, the map and the gap trace are all pairwise. */
export const MAX_SELECTED_LAPS = 2;
export const LAPS_QUERY_PARAM = "laps";
/**
 * Trails a lone lap the user left on its own. Entry-point links also carry
 * just A but want a default B, so a bare single ref cannot mean "no B".
 */
const SOLO_MARKER = "solo";
/** Element id the section mounts on, so entry-point links can scroll to it. */
export const LAP_TELEMETRY_ANCHOR = "lap-telemetry";

export interface LapRef {
  recordingSlug: string;
  driverIndex: number;
  lapNumber: number;
}

export function lapRefKey(ref: LapRef): string {
  return `${ref.recordingSlug}~${ref.driverIndex}~${ref.lapNumber}`;
}

export function sameLapRef(
  a: LapRef | undefined,
  b: LapRef | undefined,
): boolean {
  return !!a && !!b && lapRefKey(a) === lapRefKey(b);
}

export function parseLapRefs(param: string | null): LapRef[] {
  if (!param) return [];
  const refs: LapRef[] = [];
  for (const part of param.split(",")) {
    const fields = part.split("~");
    const [recordingSlug, driver, lap] = fields;
    if (
      fields.length !== 3 ||
      !/^[a-z0-9-]+$/.test(recordingSlug) ||
      !/^\d+$/.test(driver) ||
      !/^\d+$/.test(lap)
    ) {
      continue;
    }
    const driverIndex = Number(driver);
    const lapNumber = Number(lap);
    const ref = { recordingSlug, driverIndex, lapNumber };
    if (!refs.some((existing) => sameLapRef(existing, ref))) refs.push(ref);
  }
  return refs.slice(0, MAX_SELECTED_LAPS);
}

/** Whether the URL keeps lap A alone rather than asking for a default B. */
export function isSoloSelection(param: string | null): boolean {
  return !!param && param.split(",").includes(SOLO_MARKER);
}

/** A single ref is written as solo: the user removed B on purpose. */
export function serializeLapRefs(refs: readonly LapRef[]): string {
  const keys = refs.map(lapRefKey);
  return (keys.length === 1 ? [...keys, SOLO_MARKER] : keys).join(",");
}

/** A selectable lap: a driver's best per recording, or any lap of a loaded manifest. */
export interface LapCandidate {
  ref: LapRef;
  lapTimeMs: number;
  driverName: string;
  team?: string;
  isPlayer: boolean;
  compound?: string;
  recording: LapRecordingSummary;
  /** Fit to stand as a "best": valid, no pit, not a race's standing start. */
  eligible: boolean;
  valid: boolean;
  pitLap: boolean;
  standingStart: boolean;
}

/** Recordings in one comparison family: same circuit, formula scope and session kind. */
export interface LapFamily {
  track: string;
  formulaKey: string;
  kind: TrackSessionKind;
}

export function recordingFormulaKey(
  recording: Pick<LapRecordingSummary, "formula" | "gameYear">,
): string {
  return getFormulaComparisonKey(recording.formula, recording.gameYear);
}

export function familyOf(recording: LapRecordingSummary): LapFamily {
  return {
    track: recording.track,
    formulaKey: recordingFormulaKey(recording),
    kind: trackTabForSessionType(recording.sessionType),
  };
}

export function isInFamily(
  recording: LapRecordingSummary,
  family: Omit<LapFamily, "kind"> & { kind?: TrackSessionKind },
): boolean {
  return (
    isSameTrack(recording.track, family.track) &&
    recordingFormulaKey(recording) === family.formulaKey &&
    (family.kind === undefined ||
      trackTabForSessionType(recording.sessionType) === family.kind)
  );
}

/** Each driver's best eligible lap in every recording given. */
export function bestLapCandidates(
  recordings: readonly LapRecordingSummary[],
): LapCandidate[] {
  return recordings.flatMap((recording) =>
    recording.drivers.flatMap((driver) =>
      driver.best
        ? [
            {
              ref: {
                recordingSlug: recording.slug,
                driverIndex: driver.index,
                lapNumber: driver.best.lapNumber,
              },
              lapTimeMs: driver.best.lapTimeMs,
              driverName: driver.name,
              team: driver.team,
              isPlayer: driver.index === recording.playerIndex,
              compound: driver.best.compound,
              recording,
              eligible: true,
              valid: true,
              pitLap: false,
              standingStart: false,
            },
          ]
        : [],
    ),
  );
}

/** Every complete lap of one recording, from its full manifest. */
export function manifestCandidates(
  manifest: LapRecordingManifest,
  recording: LapRecordingSummary,
): LapCandidate[] {
  return manifest.drivers.flatMap((driver) =>
    driver.laps
      .filter((lap) => lap.complete && lap.lapTimeMs)
      .map((lap) => ({
        ref: {
          recordingSlug: manifest.slug,
          driverIndex: driver.index,
          lapNumber: lap.lapNumber,
        },
        lapTimeMs: lap.lapTimeMs!,
        driverName: driver.name,
        team: driver.team,
        isPlayer: driver.index === manifest.playerIndex,
        compound: lap.compound,
        recording,
        eligible: isEligibleBestLap(lap, manifest.sessionType),
        valid: lap.valid,
        pitLap: lap.pitInLap || lap.pitOutLap,
        standingStart:
          isRaceSessionType(manifest.sessionType) && lap.lapNumber === 1,
      })),
  );
}

/** Merge candidate lists, later entries winning (manifests carry more detail). */
export function mergeCandidates(
  ...lists: readonly (readonly LapCandidate[])[]
): LapCandidate[] {
  const byKey = new Map<string, LapCandidate>();
  for (const list of lists) {
    for (const candidate of list)
      byKey.set(lapRefKey(candidate.ref), candidate);
  }
  return [...byKey.values()];
}

function fastest(
  candidates: readonly LapCandidate[],
): LapCandidate | undefined {
  return candidates.reduce<LapCandidate | undefined>(
    (best, candidate) =>
      !best || candidate.lapTimeMs < best.lapTimeMs ? candidate : best,
    undefined,
  );
}

export type LapPresetId = "session-best" | "my-best" | "fastest-here";

export interface LapPreset {
  id: LapPresetId;
  label: string;
  candidate?: LapCandidate;
  /** Why the preset is disabled, e.g. lap A already is that lap. */
  reason?: string;
}

/**
 * One-click comparisons for slot B. A preset that resolves to lap A itself is
 * disabled with the reason rather than quietly picking the next-best lap.
 */
export function resolvePresets(
  a: LapRef,
  pool: readonly LapCandidate[],
): LapPreset[] {
  const eligible = pool.filter((candidate) => candidate.eligible);
  const resolve = (
    id: LapPresetId,
    label: string,
    candidates: readonly LapCandidate[],
    isA: string,
  ): LapPreset => {
    const best = fastest(candidates);
    if (!best) return { id, label, reason: "No complete lap qualifies" };
    return sameLapRef(best.ref, a)
      ? { id, label, reason: isA }
      : { id, label, candidate: best };
  };
  return [
    resolve(
      "session-best",
      "Session best",
      eligible.filter((c) => c.ref.recordingSlug === a.recordingSlug),
      "Lap A is the session best",
    ),
    resolve(
      "my-best",
      "My best here",
      eligible.filter((c) => c.isPlayer),
      "Lap A is your best here",
    ),
    resolve(
      "fastest-here",
      "Fastest by anyone here",
      eligible,
      "Lap A is the fastest here",
    ),
  ];
}

/** Lap A with zero clicks. */
export function defaultLapA(
  pool: readonly LapCandidate[],
  options: { recordingSlug?: string; driverIndex?: number },
): LapCandidate | undefined {
  const inRecording = options.recordingSlug
    ? pool.filter((c) => c.ref.recordingSlug === options.recordingSlug)
    : pool;
  // An invalidated or pit lap beats an empty section when it is all there is.
  const eligible = inRecording.filter((c) => c.eligible);
  const choices = eligible.length > 0 ? eligible : inRecording;
  if (options.driverIndex !== undefined) {
    const focused = fastest(
      choices.filter((c) => c.ref.driverIndex === options.driverIndex),
    );
    if (focused) return focused;
  }
  return fastest(choices.filter((c) => c.isPlayer)) ?? fastest(choices);
}

/**
 * The comparison for A when the URL names none: the selected rival's best,
 * else the fastest lap quicker than A, else the player's best from another
 * run, else the fastest lap by someone else.
 */
export function defaultComparison(
  a: LapCandidate,
  pool: readonly LapCandidate[],
  options: { rivalDriverIndex?: number | null } = {},
): LapCandidate | undefined {
  if (a.standingStart) {
    // A standing start only compares fairly with another standing start.
    const starts = pool.filter(
      (c) =>
        c.standingStart &&
        c.ref.recordingSlug === a.ref.recordingSlug &&
        !sameLapRef(c.ref, a.ref),
    );
    const start =
      fastest(
        starts.filter((c) => c.ref.driverIndex === options.rivalDriverIndex),
      ) ??
      fastest(starts.filter((c) => c.lapTimeMs < a.lapTimeMs)) ??
      fastest(starts);
    if (start) return start;
  }
  const others = pool.filter((c) => c.eligible && !sameLapRef(c.ref, a.ref));
  if (options.rivalDriverIndex != null) {
    const rival = fastest(
      others.filter(
        (c) =>
          c.ref.recordingSlug === a.ref.recordingSlug &&
          c.ref.driverIndex === options.rivalDriverIndex,
      ),
    );
    if (rival) return rival;
  }
  const quicker = fastest(others.filter((c) => c.lapTimeMs < a.lapTimeMs));
  if (quicker) return quicker;
  const ownOtherRun = fastest(
    others.filter(
      (c) =>
        c.isPlayer && a.isPlayer && c.ref.recordingSlug !== a.ref.recordingSlug,
    ),
  );
  return (
    ownOtherRun ??
    fastest(others.filter((c) => c.ref.driverIndex !== a.ref.driverIndex)) ??
    fastest(others)
  );
}
