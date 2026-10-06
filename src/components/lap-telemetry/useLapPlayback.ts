import { useEffect, useState, useSyncExternalStore } from "react";
import { valueAt } from "../../analysis/lapTelemetryAnalysis";
import type { HoverStore } from "./hoverStore";

const PLAYBACK_SPEEDS = [0.25, 0.5, 1, 2, 4] as const;
type PlaybackSpeed = (typeof PLAYBACK_SPEEDS)[number];

const MAX_FRAME_S = 0.1;
/** Within this of the range end, Play starts over instead of finishing at once. */
const END_EPSILON_M = 1;

/**
 * Drives the shared cursor along lap A in real time (times `speed`), inside
 * `range` so a zoomed sector or tip plays on its own. Lap A's clock maps time
 * to distance, so every lap's inputs are read at the same track position.
 */
export function useLapPlayback({
  store,
  grid,
  time,
  range,
}: {
  store: HoverStore;
  grid: Float64Array;
  /** Lap A's elapsed seconds at each grid point. */
  time: Float32Array;
  range: [number, number];
}) {
  const playing = useSyncExternalStore(
    store.subscribe,
    store.isPlaying,
    store.isPlaying,
  );
  const [speed, setSpeed] = useState<PlaybackSpeed>(1);
  const [from, to] = range;

  useEffect(() => {
    if (!playing) return;
    let frame = 0;
    let last: number | null = null;
    const tick = (now: number) => {
      // Capped so a background tab, where frames stop, resumes where it was.
      const dt = last === null ? 0 : Math.min((now - last) / 1000, MAX_FRAME_S);
      last = now;
      const head = Math.min(Math.max(store.getPlayhead() ?? from, from), to);
      // Distance -> lap time -> advance -> distance; both maps are the same
      // monotonic piecewise-linear clock, so the round trip is exact enough.
      const t = valueAt(grid, time, head) + dt * speed;
      const next = Math.min(valueAt(time, grid, t), to);
      store.seek(next);
      if (next >= to) {
        store.setPlaying(false);
        return;
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing, speed, store, grid, time, from, to]);

  return {
    playing,
    speed,
    toggle() {
      if (playing) {
        store.setPlaying(false);
        return;
      }
      const head = store.getPlayhead();
      if (head === null || head < from || head >= to - END_EPSILON_M)
        store.seek(from);
      store.setPlaying(true);
    },
    restart() {
      store.seek(from);
      store.setPlaying(true);
    },
    cycleSpeed() {
      const index = PLAYBACK_SPEEDS.indexOf(speed);
      setSpeed(PLAYBACK_SPEEDS[(index + 1) % PLAYBACK_SPEEDS.length]);
    },
  };
}

export type LapPlayback = ReturnType<typeof useLapPlayback>;
