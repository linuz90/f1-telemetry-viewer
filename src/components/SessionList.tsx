import { CalendarDays, Route } from "lucide-react";
import { useEffect, useState } from "react";
import { SESSION_LIST_TAB_STORAGE_KEY } from "../constants/storage";
import { useTelemetry } from "../context/TelemetryContext";
import {
  areSessionFiltersDefault,
  DEFAULT_FILTERS,
  matchesSessionFilters,
  useSessionFilters,
} from "../hooks/useSessionFilters";
import { useSessionList } from "../hooks/useSessionList";
import type { SessionSummary } from "../types/telemetry";
import { cn } from "../utils/cn";
import { formatRelativeDate, msToLapTime } from "../utils/format";
import { getSessionFormulaScopeKey } from "../utils/formulaScope";
import {
  isQualifyingSessionType,
  isTimeTrialSessionType,
} from "../utils/sessionTypes";
import { readStoredString, writeStoredString } from "../utils/storage";
import { sortTracksByCalendar } from "../utils/tracks";
import { SessionListActiveFilters } from "./SessionListActiveFilters";
import { SessionListFilterMenu } from "./SessionListFilterMenu";
import { SessionListItem } from "./SessionListItem";
import { resolveSessionMode } from "./sessionModeMeta";
import { TrackListItem, type TrackListBestLapKind } from "./TrackListItem";
import { HStack } from "./ui/Stack";
import { Tabs } from "./ui/Tabs";

const SIDEBAR_TABS = [
  { value: "sessions", label: "Sessions", icon: CalendarDays },
  { value: "tracks", label: "Tracks", icon: Route },
] as const;

// Only Quali and Time Trial rows display a best-lap pill in the sidebar; the
// helper lets us bucket those two kinds into separate per-track bests so a
// fast Quali lap doesn't steal the purple highlight from the user's best TT.
function sessionBestLapKind(
  sessionType: string,
): TrackListBestLapKind | undefined {
  if (isTimeTrialSessionType(sessionType)) return "tt";
  if (isQualifyingSessionType(sessionType)) return "quali";
  return undefined;
}

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

/** Per-row mode label — null when the session has no applicable mode (e.g. offline Time Trial). */
function sessionModeLabel(s: SessionSummary): string | null {
  return resolveSessionMode(s.isOnline, s.aiDifficulty)?.label ?? null;
}

/**
 * Group-level mode label hoisted into the date header so matching rows can omit it.
 * Considers only sessions that *have* a mode — a Time Trial without AI doesn't break
 * the uniformity of a group full of AI 110 races. Rows whose own mode differs from
 * the label (e.g. an Online TT in an AI-110 group) still show their tag.
 */
function groupModeLabel(sessions: SessionSummary[]): string | null {
  const labels = new Set<string>();
  for (const s of sessions) {
    const label = sessionModeLabel(s);
    if (label != null) labels.add(label);
  }
  return labels.size === 1 ? (labels.values().next().value ?? null) : null;
}

const PAGE_SIZE = 50;

type SidebarTab = "sessions" | "tracks";

function representativeFormulaKey(
  sessions: SessionSummary[],
): string | undefined {
  return sessions[0] ? getSessionFormulaScopeKey(sessions[0]) : undefined;
}

function isSessionTrackBest(
  session: SessionSummary,
  bestTimeByTrack: Readonly<Record<string, number>>,
): boolean {
  if (!session.bestLapTimeMs) return false;
  const kind = sessionBestLapKind(session.sessionType);
  if (!kind) return false;
  const key = `${session.track}::${getSessionFormulaScopeKey(session)}::${kind}`;
  return session.bestLapTimeMs === bestTimeByTrack[key];
}

interface TrackListBestLap {
  time: string;
  kind: TrackListBestLapKind;
  sessionCount: number;
}

function getTrackListBestLap(
  sessions: readonly SessionSummary[],
  formulaKey: string | undefined,
): TrackListBestLap | null {
  const counts: Record<TrackListBestLapKind, number> = { quali: 0, tt: 0 };
  let best:
    | { session: SessionSummary; kind: TrackListBestLapKind; timeMs: number }
    | undefined;

  for (const session of sessions) {
    const kind = sessionBestLapKind(session.sessionType);
    const timeMs = session.bestLapTimeMs;
    if (
      getSessionFormulaScopeKey(session) !== formulaKey ||
      session.isSpectator === true ||
      !kind ||
      timeMs == null ||
      timeMs <= 0
    ) {
      continue;
    }

    counts[kind] += 1;
    if (!best || timeMs < best.timeMs) best = { session, kind, timeMs };
  }

  if (!best) return null;
  return {
    time: best.session.bestLapTime ?? msToLapTime(best.timeMs),
    kind: best.kind,
    sessionCount: counts[best.kind],
  };
}

export function SessionList() {
  const { sessions, loading, error } = useSessionList();
  const { activeFormulaKey, formulaOptions } = useTelemetry();
  const [tab, setTab] = useState<SidebarTab>(() =>
    readStoredString(SESSION_LIST_TAB_STORAGE_KEY, "session") === "tracks"
      ? "tracks"
      : "sessions",
  );
  const [filters, setFilters] = useSessionFilters();
  const [page, setPage] = useState(0);

  // Keep the active tab scoped to this browser tab; filters are a longer-lived
  // preference shared with the dashboard via useSessionFilters().
  useEffect(() => {
    writeStoredString(SESSION_LIST_TAB_STORAGE_KEY, tab, "session");
  }, [tab]);

  useEffect(() => {
    setPage(0);
  }, [filters.type, filters.mode]);

  const updateFilters = (next: typeof filters) => {
    setFilters(next);
    setPage(0);
  };

  if (loading) {
    return <div className="p-4 text-sm text-zinc-500">Loading sessions...</div>;
  }

  if (error) {
    return <div className="p-4 text-sm text-behind">{error}</div>;
  }

  if (sessions.length === 0) {
    return (
      <div className="p-4 text-sm text-zinc-500">No telemetry files found.</div>
    );
  }

  if (!activeFormulaKey && formulaOptions.length > 0) {
    return (
      <div className="p-4 text-sm text-zinc-500">
        Choose a game scope to view sessions.
      </div>
    );
  }

  // Formula scope is app-wide, then the sidebar filters narrow that same set so
  // the matching/total count can make a persisted filter's impact explicit.
  // Synthetic demo entries still populate the sidebar, but their extracted row
  // components keep them static because no detail JSON exists to navigate to.
  const scopedSessions = activeFormulaKey
    ? sessions.filter((s) => getSessionFormulaScopeKey(s) === activeFormulaKey)
    : sessions;
  const filteredSessions = scopedSessions.filter((s) =>
    matchesSessionFilters(s, filters),
  );
  const filtersActive = !areSessionFiltersDefault(filters);

  const pageCount = Math.ceil(filteredSessions.length / PAGE_SIZE);
  const safePage = Math.min(page, Math.max(0, pageCount - 1));
  const pagedSessions = filteredSessions.slice(
    safePage * PAGE_SIZE,
    (safePage + 1) * PAGE_SIZE,
  );

  const grouped = groupByDate(pagedSessions);
  const tracks = sortTracksByCalendar(
    [...new Set(filteredSessions.map((s) => s.track))],
    activeFormulaKey,
  );

  // Best lap time per track, split by session-type group. Time Trial is its
  // own leaderboard in-game, so the user expects the fastest TT lap at a
  // track to be highlighted even when a Short Quali ran faster — and vice
  // versa. Keyed by `${track}::${scope}::${kind}` where kind is "tt" or
  // "quali"; race sessions don't show a best lap in the sidebar row.
  const bestTimeByTrack: Record<string, number> = {};
  for (const s of filteredSessions) {
    if (s.isSpectator) continue;
    if (!s.bestLapTimeMs || s.bestLapTimeMs <= 0) continue;
    const kind = sessionBestLapKind(s.sessionType);
    if (!kind) continue;
    const key = `${s.track}::${getSessionFormulaScopeKey(s)}::${kind}`;
    const prev = bestTimeByTrack[key];
    if (!prev || s.bestLapTimeMs < prev) {
      bestTimeByTrack[key] = s.bestLapTimeMs;
    }
  }

  return (
    <nav className="flex flex-col">
      {/* Sticky header: tabs + filter */}
      <div className="sticky top-0 z-10 bg-black/85 backdrop-blur">
        <HStack className="px-2 pt-2">
          <Tabs
            className="flex-1"
            options={SIDEBAR_TABS}
            value={tab}
            onChange={setTab}
            ariaLabel="Sidebar section"
          />
          <div className="pb-[7px] pl-2">
            <SessionListFilterMenu value={filters} onChange={updateFilters} />
          </div>
        </HStack>

        {filtersActive && (
          <SessionListActiveFilters
            value={filters}
            matchingCount={filteredSessions.length}
            totalCount={scopedSessions.length}
            onReset={() => updateFilters(DEFAULT_FILTERS)}
          />
        )}

        {tab === "sessions" && pageCount > 1 && (
          <HStack justify="between" className="mt-1 px-2 py-1">
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
          </HStack>
        )}
      </div>

      <div
        className={cn("p-2", tab === "sessions" ? "space-y-4" : "space-y-0.5")}
      >
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
          grouped.map(([dateKey, dateSessions]) => {
            const modeLabel = groupModeLabel(dateSessions);
            return (
              <div key={dateKey}>
                <h3 className="mb-1 px-2 font-mono text-xs font-semibold uppercase tracking-wider text-zinc-500">
                  {formatRelativeDate(dateKey + "T00:00:00")}
                  {modeLabel && (
                    <span className="ml-1.5 text-zinc-600">· {modeLabel}</span>
                  )}
                </h3>
                <div className="space-y-0.5">
                  {dateSessions.map((session) => (
                    <SessionListItem
                      key={session.relativePath}
                      session={session}
                      isTrackBest={isSessionTrackBest(session, bestTimeByTrack)}
                      hideMode={
                        modeLabel != null &&
                        sessionModeLabel(session) === modeLabel
                      }
                    />
                  ))}
                </div>
              </div>
            );
          })}

        {tab === "tracks" &&
          tracks.map((track) => {
            const trackSessions = filteredSessions.filter(
              (s) => s.track === track,
            );
            const count = trackSessions.length;
            const formulaKey =
              activeFormulaKey ?? representativeFormulaKey(trackSessions);
            const bestLap = getTrackListBestLap(trackSessions, formulaKey);
            // A track whose every session is synthetic has no usable detail
            // page (the TrackPage filters those out, so navigation lands on
            // "No sessions found"). Render as a dim, non-interactive row.
            const isSyntheticOnly = trackSessions.every((s) => s.isSynthetic);
            return (
              <TrackListItem
                key={track}
                track={track}
                formulaKey={formulaKey}
                totalSessionCount={count}
                bestLapTime={bestLap?.time}
                bestLapKind={bestLap?.kind}
                bestLapSessionCount={bestLap?.sessionCount}
                isSyntheticOnly={isSyntheticOnly}
              />
            );
          })}
      </div>
    </nav>
  );
}
