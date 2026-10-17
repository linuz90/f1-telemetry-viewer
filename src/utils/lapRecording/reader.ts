import JSZip from "jszip";
import { isRaceSessionType } from "../sessionTypes";
import { parseFilename, toSlug } from "../parseFilename";
import { decodeLapNpz } from "./npz";
import {
  LAP_RECORDING_EXTENSION,
  LAP_RECORDING_FORMAT_VERSION,
  type LapChannel,
  type LapRecordingManifest,
  type LapRecordingSummary,
  type LapTrace,
  type RecordedDriver,
  type RecordedLap,
  type RecordingPairing,
} from "./types";

/**
 * Completeness tolerance. A lap counts as captured start to finish when its
 * first sample past the line, its last sample before the line, and every gap
 * between samples are within this distance. 285 of 339 laps the exporter
 * flagged `is_good` in the first beta corpus started mid-lap, so the flag is
 * never trusted.
 */
export const COMPLETE_LAP_TOLERANCE_M = 30;

export interface OpenedLapRecording {
  manifest: LapRecordingManifest;
  /** Raw `.npz` bytes for one lap, or undefined when the recording has no such lap. */
  readLapBytes(
    driverIndex: number,
    lapNumber: number,
  ): Promise<Uint8Array | undefined>;
}

function stripExtension(fileName: string): string {
  const base = fileName.split("/").pop() ?? fileName;
  return base.replace(/\.(pngt|json)$/i, "");
}

/** Slug for a recording, from its filename (same rule as session slugs). */
function lapRecordingSlug(fileName: string): string {
  return toSlug(stripExtension(fileName));
}

/**
 * Key pairing a recording with its session JSON. Pits n' Giggles names the
 * JSON `Race_Melbourne_Just_in_case_<date>.json` (or `_Manual_`) while the
 * recording beside it drops that token, so both sides normalize it away.
 */
export function recordingPairKey(fileName: string): string {
  return stripExtension(fileName)
    .replace(/_(?:just_in_case|manual)(?=_\d{4}_\d{2}_\d{2}_)/i, "")
    .toLowerCase();
}

function finitePositive(value: unknown): number | undefined {
  const number = typeof value === "string" ? Number(value) : value;
  return typeof number === "number" && Number.isFinite(number) && number > 0
    ? number
    : undefined;
}

interface PairableSession {
  "session-info"?: {
    "track-length"?: unknown;
    "sector-2-lap-distance-start"?: unknown;
    "sector-3-lap-distance-start"?: unknown;
    weather?: unknown;
  };
  "classification-data"?: { index: number; "is-player"?: boolean }[];
}

/** Context the recording lacks, read from the paired session JSON. */
export function buildRecordingPairing(
  sessionFileName: string,
  session: PairableSession,
): RecordingPairing {
  const info = session["session-info"] ?? {};
  // Beta exports write sector starts as strings and older ones as 0.0.
  const sector2 = finitePositive(info["sector-2-lap-distance-start"]);
  const sector3 = finitePositive(info["sector-3-lap-distance-start"]);
  return {
    sessionSlug: toSlug(stripExtension(sessionFileName)),
    playerIndex: session["classification-data"]?.find((d) => d["is-player"])
      ?.index,
    trackLengthM: finitePositive(info["track-length"]),
    sectorStartsM:
      sector2 && sector3 && sector3 > sector2 ? [sector2, sector3] : undefined,
    weather: typeof info.weather === "string" ? info.weather : undefined,
  };
}

interface RawLap {
  lap_number?: unknown;
  lap_time_ms?: unknown;
  valid?: unknown;
  tyre_compound?: unknown;
  tyre_laps?: unknown;
  pit_in_lap?: unknown;
  pit_out_lap?: unknown;
  num_points?: unknown;
}

interface DistanceCoverage {
  sampleCount: number;
  startDistanceM: number | null;
  endDistanceM: number | null;
  maxGapM: number | null;
}

function measureCoverage(distance: Float32Array | undefined): DistanceCoverage {
  if (!distance) {
    return {
      sampleCount: 0,
      startDistanceM: null,
      endDistanceM: null,
      maxGapM: null,
    };
  }
  // Samples before the line carry negative distance; only the lap itself counts.
  let start: number | null = null;
  let end: number | null = null;
  let maxGap = 0;
  let previous: number | null = null;
  for (const value of distance) {
    if (!Number.isFinite(value) || value < 0) continue;
    if (start === null) start = value;
    if (previous !== null && value > previous) {
      maxGap = Math.max(maxGap, value - previous);
    }
    if (previous === null || value > previous) previous = value;
    end = end === null ? value : Math.max(end, value);
  }
  return {
    sampleCount: distance.length,
    startDistanceM: start,
    endDistanceM: end,
    maxGapM: start === null ? null : maxGap,
  };
}

function roundedMetres(value: number): number {
  return Math.max(10, Math.round(value / 10) * 10);
}

/** Viewer-owned completeness rule; see COMPLETE_LAP_TOLERANCE_M. */
export function judgeLapCoverage(
  lapTimeMs: number | null,
  coverage: DistanceCoverage,
  trackLengthM: number,
): { complete: boolean; incompleteReason?: string } {
  if (!lapTimeMs || lapTimeMs <= 0) {
    return { complete: false, incompleteReason: "no lap time" };
  }
  const { startDistanceM: start, endDistanceM: end, maxGapM: gap } = coverage;
  if (start === null || end === null || gap === null) {
    return { complete: false, incompleteReason: "not recorded past the line" };
  }
  const late = start > COMPLETE_LAP_TOLERANCE_M;
  const early = end < trackLengthM - COMPLETE_LAP_TOLERANCE_M;
  if (late && !early) {
    return {
      complete: false,
      incompleteReason: `last ${roundedMetres(trackLengthM - start)} m only`,
    };
  }
  if (early && !late) {
    return {
      complete: false,
      incompleteReason: `first ${roundedMetres(end)} m only`,
    };
  }
  if (late && early) {
    return {
      complete: false,
      incompleteReason: `${roundedMetres(end - start)} m mid-lap only`,
    };
  }
  if (gap > COMPLETE_LAP_TOLERANCE_M) {
    return {
      complete: false,
      incompleteReason: `${roundedMetres(gap)} m gap in the trace`,
    };
  }
  return { complete: true };
}

/** Laps fit to stand as someone's "best": complete, valid, no pit, no standing start. */
export function isEligibleBestLap(
  lap: RecordedLap,
  sessionType: string,
): lap is RecordedLap & { lapTimeMs: number } {
  return (
    lap.complete &&
    lap.valid &&
    lap.lapTimeMs != null &&
    lap.lapTimeMs > 0 &&
    !lap.pitInLap &&
    !lap.pitOutLap &&
    !(isRaceSessionType(sessionType) && lap.lapNumber === 1)
  );
}

function lapEntryPath(folder: string, lapNumber: number): string {
  return `drivers/${folder}/lap_${String(lapNumber).padStart(3, "0")}.npz`;
}

async function readJson<T>(zip: JSZip, path: string): Promise<T> {
  const entry = zip.file(path);
  if (!entry) throw new Error(`Recording is missing ${path}`);
  return JSON.parse(await entry.async("text")) as T;
}

/** An opened `.pngt` that can read single laps. */
export interface LapArchive {
  zip: JSZip;
  /** Driver index -> folder name under `drivers/`. */
  folders: Map<number, string>;
  readLapBytes(
    driverIndex: number,
    lapNumber: number,
  ): Promise<Uint8Array | undefined>;
}

/**
 * Open a `.pngt` for lap reads only: header check and folder map, no manifest
 * scan. Serving one lap does not need every other lap's distance trace.
 */
export async function openLapArchive(
  data: Uint8Array | ArrayBuffer | Blob,
): Promise<LapArchive> {
  const zip = await JSZip.loadAsync(data);
  const header = await readJson<{ format?: unknown; version?: unknown }>(
    zip,
    "header.json",
  );
  if (
    header.format !== "pngt" ||
    header.version !== LAP_RECORDING_FORMAT_VERSION
  ) {
    throw new Error(
      `Unsupported lap recording format ${String(header.format)} v${String(header.version)}; this viewer reads pngt v${LAP_RECORDING_FORMAT_VERSION}`,
    );
  }
  const folders = new Map<number, string>();
  zip.forEach((path) => {
    const match = path.match(/^drivers\/(\d+)\/laps\.json$/);
    if (match) folders.set(Number(match[1]), match[1]);
  });
  return {
    zip,
    folders,
    async readLapBytes(driverIndex, lapNumber) {
      const folder = folders.get(driverIndex);
      const entry = folder ? zip.file(lapEntryPath(folder, lapNumber)) : null;
      return entry ? entry.async("uint8array") : undefined;
    },
  };
}

/**
 * Open a `.pngt` and build its manifest: session metadata, drivers, and every
 * lap with its distance coverage. Decodes only `lap_distance` per lap.
 */
export async function openLapRecording(
  data: Uint8Array | ArrayBuffer | Blob,
  options: { fileName: string; pairing?: RecordingPairing },
): Promise<OpenedLapRecording> {
  const archive = await openLapArchive(data);
  const { zip, folders } = archive;

  const sessionText = await zip.file("session.json")?.async("text");
  if (!sessionText) throw new Error("Recording is missing session.json");
  const session = JSON.parse(sessionText) as {
    session_type?: unknown;
    session_name?: unknown;
    app_version?: unknown;
    game_year?: unknown;
    formula?: unknown;
    track?: { name?: unknown };
  };
  // JSON.parse would round the 64-bit UID, so lift it from the raw text.
  const sessionUid = sessionText.match(/"session_uid"\s*:\s*"?(\d+)/)?.[1];
  const { drivers: rawDrivers = [] } = await readJson<{
    drivers?: {
      driver_index?: unknown;
      name?: unknown;
      team?: unknown;
      car_number?: unknown;
    }[];
  }>(zip, "drivers.json");

  const parsedDrivers = await Promise.all(
    rawDrivers.map(async (raw) => {
      const index = Number(raw.driver_index);
      const folder = folders.get(index);
      if (!Number.isInteger(index) || !folder) return null;
      const { laps: rawLaps = [] } = await readJson<{ laps?: RawLap[] }>(
        zip,
        `drivers/${folder}/laps.json`,
      );
      const laps = await Promise.all(
        rawLaps.map(async (lap) => {
          const lapNumber = Number(lap.lap_number);
          const entry = Number.isInteger(lapNumber)
            ? zip.file(lapEntryPath(folder, lapNumber))
            : null;
          const trace = entry
            ? await decodeLapNpz(await entry.async("uint8array"), [
                "lap_distance",
              ])
            : undefined;
          const lapTimeMs = finitePositive(lap.lap_time_ms) ?? null;
          return {
            lapNumber,
            lapTimeMs,
            // Beta files write `valid` as 1 / false.
            valid: lap.valid === true || lap.valid === 1,
            compound:
              typeof lap.tyre_compound === "string"
                ? lap.tyre_compound
                : undefined,
            tyreAgeLaps:
              typeof lap.tyre_laps === "number" ? lap.tyre_laps : undefined,
            pitInLap: lap.pit_in_lap === true,
            pitOutLap: lap.pit_out_lap === true,
            coverage: measureCoverage(trace?.lap_distance),
          };
        }),
      );
      return {
        index,
        name: typeof raw.name === "string" ? raw.name : `Car ${index}`,
        team: typeof raw.team === "string" ? raw.team : undefined,
        carNumber:
          typeof raw.car_number === "number" ? raw.car_number : undefined,
        laps: laps.filter((lap) => Number.isInteger(lap.lapNumber)),
      };
    }),
  );

  const pairing = options.pairing;
  // Without the paired JSON, the longest timed lap is the best length estimate.
  const recordedLength = Math.max(
    0,
    ...parsedDrivers.flatMap((driver) =>
      (driver?.laps ?? [])
        .filter((lap) => lap.lapTimeMs)
        .map((lap) => lap.coverage.endDistanceM ?? 0),
    ),
  );
  const trackLengthM = pairing?.trackLengthM ?? recordedLength;

  const drivers: RecordedDriver[] = parsedDrivers
    .filter((driver): driver is NonNullable<typeof driver> => driver !== null)
    .map((driver) => ({
      index: driver.index,
      name: driver.name,
      team: driver.team,
      carNumber: driver.carNumber,
      laps: driver.laps
        .map(
          ({ coverage, ...lap }): RecordedLap => ({
            ...lap,
            ...coverage,
            ...judgeLapCoverage(lap.lapTimeMs, coverage, trackLengthM),
          }),
        )
        .sort((a, b) => a.lapNumber - b.lapNumber),
    }))
    .sort((a, b) => a.index - b.index);

  const parsedName = parseFilename(stripExtension(options.fileName));
  const sessionType =
    typeof session.session_type === "string"
      ? session.session_type
      : parsedName.sessionType;
  const manifest: LapRecordingManifest = {
    slug: lapRecordingSlug(options.fileName),
    fileName: `${stripExtension(options.fileName)}${LAP_RECORDING_EXTENSION}`,
    sessionUid,
    sessionType,
    track:
      typeof session.track?.name === "string"
        ? session.track.name
        : parsedName.track,
    formula: typeof session.formula === "string" ? session.formula : undefined,
    gameYear:
      typeof session.game_year === "number" ? session.game_year : undefined,
    appVersion:
      typeof session.app_version === "string" ? session.app_version : undefined,
    date: parsedName.date,
    trackLengthM,
    sessionSlug: pairing?.sessionSlug,
    playerIndex: pairing?.playerIndex,
    sectorStartsM: pairing?.sectorStartsM,
    weather: pairing?.weather,
    drivers,
  };

  return { manifest, readLapBytes: archive.readLapBytes };
}

/**
 * Every channel the viewer reads. Others are skipped, so a channel the beta
 * adds in a dtype the decoder lacks cannot make every lap unviewable.
 */
const LAP_CHANNELS: readonly LapChannel[] = [
  "lap_distance",
  "lap_time_ms",
  "speed",
  "throttle",
  "brake",
  "steering",
  "gear",
  "engine_rpm",
  "ers.deploy_mode",
  "ers.store_energy_j",
  "ers.store_energy",
  "tyre_wear.fl",
  "tyre_wear.fr",
  "tyre_wear.rl",
  "tyre_wear.rr",
];

/** Decode one lap's traces from the bytes served by the API or held in memory. */
export function parseLapTrace(bytes: Uint8Array): Promise<LapTrace> {
  return decodeLapNpz(bytes, LAP_CHANNELS);
}

/** Compact per-recording row: each driver's best lap plus any faster partial one. */
export function summarizeLapRecording(
  manifest: LapRecordingManifest,
): LapRecordingSummary {
  let completeLapCount = 0;
  const drivers = manifest.drivers.map((driver) => {
    let best: RecordedLap | undefined;
    let fastestIncomplete: RecordedLap | undefined;
    for (const lap of driver.laps) {
      if (lap.complete) completeLapCount += 1;
      if (isEligibleBestLap(lap, manifest.sessionType)) {
        if (!best || lap.lapTimeMs < (best.lapTimeMs ?? Infinity)) best = lap;
      } else if (
        !lap.complete &&
        lap.valid &&
        lap.lapTimeMs &&
        lap.lapTimeMs < (fastestIncomplete?.lapTimeMs ?? Infinity)
      ) {
        fastestIncomplete = lap;
      }
    }
    const fasterIncomplete =
      fastestIncomplete?.lapTimeMs &&
      fastestIncomplete.lapTimeMs < (best?.lapTimeMs ?? Infinity)
        ? {
            lapNumber: fastestIncomplete.lapNumber,
            lapTimeMs: fastestIncomplete.lapTimeMs,
            compound: fastestIncomplete.compound,
            reason: fastestIncomplete.incompleteReason ?? "partial trace",
          }
        : undefined;
    return {
      index: driver.index,
      name: driver.name,
      team: driver.team,
      best: best?.lapTimeMs
        ? {
            lapNumber: best.lapNumber,
            lapTimeMs: best.lapTimeMs,
            compound: best.compound,
          }
        : undefined,
      fasterIncomplete,
    };
  });

  return {
    slug: manifest.slug,
    sessionSlug: manifest.sessionSlug,
    sessionType: manifest.sessionType,
    track: manifest.track,
    formula: manifest.formula,
    gameYear: manifest.gameYear,
    date: manifest.date,
    trackLengthM: manifest.trackLengthM,
    playerIndex: manifest.playerIndex,
    completeLapCount,
    drivers,
  };
}
