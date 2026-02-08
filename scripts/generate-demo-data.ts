/**
 * Generates trimmed demo telemetry files from real session data.
 * Keeps the player + top 5 other drivers to reduce file size.
 *
 * Usage: npx tsx scripts/generate-demo-data.ts
 *
 * Source files are hardcoded below — update paths if the originals move.
 */

import fs from "fs";
import path from "path";
import { parseFilename, toSlug } from "../src/utils/parseFilename.ts";

const TELEMETRY_DIR =
  "/Users/linuz90/Library/CloudStorage/OneDrive-Personal/Pits & Giggles/data";

const SOURCES = [
  // Race at Spa — full 20-driver race, ~3.1MB → trimmed
  "2026_01_26/race-info/Race_Spa_2026_01_26_22_14_52.json",
  // Short Qualifying at Zandvoort — ~597KB → trimmed
  "2026_02_07/race-info/Short_Qualifying_Zandvoort_2026_02_07_11_33_48.json",
];

const KEEP_DRIVERS = 6; // player + 5 others
const OUT_DIR = path.resolve(import.meta.dirname, "../public/demo");

interface DriverEntry {
  index: number;
  "is-player": boolean;
  "driver-name": string;
  "track-position": number;
  "final-classification": { position: number } | null;
  "session-history": {
    "lap-history-data": { "lap-time-in-ms": number; "lap-valid-bit-flags": number }[];
    "best-lap-time-lap-num": number;
  };
  [key: string]: unknown;
}

function pickDrivers(classificationData: DriverEntry[]): Set<string> {
  const player = classificationData.find((d) => d["is-player"]);
  const names = new Set<string>();

  if (player) names.add(player["driver-name"]);

  // Sort remaining by final position (race) or track position (quali)
  const others = classificationData
    .filter((d) => !d["is-player"])
    .sort((a, b) => {
      const posA = a["final-classification"]?.position ?? a["track-position"] ?? 99;
      const posB = b["final-classification"]?.position ?? b["track-position"] ?? 99;
      return posA - posB;
    });

  for (const d of others) {
    if (names.size >= KEEP_DRIVERS) break;
    names.add(d["driver-name"]);
  }

  return names;
}

function trimSession(raw: Record<string, unknown>, keepNames: Set<string>): Record<string, unknown> {
  const data = structuredClone(raw);

  // Trim classification-data
  data["classification-data"] = (data["classification-data"] as DriverEntry[]).filter(
    (d) => keepNames.has(d["driver-name"]),
  );

  // Trim position-history
  if (Array.isArray(data["position-history"])) {
    data["position-history"] = (data["position-history"] as { name: string }[]).filter(
      (d) => keepNames.has(d.name),
    );
  }

  // Trim tyre-stint-history-v2
  if (Array.isArray(data["tyre-stint-history-v2"])) {
    data["tyre-stint-history-v2"] = (data["tyre-stint-history-v2"] as { name: string }[]).filter(
      (d) => keepNames.has(d.name),
    );
  }

  // Trim speed-trap-records
  if (Array.isArray(data["speed-trap-records"])) {
    data["speed-trap-records"] = (data["speed-trap-records"] as { name: string }[]).filter(
      (d) => keepNames.has(d.name),
    );
  }

  // Trim overtakes
  if (data.overtakes && typeof data.overtakes === "object") {
    const ot = data.overtakes as { records: { "overtaking-driver-name": string; "overtaken-driver-name": string }[] };
    ot.records = ot.records.filter(
      (r) => keepNames.has(r["overtaking-driver-name"]) || keepNames.has(r["overtaken-driver-name"]),
    );
  }

  return data;
}

function buildSummary(filename: string, data: Record<string, unknown>) {
  const parsed = parseFilename(filename);
  const slug = toSlug(filename);

  const classData = data["classification-data"] as DriverEntry[];
  let focusDriver = classData.find((d) => d["is-player"]);
  let isSpectator = false;

  if (!focusDriver) {
    isSpectator = true;
    let maxLaps = 0;
    for (const d of classData) {
      const count = (d["session-history"]?.["lap-history-data"] ?? [])
        .filter((l) => l["lap-time-in-ms"] > 0).length;
      if (count > maxLaps) {
        maxLaps = count;
        focusDriver = d;
      }
    }
  }

  let validLapCount = 0;
  let lapIndicators: ("valid" | "invalid" | "best")[] | undefined;
  let bestLapTime: string | undefined;
  let bestLapTimeMs: number | undefined;

  const sessionInfo = data["session-info"] as Record<string, unknown> | undefined;
  const isOnline = sessionInfo?.["network-game"] === 1;
  const aiDifficulty = isOnline ? 0 : ((sessionInfo?.["ai-difficulty"] as number) ?? 0);

  if (focusDriver) {
    const laps = focusDriver["session-history"]["lap-history-data"];
    validLapCount = laps.filter((l) => l["lap-time-in-ms"] > 0).length;

    const isQuali =
      parsed.sessionType === "Short Qualifying" ||
      parsed.sessionType === "One Shot Qualifying";

    if (isQuali) {
      const bestLapNum = focusDriver["session-history"]["best-lap-time-lap-num"] ?? -1;
      lapIndicators = laps
        .filter((l) => l["lap-time-in-ms"] > 0)
        .map((l, i) => {
          const lapNum = i + 1;
          if (lapNum === bestLapNum) return "best" as const;
          return l["lap-valid-bit-flags"] === 15 ? ("valid" as const) : ("invalid" as const);
        });

      if (bestLapNum > 0) {
        const bestLap = laps[bestLapNum - 1] as { "lap-time-str"?: string; "lap-time-in-ms"?: number } | undefined;
        if (bestLap?.["lap-time-str"]) {
          bestLapTime = bestLap["lap-time-str"];
          bestLapTimeMs = bestLap["lap-time-in-ms"];
        }
      }
    }
  }

  return {
    relativePath: filename,
    slug,
    ...parsed,
    validLapCount,
    lapIndicators,
    bestLapTime,
    bestLapTimeMs,
    aiDifficulty,
    isSpectator,
  };
}

// --- Main ---

fs.mkdirSync(OUT_DIR, { recursive: true });

const manifest = [];

for (const relPath of SOURCES) {
  const srcPath = path.join(TELEMETRY_DIR, relPath);
  const filename = path.basename(relPath);

  console.log(`Processing ${filename}...`);
  const raw = JSON.parse(fs.readFileSync(srcPath, "utf-8"));
  const keepNames = pickDrivers(raw["classification-data"]);
  console.log(`  Keeping ${keepNames.size} drivers: ${[...keepNames].join(", ")}`);

  const trimmed = trimSession(raw, keepNames);
  const slug = toSlug(filename);
  const outPath = path.join(OUT_DIR, `${slug}.json`);
  const json = JSON.stringify(trimmed);

  fs.writeFileSync(outPath, json);
  console.log(`  Written ${outPath} (${(json.length / 1024).toFixed(0)} KB)`);

  manifest.push(buildSummary(filename, trimmed));
}

// Sort manifest by date descending
manifest.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

const manifestPath = path.join(OUT_DIR, "sessions.json");
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
console.log(`\nManifest written to ${manifestPath} (${manifest.length} sessions)`);
