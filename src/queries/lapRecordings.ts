import { queryOptions } from "@tanstack/react-query";
import {
  buildRecordingPairing,
  openLapRecording,
  parseLapTrace,
  summarizeLapRecording,
  type OpenedLapRecording,
} from "../utils/lapRecording/reader";
import type { TelemetrySession } from "../types/telemetry";
import { toSlug } from "../utils/parseFilename";
import type {
  LapRecordingManifest,
  LapRecordingSummary,
  LapTrace,
  RecordedLap,
} from "../utils/lapRecording/types";
import type { Mode } from "./telemetry";

/**
 * Opened recordings held in memory, keyed by recording slug: upload mode's
 * files plus browser imports, which every mode serves from here first.
 */
export type LapRecordingStore = Map<string, OpenedLapRecording>;

// Hierarchical like telemetryKeys so replacing uploads evicts one prefix.
export const lapRecordingKeys = {
  byMode: (mode: Mode) => ["lap-recordings", mode] as const,
  list: (mode: Mode) => ["lap-recordings", mode, "list"] as const,
  manifest: (mode: Mode, slug: string) =>
    ["lap-recordings", mode, "manifest", slug] as const,
  lap: (mode: Mode, slug: string, driverIndex: number, lapNumber: number) =>
    ["lap-recordings", mode, "lap", slug, driverIndex, lapNumber] as const,
};

/** Pits n' Giggles lap-analyzer API, the one source of `.pngt` data in API mode. */
const API_BASE: string =
  import.meta.env.VITE_LAP_API_BASE || "/lap-analyzer/api/v1";

/** JSON from the lap API; undefined when the host has no such API (404 or its SPA page). */
async function fetchApiJson<T>(path: string): Promise<T | undefined> {
  const res = await fetch(`${API_BASE}${path}`);
  if (res.status === 404) return undefined;
  if (!res.ok) throw new Error(`Lap API ${path} failed: ${res.status}`);
  if (!res.headers.get("content-type")?.includes("application/json")) {
    return undefined;
  }
  return (await res.json()) as T;
}

/** A session from `/sessions/<id>`: the manifest minus its drivers. */
type ApiSession = Omit<LapRecordingManifest, "drivers">;
type ApiDriver = Omit<LapRecordingManifest["drivers"][number], "laps">;

/** Three requests, however many drivers: the session, its drivers, all their laps. */
async function fetchApiManifest(
  slug: string,
): Promise<LapRecordingManifest | undefined> {
  const id = encodeURIComponent(slug);
  const [session, drivers, laps] = await Promise.all([
    fetchApiJson<ApiSession>(`/sessions/${id}`),
    fetchApiJson<ApiDriver[]>(`/sessions/${id}/drivers`),
    fetchApiJson<Record<string, RecordedLap[]>>(`/sessions/${id}/laps`),
  ]);
  if (!session) return undefined;
  return {
    ...session,
    drivers: (drivers ?? []).map((driver) => ({
      ...driver,
      laps: laps?.[driver.index] ?? [],
    })),
  };
}

const demoLoads = new WeakMap<LapRecordingStore, Promise<void>>();

/**
 * The demo's bundled recordings (`public/demo/recordings.json`), opened once
 * into the store like an upload. A missing file only leaves the demo without
 * Lap telemetry.
 */
function loadDemoRecordings(store: LapRecordingStore): Promise<void> {
  const loading =
    demoLoads.get(store) ??
    (async () => {
      const base = `${import.meta.env.BASE_URL}demo/`;
      const res = await fetch(`${base}recordings.json`);
      if (!res.ok) return;
      const entries = (await res.json()) as { file: string; session: string }[];
      await Promise.all(
        entries.map(async ({ file, session }) => {
          const [data, json] = await Promise.all([
            fetch(`${base}recordings/${file}`).then((r) => r.arrayBuffer()),
            fetch(`${base}${toSlug(session)}.json`).then(
              (r) => r.json() as Promise<TelemetrySession>,
            ),
          ]);
          const recording = await openLapRecording(data, {
            fileName: file,
            pairing: buildRecordingPairing(session, json),
          });
          store.set(recording.manifest.id, recording);
        }),
      );
    })().catch((error) => {
      console.warn("Skipping the demo's lap recordings", error);
    });
  demoLoads.set(store, loading);
  return loading;
}

export function lapRecordingListQueryOptions(
  mode: Mode,
  store: LapRecordingStore,
  /** Stored imports are open, so a selection naming one does not flash defaults. */
  importsReady: boolean,
) {
  return queryOptions({
    queryKey: lapRecordingKeys.list(mode),
    queryFn: async (): Promise<LapRecordingSummary[]> => {
      if (mode === "demo") await loadDemoRecordings(store);
      const held = [...store.values()].map((recording) =>
        summarizeLapRecording(recording.manifest),
      );
      if (mode !== "api") return held;
      // Hosts without the lap API answer 404 or their SPA page; no recordings
      // is the honest answer there, not an error.
      const summaries = await fetchApiJson<LapRecordingSummary[]>(
        "/sessions/summaries",
      );
      return [...(summaries ?? []), ...held];
    },
    enabled: importsReady && mode !== "detecting",
    staleTime: 10_000,
  });
}

export function lapRecordingManifestQueryOptions(
  mode: Mode,
  slug: string,
  store: LapRecordingStore,
) {
  return queryOptions({
    queryKey: lapRecordingKeys.manifest(mode, slug),
    queryFn: async (): Promise<LapRecordingManifest> => {
      const held = store.get(slug);
      if (held) return held.manifest;
      if (mode !== "api") throw new Error(`Lap recording not found: ${slug}`);
      const manifest = await fetchApiManifest(slug);
      if (!manifest) throw new Error(`Failed to load lap recording: ${slug}`);
      return manifest;
    },
    staleTime: Infinity,
  });
}

export function lapTraceQueryOptions(
  mode: Mode,
  slug: string,
  driverIndex: number,
  lapNumber: number,
  store: LapRecordingStore,
) {
  return queryOptions({
    queryKey: lapRecordingKeys.lap(mode, slug, driverIndex, lapNumber),
    queryFn: async (): Promise<LapTrace> => {
      let bytes: Uint8Array | undefined;
      const held = store.get(slug);
      if (held) {
        bytes = await held.readLapBytes(driverIndex, lapNumber);
      } else if (mode === "api") {
        const res = await fetch(
          `${API_BASE}/telemetry/${encodeURIComponent(slug)}/${driverIndex}/${lapNumber}`,
        );
        if (res.ok) bytes = new Uint8Array(await res.arrayBuffer());
      }
      if (!bytes) throw new Error("Lap trace not found");
      return parseLapTrace(bytes);
    },
    // A recorded lap never changes; decoded arrays are ~300 KB, so let unused
    // ones go after a while instead of pinning every lap ever opened.
    staleTime: Infinity,
    gcTime: 10 * 60_000,
  });
}
