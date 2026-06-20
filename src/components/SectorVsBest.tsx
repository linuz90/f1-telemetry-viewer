import type { TelemetrySession } from "../types/telemetry";
import { buildSectorVsBestModel } from "../analysis/sectorAnalysis";
import { cn } from "../utils/cn";
import { getTeamColor } from "../utils/colors";
import { msToLapTime, msToSectorTime } from "../utils/format";
import { accentCardClass, neutralCardClass } from "./Card";
import { Eyebrow } from "./ui/Eyebrow";
import { InsightValue } from "./ui/InsightText";
import { SectionHeader } from "./ui/SectionHeader";

interface SectorVsBestProps {
  session: TelemetrySession;
  focusedDriverIndex: number;
}

/**
 * Compares the focused driver's best sector times against the session-best sectors,
 * showing deltas and who holds the best in each sector.
 */
export function SectorVsBest({
  session,
  focusedDriverIndex,
}: SectorVsBestProps) {
  const model = buildSectorVsBestModel({
    session,
    focusedDriverIndex,
  });
  if (!model) return null;

  return (
    <div>
      <SectionHeader size="sm" title="Sectors vs Best" />
      <div className="grid grid-cols-4 gap-3">
        {/* Fastest lap */}
        <div
          className={cn(
            "rounded-lg px-3 py-3",
            model.isFocusedBestLap
              ? accentCardClass("purple")
              : neutralCardClass,
          )}
        >
          <div className="mb-2">
            <Eyebrow>Lap</Eyebrow>
          </div>
          <InsightValue size="md">
            {model.focusedBestLap !== null
              ? msToLapTime(model.focusedBestLap)
              : "–"}
          </InsightValue>
          {model.lapDeltaMs !== null && (
            <div
              className={cn(
                "font-mono text-sm mt-0.5",
                model.isFocusedBestLap
                  ? "text-best"
                  : model.lapDeltaMs < 100
                    ? "text-yellow-400"
                    : "text-behind",
              )}
            >
              {model.isFocusedBestLap
                ? "Session best"
                : `+${(model.lapDeltaMs / 1000).toFixed(3)}`}
            </div>
          )}
          {!model.isFocusedBestLap && model.sessionBestLap > 0 && (
            <div className="flex items-center gap-1.5 mt-2 text-xs text-zinc-500">
              <span
                className="inline-block w-1.5 h-1.5 rounded-full"
                style={{
                  backgroundColor: getTeamColor(model.sessionBestLapTeam),
                }}
              />
              <span className="truncate">
                {model.sessionBestLapDriver}{" "}
                <span className="font-mono">
                  {msToLapTime(model.sessionBestLap)}
                </span>
              </span>
            </div>
          )}
        </div>

        {model.sectors.map((s) => (
          <div
            key={s.label}
            className={cn(
              "rounded-lg px-3 py-3",
              s.isFocusedBest ? accentCardClass("purple") : neutralCardClass,
            )}
          >
            <div className="mb-2">
              <Eyebrow>{s.label}</Eyebrow>
            </div>

            {/* Focused driver time */}
            <InsightValue size="md">
              {s.focusedBest !== null ? msToSectorTime(s.focusedBest) : "–"}
            </InsightValue>

            {/* Delta */}
            {s.deltaMs !== null && (
              <div
                className={cn(
                  "font-mono text-sm mt-0.5",
                  s.isFocusedBest
                    ? "text-best"
                    : s.deltaMs < 100
                      ? "text-yellow-400"
                      : "text-behind",
                )}
              >
                {s.isFocusedBest
                  ? "Session best"
                  : `+${(s.deltaMs / 1000).toFixed(3)}`}
              </div>
            )}

            {/* Session best holder */}
            {!s.isFocusedBest && s.sessionBest > 0 && (
              <div className="flex items-center gap-1.5 mt-2 text-xs text-zinc-500">
                <span
                  className="inline-block w-1.5 h-1.5 rounded-full"
                  style={{ backgroundColor: getTeamColor(s.sessionBestTeam) }}
                />
                <span className="truncate">
                  {s.sessionBestDriver}{" "}
                  <span className="font-mono">
                    {msToSectorTime(s.sessionBest)}
                  </span>
                </span>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
