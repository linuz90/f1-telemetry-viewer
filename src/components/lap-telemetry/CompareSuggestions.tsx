import { Plus } from "lucide-react";
import type {
  LapCandidate,
  LapPreset,
} from "../../analysis/lapTelemetrySelection";
import { cn } from "../../utils/cn";
import { msToLapTime } from "../../utils/format";
import { Eyebrow } from "../ui/Eyebrow";
import { insetTileClass } from "../ui/surfaces";
import { lapColorBarClass } from "./lapColorBar";
import { driverLabel, recordingLabel, recordingTeamColor } from "./labels";

/**
 * What lap A can be compared with, one tap each, when no comparison is fair
 * enough to pick by itself: the presets that resolve to a lap, then the full
 * picker. Each says whose lap it is, where from, and how it stands against A.
 */
export function CompareSuggestions({
  a,
  presets,
  onPick,
  onMore,
}: {
  a: LapCandidate;
  presets: readonly LapPreset[];
  onPick: (candidate: LapCandidate) => void;
  onMore: () => void;
}) {
  const offered = presets.filter(
    (preset): preset is LapPreset & { candidate: LapCandidate } =>
      !!preset.candidate,
  );
  return (
    <div className="space-y-2">
      <p className="text-sm text-tone-400">
        Compare lap A with
        {offered.length > 0 ? ":" : " another recorded lap."}
      </p>
      <div className="flex flex-wrap items-stretch gap-2">
        {offered.map(({ id, label, candidate }) => {
          const gapS = (candidate.lapTimeMs - a.lapTimeMs) / 1000;
          const where =
            candidate.recording.id === a.recording.id
              ? `Lap ${candidate.ref.lapNumber}`
              : recordingLabel(candidate.recording, candidate.ref.driverIndex);
          return (
            <button
              key={id}
              type="button"
              onClick={() => onPick(candidate)}
              className={cn(
                insetTileClass,
                "flex min-w-48 flex-col gap-1 px-3 py-2 text-left transition-colors hover:bg-tone-700/40",
              )}
            >
              <Eyebrow>{label}</Eyebrow>
              <span className="flex min-w-0 items-center gap-2">
                <span
                  className={lapColorBarClass}
                  style={{
                    backgroundColor: recordingTeamColor(candidate.team),
                  }}
                />
                <span className="truncate text-sm text-tone-200">
                  {driverLabel(candidate.driverName, candidate.isPlayer)}
                </span>
                <span className="ml-auto font-mono text-sm tabular-nums text-tone-100">
                  {msToLapTime(candidate.lapTimeMs)}
                </span>
              </span>
              <span className="truncate text-2xs text-tone-500">
                {where} ·{" "}
                {Math.abs(gapS) < 0.0005
                  ? "level with A"
                  : `${Math.abs(gapS).toFixed(3)} s ${gapS < 0 ? "quicker" : "slower"}`}
              </span>
            </button>
          );
        })}
        <button
          type="button"
          onClick={onMore}
          className="flex min-w-36 items-center justify-center gap-1.5 rounded-xl border border-dashed border-tone-700 px-3 py-2 text-sm text-tone-400 transition-colors hover:bg-tone-800/50 hover:text-tone-200"
        >
          <Plus className="size-3.5" />
          {offered.length > 0 ? "Another lap" : "Choose a lap"}
        </button>
      </div>
    </div>
  );
}
