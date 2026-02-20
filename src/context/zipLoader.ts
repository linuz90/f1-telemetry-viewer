import JSZip from "jszip";
import { parseFilename, toSlug } from "../utils/parseFilename";
import type { SessionSummary, TelemetrySession } from "../types/telemetry";

export interface LoadResult {
  sessions: SessionSummary[];
  sessionData: Map<string, TelemetrySession>;
}

/** Build a SessionSummary from a parsed telemetry JSON and its filename. */
function buildSummary(
  relativePath: string,
  json: TelemetrySession,
): { summary: SessionSummary; valid: boolean } {
  const parsed = parseFilename(relativePath);
  const slug = toSlug(relativePath);

  let validLapCount = 0;
  let lapIndicators: ("valid" | "invalid" | "best")[] | undefined;
  let bestLapTime: string | undefined;
  let bestLapTimeMs: number | undefined;
  let aiDifficulty: number | undefined;
  let isSpectator = false;

  const sessionInfo = json["session-info"];
  const isOnline = sessionInfo?.["network-game"] === 1;
  aiDifficulty = isOnline ? 0 : (sessionInfo?.["ai-difficulty"] ?? 0);

  let focusDriver = json["classification-data"]?.find(
    (d) => d["is-player"],
  );

  // Spectator fallback: no player → pick driver with most valid laps
  if (!focusDriver) {
    isSpectator = true;
    const drivers = json["classification-data"] ?? [];
    let maxLaps = 0;
    for (const d of drivers) {
      const count = (d["session-history"]?.["lap-history-data"] ?? [])
        .filter((l) => l["lap-time-in-ms"] > 0).length;
      if (count > maxLaps) {
        maxLaps = count;
        focusDriver = d;
      }
    }
  }

  if (focusDriver) {
    const laps = focusDriver["session-history"]?.["lap-history-data"] ?? [];
    validLapCount = laps.filter((l) => l["lap-time-in-ms"] > 0).length;

    const isQuali =
      parsed.sessionType === "Short Qualifying" ||
      parsed.sessionType === "One Shot Qualifying";
    if (isQuali) {
      const bestLapNum =
        focusDriver["session-history"]?.["best-lap-time-lap-num"] ?? -1;
      lapIndicators = laps
        .filter((l) => l["lap-time-in-ms"] > 0)
        .map((l, i) => {
          const lapNum = i + 1;
          if (lapNum === bestLapNum) return "best" as const;
          return l["lap-valid-bit-flags"] === 15
            ? ("valid" as const)
            : ("invalid" as const);
        });

      if (bestLapNum > 0) {
        const bestLap = laps[bestLapNum - 1];
        if (bestLap?.["lap-time-str"]) {
          bestLapTime = bestLap["lap-time-str"];
          bestLapTimeMs = bestLap["lap-time-in-ms"];
        }
      }
    }
  }

  return {
    summary: {
      relativePath,
      slug,
      ...parsed,
      validLapCount,
      lapIndicators,
      bestLapTime,
      bestLapTimeMs,
      aiDifficulty,
      isSpectator,
    },
    valid: validLapCount > 0,
  };
}

function sortByDateDesc(sessions: SessionSummary[]) {
  sessions.sort(
    (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime(),
  );
}

export async function loadZipFile(file: File): Promise<LoadResult> {
  const zip = await JSZip.loadAsync(file);

  const sessions: SessionSummary[] = [];
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
      const { summary, valid } = buildSummary(relativePath, json);
      if (valid) {
        sessions.push(summary);
        sessionData.set(summary.slug, json);
      }
    } catch {
      // Skip files that can't be parsed
    }
  }

  sortByDateDesc(sessions);
  return { sessions, sessionData };
}

export async function loadJsonFiles(files: File[]): Promise<LoadResult> {
  const sessions: SessionSummary[] = [];
  const sessionData = new Map<string, TelemetrySession>();

  for (const file of files) {
    try {
      const text = await file.text();
      const json = JSON.parse(text) as TelemetrySession;
      const { summary, valid } = buildSummary(file.name, json);
      if (valid) {
        sessions.push(summary);
        sessionData.set(summary.slug, json);
      }
    } catch {
      // Skip files that can't be parsed
    }
  }

  sortByDateDesc(sessions);
  return { sessions, sessionData };
}
