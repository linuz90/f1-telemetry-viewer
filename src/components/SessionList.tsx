import { useState } from "react";
import { NavLink } from "react-router-dom";
import { useSessionList } from "../hooks/useSessionList";
import type { SessionSummary } from "../types/telemetry";
import { formatDate, formatTime, formatSessionType, toTrackSlug, sortTracksByCalendar } from "../utils/format";
import { compareFormulaComparisonKeys, getFormulaComparisonKey, getFormulaLabel, isQualifyingSessionType, isRaceSessionType } from "../utils/sessionTypes";
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

const PAGE_SIZE = 50;

interface TrackFormulaOption {
  key: string;
  label: string;
  timedSessionCount: number;
  latestTime: number;
}

function representativeFormulaKey(sessions: SessionSummary[]): string | undefined {
  // Track-list times come from summary best laps, so rank groups that can
  // actually display a time before falling back to race-only groups.
  const timedSessions = sessions.filter((s) => s.bestLapTimeMs && s.bestLapTimeMs > 0);
  const candidates = timedSessions.length > 0 ? timedSessions : sessions;

  return candidates
    .map((s) => ({
      formulaKey: getFormulaComparisonKey(s.formula, s.gameYear),
      time: new Date(s.date).getTime(),
    }))
    .sort((a, b) => {
      const formulaOrder = compareFormulaComparisonKeys(a.formulaKey, b.formulaKey);
      if (formulaOrder !== 0) return formulaOrder;
      return b.time - a.time;
    })[0]?.formulaKey;
}

function getFormulaOptions(sessions: SessionSummary[]): TrackFormulaOption[] {
  const options = new Map<string, TrackFormulaOption>();

  for (const session of sessions) {
    const key = getFormulaComparisonKey(session.formula, session.gameYear);
    const option = options.get(key) ?? {
      key,
      label: getFormulaLabel(session.formula, session.gameYear),
      timedSessionCount: 0,
      latestTime: 0,
    };

    if (session.bestLapTimeMs && session.bestLapTimeMs > 0) {
      option.timedSessionCount += 1;
    }
    option.latestTime = Math.max(option.latestTime, new Date(session.date).getTime());
    options.set(key, option);
  }

  return [...options.values()]
    .filter((option) => option.timedSessionCount > 0)
    .sort((a, b) => {
      const formulaOrder = compareFormulaComparisonKeys(a.key, b.key);
      if (formulaOrder !== 0) return formulaOrder;
      return b.latestTime - a.latestTime;
    });
}

export function SessionList() {
  const { sessions, loading, error } = useSessionList();
  const [tab, setTab] = useState<"sessions" | "tracks">("sessions");
  const [typeFilter, setTypeFilter] = useState<"all" | "race" | "quali">("all");
  const [modeFilter, setModeFilter] = useState<"all" | "online" | "ai">("all");
  const [trackFormulaFilter, setTrackFormulaFilter] = useState<string | null>(null);
  const [page, setPage] = useState(0);

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
    if (typeFilter === "race" && !isRaceSessionType(s.sessionType)) return false;
    if (typeFilter === "quali" && !isQualifyingSessionType(s.sessionType)) return false;
    if (modeFilter === "online" && !(s.aiDifficulty == null || s.aiDifficulty === 0)) return false;
    if (modeFilter === "ai" && (s.aiDifficulty == null || s.aiDifficulty === 0)) return false;
    return true;
  });

  const pageCount = Math.ceil(filteredSessions.length / PAGE_SIZE);
  const safePage = Math.min(page, Math.max(0, pageCount - 1));
  const pagedSessions = filteredSessions.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE);

  const grouped = groupByDate(pagedSessions);
  const trackFormulaOptions = getFormulaOptions(filteredSessions);
  const activeTrackFormulaKey = trackFormulaOptions.some((option) => option.key === trackFormulaFilter)
    ? trackFormulaFilter
    : trackFormulaOptions[0]?.key;
  const trackListSessions = activeTrackFormulaKey
    ? filteredSessions.filter((s) => getFormulaComparisonKey(s.formula, s.gameYear) === activeTrackFormulaKey)
    : filteredSessions;
  const tracks = sortTracksByCalendar([...new Set(trackListSessions.map((s) => s.track))]);

  // Compute best lap time per track (lowest ms wins)
  const bestTimeByTrack: Record<string, number> = {};
  for (const s of filteredSessions) {
    if (s.bestLapTimeMs && s.bestLapTimeMs > 0) {
      const key = `${s.track}::${getFormulaComparisonKey(s.formula, s.gameYear)}`;
      const prev = bestTimeByTrack[key];
      if (!prev || s.bestLapTimeMs < prev) {
        bestTimeByTrack[key] = s.bestLapTimeMs;
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
                  onClick={() => { setTypeFilter(value); setPage(0); }}
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
              onClick={() => { setModeFilter((prev) => prev === "all" ? "online" : prev === "online" ? "ai" : "all"); setPage(0); }}
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

        {tab === "tracks" && trackFormulaOptions.length > 1 && (
          <div className="mx-2 mt-2 mb-1 overflow-x-auto">
            <div className="flex min-w-max gap-0.5 p-0.5 rounded-lg bg-zinc-950/50" aria-label="Formula">
              {trackFormulaOptions.map((formula) => (
                <button
                  key={formula.key}
                  onClick={() => setTrackFormulaFilter(formula.key)}
                  className={`rounded-md px-2 py-1 text-[11px] font-medium transition-colors ${
                    activeTrackFormulaKey === formula.key
                      ? "bg-zinc-900 text-zinc-200 shadow-sm"
                      : "text-zinc-500 hover:text-zinc-400"
                  }`}
                >
                  {formula.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {tab === "sessions" && pageCount > 1 && (
          <div className="flex items-center justify-between px-2 py-1 border-t border-zinc-900">
            <button
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={safePage === 0}
              className="px-2 py-0.5 text-xs text-zinc-400 hover:text-zinc-200 disabled:text-zinc-700 disabled:cursor-default transition-colors"
            >
              ←
            </button>
            <span className="text-xs text-zinc-500 tabular-nums">
              {safePage + 1} / {pageCount}
            </span>
            <button
              onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
              disabled={safePage === pageCount - 1}
              className="px-2 py-0.5 text-xs text-zinc-400 hover:text-zinc-200 disabled:text-zinc-700 disabled:cursor-default transition-colors"
            >
              →
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
                      isTrackBest={!!s.bestLapTimeMs && s.bestLapTimeMs === bestTimeByTrack[`${s.track}::${getFormulaComparisonKey(s.formula, s.gameYear)}`]}
                      aiDifficulty={s.aiDifficulty}
                      isSpectator={s.isSpectator}
                      formula={s.formula}
                      gameYear={s.gameYear}
                    />
                  </NavLink>
                ))}
              </div>
            </div>
          ))}

        {tab === "tracks" &&
          tracks.map((track) => {
            const trackSessions = trackListSessions.filter((s) => s.track === track);
            const count = trackSessions.length;
            const formulaKey = activeTrackFormulaKey ?? representativeFormulaKey(trackSessions);
            const bestTime = trackSessions
              .filter((s) => getFormulaComparisonKey(s.formula, s.gameYear) === formulaKey && s.bestLapTimeMs)
              .sort((a, b) => (a.bestLapTimeMs ?? Infinity) - (b.bestLapTimeMs ?? Infinity))[0]?.bestLapTime;
            const trackPath = formulaKey
              ? `/track/${toTrackSlug(track)}?formula=${encodeURIComponent(formulaKey)}`
              : `/track/${toTrackSlug(track)}`;
            return (
              <NavLink
                key={track}
                to={trackPath}
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
