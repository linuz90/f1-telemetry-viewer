import { X } from "lucide-react";
import type { DriverData } from "../../types/telemetry";
import type { RaceDriverStats } from "../../analysis/resultsAnalysis";
import { useScopedSessions } from "../../hooks/useSessionLog";
import { getTeamName } from "../../utils/colors";
import { msToLapTime } from "../../utils/format";
import { driverNameKey } from "../../utils/stats/drivers";

function signed(ms: number) {
  const s = (ms / 1000).toFixed(3);
  return ms > 0 ? `+${s}` : ms < 0 ? `−${s.slice(1)}` : "0.000";
}

/**
 * A rival in context: this race against you, then your history with them
 * from the session summaries (races together, same-tyre pace gap).
 */
export function DriverPanel({
  driver,
  you,
  stats,
  onClose,
  onCompare,
}: {
  driver: DriverData;
  you: DriverData | undefined;
  stats: Map<number, RaceDriverStats>;
  onClose: () => void;
  onCompare: () => void;
}) {
  const scoped = useScopedSessions();
  const key = driverNameKey(driver["driver-name"]);
  const meetings = scoped.filter((s) => s.rivals?.some((r) => r.key === key));
  const paced = meetings
    .map(
      (s) => s.rivals!.find((r) => r.key === key)!.compoundMatchedPaceDeltaMs,
    )
    .filter((d): d is number => typeof d === "number");
  const avgPace = paced.length
    ? paced.reduce((a, b) => a + b, 0) / paced.length
    : null;
  const fc = driver["final-classification"];
  const own = you ? stats.get(you.index) : undefined;
  const theirs = stats.get(driver.index);

  const row = (
    label: string,
    value: string,
    delta?: string,
    tone?: "faster" | "slower",
  ) => (
    <div className="flex items-baseline justify-between gap-3 border-t border-tone-800 py-2 text-sm first:border-t-0">
      <span className="text-tone-400">{label}</span>
      <span className="font-mono font-semibold text-tone-50">{value}</span>
      <span
        className={
          tone === "faster"
            ? "w-16 text-right font-mono text-xs text-behind"
            : tone === "slower"
              ? "w-16 text-right font-mono text-xs text-ahead"
              : "w-16"
        }
      >
        {delta}
      </span>
    </div>
  );

  return (
    <aside className="rounded-2xl bg-tone-900 p-5 shadow-2xl shadow-tone-1000/40 ring-1 ring-tone-700 lg:sticky lg:top-20">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-lg font-semibold tracking-tight text-tone-50">
            {driver["driver-name"]}
          </div>
          <div className="text-xs text-tone-500">
            {getTeamName(driver.team)}
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="rounded-lg p-1 text-tone-500 hover:bg-tone-800 hover:text-tone-100"
        >
          <X className="size-4" />
        </button>
      </div>
      <div className="mt-4 text-xs text-tone-500">This race</div>
      <div className="mt-1">
        {row(
          "Result",
          fc ? `P${fc.position}` : "–",
          fc?.["grid-position"] ? `from P${fc["grid-position"]}` : undefined,
        )}
        {theirs &&
          theirs.racePace > 0 &&
          row(
            "Race pace",
            msToLapTime(theirs.racePace),
            own && own.racePace > 0
              ? signed(theirs.racePace - own.racePace)
              : undefined,
            own && own.racePace > 0
              ? theirs.racePace < own.racePace
                ? "faster"
                : "slower"
              : undefined,
          )}
        {theirs &&
          theirs.bestLap > 0 &&
          row(
            "Best lap",
            msToLapTime(theirs.bestLap),
            own && own.bestLap > 0
              ? signed(theirs.bestLap - own.bestLap)
              : undefined,
            own && own.bestLap > 0
              ? theirs.bestLap < own.bestLap
                ? "faster"
                : "slower"
              : undefined,
          )}
      </div>
      {meetings.length > 0 && (
        <>
          <div className="mt-4 text-xs text-tone-500">
            You and {driver["driver-name"]}
          </div>
          <div className="mt-1">
            {row("Races together", String(meetings.length))}
            {avgPace != null &&
              row(
                "Their pace vs yours",
                `${(Math.abs(avgPace) / 1000).toFixed(3)} s`,
                avgPace < 0 ? "faster" : "slower",
              )}
          </div>
        </>
      )}
      <button
        type="button"
        onClick={onCompare}
        className="mt-4 text-sm text-active hover:underline"
      >
        Compare laps with {driver["driver-name"]} →
      </button>
    </aside>
  );
}
