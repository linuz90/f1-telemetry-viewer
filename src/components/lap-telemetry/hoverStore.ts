import { useSyncExternalStore } from "react";

/**
 * Cursor distance shared by the trace panes, the readout and the track map.
 * A tiny external store keeps pointer moves from re-rendering the
 * (expensive) static traces: only subscribers update.
 *
 * Two sources feed the cursor: the pointer hover and the playback head. While
 * playing the head wins, so stray pointer moves cannot fight the animation;
 * while paused the pointer wins and the cursor rests on the head otherwise.
 */
export interface HoverStore {
  /** Cursor distance, or null when nothing is hovered or parked. */
  get(): number | null;
  /** Pointer hover. */
  set(distance: number | null): void;
  getPlayhead(): number | null;
  /** Move the playback head without changing play state. */
  seek(distance: number | null): void;
  isPlaying(): boolean;
  setPlaying(playing: boolean): void;
  subscribe(listener: () => void): () => void;
}

export function createHoverStore(): HoverStore {
  let hover: number | null = null;
  let playhead: number | null = null;
  let playing = false;
  let cursor: number | null = null;
  const listeners = new Set<() => void>();
  const update = (force = false) => {
    const next = playing ? playhead : (hover ?? playhead);
    if (!force && next === cursor) return;
    cursor = next;
    for (const listener of listeners) listener();
  };
  return {
    get: () => cursor,
    set(distance) {
      if (distance === hover) return;
      hover = distance;
      update();
    },
    getPlayhead: () => playhead,
    seek(distance) {
      playhead = distance;
      update();
    },
    isPlaying: () => playing,
    setPlaying(next) {
      if (next === playing) return;
      playing = next;
      // Play state is read by the controls even when the cursor stays put.
      update(true);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

export function useHoverDistance(store: HoverStore): number | null {
  return useSyncExternalStore(store.subscribe, store.get, store.get);
}
