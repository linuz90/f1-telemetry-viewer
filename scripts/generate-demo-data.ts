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
import type {
  SessionSummary,
  TelemetrySession,
} from "../src/types/telemetry.ts";
import { toSlug } from "../src/utils/parseFilename.ts";
import { buildSessionSummary } from "../src/utils/sessionSummary.ts";
import { buildSyntheticOnlineRaces } from "./generate-demo-synthetic.ts";

const FALLBACK_TELEMETRY_DIR =
  "/Users/linuz90/Library/CloudStorage/OneDrive-Personal/Pits & Giggles/data";

function unquote(value: string): string {
  return value.trim().replace(/^['"]|['"]$/g, "");
}

function readTelemetryDir(): string {
  if (process.env.TELEMETRY_DIR) return unquote(process.env.TELEMETRY_DIR);

  const envPath = path.resolve(import.meta.dirname, "../.env");
  if (fs.existsSync(envPath)) {
    const match = fs
      .readFileSync(envPath, "utf-8")
      .match(/^TELEMETRY_DIR=(.+)$/m);
    if (match?.[1]) return unquote(match[1]);
  }

  return FALLBACK_TELEMETRY_DIR;
}

const TELEMETRY_DIR = readTelemetryDir();

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
    "lap-history-data": {
      "lap-time-in-ms": number;
      "lap-valid-bit-flags": number;
    }[];
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
      const posA =
        a["final-classification"]?.position ?? a["track-position"] ?? 99;
      const posB =
        b["final-classification"]?.position ?? b["track-position"] ?? 99;
      return posA - posB;
    });

  for (const d of others) {
    if (names.size >= KEEP_DRIVERS) break;
    names.add(d["driver-name"]);
  }

  return names;
}

function trimSession(
  raw: Record<string, unknown>,
  keepNames: Set<string>,
): Record<string, unknown> {
  const data = structuredClone(raw);

  // Trim classification-data
  data["classification-data"] = (
    data["classification-data"] as DriverEntry[]
  ).filter((d) => keepNames.has(d["driver-name"]));

  // Trim position-history
  if (Array.isArray(data["position-history"])) {
    data["position-history"] = (
      data["position-history"] as { name: string }[]
    ).filter((d) => keepNames.has(d.name));
  }

  // Trim tyre-stint-history-v2
  if (Array.isArray(data["tyre-stint-history-v2"])) {
    data["tyre-stint-history-v2"] = (
      data["tyre-stint-history-v2"] as { name: string }[]
    ).filter((d) => keepNames.has(d.name));
  }

  // Trim speed-trap-records
  if (Array.isArray(data["speed-trap-records"])) {
    data["speed-trap-records"] = (
      data["speed-trap-records"] as { name: string }[]
    ).filter((d) => keepNames.has(d.name));
  }

  // Trim overtakes
  if (data.overtakes && typeof data.overtakes === "object") {
    const ot = data.overtakes as {
      records: {
        "overtaking-driver-name": string;
        "overtaken-driver-name": string;
      }[];
    };
    ot.records = ot.records.filter(
      (r) =>
        keepNames.has(r["overtaking-driver-name"]) ||
        keepNames.has(r["overtaken-driver-name"]),
    );
  }

  return data;
}

// --- Main ---

fs.mkdirSync(OUT_DIR, { recursive: true });

const manifest = [];

for (const relPath of SOURCES) {
  const srcPath = path.join(TELEMETRY_DIR, relPath);
  const filename = path.basename(relPath);

  console.log(`Processing ${filename}...`);
  const raw = JSON.parse(fs.readFileSync(srcPath, "utf-8")) as TelemetrySession;
  const rawText = JSON.stringify(raw);
  const rawSummary = buildSessionSummary(
    filename,
    raw,
    Buffer.byteLength(rawText),
  ).summary;
  const keepNames = pickDrivers(raw["classification-data"]);
  console.log(
    `  Keeping ${keepNames.size} drivers: ${[...keepNames].join(", ")}`,
  );

  const trimmed = trimSession(
    raw as unknown as Record<string, unknown>,
    keepNames,
  );
  const slug = toSlug(filename);
  const outPath = path.join(OUT_DIR, `${slug}.json`);
  const json = JSON.stringify(trimmed);

  fs.writeFileSync(outPath, json);
  console.log(`  Written ${outPath} (${(json.length / 1024).toFixed(0)} KB)`);

  // Don't surface the user's real online opponents in the no-data demo.
  // The Spa race's `rivals` roster contains the actual gamertags of people
  // the user races with — stripping it keeps the dashboard's Rivals &
  // Teammates section sourced entirely from synthetic fictional names.
  // The detail page (raceResultsTable etc.) still shows real names from the
  // underlying JSON, which is acceptable as an authentic sample race.
  const sanitizedSummary = { ...rawSummary, rivals: undefined };
  manifest.push(sanitizedSummary);
}

// Append synthetic online race summaries (no backing detail JSON). These exist
// purely so the prod (no-data) Dashboard renders a rich Rivals & Teammates
// section instead of one or two lonely cards. The `isSynthetic` flag tells UI
// surfaces to avoid assuming there is a real detail JSON behind every row.
const synthetic = buildSyntheticOnlineRaces();
console.log(`\nGenerated ${synthetic.length} synthetic online race summaries.`);
const fullManifest: SessionSummary[] = [...manifest, ...synthetic];

// Sort manifest by date descending
fullManifest.sort(
  (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime(),
);

const manifestPath = path.join(OUT_DIR, "sessions.json");
fs.writeFileSync(manifestPath, JSON.stringify(fullManifest, null, 2));
console.log(
  `Manifest written to ${manifestPath} (${fullManifest.length} sessions)`,
);
