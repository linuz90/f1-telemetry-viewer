import type { TyreStint } from "../types/telemetry";
import { getCompoundColor } from "../utils/colors";

interface StintTimelineProps {
  stints: TyreStint[];
  totalLaps: number;
}

/**
 * Horizontal bar showing each stint as a colored block.
 * Width proportional to stint length relative to total laps.
 */
export function StintTimeline({ stints, totalLaps }: StintTimelineProps) {
  if (!stints.length) {
    return <p className="text-sm text-zinc-500">No stint data available.</p>;
  }

  const effectiveTotal =
    totalLaps || stints.reduce((s, t) => s + t["stint-length"], 0);

  return (
    <div>
      <h3 className="text-sm font-semibold text-zinc-300 mb-2">
        Stint Strategy
      </h3>
      <div className="flex h-10 rounded-lg overflow-hidden gap-0.5">
        {stints.map((stint, i) => {
          const compound = stint["tyre-set-data"]["visual-tyre-compound"];
          const color = getCompoundColor(compound);
          const widthPct = (stint["stint-length"] / effectiveTotal) * 100;
          const isLastUnfinished =
            i === stints.length - 1 && stint["end-lap"] < totalLaps;

          return (
            <div
              key={i}
              className="flex items-center justify-center text-xs font-bold relative"
              style={{
                width: `${widthPct}%`,
                backgroundColor: color,
                color: compound === "Hard" ? "#18181b" : "#fff",
                minWidth: "40px",
                ...(isLastUnfinished && {
                  maskImage:
                    "linear-gradient(to right, black 90%, transparent)",
                }),
              }}
              title={`${compound}: Laps ${stint["start-lap"]}–${stint["end-lap"]} (${stint["stint-length"]} laps)`}
            >
              <span className="truncate px-1">
                {compound[0]} · L{stint["start-lap"]}–{stint["end-lap"]}
              </span>
            </div>
          );
        })}
      </div>
      {/* Legend */}
      <div className="flex gap-4 mt-2 text-xs text-zinc-400">
        {stints.map((stint, i) => (
          <span key={i} className="flex items-center gap-1">
            <span
              className="inline-block w-2.5 h-2.5 rounded-sm"
              style={{
                backgroundColor: getCompoundColor(
                  stint["tyre-set-data"]["visual-tyre-compound"],
                ),
              }}
            />
            {stint["tyre-set-data"]["visual-tyre-compound"]} (
            {stint["stint-length"]} laps)
          </span>
        ))}
      </div>
    </div>
  );
}
