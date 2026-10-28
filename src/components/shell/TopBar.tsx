import { useCallback } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { FolderUp, Search } from "lucide-react";
import { useTelemetry } from "../../context/TelemetryContext";
import { useScopedSessions, useTrackIndex } from "../../hooks/useSessionLog";
import {
  DEFAULT_FILTERS,
  sessionFiltersToParams,
  type SessionListFilters,
} from "../../hooks/useSessionFilters";
import { buildSessionLog } from "../../analysis/sessionLog";
import { recentTracks } from "../../analysis/trackIndex";
import { sessionRowLabel } from "../../analysis/sessionKind";
import {
  SESSIONS_ROUTE_SEGMENT,
  TRACKS_ROUTE_SEGMENT,
} from "../../constants/routes";
import { AppBrand } from "../AppBrand";
import { AppLogo } from "../AppLogo";
import { FormulaScopeSelect } from "../FormulaScopeSelect";
import { TrackFlag } from "../TrackFlag";
import { TrackOutline } from "../TrackOutline";
import { getTrackDisplayName } from "../../utils/tracks";
import { msToLapTime } from "../../utils/format";
import {
  dashboardPath,
  replaceFormulaScopeInPath,
  sessionSummaryPath,
  trackPath,
  tracksPath,
} from "../../utils/routes";
import { cn } from "../../utils/cn";
import {
  formatDayLabel,
  offlineGroupSummary,
  sessionClock,
  sessionResult,
} from "../sessions/sessionFormat";
import { MenuSection, NavHoverMenu } from "./NavHoverMenu";
import { setCommandPaletteOpen } from "./commandPaletteStore";

const menuRow =
  "flex items-baseline justify-between gap-6 rounded-lg px-2.5 py-1.5 text-tone-100 hover:bg-tone-800";

function SessionsMenu() {
  const { activeFormulaKey } = useTelemetry();
  const scoped = useScopedSessions();
  const navigate = useNavigate();
  const groups = buildSessionLog(scoped.slice(0, 120)).flatMap(
    (day) => day.groups,
  );
  const latestOnline = groups.find((group) => group.online);
  const earlier = groups.filter((group) => group !== latestOnline).slice(0, 2);
  const home = dashboardPath(activeFormulaKey);
  const filterTo = (filters: Partial<SessionListFilters>) => {
    const params = sessionFiltersToParams({ ...DEFAULT_FILTERS, ...filters });
    navigate(`${home}?${params.toString()}`);
  };

  return (
    <div className="w-[22rem]">
      {latestOnline && (
        <>
          <MenuSection>
            Latest · {formatDayLabel(latestOnline.dayKey)} ·{" "}
            {getTrackDisplayName(latestOnline.track)} · Online
          </MenuSection>
          {latestOnline.sessions.map((session) => {
            const result = sessionResult(session);
            return (
              <Link
                key={session.slug}
                to={sessionSummaryPath(session)}
                className={menuRow}
              >
                <span>{sessionRowLabel(session)}</span>
                <span className="text-xs text-tone-400 tabular-nums">
                  {result && (
                    <b className="font-semibold text-tone-100">{result.main}</b>
                  )}{" "}
                  {result?.detail} · {sessionClock(session)}
                </span>
              </Link>
            );
          })}
        </>
      )}
      {earlier.length > 0 && (
        <>
          <MenuSection>Earlier</MenuSection>
          {earlier.map((group) => {
            const summary = group.online
              ? (sessionResult(group.sessions[0])?.main ?? "")
              : offlineGroupSummary(group)
                  .map((part) => part.label)
                  .join(" · ");
            return (
              <Link
                key={group.key}
                to={sessionSummaryPath(group.sessions[0])}
                className={menuRow}
              >
                <span className="truncate">
                  <TrackFlag track={group.track} className="mr-1.5" />
                  {formatDayLabel(group.dayKey)} ·{" "}
                  {group.online ? "Online" : "Practice"}
                </span>
                <span className="shrink-0 text-xs text-tone-400">
                  {summary}
                </span>
              </Link>
            );
          })}
        </>
      )}
      <div className="mt-1.5 flex flex-wrap gap-1.5 border-t border-tone-800 px-2.5 pt-2.5 pb-1.5">
        {(
          [
            ["Races", { type: "race" }],
            ["Qualifying", { type: "quali" }],
            ["Long runs", { type: "long-run" }],
            ["Online only", { mode: "online" }],
          ] as const
        ).map(([label, filters]) => (
          <button
            key={label}
            type="button"
            onClick={() => filterTo(filters)}
            className="rounded-full px-2.5 py-0.5 text-xs text-tone-300 ring-1 ring-tone-700 hover:text-tone-50"
          >
            {label}
          </button>
        ))}
      </div>
      <div className="flex items-center justify-between border-t border-tone-800 px-2.5 pt-2 pb-1 text-xs">
        <Link to={home} className="text-tone-100 hover:underline">
          All sessions →
        </Link>
        <button
          type="button"
          onClick={() => setCommandPaletteOpen(true)}
          className="text-tone-400 hover:text-tone-100"
        >
          Search{" "}
          <kbd className="ml-1 rounded px-1 ring-1 ring-tone-700">⌘K</kbd>
        </button>
      </div>
    </div>
  );
}

function TracksMenu() {
  const { activeFormulaKey } = useTelemetry();
  const index = useTrackIndex();
  if (!activeFormulaKey) return null;
  const recent = recentTracks(index, 4);
  return (
    <div className="w-[26rem]">
      <MenuSection>Recent tracks</MenuSection>
      <div className="grid grid-cols-2 gap-1">
        {recent.map((entry, i) => (
          <Link
            key={entry.trackId}
            to={trackPath(activeFormulaKey, entry.trackId)}
            className="flex items-center gap-3 rounded-lg p-2 hover:bg-tone-800"
          >
            <TrackOutline
              track={entry.track}
              glow={i === 0}
              className="h-9 w-12 shrink-0"
            />
            <span className="min-w-0">
              <span className="block truncate text-sm font-medium text-tone-100">
                {getTrackDisplayName(entry.track)}
              </span>
              <span className="block text-xs text-tone-400 tabular-nums">
                {entry.qualiPbMs ? (
                  <span className="text-best">
                    {msToLapTime(entry.qualiPbMs)}
                  </span>
                ) : (
                  `${entry.sessionCount} sessions`
                )}{" "}
                · {formatDayLabel(entry.lastDate.split("T")[0])}
              </span>
            </span>
          </Link>
        ))}
      </div>
      <div className="mt-1 flex items-center justify-between border-t border-tone-800 px-2.5 pt-2 pb-1 text-xs">
        <Link
          to={tracksPath(activeFormulaKey)}
          className="text-tone-100 hover:underline"
        >
          All {index.entries.length} tracks →
        </Link>
        {index.notDriven.length > 0 && (
          <span className="text-tone-500">
            {index.notDriven.length} not driven yet
          </span>
        )}
      </div>
    </div>
  );
}

export function TopBar({
  hasUnseenChangelog,
  onOpenChangelog,
}: {
  hasUnseenChangelog: boolean;
  onOpenChangelog: () => void;
}) {
  const { mode, setShowUploadModal, formulaOptions, activeFormulaKey } =
    useTelemetry();
  const location = useLocation();
  const navigate = useNavigate();
  const [, , section] = location.pathname.split("/");
  const onTracks = section === TRACKS_ROUTE_SEGMENT;
  const onSessions = !onTracks;
  const home = dashboardPath(activeFormulaKey);

  const handleFormulaScopeChange = useCallback(
    (nextKey: string) => {
      if (nextKey === activeFormulaKey) return;
      // A session belongs to one game scope: changing scope from a session
      // page lands on that scope's Sessions page instead of a missing URL.
      if (section === SESSIONS_ROUTE_SEGMENT || !activeFormulaKey) {
        navigate(dashboardPath(nextKey));
        return;
      }
      navigate(replaceFormulaScopeInPath(location.pathname, nextKey));
    },
    [activeFormulaKey, location.pathname, navigate, section],
  );

  return (
    <header className="sticky top-0 z-40 border-b border-tone-800/70 bg-canvas/85 backdrop-blur-md">
      <div className="mx-auto flex h-14 max-w-6xl items-center gap-2 px-4 sm:gap-4 sm:px-6">
        <Link
          to={home}
          aria-label="Sessions home"
          className="flex items-center gap-2.5 font-semibold tracking-tight text-tone-50 transition-opacity hover:opacity-80"
        >
          <AppLogo className="h-[18px]" />
          <span className="hidden sm:inline">
            <AppBrand />
          </span>
        </Link>
        {formulaOptions.length > 1 && activeFormulaKey && (
          <FormulaScopeSelect
            options={formulaOptions}
            value={activeFormulaKey}
            onChange={handleFormulaScopeChange}
          />
        )}
        {activeFormulaKey && (
          <nav className="flex items-center gap-0.5 sm:ml-2">
            <NavHoverMenu to={home} label="Sessions" active={onSessions}>
              <SessionsMenu />
            </NavHoverMenu>
            <NavHoverMenu
              to={tracksPath(activeFormulaKey)}
              label="Tracks"
              active={onTracks}
            >
              <TracksMenu />
            </NavHoverMenu>
          </nav>
        )}
        <div className="flex-1" />
        {(mode === "upload" || mode === "demo") && (
          <button
            type="button"
            onClick={() => setShowUploadModal(true)}
            title="Load different data"
            className="rounded-lg p-1.5 text-tone-400 transition-colors hover:bg-tone-900 hover:text-tone-100"
          >
            <FolderUp className="size-4" />
          </button>
        )}
        {hasUnseenChangelog && (
          <button
            type="button"
            onClick={onOpenChangelog}
            className="hidden items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium text-tone-200 ring-1 ring-tone-700 transition-colors hover:bg-tone-900 hover:text-tone-50 sm:inline-flex"
          >
            <span aria-hidden className="size-1.5 rounded-full bg-brand" />
            What's new
          </button>
        )}
        <button
          type="button"
          onClick={() => setCommandPaletteOpen(true)}
          aria-label="Search"
          className={cn(
            "flex items-center gap-2.5 rounded-lg bg-tone-900 py-1.5 pr-1.5 pl-2.5 text-sm text-tone-500 ring-1 ring-tone-800 transition-colors hover:text-tone-300",
          )}
        >
          <Search aria-hidden className="size-3.5" />
          <span className="hidden md:inline">
            Search sessions, tracks, drivers
          </span>
          <kbd className="rounded-md px-1.5 text-xs text-tone-400 ring-1 ring-tone-700">
            ⌘K
          </kbd>
        </button>
      </div>
    </header>
  );
}
