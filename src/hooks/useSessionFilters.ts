import { useCallback, useSyncExternalStore } from "react";
import {
  SESSION_FILTERS_CHANGED_EVENT,
  SESSION_FILTERS_STORAGE_KEY,
} from "../constants/storage";
import type { SessionSummary } from "../types/telemetry";
import {
  isQualifyingSessionType,
  isRaceSessionType,
} from "../utils/sessionTypes";
import { readStoredString, writeStoredString } from "../utils/storage";

export type SessionTypeFilter = "all" | "race" | "quali";
export type SessionModeFilter = "all" | "online" | "ai";

export interface SessionListFilters {
  type: SessionTypeFilter;
  mode: SessionModeFilter;
}

export const DEFAULT_FILTERS: SessionListFilters = {
  type: "all",
  mode: "all",
};

const DEFAULT_FILTERS_SNAPSHOT = JSON.stringify(DEFAULT_FILTERS);

let memoryFilters = DEFAULT_FILTERS;

function normalizeFilters(
  value: Partial<SessionListFilters> | null | undefined,
): SessionListFilters {
  return {
    type:
      value?.type === "race" || value?.type === "quali" ? value.type : "all",
    mode: value?.mode === "online" || value?.mode === "ai" ? value.mode : "all",
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
    const raw = readStoredString(SESSION_FILTERS_STORAGE_KEY, "session");
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

  writeStoredString(
    SESSION_FILTERS_STORAGE_KEY,
    JSON.stringify(filters),
    "session",
  );
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
    filters.mode === DEFAULT_FILTERS.mode
  );
}

export function matchesSessionFilters(
  session: SessionSummary,
  filters: SessionListFilters,
): boolean {
  if (filters.type === "race" && !isRaceSessionType(session.sessionType))
    return false;
  if (filters.type === "quali" && !isQualifyingSessionType(session.sessionType))
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
