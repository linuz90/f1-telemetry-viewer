/**
 * Shapes for Pits n' Giggles lap recordings (`.pngt`, format version 1).
 *
 * A recording is a zip beside the session JSON with distance-based traces for
 * every car's laps. These types are shared by the Node index, the API routes
 * and the browser (upload mode), so both apply the same completeness rules.
 */

export const LAP_RECORDING_FORMAT_VERSION = 1;
export const LAP_RECORDING_EXTENSION = ".pngt";

/** Channel names as stored in each lap's `.npz` (file name minus `.npy`). */
export type LapChannel =
  | "lap_distance"
  | "lap_time_ms"
  | "speed"
  | "throttle"
  | "brake"
  | "steering"
  | "gear"
  | "engine_rpm"
  | "ers.deploy_mode"
  | "ers.store_energy_j"
  | "ers.store_energy"
  | "tyre_wear.fl"
  | "tyre_wear.fr"
  | "tyre_wear.rl"
  | "tyre_wear.rr";

/** Raw per-sample arrays of one lap, keyed by channel (`LapChannel`s only). */
export type LapTrace = Readonly<Record<string, Float32Array | undefined>>;

export interface RecordedLap {
  lapNumber: number;
  /** Official lap time; null for untimed laps. */
  lapTimeMs: number | null;
  valid: boolean;
  compound?: string;
  /** Tyre age in laps at the start of this lap, as exported. */
  tyreAgeLaps?: number;
  pitInLap: boolean;
  pitOutLap: boolean;
  sampleCount: number;
  /** First sample at or past the start line (m); null when nothing was recorded past it. */
  startDistanceM: number | null;
  endDistanceM: number | null;
  /** Largest distance between consecutive samples past the line (m). */
  maxGapM: number | null;
  /** Viewer-owned completeness verdict. Never derived from the exporter's `is_good`. */
  complete: boolean;
  /** Short reader-facing reason when not complete, e.g. "last 570 m only". */
  incompleteReason?: string;
}

export interface RecordedDriver {
  index: number;
  name: string;
  team?: string;
  carNumber?: number;
  laps: RecordedLap[];
}

/** Context taken from the paired session JSON (same base filename). */
export interface RecordingPairing {
  sessionSlug: string;
  playerIndex?: number;
  trackLengthM?: number;
  /** Lap distances where sectors 2 and 3 start. */
  sectorStartsM?: [number, number];
  weather?: string;
}

export interface LapRecordingManifest {
  slug: string;
  fileName: string;
  /** Kept as a string: the exporter writes a 64-bit integer. */
  sessionUid?: string;
  sessionType: string;
  track: string;
  formula?: string;
  gameYear?: number;
  appVersion?: string;
  /** Local session start, parsed from the filename like session dates. */
  date: string;
  trackLengthM: number;
  sessionSlug?: string;
  playerIndex?: number;
  sectorStartsM?: [number, number];
  weather?: string;
  drivers: RecordedDriver[];
}

export interface RecordedLapSummary {
  lapNumber: number;
  lapTimeMs: number;
  compound?: string;
}

/** One row per recording for `GET /api/lap-recordings`. */
export interface LapRecordingSummary {
  slug: string;
  sessionSlug?: string;
  sessionType: string;
  track: string;
  formula?: string;
  gameYear?: number;
  date: string;
  trackLengthM: number;
  playerIndex?: number;
  completeLapCount: number;
  drivers: {
    index: number;
    name: string;
    team?: string;
    /** Fastest lap eligible as a "best" (complete, valid, no pit, no race lap 1). */
    best?: RecordedLapSummary;
    /** A faster timed lap the recording did not capture whole, for honest pickers. */
    fasterIncomplete?: RecordedLapSummary & { reason: string };
  }[];
}
