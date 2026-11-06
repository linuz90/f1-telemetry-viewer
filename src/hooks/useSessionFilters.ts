import { useCallback, useSyncExternalStore } from "react";
import {
  SESSION_FILTERS_CHANGED_EVENT,
  SESSION_FILTERS_STORAGE_KEY,
} from "../constants/storage";
import type { SessionSummary } from "../types/telemetry";
import { summaryKind } from "../analysis/sessionKind";
import { getTrackId } from "../utils/tracks";
import { readStoredString, writeStoredString } from "../utils/storage";

export type SessionTypeFilter = "all" | "race" | "long-run" | "quali" | "tt";
export type SessionModeFilter = "all" | "online" | "ai";

/**
 * The session log's filters. Shared by the log, the top-bar menu and the
 * session pages' ‹ ›, which step through the log as filtered; the Sessions page
 * mirrors them into its URL so a filtered log can be linked.
 */
export interface SessionListFilters {
  type: SessionTypeFilter;
  mode: SessionModeFilter;
  /** Canonical track id, or null for every track. */
  track: string | null;
}

export const DEFAULT_FILTERS: SessionListFilters = {
  type: "all",
  mode: "all",
  track: null,
};

export const SESSION_TYPE_FILTERS: readonly SessionTypeFilter[] = [
  "all",
  "race",
  "long-run",
  "quali",
  "tt",
];

const DEFAULT_FILTERS_SNAPSHOT = JSON.stringify(DEFAULT_FILTERS);

let memoryFilters = DEFAULT_FILTERS;

function normalizeFilters(
  value: Partial<SessionListFilters> | null | undefined,
): SessionListFilters {
  return {
    type: SESSION_TYPE_FILTERS.includes(value?.type as SessionTypeFilter)
      ? (value!.type as SessionTypeFilter)
      : "all",
    mode: value?.mode === "online" || value?.mode === "ai" ? value.mode : "all",
    track:
      typeof value?.track === "string" && value.track !== ""
        ? value.track
        : null,
  };
}

function parseSnapshot(snapshot: string): SessionListFilters {
  try {
    return normalizeFilters(
      JSON.parse(snapshot) as Partial<SessionListFilters>,
    );
  } catch {
    return DEFAULT_FILTERS;
  }
}

function readSessionFilters(): SessionListFilters {
  if (typeof window === "undefined") return memoryFilters;

  try {
    // Filters are a browsing preference, not just temporary UI state. Read the
    // old sessionStorage value as a migration path for tabs opened before this
    // preference moved to localStorage.
    const raw =
      readStoredString(SESSION_FILTERS_STORAGE_KEY) ??
      readStoredString(SESSION_FILTERS_STORAGE_KEY, "session");
    if (!raw) return memoryFilters;
    const filters = normalizeFilters(
      JSON.parse(raw) as Partial<SessionListFilters>,
    );
    memoryFilters = filters;
    return filters;
  } catch {
    return memoryFilters;
  }
}

function getSnapshot(): string {
  return JSON.stringify(readSessionFilters());
}

function subscribe(callback: () => void): () => void {
  if (typeof window === "undefined") return () => {};

  const onStorage = (event: StorageEvent) => {
    if (event.key === SESSION_FILTERS_STORAGE_KEY) callback();
  };
  window.addEventListener("storage", onStorage);
  window.addEventListener(SESSION_FILTERS_CHANGED_EVENT, callback);

  return () => {
    window.removeEventListener("storage", onStorage);
    window.removeEventListener(SESSION_FILTERS_CHANGED_EVENT, callback);
  };
}

function writeSessionFilters(next: SessionListFilters): void {
  const filters = normalizeFilters(next);
  memoryFilters = filters;

  if (typeof window === "undefined") return;

  writeStoredString(SESSION_FILTERS_STORAGE_KEY, JSON.stringify(filters));
  window.dispatchEvent(new Event(SESSION_FILTERS_CHANGED_EVENT));
}

export function useSessionFilters(): readonly [
  SessionListFilters,
  (next: SessionListFilters) => void,
] {
  const snapshot = useSyncExternalStore(
    subscribe,
    getSnapshot,
    () => DEFAULT_FILTERS_SNAPSHOT,
  );
  const setFilters = useCallback((next: SessionListFilters) => {
    writeSessionFilters(next);
  }, []);

  return [parseSnapshot(snapshot), setFilters];
}

export function areSessionFiltersDefault(filters: SessionListFilters): boolean {
  return (
    filters.type === DEFAULT_FILTERS.type &&
    filters.mode === DEFAULT_FILTERS.mode &&
    filters.track === DEFAULT_FILTERS.track
  );
}

export function matchesSessionFilters(
  session: SessionSummary,
  filters: SessionListFilters,
): boolean {
  const kind = summaryKind(session);
  if (filters.type === "race" && kind !== "race") return false;
  if (filters.type === "long-run" && kind !== "long-run") return false;
  if (filters.type === "quali" && kind !== "qualifying") return false;
  if (filters.type === "tt" && kind !== "time-trial") return false;
  if (filters.track && getTrackId(session.track) !== filters.track)
    return false;
  if (filters.mode === "online" && session.isOnline !== true) return false;
  if (
    filters.mode === "ai" &&
    (session.isOnline === true || (session.aiDifficulty ?? 0) <= 0)
  ) {
    return false;
  }
  return true;
}

const TYPE_PARAM: Record<SessionTypeFilter, string> = {
  all: "",
  race: "races",
  "long-run": "long-runs",
  quali: "qualifying",
  tt: "time-trial",
};

/** Filters as URL search params (`?type=races&online=1&track=sakhir`). */
export function sessionFiltersToParams(
  filters: SessionListFilters,
): URLSearchParams {
  const params = new URLSearchParams();
  if (filters.type !== "all") params.set("type", TYPE_PARAM[filters.type]);
  if (filters.mode !== "all") params.set("mode", filters.mode);
  if (filters.track) params.set("track", filters.track);
  return params;
}

export function sessionFiltersFromParams(
  params: URLSearchParams,
): SessionListFilters | null {
  if (!params.has("type") && !params.has("mode") && !params.has("track")) {
    return null;
  }
  const type = (Object.entries(TYPE_PARAM).find(
    ([, value]) => value !== "" && value === params.get("type"),
  )?.[0] ?? "all") as SessionTypeFilter;
  return normalizeFilters({
    type,
    mode: params.get("mode") as SessionModeFilter,
    track: params.get("track"),
  });
}
