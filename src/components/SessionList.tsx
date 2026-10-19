import { CalendarDays, Route } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { matchPath, useLocation } from "react-router-dom";
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
import { sessionSummaryPath } from "../utils/routes";
import { getSessionFormulaScopeKey } from "../utils/formulaScope";
import {
  isQualifyingSessionType,
  isTimeTrialSessionType,
} from "../utils/sessionTypes";
import { readStoredString, writeStoredString } from "../utils/storage";
import { getTrackId, sortTracksByCalendar } from "../utils/tracks";
import { sessionSaveSlugs } from "../utils/deduplicateSessions";
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

/** The open page's row, waiting for its tab and page of sessions to render. */
interface PendingReveal {
  tab: SidebarTab;
  /** Page of sessions holding the row; unset for tracks or a filtered-out session. */
  page?: number;
  /** Link of the row to reveal; unset means the active one (`aria-current`). */
  href?: string;
  flash: boolean;
}

/** The sidebar tab listing the open page, if it is a session or a track. */
function routeTab(pathname: string): SidebarTab | null {
  if (matchPath("/:formulaKey/tracks/:trackId", pathname)) return "tracks";
  if (matchPath("/:formulaKey/sessions/*", pathname)) return "sessions";
  return null;
}

/** Colour the row peaks at when it flashes. */
const ROW_FLASH_COLOR = "rgba(255, 255, 255, 0.28)";
const ROW_FLASH_MS = 1_200;

/**
 * Scroll a row into view unless it is already visible below the sticky
 * header, then optionally flash it once so the eye finds it. Returns a
 * cleanup that cancels a flash still waiting to be seen.
 */
function revealRow(
  row: HTMLElement,
  header: HTMLElement | null,
  flash: boolean,
): (() => void) | undefined {
  // The sidebar scrolls in Layout's <aside>, the nav's parent.
  const scroller = header?.closest("nav")?.parentElement;
  if (!header || !scroller) return;
  const { top, bottom } = row.getBoundingClientRect();
  const visibleTop = header.getBoundingClientRect().bottom;
  const visibleBottom = scroller.getBoundingClientRect().bottom;
  if (top < visibleTop || bottom > visibleBottom) {
    row.scrollIntoView({ block: "center", behavior: "smooth" });
  }
  if (!flash || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  // Flash once the row is fully on screen below the header: when a smooth
  // scroll lands, or when the closed mobile drawer is opened.
  const observer = new IntersectionObserver(
    ([entry]) => {
      if (!entry?.isIntersecting) return;
      observer.disconnect();
      // Only the peak is given: both ends follow the row's live background,
      // which may still be mid-transition to its active colour.
      row.animate([{ backgroundColor: ROW_FLASH_COLOR, offset: 0.2 }], {
        duration: ROW_FLASH_MS,
        easing: "ease-out",
      });
    },
    {
      rootMargin: `-${Math.max(0, Math.round(visibleTop))}px 0px 0px 0px`,
      // Just under 1: rounding can keep a fully shown row a hair below it.
      threshold: 0.95,
    },
  );
  observer.observe(row);
  return () => observer.disconnect();
}

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
  const key = `${getTrackId(session.track)}::${getSessionFormulaScopeKey(session)}::${kind}`;
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
  const { pathname } = useLocation();
  const headerRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const pendingReveal = useRef<PendingReveal | null>(null);
  // The row a click in this list opened; it needs no flash, the user knows.
  const clickedPath = useRef<string | null>(null);
  const cancelFlash = useRef<(() => void) | undefined>(undefined);
  useEffect(() => () => cancelFlash.current?.(), []);

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
  const pageCount = Math.ceil(filteredSessions.length / PAGE_SIZE);
  const safePage = Math.min(page, Math.max(0, pageCount - 1));

  // Opening a session or track page shows its row: its tab, its page of
  // sessions, then the row itself, flashed unless it was clicked here. Only
  // navigation does this, so a tab picked by hand stays until the next page.
  const listReady = !loading && sessions.length > 0;
  useEffect(() => {
    const target = routeTab(pathname);
    if (!target || !listReady) return;
    setTab(target);
    // `endsWith` tolerates the base path an embedding host serves under.
    const flash = !clickedPath.current?.endsWith(pathname);
    clickedPath.current = null;
    const pending: PendingReveal = { tab: target, flash };
    if (target === "sessions") {
      // A restarted run that dedupe hid has no row of its own; the row it was
      // folded into stands in for it.
      const slug = matchPath("/:formulaKey/sessions/*", pathname)?.params["*"];
      const index = slug
        ? filteredSessions.findIndex((s) => sessionSaveSlugs(s).includes(slug))
        : -1;
      if (index >= 0) {
        pending.page = Math.floor(index / PAGE_SIZE);
        pending.href = sessionSummaryPath(filteredSessions[index]);
        setPage(pending.page);
      }
    }
    pendingReveal.current = pending;
    cancelFlash.current?.();
    cancelFlash.current = undefined;
    // filteredSessions is read at navigation time on purpose: following it
    // would undo every manual tab or page change.
  }, [pathname, listReady]);

  useEffect(() => {
    const pending = pendingReveal.current;
    if (!pending) return;
    const row = listRef.current?.querySelector<HTMLElement>(
      pending.href
        ? `a[href$="${CSS.escape(pending.href)}"]`
        : '[aria-current="page"]',
    );
    if (row) {
      pendingReveal.current = null;
      cancelFlash.current = revealRow(row, headerRef.current, pending.flash);
    } else if (
      tab === pending.tab &&
      (pending.page === undefined || safePage === pending.page)
    ) {
      // Its tab and page rendered without it (a sidebar filter hides it): let
      // it go, or a later filter change would scroll and flash out of nowhere.
      pendingReveal.current = null;
    }
  });

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

  const filtersActive = !areSessionFiltersDefault(filters);

  const pagedSessions = filteredSessions.slice(
    safePage * PAGE_SIZE,
    (safePage + 1) * PAGE_SIZE,
  );

  const grouped = groupByDate(pagedSessions);
  const trackSessionsById = new Map<string, SessionSummary[]>();
  for (const session of filteredSessions) {
    const trackId = getTrackId(session.track);
    const trackSessions = trackSessionsById.get(trackId) ?? [];
    trackSessions.push(session);
    trackSessionsById.set(trackId, trackSessions);
  }
  const tracks = sortTracksByCalendar(
    [...trackSessionsById.keys()],
    activeFormulaKey,
  );

  // Best lap time per track, split by session-type group. Time Trial is its
  // own leaderboard in-game, so the user expects the fastest TT lap at a
  // track to be highlighted even when a Short Quali ran faster — and vice
  // versa. Canonical track ids keep exporter aliases in the same PB bucket;
  // race sessions don't show a best lap in the sidebar row.
  const bestTimeByTrack: Record<string, number> = {};
  for (const s of filteredSessions) {
    if (s.isSpectator) continue;
    if (!s.bestLapTimeMs || s.bestLapTimeMs <= 0) continue;
    const kind = sessionBestLapKind(s.sessionType);
    if (!kind) continue;
    const key = `${getTrackId(s.track)}::${getSessionFormulaScopeKey(s)}::${kind}`;
    const prev = bestTimeByTrack[key];
    if (!prev || s.bestLapTimeMs < prev) {
      bestTimeByTrack[key] = s.bestLapTimeMs;
    }
  }

  return (
    <nav className="flex flex-col">
      {/* Sticky header: tabs + filter */}
      <div
        ref={headerRef}
        className="sticky top-0 z-10 bg-black/85 backdrop-blur"
      >
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
        ref={listRef}
        onClickCapture={(event) => {
          clickedPath.current =
            (event.target as Element).closest("a")?.pathname ?? null;
        }}
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
          tracks.map((trackId) => {
            const trackSessions = trackSessionsById.get(trackId) ?? [];
            const track = trackSessions[0]?.track ?? trackId;
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
                key={trackId}
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
