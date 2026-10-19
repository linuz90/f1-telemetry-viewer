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
  /** Driven by the friend whose file was imported. */
  isFriend: boolean;
  compound?: string;
  recording: LapRecordingSummary;
  /** Fit to stand as a "best": valid, no pit, not a race's standing start. */
  eligible: boolean;
  valid: boolean;
  pitLap: boolean;
  standingStart: boolean;
}

/**
 * Identifies a lap across recordings. A session saved twice (a Manual save,
 * then Just_in_case) writes a second recording with the same laps, and
 * comparing a lap with its own copy says nothing.
 */
export function lapIdentity(candidate: LapCandidate): string {
  return `${candidate.recording.track}|${candidate.recording.sessionType}|${candidate.driverName}|${candidate.ref.lapNumber}|${candidate.lapTimeMs}`;
}

function isSameLap(a: LapCandidate, b: LapCandidate): boolean {
  return sameLapRef(a.ref, b.ref) || lapIdentity(a) === lapIdentity(b);
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
              isFriend: driver.index === recording.friendIndex,
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
        isFriend: driver.index === manifest.friendIndex,
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
  /** Why the preset is disabled, short enough to sit beside its label. */
  reason?: string;
}

/**
 * One-click comparisons for slot B. A preset that resolves to lap A itself is
 * disabled with the reason rather than quietly picking the next-best lap.
 */
export function resolvePresets(
  a: LapCandidate,
  pool: readonly LapCandidate[],
): LapPreset[] {
  const eligible = pool.filter((candidate) => candidate.eligible);
  const resolve = (
    id: LapPresetId,
    label: string,
    candidates: readonly LapCandidate[],
    none: string,
  ): LapPreset => {
    const best = fastest(candidates);
    if (!best) return { id, label, reason: none };
    return isSameLap(best, a)
      ? { id, label, reason: "already lap A" }
      : { id, label, candidate: best };
  };
  return [
    resolve(
      "session-best",
      "Session best",
      eligible.filter((c) => c.ref.recordingSlug === a.ref.recordingSlug),
      "none in lap A's session",
    ),
    resolve(
      "my-best",
      "My best here",
      eligible.filter((c) => c.isPlayer),
      "none of yours yet",
    ),
    resolve("fastest-here", "Fastest by anyone here", eligible, "none yet"),
  ];
}

/**
 * Laps to open after importing a file: the user's best at the circuit (same
 * session kind first) as A against the owner's best in the file. The user's
 * own file opens alone, so the default comparison fills B.
 */
export function importedLapRefs(
  imported: LapRecordingSummary,
  ownerIndex: number,
  recordings: readonly LapRecordingSummary[],
): LapRef[] {
  const best = imported.drivers.find((d) => d.index === ownerIndex)?.best;
  const theirs = best && {
    recordingSlug: imported.slug,
    driverIndex: ownerIndex,
    lapNumber: best.lapNumber,
  };
  if (imported.playerIndex === ownerIndex) return theirs ? [theirs] : [];
  const family = familyOf(imported);
  const mine = bestLapCandidates(
    recordings.filter(
      (recording) =>
        recording.slug !== imported.slug &&
        isInFamily(recording, {
          track: family.track,
          formulaKey: family.formulaKey,
        }),
    ),
  ).filter((candidate) => candidate.isPlayer);
  const a =
    fastest(
      mine.filter(
        (candidate) =>
          trackTabForSessionType(candidate.recording.sessionType) ===
          family.kind,
      ),
    ) ?? fastest(mine);
  return [a?.ref, theirs].filter((ref): ref is LapRef => !!ref);
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
        !isSameLap(c, a),
    );
    const start =
      fastest(
        starts.filter((c) => c.ref.driverIndex === options.rivalDriverIndex),
      ) ??
      fastest(starts.filter((c) => c.lapTimeMs < a.lapTimeMs)) ??
      fastest(starts);
    if (start) return start;
  }
  const others = pool.filter((c) => c.eligible && !isSameLap(c, a));
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
