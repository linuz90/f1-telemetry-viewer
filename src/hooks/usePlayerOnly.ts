import { useCallback, useSyncExternalStore } from "react";
import {
  PLAYER_ONLY_CHANGED_EVENT,
  PLAYER_ONLY_STORAGE_KEY,
} from "../constants/storage";
import { readStoredBoolean, writeStoredBoolean } from "../utils/storage";

function getSnapshot(): boolean {
  return readStoredBoolean(PLAYER_ONLY_STORAGE_KEY);
}

function subscribe(callback: () => void): () => void {
  if (typeof window === "undefined") return () => {};

  const handler = (e: StorageEvent) => {
    if (e.key === PLAYER_ONLY_STORAGE_KEY) callback();
  };
  // Listen to changes from other tabs
  window.addEventListener("storage", handler);
  // Custom event for same-tab updates
  window.addEventListener(PLAYER_ONLY_CHANGED_EVENT, callback);
  return () => {
    window.removeEventListener("storage", handler);
    window.removeEventListener(PLAYER_ONLY_CHANGED_EVENT, callback);
  };
}

export function usePlayerOnly(): [boolean, () => void] {
  const playerOnly = useSyncExternalStore(subscribe, getSnapshot);

  const toggle = useCallback(() => {
    const next = !getSnapshot();
    writeStoredBoolean(PLAYER_ONLY_STORAGE_KEY, next);
    window.dispatchEvent(new Event(PLAYER_ONLY_CHANGED_EVENT));
  }, []);

  return [playerOnly, toggle];
}
