import JSZip from "jszip";
import { deduplicateSessions } from "../utils/deduplicateSessions";
import type { SessionSummary, TelemetrySession } from "../types/telemetry";
import { buildSessionSummary } from "../utils/sessionSummary";

export type LoadedSessionSummary = SessionSummary & { fileSize: number };

export interface LoadResult {
  sessions: LoadedSessionSummary[];
  sessionData: Map<string, TelemetrySession>;
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

  const jsonEntries: [string, JSZip.JSZipObject][] = [];
  zip.forEach((relativePath, entry) => {
    if (!entry.dir && relativePath.endsWith(".json")) {
      jsonEntries.push([relativePath, entry]);
    }
  });

  for (const [relativePath, entry] of jsonEntries) {
    try {
      const text = await entry.async("text");
      const json = JSON.parse(text) as TelemetrySession;
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
  return { sessions: deduplicated, sessionData };
}

export async function loadJsonFiles(files: File[]): Promise<LoadResult> {
  const sessions: LoadedSessionSummary[] = [];
  const sessionData = new Map<string, TelemetrySession>();

  for (const file of files) {
    try {
      const text = await file.text();
      const json = JSON.parse(text) as TelemetrySession;
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
  return { sessions: deduplicated, sessionData };
}
