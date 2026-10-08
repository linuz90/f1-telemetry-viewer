/**
 * Re-measures the evidence behind the tuning constants at the top of
 * `src/analysis/lapTelemetryAnalysis.ts` on whatever lap recordings exist.
 * Run it before changing one of them, and again after:
 *
 *   pnpm check:lap-telemetry [folder]   (defaults to TELEMETRY_DIR)
 *
 * It prints aggregates only, never file names, drivers or laps:
 *
 * 1. Corpus: how many recordings, laps, tracks and conditions the numbers
 *    rest on.
 * 2. Clock accuracy: the recording's clock at each sector end against the
 *    official sector times in the paired session JSON, per lap and for the
 *    gap between two laps at several smoothing widths. This is what
 *    `TIP_FLOOR_S`, `WASH_PHASE_FLOOR_S` and `UNIT_GAP_HALF_WINDOW_M` stand on.
 * 3. Tip census: what `compareLaps()` says across lap pairs, by kind and
 *    category, plus how many tips sit just above the floor. A threshold
 *    change shows up here as tips moving between rows.
 */
import fs from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import {
  buildLapSeries,
  compareLaps,
  prepareLap,
  TIP_FLOOR_S,
  valueAt,
  type PreparedLap,
} from "../src/analysis/lapTelemetryAnalysis.ts";
import { createLapRecordingIndex } from "../src/plugin/lap-recording-index.ts";
import {
  parseLapTrace,
  recordingPairKey,
} from "../src/utils/lapRecording/reader.ts";
import type { LapRecordingManifest } from "../src/utils/lapRecording/types.ts";
import { getTrackCorners } from "../src/utils/tracks.ts";

/** Half-widths of the gap average to compare, in metres. */
const WINDOWS_M = [0, 10, 20, 30, 50];
/** Each lap is compared with the next few by lap time, to bound the run. */
const PAIRS_PER_LAP = 3;
const GRID_STEP_M = 2;

interface CheckedLap {
  lap: PreparedLap;
  manifest: LapRecordingManifest;
  /** Official elapsed ms at the end of sectors 1 and 2, when exported. */
  officialMs?: [number, number];
}

function unquote(value: string): string {
  return value.trim().replace(/^['"]|['"]$/g, "");
}

function readTelemetryDir(): string {
  if (process.argv[2]) return path.resolve(process.argv[2]);
  if (process.env.TELEMETRY_DIR) return unquote(process.env.TELEMETRY_DIR);
  const envPath = path.resolve(import.meta.dirname, "../.env");
  if (fs.existsSync(envPath)) {
    const match = fs
      .readFileSync(envPath, "utf-8")
      .match(/^TELEMETRY_DIR=(.+)$/m);
    if (match?.[1]) return unquote(match[1]);
  }
  throw new Error(
    "No telemetry folder. Pass one, export TELEMETRY_DIR, or add it to .env.",
  );
}

interface SessionLapHistory {
  "lap-time-in-ms"?: number;
  "sector-1-time-in-ms"?: number;
  "sector-1-time-minutes"?: number;
  "sector-2-time-in-ms"?: number;
  "sector-2-time-minutes"?: number;
}

interface SessionJson {
  "classification-data"?: {
    index: number;
    "session-history"?: { "lap-history-data"?: SessionLapHistory[] };
  }[];
}

/** Official sector-end times for one lap, matched by lap time like the viewer does. */
function officialSectorEnds(
  session: SessionJson | undefined,
  driverIndex: number,
  lapTimeMs: number,
): [number, number] | undefined {
  const driver = session?.["classification-data"]?.find(
    (entry) => entry.index === driverIndex,
  );
  const lap = driver?.["session-history"]?.["lap-history-data"]?.find(
    (entry) => entry["lap-time-in-ms"] === lapTimeMs,
  );
  const s1 =
    (lap?.["sector-1-time-in-ms"] ?? 0) +
    (lap?.["sector-1-time-minutes"] ?? 0) * 60_000;
  const s2 =
    (lap?.["sector-2-time-in-ms"] ?? 0) +
    (lap?.["sector-2-time-minutes"] ?? 0) * 60_000;
  return s1 > 0 && s2 > 0 ? [s1, s1 + s2] : undefined;
}

const rms = (values: number[]) =>
  Math.sqrt(values.reduce((sum, v) => sum + v * v, 0) / values.length);
const mean = (values: number[]) =>
  values.reduce((sum, v) => sum + v, 0) / values.length;
const maxAbs = (values: number[]) => Math.max(...values.map(Math.abs));
const ms = (seconds: number) => `${(seconds * 1000).toFixed(1)} ms`;

function tally(counts: Map<string, number>, key: string): void {
  counts.set(key, (counts.get(key) ?? 0) + 1);
}

function printTally(title: string, counts: Map<string, number>): void {
  console.log(title);
  for (const [key, count] of [...counts].sort((x, y) => y[1] - x[1])) {
    console.log(`  ${String(count).padStart(4)}  ${key}`);
  }
}

async function main(): Promise<void> {
  const telemetryDir = readTelemetryDir();
  const index = createLapRecordingIndex({
    telemetryDir,
    logger: { info: () => undefined, warn: () => undefined },
  });

  const sessionPaths = new Map<string, string>();
  for (const entry of await readdir(telemetryDir, { recursive: true })) {
    if (entry.toLowerCase().endsWith(".json")) {
      sessionPaths.set(
        recordingPairKey(path.basename(entry)),
        path.join(telemetryDir, entry),
      );
    }
  }

  const summaries = (await index.list()).filter(
    (summary) => summary.completeLapCount > 0,
  );
  const corpus = new Map<string, { recordings: number; laps: number }>();
  const byRecording: CheckedLap[][] = [];
  for (const summary of summaries) {
    const manifest = await index.manifest(summary.slug);
    if (!manifest) continue;
    const sessionPath = sessionPaths.get(recordingPairKey(manifest.fileName));
    const session = sessionPath
      ? (JSON.parse(await readFile(sessionPath, "utf-8")) as SessionJson)
      : undefined;
    const laps: CheckedLap[] = [];
    for (const driver of manifest.drivers) {
      for (const recorded of driver.laps) {
        if (!recorded.complete || !recorded.lapTimeMs) continue;
        const bytes = await index.lapBytes(
          manifest.slug,
          driver.index,
          recorded.lapNumber,
        );
        if (!bytes) continue;
        try {
          laps.push({
            manifest,
            lap: prepareLap(
              await parseLapTrace(bytes),
              {
                key: `${manifest.slug}~${driver.index}~${recorded.lapNumber}`,
                driverName: driver.name,
                team: driver.team,
                isPlayer: manifest.playerIndex === driver.index,
                sessionType: manifest.sessionType,
                lapNumber: recorded.lapNumber,
                lapTimeMs: recorded.lapTimeMs,
                compound: recorded.compound,
                weather: manifest.weather,
              },
              manifest.trackLengthM,
            ),
            officialMs: officialSectorEnds(
              session,
              driver.index,
              recorded.lapTimeMs,
            ),
          });
        } catch {
          // A lap the analysis cannot prepare is not evidence either way.
        }
      }
    }
    if (laps.length === 0) continue;
    byRecording.push(laps);
    const conditions = `${manifest.track} · ${manifest.formula ?? "?"} · ${manifest.sessionType} · ${manifest.weather ?? "?"}`;
    const seen = corpus.get(conditions) ?? { recordings: 0, laps: 0 };
    corpus.set(conditions, {
      recordings: seen.recordings + 1,
      laps: seen.laps + laps.length,
    });
  }

  const allLaps = byRecording.flat();
  console.log(
    `Corpus: ${byRecording.length} recordings with complete laps, ${allLaps.length} laps, ${allLaps.filter((entry) => entry.officialMs).length} with official sector times`,
  );
  for (const [conditions, { recordings, laps }] of corpus) {
    console.log(`  ${conditions}: ${recordings} recordings, ${laps} laps`);
  }
  if (allLaps.length < 2) return;

  // --- Clock accuracy ------------------------------------------------------
  const perLapErrors: number[] = [];
  for (const { lap, manifest, officialMs } of allLaps) {
    if (!officialMs || !manifest.sectorStartsM) continue;
    manifest.sectorStartsM.forEach((start, k) => {
      perLapErrors.push(valueAt(lap.d, lap.t, start) - officialMs[k] / 1000);
    });
  }
  const gapErrors = new Map<number, number[]>(WINDOWS_M.map((w) => [w, []]));
  const kinds = new Map<string, number>();
  let comparisons = 0;
  let unitCount = 0;
  let tipCount = 0;
  let nearFloor = 0;
  let washes = 0;
  let worstSumError = 0;

  for (const laps of byRecording) {
    // Like with like: a race's standing-start lap only against another.
    const groups = new Map<number, CheckedLap[]>();
    for (const entry of laps) {
      const key = entry.lap.context.lapNumber === 1 ? 1 : 2;
      groups.set(key, [...(groups.get(key) ?? []), entry]);
    }
    for (const group of groups.values()) {
      group.sort((x, y) => x.lap.context.lapTimeMs - y.lap.context.lapTimeMs);
      for (let i = 0; i < group.length; i += 1) {
        for (
          let j = i + 1;
          j < Math.min(group.length, i + 1 + PAIRS_PER_LAP);
          j += 1
        ) {
          const a = group[i];
          const b = group[j];
          const sectorStarts = a.manifest.sectorStartsM;

          if (a.officialMs && b.officialMs && sectorStarts) {
            const set = buildLapSeries([a.lap, b.lap]);
            const [timeA, timeB] = set.laps.map((lap) => lap.time);
            sectorStarts.forEach((start, k) => {
              const official = (a.officialMs![k] - b.officialMs![k]) / 1000;
              const centre = Math.round(start / GRID_STEP_M);
              for (const window of WINDOWS_M) {
                const half = Math.round(window / GRID_STEP_M);
                let sum = 0;
                for (let q = centre - half; q <= centre + half; q += 1)
                  sum += timeA[q] - timeB[q];
                gapErrors.get(window)!.push(sum / (2 * half + 1) - official);
              }
            });
          }

          const comparison = compareLaps(a.lap, b.lap, {
            sectorStarts,
            corners: getTrackCorners(a.manifest.track, a.lap.trackLengthM),
          });
          comparisons += 1;
          unitCount += comparison.units.length;
          tipCount += comparison.tips.length;
          const sum =
            comparison.tips.reduce((total, tip) => total + tip.timeS, 0) +
            comparison.remainderS;
          worstSumError = Math.max(
            worstSumError,
            Math.abs(sum - comparison.totalS),
          );
          for (const tip of comparison.tips) {
            const size = Math.abs(tip.timeS);
            if (size < TIP_FLOOR_S) washes += 1;
            else if (size < TIP_FLOOR_S + 0.01) nearFloor += 1;
            tally(kinds, `${tip.kind.padEnd(4)} ${tip.category}`);
          }
        }
      }
    }
  }

  console.log("\nClock accuracy against official sector times");
  if (perLapErrors.length === 0) {
    console.log("  no laps with official sector times and sector starts");
  } else {
    console.log(
      `  one lap's clock at a sector end: mean ${ms(mean(perLapErrors))}, RMS ${ms(rms(perLapErrors))}, worst ${ms(maxAbs(perLapErrors))} (n=${perLapErrors.length})`,
    );
    for (const window of WINDOWS_M) {
      const errors = gapErrors.get(window)!;
      if (errors.length === 0) continue;
      console.log(
        `  gap between two laps, ±${String(window).padStart(2)} m average: RMS ${ms(rms(errors))}, worst ${ms(maxAbs(errors))} (n=${errors.length})`,
      );
    }
    console.log(
      "  A stretch's time is the difference of two gap readings, so its error is about 1.4x the gap RMS.",
    );
  }

  console.log(`\nTip census over ${comparisons} comparisons`);
  console.log(
    `  ${(unitCount / comparisons).toFixed(1)} units and ${(tipCount / comparisons).toFixed(1)} tips per comparison`,
  );
  console.log(
    `  ${nearFloor} tips within 0.01 s above the ${TIP_FLOOR_S} s floor, ${washes} wash notes under it`,
  );
  console.log(
    `  tips + remainder vs the official gap: worst mismatch ${(worstSumError * 1e6).toFixed(1)} µs`,
  );
  printTally("  by kind and category:", kinds);
}

await main();
