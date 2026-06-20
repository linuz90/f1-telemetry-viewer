import { useCallback, useSyncExternalStore } from "react";
import { readStoredBoolean, writeStoredBoolean } from "../utils/storage";

const STORAGE_KEY = "player-only";

function getSnapshot(): boolean {
  return readStoredBoolean(STORAGE_KEY);
}

function subscribe(callback: () => void): () => void {
  if (typeof window === "undefined") return () => {};

  const handler = (e: StorageEvent) => {
    if (e.key === STORAGE_KEY) callback();
  };
  // Listen to changes from other tabs
  window.addEventListener("storage", handler);
  // Custom event for same-tab updates
  window.addEventListener("player-only-changed", callback);
  return () => {
    window.removeEventListener("storage", handler);
    window.removeEventListener("player-only-changed", callback);
  };
}

export function usePlayerOnly(): [boolean, () => void] {
  const playerOnly = useSyncExternalStore(subscribe, getSnapshot);

  const toggle = useCallback(() => {
    const next = !getSnapshot();
    writeStoredBoolean(STORAGE_KEY, next);
    window.dispatchEvent(new Event("player-only-changed"));
  }, []);

  return [playerOnly, toggle];
}
