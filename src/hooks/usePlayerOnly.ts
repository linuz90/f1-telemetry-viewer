import { useCallback, useSyncExternalStore } from "react";

const STORAGE_KEY = "player-only";

function getSnapshot(): boolean {
  return localStorage.getItem(STORAGE_KEY) === "true";
}

function subscribe(callback: () => void): () => void {
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
    localStorage.setItem(STORAGE_KEY, String(next));
    window.dispatchEvent(new Event("player-only-changed"));
  }, []);

  return [playerOnly, toggle];
}
