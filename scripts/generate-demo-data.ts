/**
 * Generates the public demo from real sessions: one online race weekend at
 * Sakhir with a lap recording, and three long runs at Miami for stint
 * comparison. Every human name becomes a fictional handle, so nothing in
 * `public/demo/` identifies a real player, and the script fails if one survives.
 *
 * Usage: TELEMETRY_DIR=/path/to/data pnpm generate-demo
 *        (or set TELEMETRY_DIR in .env)
 *
 * Source files are hardcoded below; update paths if the originals move.
 */

import fs from "fs";
import path from "path";
import JSZip from "jszip";
import type {
  SessionSummary,
  TelemetrySession,
} from "../src/types/telemetry.ts";
import { toSlug } from "../src/utils/parseFilename.ts";
import { buildSessionSummary } from "../src/utils/sessionSummary.ts";
import { buildSyntheticOnlineRaces } from "./generate-demo-synthetic.ts";

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

  throw new Error(
    "TELEMETRY_DIR is not set. Export it or add it to .env before generating demo data.",
  );
}

const TELEMETRY_DIR = readTelemetryDir();

interface DemoSource {
  path: string;
  /** Drivers to keep; the race and the recorded quali keep the full field. */
  keep?: number;
  /** The session's `.pngt`, bundled so the demo has Lap telemetry. */
  recording?: string;
}

const SOURCES: DemoSource[] = [
  { path: "2026_10_26/race-info/Race_Sakhir_2026_10_26_22_36_52.json" },
  {
    path: "2026_10_26/race-info/Short_Qualifying_Sakhir_2026_10_26_21_29_32.json",
    recording:
      "2026_10_26/telemetry/Short_Qualifying_Sakhir_2026_10_26_21_29_32.pngt",
  },
  // An earlier run on the race's tyres, for the Tyres tab's comparison.
  {
    path: "2026_10_26/race-info/Race_Sakhir_Manual_2026_10_26_18_29_18.json",
    keep: 6,
  },
  {
    path: "2026_10_30/race-info/Race_Miami_Manual_2026_10_30_18_07_16.json",
    keep: 6,
  },
  {
    path: "2026_10_30/race-info/Race_Miami_Manual_2026_10_30_18_24_39.json",
    keep: 6,
  },
  {
    path: "2026_10_30/race-info/Race_Miami_Manual_2026_10_30_18_38_16.json",
    keep: 6,
  },
];

/** Stand-ins for human players, one per name across every source. */
const HANDLES = `Apex_Hunter LateBraker KerbHopper DRS_Train Tow_Tom GravelTrap
  Slipstream07 BoxBoxBox Undercut_Joe ColdTyres PurpleSector1 FlatOut_Mo
  TrailBrake42 MarblesMike PitWall_Pat Oversteer88 Understeer_Uli LockUp_Lou
  Backmarker9 BlueFlag_Bo SendIt_Sam DirtyAir_Dan HotLap_Hana RedMist_Rio
  Chicane_Cal Hairpin_Hugo Paddock_Pia Grid_Gus Fuel_Saver_Ed TyreWhisperer
  Delta_Dee Sector3_Sol Parc_Ferme Kerb_Kid Rain_Master11 Safety_Sid`.split(
  /\s+/,
);

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

function pickDrivers(
  classificationData: DriverEntry[],
  keep: number,
): Set<string> {
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
    if (names.size >= keep) break;
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

/**
 * Who needs a stand-in: any name that isn't an AI driver's upper-case surname
 * or a "Team '26 #8" placeholder, and every online human whatever their name.
 */
function humanNames(session: TelemetrySession): string[] {
  const online = session["session-info"]?.["network-game"] === 1;
  return (session["classification-data"] as unknown as DriverEntry[]).flatMap(
    (driver) => {
      const name = driver["driver-name"];
      if (!name || /#\d+$/.test(name)) return [];
      const participant = driver["participant-data"] as
        | { "ai-controlled"?: boolean }
        | undefined;
      const surname = /^[\p{Lu}' -]+$/u.test(name);
      return !surname || (online && !participant?.["ai-controlled"])
        ? [name]
        : [];
    },
  );
}

function nameReplacer(names: readonly string[]) {
  if (names.length > HANDLES.length) {
    throw new Error(`Need ${names.length} handles, have ${HANDLES.length}`);
  }
  // PnG writes non-ASCII as \\uXXXX, so a name has an escaped form on disk.
  const escapedForm = (name: string) =>
    name.replace(
      /[^\x00-\x7f]/g,
      (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`,
    );
  const handles = new Map(
    names.flatMap((name, i) =>
      [name, escapedForm(name)].map((form) => [form.toLowerCase(), HANDLES[i]]),
    ),
  );
  const escaped = [...handles.keys()]
    .sort((a, b) => b.length - a.length)
    .map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const pattern = new RegExp(
    `(?<![\\p{L}\\p{N}_])(${escaped.join("|")})(?![\\p{L}\\p{N}_])`,
    "giu",
  );
  return (text: string) =>
    text.replace(pattern, (name) => handles.get(name.toLowerCase())!);
}

/** A recording with every name in its JSON entries replaced. */
async function anonymiseRecording(
  source: Buffer,
  replaceNames: (text: string) => string,
): Promise<Buffer> {
  const zip = await JSZip.loadAsync(source);
  for (const entry of Object.values(zip.files)) {
    if (entry.dir || !entry.name.endsWith(".json")) continue;
    zip.file(entry.name, replaceNames(await entry.async("text")));
  }
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}

// --- Main ---

fs.rmSync(OUT_DIR, { recursive: true, force: true });
fs.mkdirSync(path.join(OUT_DIR, "recordings"), { recursive: true });

const sources = SOURCES.map((source) => ({
  ...source,
  filename: path.basename(source.path),
  text: fs.readFileSync(path.join(TELEMETRY_DIR, source.path), "utf-8"),
}));
const realNames = [
  ...new Set(
    sources.flatMap((s) => humanNames(JSON.parse(s.text) as TelemetrySession)),
  ),
].sort();
const replaceNames = nameReplacer(realNames);

const manifest = [];
const recordings: { file: string; session: string }[] = [];

for (const { filename, keep, recording, text } of sources) {
  console.log(`Processing ${filename}...`);
  const raw = JSON.parse(replaceNames(text)) as TelemetrySession;
  const rawSummary = buildSessionSummary(
    filename,
    raw,
    Buffer.byteLength(text),
  ).summary;
  const drivers = raw["classification-data"] as unknown as DriverEntry[];
  const keepNames = pickDrivers(drivers, keep ?? drivers.length);
  console.log(`  Keeping ${keepNames.size} drivers`);

  const trimmed = trimSession(
    raw as unknown as Record<string, unknown>,
    keepNames,
  );
  const slug = toSlug(filename);
  const outPath = path.join(OUT_DIR, `${slug}.json`);
  const json = JSON.stringify(trimmed);

  fs.writeFileSync(outPath, json);
  console.log(`  Written ${outPath} (${(json.length / 1024).toFixed(0)} KB)`);

  manifest.push(rawSummary);

  if (recording) {
    const file = path.basename(recording);
    fs.writeFileSync(
      path.join(OUT_DIR, "recordings", file),
      await anonymiseRecording(
        fs.readFileSync(path.join(TELEMETRY_DIR, recording)),
        replaceNames,
      ),
    );
    recordings.push({ file, session: filename });
  }
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
fs.writeFileSync(manifestPath, `${JSON.stringify(fullManifest, null, 2)}\n`);
console.log(
  `Manifest written to ${manifestPath} (${fullManifest.length} sessions)`,
);
fs.writeFileSync(
  path.join(OUT_DIR, "recordings.json"),
  `${JSON.stringify(recordings, null, 2)}\n`,
);

// Everything public must read clean, recordings included.
const published = fs
  .readdirSync(OUT_DIR, { recursive: true, encoding: "utf-8" })
  .map((file) => path.join(OUT_DIR, file))
  .filter((file) => fs.statSync(file).isFile());
for (const file of published) {
  const texts = file.endsWith(".pngt")
    ? await Promise.all(
        Object.values((await JSZip.loadAsync(fs.readFileSync(file))).files)
          .filter((entry) => entry.name.endsWith(".json"))
          .map((entry) => entry.async("text")),
      )
    : [fs.readFileSync(file, "utf-8")];
  for (const text of texts) {
    const lower = text.toLowerCase();
    const leak = realNames.find((name) => lower.includes(name.toLowerCase()));
    if (leak) throw new Error(`A real name survived in ${file}`);
  }
}
console.log(
  `Checked ${published.length} files: ${realNames.length} names replaced`,
);
