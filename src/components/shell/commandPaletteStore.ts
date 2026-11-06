import { useSyncExternalStore } from "react";

/**
 * Open state of the ⌘K palette, shared by the top-bar search, the menus'
 * "Search" entries and the global shortcut without threading a context.
 */
let open = false;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

export function setCommandPaletteOpen(next: boolean) {
  if (open === next) return;
  open = next;
  emit();
}

export function useCommandPaletteOpen(): boolean {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => open,
    () => false,
  );
}
