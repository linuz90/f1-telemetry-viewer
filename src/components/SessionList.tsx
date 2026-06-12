import { useEffect, useState } from "react";
import { NavLink } from "react-router-dom";
import { useSessionList } from "../hooks/useSessionList";
import type { SessionSummary } from "../types/telemetry";
import { formatDate, formatTime, formatSessionType, toTrackSlug, sortTracksByCalendar } from "../utils/format";
import { isQualifyingSessionType, isRaceSessionType } from "../utils/sessionTypes";
import { getFormulaScopeOptions, getSessionFormulaScopeKey } from "../utils/dashboardStats";
import { TrackFlag } from "./TrackFlag";
import { SessionCard } from "./SessionCard";
import {
  SessionListFilterMenu,
  DEFAULT_FILTERS,
  type SessionListFilters,
} from "./SessionListFilterMenu";

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
const FILTERS_STORAGE_KEY = "session-list-filters";

function representativeFormulaKey(sessions: SessionSummary[]): string | undefined {
  return getFormulaScopeOptions(sessions)[0]?.key;
}

function readPersistedFilters(): SessionListFilters {
  if (typeof window === "undefined") return DEFAULT_FILTERS;
  try {
    const raw = window.sessionStorage.getItem(FILTERS_STORAGE_KEY);
    if (!raw) return DEFAULT_FILTERS;
    const parsed = JSON.parse(raw) as Partial<SessionListFilters>;
    return {
      type: parsed.type === "race" || parsed.type === "quali" ? parsed.type : "all",
      mode: parsed.mode === "online" || parsed.mode === "ai" ? parsed.mode : "all",
      formula: typeof parsed.formula === "string" ? parsed.formula : null,
    };
  } catch {
    return DEFAULT_FILTERS;
  }
}

export function SessionList() {
  const { sessions, loading, error } = useSessionList();
  const [tab, setTab] = useState<"sessions" | "tracks">("sessions");
  const [filters, setFilters] = useState<SessionListFilters>(readPersistedFilters);
  const [page, setPage] = useState(0);

  // Persist filters across reloads within the same tab session.
  useEffect(() => {
    try {
      window.sessionStorage.setItem(FILTERS_STORAGE_KEY, JSON.stringify(filters));
    } catch {
      // Ignore storage failures (e.g. private mode quota limits).
    }
  }, [filters]);

  const updateFilters = (next: SessionListFilters) => {
    setFilters(next);
    setPage(0);
  };

  if (loading) {
    return (
      <div className="p-4 text-sm text-zinc-500">Loading sessions...</div>
    );
  }

  if (error) {
    return <div className="p-4 text-sm text-behind">{error}</div>;
  }

  if (sessions.length === 0) {
    return (
      <div className="p-4 text-sm text-zinc-500">
        No telemetry files found.
      </div>
    );
  }

  // First pass: type + mode. We derive formula options from this set so the formula chips reflect
  // what's actually available under the current type/mode selection, not the formula filter itself.
  // Synthetic (demo-only) entries DO appear here so the sidebar reads like a real session list;
  // clicking one lands on the SessionPage's friendly "Demo session — upload to explore detail"
  // placeholder rather than a 404.
  const typeModeFiltered = sessions.filter((s) => {
    if (filters.type === "race" && !isRaceSessionType(s.sessionType)) return false;
    if (filters.type === "quali" && !isQualifyingSessionType(s.sessionType)) return false;
    if (filters.mode === "online" && s.isOnline !== true) return false;
    if (filters.mode === "ai" && (s.isOnline === true || (s.aiDifficulty ?? 0) <= 0)) return false;
    return true;
  });

  const trackFormulaOptions = getFormulaScopeOptions(typeModeFiltered);
  // Drop a persisted formula key that no longer matches any available scope so the UI silently
  // falls back to the first option instead of showing nothing selected.
  const activeTrackFormulaKey = trackFormulaOptions.some((option) => option.key === filters.formula)
    ? filters.formula
    : trackFormulaOptions[0]?.key ?? null;

  // Second pass: apply formula. Both tabs filter by formula now that it lives in the shared menu.
  const filteredSessions = activeTrackFormulaKey
    ? typeModeFiltered.filter((s) => getSessionFormulaScopeKey(s) === activeTrackFormulaKey)
    : typeModeFiltered;

  const pageCount = Math.ceil(filteredSessions.length / PAGE_SIZE);
  const safePage = Math.min(page, Math.max(0, pageCount - 1));
  const pagedSessions = filteredSessions.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE);

  const grouped = groupByDate(pagedSessions);
  const tracks = sortTracksByCalendar(
    [...new Set(filteredSessions.map((s) => s.track))],
    activeTrackFormulaKey,
  );

  // Compute best lap time per track (lowest ms wins)
  const bestTimeByTrack: Record<string, number> = {};
  for (const s of filteredSessions) {
    if (s.bestLapTimeMs && s.bestLapTimeMs > 0) {
      const key = `${s.track}::${getSessionFormulaScopeKey(s)}`;
      const prev = bestTimeByTrack[key];
      if (!prev || s.bestLapTimeMs < prev) {
        bestTimeByTrack[key] = s.bestLapTimeMs;
      }
    }
  }

  return (
    <nav className="flex flex-col">
      {/* Sticky header: tabs + filter */}
      <div className="sticky top-0 z-10 bg-black/85 backdrop-blur">
        <div className="flex items-center px-2 pt-2">
          <div className="flex flex-1">
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
          <div className="pb-[7px] pl-2">
            <SessionListFilterMenu
              value={filters}
              onChange={updateFilters}
              formulaOptions={trackFormulaOptions.map((f) => ({ key: f.key, label: f.label }))}
              activeFormulaKey={activeTrackFormulaKey ?? null}
            />
          </div>
        </div>

        {tab === "sessions" && pageCount > 1 && (
          <div className="flex items-center justify-between px-2 py-1 mt-1">
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
        {tab === "sessions" && filteredSessions.length === 0 && (
          <div className="px-2 py-4 text-sm text-zinc-500">
            No sessions match these filters.{" "}
            <button
              type="button"
              onClick={() => updateFilters(DEFAULT_FILTERS)}
              className="font-medium text-sky-400 hover:text-sky-300"
            >
              Reset
            </button>
          </div>
        )}
        {tab === "tracks" && tracks.length === 0 && (
          <div className="px-2 py-4 text-sm text-zinc-500">
            No tracks match these filters.{" "}
            <button
              type="button"
              onClick={() => updateFilters(DEFAULT_FILTERS)}
              className="font-medium text-sky-400 hover:text-sky-300"
            >
              Reset
            </button>
          </div>
        )}
        {tab === "sessions" &&
          grouped.map(([dateKey, dateSessions]) => (
            <div key={dateKey}>
              <h3 className="px-2 mb-1 text-xs font-semibold uppercase tracking-wider text-zinc-500">
                {formatDate(dateKey + "T00:00:00")}
              </h3>
              <div className="space-y-0.5">
                {dateSessions.map((s) => {
                  const card = (
                    <SessionCard
                      sessionType={formatSessionType(s.sessionType, s.formula)}
                      track={s.track}
                      time={formatTime(s.date)}
                      lapIndicators={s.lapIndicators}
                      bestLapTime={s.bestLapTime}
                      isTrackBest={!!s.bestLapTimeMs && s.bestLapTimeMs === bestTimeByTrack[`${s.track}::${getSessionFormulaScopeKey(s)}`]}
                      aiDifficulty={s.aiDifficulty}
                      isSpectator={s.isSpectator}
                      formula={s.formula}
                      gameYear={s.gameYear}
                      isAutoSave={s.isAutoSave}
                    />
                  );
                  // Synthetic (demo) entries have no detail JSON, so they
                  // render as static rows — visible to populate the sidebar
                  // but not clickable. Real sessions stay as NavLinks.
                  if (s.isSynthetic) {
                    return (
                      <div
                        key={s.relativePath}
                        title="Demo data — upload your telemetry to explore detail"
                        className="block rounded-xl px-2 py-2 text-zinc-400"
                      >
                        {card}
                      </div>
                    );
                  }
                  return (
                    <NavLink
                      key={s.relativePath}
                      to={`/session/${s.slug}`}
                      className={({ isActive }) =>
                        `block rounded-xl px-2 py-2 transition-colors ${
                          isActive
                            ? "bg-zinc-800/70 text-white"
                            : "text-zinc-400 hover:bg-zinc-900/60 hover:text-zinc-200"
                        }`
                      }
                    >
                      {card}
                    </NavLink>
                  );
                })}
              </div>
            </div>
          ))}

        {tab === "tracks" &&
          tracks.map((track) => {
            const trackSessions = filteredSessions.filter((s) => s.track === track);
            const count = trackSessions.length;
            const formulaKey = activeTrackFormulaKey ?? representativeFormulaKey(trackSessions);
            const bestTime = trackSessions
              .filter((s) => getSessionFormulaScopeKey(s) === formulaKey && s.bestLapTimeMs)
              .sort((a, b) => (a.bestLapTimeMs ?? Infinity) - (b.bestLapTimeMs ?? Infinity))[0]?.bestLapTime;
            // A track whose every session is synthetic has no usable detail
            // page (the TrackPage filters those out, so navigation lands on
            // "No sessions found"). Render as a dim, non-interactive row.
            const isSyntheticOnly = trackSessions.every((s) => s.isSynthetic);
            const trackContent = (
              <>
                <TrackFlag track={track} />
                <span className="flex-1 truncate font-medium">{track}</span>
                {bestTime && (
                  <span className="text-xs font-mono text-best">{bestTime}</span>
                )}
                <span className="text-xs text-zinc-500 tabular-nums w-5 text-right">{count}</span>
              </>
            );
            if (isSyntheticOnly) {
              return (
                <div
                  key={track}
                  title="Demo data — upload your telemetry to explore this track"
                  className="flex items-center gap-2 rounded-xl px-2 py-1.5 text-sm text-zinc-400"
                >
                  {trackContent}
                </div>
              );
            }
            const trackPath = formulaKey
              ? `/track/${toTrackSlug(track)}?formula=${encodeURIComponent(formulaKey)}`
              : `/track/${toTrackSlug(track)}`;
            return (
              <NavLink
                key={track}
                to={trackPath}
                className={({ isActive }) =>
                  `flex items-center gap-2 rounded-xl px-2 py-1.5 text-sm transition-colors ${
                    isActive
                      ? "bg-zinc-800/70 text-white"
                      : "text-zinc-400 hover:bg-zinc-900/60 hover:text-zinc-200"
                  }`
                }
              >
                {trackContent}
              </NavLink>
            );
          })}
      </div>
    </nav>
  );
}
