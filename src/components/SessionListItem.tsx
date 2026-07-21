import { NavLink } from "react-router-dom";
import type { SessionSummary } from "../types/telemetry";
import { cn } from "../utils/cn";
import { formatSessionType, formatTime } from "../utils/format";
import { sessionSummaryPath } from "../utils/routes";
import { SessionCard } from "./SessionCard";

interface SessionListItemProps {
  session: SessionSummary;
  isTrackBest: boolean;
  hideMode: boolean;
}

/** One session sidebar row, interactive for real data and static for demo data. */
export function SessionListItem({
  session,
  isTrackBest,
  hideMode,
}: SessionListItemProps) {
  const card = (
    <SessionCard
      sessionType={formatSessionType(session.sessionType, session.formula)}
      track={session.track}
      time={formatTime(session.date)}
      lapIndicators={session.lapIndicators}
      bestLapTime={session.bestLapTime}
      isTrackBest={isTrackBest}
      aiDifficulty={session.aiDifficulty}
      isOnline={session.isOnline}
      isSpectator={session.isSpectator}
      hideMode={hideMode}
    />
  );

  if (session.isSynthetic) {
    return (
      <div
        title="Demo data — upload your telemetry to explore detail"
        className="block rounded-xl px-2 py-2 text-zinc-400"
      >
        {card}
      </div>
    );
  }

  return (
    <NavLink
      to={sessionSummaryPath(session)}
      className={({ isActive }) =>
        cn(
          "block rounded-xl px-2 py-2 transition-colors",
          isActive
            ? "bg-zinc-800/70 text-white"
            : "text-zinc-400 hover:bg-zinc-900/60 hover:text-zinc-200",
        )
      }
    >
      {card}
    </NavLink>
  );
}
