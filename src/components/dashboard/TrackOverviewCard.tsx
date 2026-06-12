import { Link } from "react-router-dom";
import type { SessionSummary } from "../../types/telemetry";
import { formatShortDate, toTrackSlug } from "../../utils/format";
import { cardClassCompact } from "../Card";
import { TrackFlag } from "../TrackFlag";
import { TrackLayout } from "../TrackLayout";
import { trackFormulaPath } from "./helpers";

export function TrackOverviewCard({
  track,
  sessions,
  activeFormulaKey,
  bestTime,
}: {
  track: string;
  sessions: SessionSummary[];
  activeFormulaKey: string | undefined;
  bestTime: string | undefined;
}) {
  const lastDriven = sessions
    .map((session) => new Date(session.date).getTime())
    .sort((a, b) => b - a)[0];
  // Synthetic-only tracks have nothing to show on the TrackPage — render the
  // card as static, dim, and non-interactive in demo mode.
  const isSyntheticOnly = sessions.every((session) => session.isSynthetic);

  const inner = (
    <div className="flex items-center gap-3">
      <div className="min-w-0 flex-1 flex flex-col gap-1">
        <div className="flex items-center gap-1.5 text-base font-semibold">
          <TrackFlag track={track} />
          {track}
        </div>
        <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-zinc-400">
          <span>
            {sessions.length} {sessions.length === 1 ? "session" : "sessions"}
          </span>
          {bestTime && (
            <span className="font-mono text-purple-400">Best {bestTime}</span>
          )}
          {lastDriven && (
            <span>
              Last {formatShortDate(new Date(lastDriven).toISOString())}
            </span>
          )}
        </div>
      </div>
      <TrackLayout
        track={track}
        className="size-14 shrink-0 text-zinc-500/40 transition-colors group-hover:text-purple-400/60 [&>svg]:size-full"
      />
    </div>
  );

  if (isSyntheticOnly) {
    return (
      <div
        title="Demo data — upload your telemetry to explore this track"
        className={`${cardClassCompact} opacity-70`}
      >
        {inner}
      </div>
    );
  }

  return (
    <Link
      to={
        activeFormulaKey
          ? trackFormulaPath(track, activeFormulaKey)
          : `/track/${toTrackSlug(track)}`
      }
      className={`${cardClassCompact} group transition-colors hover:bg-zinc-800/50`}
    >
      {inner}
    </Link>
  );
}
