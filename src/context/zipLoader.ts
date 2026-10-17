import JSZip from "jszip";
import type { LapRecordingStore } from "../queries/lapRecordings";
import { deduplicateSessions } from "../utils/deduplicateSessions";
import type { SessionSummary, TelemetrySession } from "../types/telemetry";
import {
  buildRecordingPairing,
  openLapRecording,
  recordingPairKey,
} from "../utils/lapRecording/reader";
import type { RecordingPairing } from "../utils/lapRecording/types";
import { buildSessionSummary } from "../utils/sessionSummary";

export type LoadedSessionSummary = SessionSummary & { fileSize: number };

export interface LoadedRecordingFile {
  fileName: string;
  data: Uint8Array | Blob;
}

export interface LoadResult {
  sessions: LoadedSessionSummary[];
  sessionData: Map<string, TelemetrySession>;
  /**
   * Recording context from every parsed session JSON, including ones dedupe
   * hides: their recordings hold the only complete laps of restarted runs.
   */
  pairings: Map<string, RecordingPairing>;
  recordingFiles: LoadedRecordingFile[];
}

function addPairing(
  pairings: Map<string, RecordingPairing>,
  fileName: string,
  json: TelemetrySession,
) {
  pairings.set(
    recordingPairKey(fileName),
    buildRecordingPairing(fileName, json),
  );
}

/** Open uploaded `.pngt` files, pairing each with a session from the same load. */
export async function openLoadedRecordings(
  files: readonly LoadedRecordingFile[],
  pairings: ReadonlyMap<string, RecordingPairing>,
): Promise<LapRecordingStore> {
  const store: LapRecordingStore = new Map();
  for (const file of files) {
    try {
      const recording = await openLapRecording(file.data, {
        fileName: file.fileName,
        pairing: pairings.get(recordingPairKey(file.fileName)),
      });
      store.set(recording.manifest.slug, recording);
    } catch {
      // Skip recordings this viewer cannot read (partial writes, new formats)
    }
  }
  return store;
}

function sortByDateDesc(sessions: SessionSummary[]) {
  sessions.sort(
    (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime(),
  );
}

export async function loadZipFile(file: File): Promise<LoadResult> {
  const zip = await JSZip.loadAsync(file);

  const sessions: LoadedSessionSummary[] = [];
  const sessionData = new Map<string, TelemetrySession>();
  const pairings = new Map<string, RecordingPairing>();
  const recordingFiles: LoadedRecordingFile[] = [];

  const jsonEntries: [string, JSZip.JSZipObject][] = [];
  const recordingEntries: [string, JSZip.JSZipObject][] = [];
  zip.forEach((relativePath, entry) => {
    if (entry.dir) return;
    if (relativePath.endsWith(".json")) {
      jsonEntries.push([relativePath, entry]);
    } else if (relativePath.endsWith(".pngt")) {
      recordingEntries.push([relativePath, entry]);
    }
  });
  for (const [relativePath, entry] of recordingEntries) {
    recordingFiles.push({
      fileName: relativePath,
      data: await entry.async("uint8array"),
    });
  }

  for (const [relativePath, entry] of jsonEntries) {
    try {
      const text = await entry.async("text");
      const json = JSON.parse(text) as TelemetrySession;
      addPairing(pairings, relativePath, json);
      const { summary, valid } = buildSessionSummary(
        relativePath,
        json,
        new Blob([text]).size,
      );
      if (valid) {
        sessions.push(summary as LoadedSessionSummary);
        sessionData.set(summary.slug, json);
      }
    } catch {
      // Skip files that can't be parsed
    }
  }

  const deduplicated = deduplicateSessions(sessions);
  // Remove session data for deduplicated entries
  const keptSlugs = new Set(deduplicated.map((s) => s.slug));
  for (const s of sessions) {
    if (!keptSlugs.has(s.slug)) sessionData.delete(s.slug);
  }

  sortByDateDesc(deduplicated);
  return { sessions: deduplicated, sessionData, pairings, recordingFiles };
}

export async function loadJsonFiles(files: File[]): Promise<LoadResult> {
  const sessions: LoadedSessionSummary[] = [];
  const sessionData = new Map<string, TelemetrySession>();
  const pairings = new Map<string, RecordingPairing>();

  for (const file of files) {
    try {
      const text = await file.text();
      const json = JSON.parse(text) as TelemetrySession;
      addPairing(pairings, file.name, json);
      const { summary, valid } = buildSessionSummary(
        file.name,
        json,
        file.size,
      );
      if (valid) {
        sessions.push(summary as LoadedSessionSummary);
        sessionData.set(summary.slug, json);
      }
    } catch {
      // Skip files that can't be parsed
    }
  }

  const deduplicated = deduplicateSessions(sessions);
  const keptSlugs = new Set(deduplicated.map((s) => s.slug));
  for (const s of sessions) {
    if (!keptSlugs.has(s.slug)) sessionData.delete(s.slug);
  }

  sortByDateDesc(deduplicated);
  return { sessions: deduplicated, sessionData, pairings, recordingFiles: [] };
}
