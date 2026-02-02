import JSZip from "jszip";
import { parseFilename, toSlug } from "../utils/parseFilename";
import type { SessionSummary, TelemetrySession } from "../types/telemetry";

export interface ZipLoadResult {
  sessions: SessionSummary[];
  sessionData: Map<string, TelemetrySession>;
}

export async function loadZipFile(file: File): Promise<ZipLoadResult> {
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
      const parsed = parseFilename(relativePath);
      const slug = toSlug(relativePath);

      // Compute summary metadata — same logic as the Vite plugin
      let validLapCount = 0;
      let lapIndicators: ("valid" | "invalid" | "best")[] | undefined;
      let bestLapTime: string | undefined;
      let bestLapTimeMs: number | undefined;
      let aiDifficulty: number | undefined;

      const sessionInfo = json["session-info"];
      const isOnline = sessionInfo?.["network-game"] === 1;
      aiDifficulty = isOnline ? 0 : (sessionInfo?.["ai-difficulty"] ?? 0);

      const player = json["classification-data"]?.find(
        (d) => d["is-player"],
      );
      if (player) {
        const laps = player["session-history"]?.["lap-history-data"] ?? [];
        validLapCount = laps.filter((l) => l["lap-time-in-ms"] > 0).length;

        const isQuali =
          parsed.sessionType === "Short Qualifying" ||
          parsed.sessionType === "One Shot Qualifying";
        if (isQuali) {
          const bestLapNum =
            player["session-history"]?.["best-lap-time-lap-num"] ?? -1;
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

      if (validLapCount > 0) {
        sessions.push({
          relativePath,
          slug,
          ...parsed,
          validLapCount,
          lapIndicators,
          bestLapTime,
          bestLapTimeMs,
          aiDifficulty,
        });
        sessionData.set(slug, json);
      }
    } catch {
      // Skip files that can't be parsed
    }
  }

  // Sort by date descending
  sessions.sort(
    (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime(),
  );

  return { sessions, sessionData };
}
