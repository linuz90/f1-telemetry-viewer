import { useState } from "react";
import { NavLink } from "react-router-dom";
import { useSessionList } from "../hooks/useSessionList";
import type { SessionSummary } from "../types/telemetry";
import { formatDate, formatTime, formatSessionType, toTrackSlug, sortTracksByCalendar } from "../utils/format";
import { TrackFlag } from "./TrackFlag";
import { SessionCard } from "./SessionCard";

/** Groups sessions by date for display */
function groupByDate(sessions: SessionSummary[]) {
  const groups: Record<string, SessionSummary[]> = {};
  for (const s of sessions) {
    const dateKey = s.date.split("T")[0];
    if (!groups[dateKey]) groups[dateKey] = [];
    groups[dateKey].push(s);
  }
  return Object.entries(groups).sort(([a], [b]) => b.localeCompare(a));
}

export function SessionList() {
  const { sessions, loading, error } = useSessionList();
  const [tab, setTab] = useState<"sessions" | "tracks">("sessions");
  const [typeFilter, setTypeFilter] = useState<"all" | "race" | "quali">("all");
  const [modeFilter, setModeFilter] = useState<"all" | "online" | "ai">("all");

  if (loading) {
    return (
      <div className="p-4 text-sm text-zinc-500">Loading sessions...</div>
    );
  }

  if (error) {
    return <div className="p-4 text-sm text-red-400">{error}</div>;
  }

  if (sessions.length === 0) {
    return (
      <div className="p-4 text-sm text-zinc-500">
        No telemetry files found.
      </div>
    );
  }

  const filteredSessions = sessions.filter((s) => {
    if (typeFilter === "race" && s.sessionType !== "Race") return false;
    if (typeFilter === "quali" && !s.sessionType.includes("Qualifying")) return false;
    if (modeFilter === "online" && !(s.aiDifficulty == null || s.aiDifficulty === 0)) return false;
    if (modeFilter === "ai" && (s.aiDifficulty == null || s.aiDifficulty === 0)) return false;
    return true;
  });

  const grouped = groupByDate(filteredSessions);
  const tracks = sortTracksByCalendar([...new Set(filteredSessions.map((s) => s.track))]);

  // Compute best lap time per track (lowest ms wins)
  const bestTimeByTrack: Record<string, number> = {};
  const bestTimeStrByTrack: Record<string, string> = {};
  for (const s of filteredSessions) {
    if (s.bestLapTimeMs && s.bestLapTimeMs > 0) {
      const prev = bestTimeByTrack[s.track];
      if (!prev || s.bestLapTimeMs < prev) {
        bestTimeByTrack[s.track] = s.bestLapTimeMs;
        if (s.bestLapTime) bestTimeStrByTrack[s.track] = s.bestLapTime;
      }
    }
  }

  return (
    <nav className="flex flex-col">
      {/* Sticky header: tabs + filter */}
      <div className="sticky top-0 z-10 bg-black">
        <div className="flex border-b border-zinc-800/60 px-2 pt-2">
          <button
            onClick={() => setTab("sessions")}
            className={`flex-1 pb-2 text-xs font-semibold uppercase tracking-wider transition-colors ${
              tab === "sessions"
                ? "text-white border-b-2 border-white"
                : "text-zinc-500 hover:text-zinc-300"
            }`}
          >
            Sessions
          </button>
          <button
            onClick={() => setTab("tracks")}
            className={`flex-1 pb-2 text-xs font-semibold uppercase tracking-wider transition-colors ${
              tab === "tracks"
                ? "text-white border-b-2 border-white"
                : "text-zinc-500 hover:text-zinc-300"
            }`}
          >
            Tracks
          </button>
        </div>

        {tab === "sessions" && (
          <div className="flex items-center gap-1.5 mx-2 mt-2 mb-1">
            <div className="flex flex-1 gap-0.5 p-0.5 rounded-lg bg-zinc-950/50">
              {(["all", "race", "quali"] as const).map((value) => (
                <button
                  key={value}
                  onClick={() => setTypeFilter(value)}
                  className={`flex-1 rounded-md px-2 py-1 text-[11px] font-medium transition-colors ${
                    typeFilter === value
                      ? "bg-zinc-900 text-zinc-200 shadow-sm"
                      : "text-zinc-500 hover:text-zinc-400"
                  }`}
                >
                  {value === "all" ? "All" : value === "race" ? "Race" : "Quali"}
                </button>
              ))}
            </div>
            <button
              onClick={() => setModeFilter((prev) => prev === "all" ? "online" : prev === "online" ? "ai" : "all")}
              className={`shrink-0 rounded-md px-2 py-1 text-[11px] font-medium transition-colors ${
                modeFilter === "all"
                  ? "text-zinc-500 hover:text-zinc-400 bg-zinc-950/50"
                  : modeFilter === "online"
                    ? "bg-sky-500/20 text-sky-400"
                    : "bg-zinc-900/50 text-zinc-300"
              }`}
            >
              {modeFilter === "all" ? "All" : modeFilter === "online" ? "Online" : "AI"}
            </button>
          </div>
        )}
      </div>

      <div className={`p-2 ${tab === "sessions" ? "space-y-4" : "space-y-0.5"}`}>
        {tab === "sessions" &&
          grouped.map(([dateKey, dateSessions]) => (
            <div key={dateKey}>
              <h3 className="px-2 mb-1 text-xs font-semibold uppercase tracking-wider text-zinc-500">
                {formatDate(dateKey + "T00:00:00")}
              </h3>
              <div className="space-y-0.5">
                {dateSessions.map((s) => (
                  <NavLink
                    key={s.relativePath}
                    to={`/session/${s.slug}`}
                    className={({ isActive }) =>
                      `block rounded-lg px-2 py-2 transition-colors ${
                        isActive
                          ? "bg-zinc-900 text-white"
                          : "text-zinc-400 hover:bg-zinc-900/50 hover:text-zinc-200"
                      }`
                    }
                  >
                    <SessionCard
                      sessionType={formatSessionType(s.sessionType)}
                      track={s.track}
                      time={formatTime(s.date)}
                      lapIndicators={s.lapIndicators}
                      bestLapTime={s.bestLapTime}
                      isTrackBest={!!s.bestLapTimeMs && s.bestLapTimeMs === bestTimeByTrack[s.track]}
                      aiDifficulty={s.aiDifficulty}
                      isSpectator={s.isSpectator}
                    />
                  </NavLink>
                ))}
              </div>
            </div>
          ))}

        {tab === "tracks" &&
          tracks.map((track) => {
            const count = sessions.filter((s) => s.track === track).length;
            const bestTime = bestTimeStrByTrack[track];
            return (
              <NavLink
                key={track}
                to={`/track/${toTrackSlug(track)}`}
                className={({ isActive }) =>
                  `flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm transition-colors ${
                    isActive
                      ? "bg-zinc-900 text-white"
                      : "text-zinc-400 hover:bg-zinc-900/50 hover:text-zinc-200"
                  }`
                }
              >
                <TrackFlag track={track} />
                <span className="flex-1 truncate font-medium">{track}</span>
                {bestTime && (
                  <span className="text-xs font-mono text-purple-400">{bestTime}</span>
                )}
                <span className="text-xs text-zinc-500 tabular-nums w-5 text-right">{count}</span>
              </NavLink>
            );
          })}
      </div>
    </nav>
  );
}
