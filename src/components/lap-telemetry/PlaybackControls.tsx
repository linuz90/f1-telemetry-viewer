import { Pause, Play, RotateCcw } from "lucide-react";
import { cn } from "../../utils/cn";
import type { LapPlayback } from "./useLapPlayback";

const iconButton =
  "inline-flex size-6 items-center justify-center rounded-md text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-zinc-600";

/** Play/pause, restart and speed for the lap cursor. */
export function PlaybackControls({ playback }: { playback: LapPlayback }) {
  const { playing, speed, toggle, restart, cycleSpeed } = playback;
  return (
    <div className="flex shrink-0 items-center gap-0.5">
      <button
        type="button"
        onClick={toggle}
        aria-label={playing ? "Pause" : "Play lap"}
        title={playing ? "Pause" : "Play lap"}
        className={cn(iconButton, "bg-zinc-800/70 text-zinc-100")}
      >
        {playing ? (
          <Pause className="size-3.5" fill="currentColor" strokeWidth={0} />
        ) : (
          <Play
            className="size-3.5 translate-x-px"
            fill="currentColor"
            strokeWidth={0}
          />
        )}
      </button>
      <button
        type="button"
        onClick={restart}
        aria-label="Restart"
        title="Restart"
        className={iconButton}
      >
        <RotateCcw className="size-3.5" />
      </button>
      <button
        type="button"
        onClick={cycleSpeed}
        aria-label={`Playback speed ${speed}×, change`}
        title="Playback speed"
        className={cn(
          iconButton,
          "w-auto px-1.5 font-mono text-2xs tabular-nums",
        )}
      >
        {speed}×
      </button>
    </div>
  );
}
