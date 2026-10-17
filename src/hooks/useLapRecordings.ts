import { useQueries, useQuery } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";
import { useTelemetry } from "../context/TelemetryContext";
import {
  LAP_TELEMETRY_ANCHOR,
  lapRefKey,
  LAPS_QUERY_PARAM,
  type LapRef,
} from "../analysis/lapTelemetrySelection";
import {
  lapRecordingListQueryOptions,
  lapRecordingManifestQueryOptions,
  lapTraceQueryOptions,
} from "../queries/lapRecordings";
import type {
  LapRecordingManifest,
  LapRecordingSummary,
  LapTrace,
} from "../utils/lapRecording/types";

const EMPTY: LapRecordingSummary[] = [];

/** Every lap recording the current data source knows about. */
export function useLapRecordingList() {
  const { mode, lapRecordingStore } = useTelemetry();
  const query = useQuery(lapRecordingListQueryOptions(mode, lapRecordingStore));
  return { recordings: query.data ?? EMPTY, loading: query.isLoading };
}

/** Complete-lap counts by paired session slug, for list badges. */
export function useRecordedLapCounts(): ReadonlyMap<string, number> {
  const { recordings } = useLapRecordingList();
  return useMemo(() => {
    const counts = new Map<string, number>();
    for (const recording of recordings) {
      if (recording.sessionSlug && recording.completeLapCount > 0) {
        counts.set(recording.sessionSlug, recording.completeLapCount);
      }
    }
    return counts;
  }, [recordings]);
}

export interface LapRecordingManifests {
  manifests: ReadonlyMap<string, LapRecordingManifest>;
  /** Slugs whose manifest failed to load, so callers stop waiting on them. */
  failed: ReadonlySet<string>;
}

export function useLapRecordingManifests(
  slugs: readonly string[],
): LapRecordingManifests {
  const { mode, lapRecordingStore } = useTelemetry();
  // TanStack re-runs `combine` only when results or its identity change, so
  // a callback keyed on `slugs` keeps the returned value stable.
  const combine = useCallback(
    (
      results: { data?: LapRecordingManifest; isError: boolean }[],
    ): LapRecordingManifests => {
      const manifests = new Map<string, LapRecordingManifest>();
      const failed = new Set<string>();
      results.forEach(({ data, isError }, i) => {
        if (data) manifests.set(data.slug, data);
        else if (isError) failed.add(slugs[i]);
      });
      return { manifests, failed };
    },
    [slugs],
  );
  return useQueries({
    queries: slugs.map((slug) =>
      lapRecordingManifestQueryOptions(mode, slug, lapRecordingStore),
    ),
    combine,
  });
}

export interface LapTraceState {
  trace?: LapTrace;
  error: boolean;
}

// Module-level so TanStack keeps the combined value stable between renders.
function combineTraces(
  results: { data?: LapTrace; isError: boolean }[],
): LapTraceState[] {
  return results.map((result) => ({
    trace: result.data,
    error: result.isError,
  }));
}

export function useLapTraces(refs: readonly LapRef[]): LapTraceState[] {
  const { mode, lapRecordingStore } = useTelemetry();
  return useQueries({
    queries: refs.map((ref) =>
      lapTraceQueryOptions(
        mode,
        ref.recordingSlug,
        ref.driverIndex,
        ref.lapNumber,
        lapRecordingStore,
      ),
    ),
    combine: combineTraces,
  });
}

/**
 * Links that open a lap in the Lap Telemetry section, matched to lap-table
 * rows by lap time in ms: the viewer's lap ordinals skip untimed laps, so
 * lap numbers do not line up with the recording's.
 */
export function useLapTraceLinks(
  sessionSlug: string,
  driverIndex: number | undefined,
): ((lapTimeMs: number) => string | undefined) | undefined {
  const { mode, lapRecordingStore } = useTelemetry();
  const { recordings } = useLapRecordingList();
  const recording = recordings.find(
    (entry) => entry.sessionSlug === sessionSlug && entry.completeLapCount > 0,
  );
  const { data: manifest } = useQuery({
    ...lapRecordingManifestQueryOptions(
      mode,
      recording?.slug ?? "",
      lapRecordingStore,
    ),
    enabled: !!recording,
  });
  return useMemo(() => {
    const driver = manifest?.drivers.find(
      (entry) => entry.index === driverIndex,
    );
    if (!manifest || !driver) return undefined;
    const lapsByTime = new Map<number, number>();
    for (const lap of driver.laps) {
      if (lap.complete && lap.lapTimeMs)
        lapsByTime.set(lap.lapTimeMs, lap.lapNumber);
    }
    if (lapsByTime.size === 0) return undefined;
    return (lapTimeMs: number) => {
      const lapNumber = lapsByTime.get(Math.round(lapTimeMs));
      return lapNumber === undefined
        ? undefined
        : `?${LAPS_QUERY_PARAM}=${lapRefKey({ recordingSlug: manifest.slug, driverIndex: driver.index, lapNumber })}#${LAP_TELEMETRY_ANCHOR}`;
    };
  }, [driverIndex, manifest]);
}
