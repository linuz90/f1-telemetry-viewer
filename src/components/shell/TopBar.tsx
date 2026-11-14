import { listItemClass, cardSurface } from "../ui/surfaces";
import { pageGutterClass } from "../ui/page";
import { useCallback, useMemo, useRef, useState, type ReactNode } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { Bell, FolderUp, Search } from "lucide-react";
import { useTelemetry } from "../../context/TelemetryContext";
import { useScopedSessions, useTrackIndex } from "../../hooks/useSessionLog";
import {
  DEFAULT_FILTERS,
  sessionFiltersToParams,
  type SessionListFilters,
} from "../../hooks/useSessionFilters";
import {
  buildSessionLog,
  type SessionLogGroup,
} from "../../analysis/sessionLog";
import { recentTracks } from "../../analysis/trackIndex";
import { sessionRowLabel, summaryKind } from "../../analysis/sessionKind";
import {
  SESSIONS_ROUTE_SEGMENT,
  TRACK_TAB_QUERY_PARAM,
  TRACKS_ROUTE_SEGMENT,
} from "../../constants/routes";
import { APP_NAME } from "../../config/branding";
import { AppLogo } from "../AppLogo";
import { FormulaScopeSelect } from "../FormulaScopeSelect";
import { TrackFlag } from "../TrackFlag";
import { TrackOutline } from "../TrackOutline";
import { getTrackDisplayName } from "../../utils/tracks";
import { msToLapTime } from "../../utils/format";
import {
  dashboardPath,
  isTrackPageTab,
  replaceFormulaScopeInPath,
  sessionSummaryPath,
  trackPath,
  tracksPath,
} from "../../utils/routes";
import { cn } from "../../utils/cn";
import {
  formatDayLabel,
  offlineGroupLabel,
  offlineGroupSummary,
  sessionClock,
  sessionResult,
} from "../sessions/sessionFormat";
import { SessionResult } from "../sessions/SessionResult";
import { SessionKindIcon } from "../SessionKindIcon";
import { MenuSection, NavSection } from "./NavSection";
import {
  NavigationMenu,
  NavigationMenuLink,
  NavigationMenuList,
  NavigationMenuPopup,
} from "../ui/NavigationMenu";
import { setCommandPaletteOpen } from "./commandPaletteStore";

/** Groups (one online event or one day's practice at a track) under Recent. */
const RECENT_GROUPS = 5;

/**
 * Flag | track | date, with a second line under the track. Every cell is
 * placed explicitly because `TrackFlag` renders nothing for an unknown track,
 * which would otherwise shift the rest one column left.
 */
const trackGrid = "grid grid-cols-[1rem_1fr_auto] gap-x-1.5";

function GroupHeading({
  group,
  children,
}: {
  group: SessionLogGroup;
  children?: ReactNode;
}) {
  return (
    <>
      <TrackFlag
        track={group.track}
        className="col-start-1 row-start-1 self-center"
      />
      <span className="col-start-2 row-start-1 min-w-0 truncate font-medium text-tone-50">
        {getTrackDisplayName(group.track)}
        {children}
      </span>
      <span className="col-start-3 row-start-1 self-center text-right text-xs text-tone-500 tabular-nums">
        {formatDayLabel(group.dayKey)}
      </span>
    </>
  );
}

/** Second line of a Recent row: the event's results, or what was practised. */
function GroupDetail({ group }: { group: SessionLogGroup }) {
  if (group.online) {
    return (
      <>
        <span className="text-active">Online</span>
        {group.sessions.map((session) => {
          const result = sessionResult(session);
          return (
            <span key={session.slug}>
              {" · "}
              <SessionKindIcon
                kind={summaryKind(session)}
                label={sessionRowLabel(session)}
                className="text-tone-500"
              />{" "}
              {result ? (
                <SessionResult result={result} />
              ) : (
                sessionRowLabel(session)
              )}
            </span>
          );
        })}
      </>
    );
  }
  const summary = (
    <span className="text-tone-300">
      {offlineGroupSummary(group).map((part, i) => (
        <span key={part.kind}>
          {i > 0 && " · "}
          <span className="whitespace-nowrap">
            <SessionKindIcon kind={part.kind} className="mr-1 text-tone-500" />
            {part.label}
          </span>
        </span>
      ))}
    </span>
  );
  const label = offlineGroupLabel(group);
  // A time-trial group's summary ("3 time trials") already names it.
  if (label === "Time trial") return summary;
  return (
    <>
      {label} · {summary}
    </>
  );
}

function SessionsMenu() {
  const { activeFormulaKey } = useTelemetry();
  const scoped = useScopedSessions();
  const location = useLocation();
  const groups = useMemo(
    () => buildSessionLog(scoped.slice(0, 120)).flatMap((day) => day.groups),
    [scoped],
  );
  // The last online event stays pinned on top even when practice came after
  // it, since it is the session a driver most often comes back to.
  const latestOnline = groups.find((group) => group.online);
  const recent = groups
    .filter((group) => group !== latestOnline)
    .slice(0, RECENT_GROUPS);
  const home = dashboardPath(activeFormulaKey);
  const filterTo = (filters: Partial<SessionListFilters>) => {
    const params = sessionFiltersToParams({ ...DEFAULT_FILTERS, ...filters });
    return `${home}?${params.toString()}`;
  };

  return (
    <div className="w-[26rem]">
      {/* Shortcuts into the filtered log: quiet text links, so the
          sessions below stay the first thing the eye lands on. */}
      <div className="mb-1 flex gap-0.5 border-b border-tone-800 px-0.5 pb-1.5">
        {(
          [
            ["Races", { type: "race" }, "race"],
            ["Qualifying", { type: "quali" }, "qualifying"],
            ["Long runs", { type: "long-run" }, "long-run"],
            ["Online only", { mode: "online" }, null],
          ] as const
        ).map(([label, filters, kind]) => (
          <NavigationMenuLink
            key={label}
            render={<Link to={filterTo(filters)} />}
            className="rounded-md px-2 py-1 text-xs text-tone-500 transition-colors hover:bg-tone-800 hover:text-tone-100"
          >
            {kind && <SessionKindIcon kind={kind} className="mr-1" />}
            {label}
          </NavigationMenuLink>
        ))}
      </div>
      {latestOnline && (
        <>
          <MenuSection>Last online event</MenuSection>
          <div className={cn(trackGrid, "px-2.5 pt-0.5 pb-1")}>
            <GroupHeading group={latestOnline}>
              {latestOnline.driverCount ? (
                <span className="font-normal text-tone-500">
                  {" "}
                  · {latestOnline.driverCount} drivers
                </span>
              ) : null}
            </GroupHeading>
          </div>
          {latestOnline.sessions.map((session) => {
            const result = sessionResult(session);
            return (
              <NavigationMenuLink
                key={session.slug}
                aria-current={
                  location.pathname === sessionSummaryPath(session)
                    ? "page"
                    : undefined
                }
                render={<Link to={sessionSummaryPath(session)} />}
                className={cn(
                  listItemClass,
                  "items-baseline gap-1.5 text-tone-200",
                )}
              >
                {/* Under the flag, so the label lines up with the track name. */}
                <SessionKindIcon
                  kind={summaryKind(session)}
                  className="mx-px size-3.5 self-center text-tone-500"
                />
                <span>{sessionRowLabel(session)}</span>
                <span className="ml-auto pl-6 text-xs text-tone-500 tabular-nums">
                  {result && (
                    <>
                      <SessionResult result={result} /> ·{" "}
                    </>
                  )}
                  {sessionClock(session)}
                </span>
              </NavigationMenuLink>
            );
          })}
        </>
      )}
      {recent.length > 0 && (
        <>
          <MenuSection>Recent</MenuSection>
          {recent.map((group) => {
            const best = Math.min(...Object.values(group.bestMs));
            return (
              <NavigationMenuLink
                key={group.key}
                aria-current={
                  location.pathname === sessionSummaryPath(group.sessions[0])
                    ? "page"
                    : undefined
                }
                render={<Link to={sessionSummaryPath(group.sessions[0])} />}
                className={cn(listItemClass, trackGrid)}
              >
                <GroupHeading group={group} />
                <span className="col-start-2 row-start-2 min-w-0 truncate text-xs text-tone-500">
                  <GroupDetail group={group} />
                </span>
                {Number.isFinite(best) && (
                  <span className="col-start-3 row-start-2 text-right font-mono text-xs text-tone-400 tabular-nums">
                    {msToLapTime(best)}
                  </span>
                )}
              </NavigationMenuLink>
            );
          })}
        </>
      )}
      <div className="mt-1.5 flex items-center justify-between border-t border-tone-800 px-2.5 pt-2 pb-1 text-xs">
        <NavigationMenuLink
          render={<Link to={home} />}
          className="text-tone-100 hover:underline"
        >
          All sessions →
        </NavigationMenuLink>
        <NavigationMenuLink
          render={<button type="button" />}
          onClick={() => setCommandPaletteOpen(true)}
          className="text-tone-400 hover:text-tone-100"
        >
          Search{" "}
          <kbd className="ml-1 rounded px-1 ring-1 ring-tone-700">⌘K</kbd>
        </NavigationMenuLink>
      </div>
    </div>
  );
}

function TracksMenu() {
  const { activeFormulaKey } = useTelemetry();
  const index = useTrackIndex();
  const location = useLocation();
  if (!activeFormulaKey) return null;
  const recent = recentTracks(index, 4);
  // From a track page, switching track keeps the tab, like the page's own
  // switcher. Session pages use `?tab=` too, so only a track route counts.
  const [, , section] = location.pathname.split("/");
  const currentTab =
    section === TRACKS_ROUTE_SEGMENT
      ? new URLSearchParams(location.search).get(TRACK_TAB_QUERY_PARAM)
      : null;
  const keptTab = isTrackPageTab(currentTab) ? currentTab : undefined;
  return (
    <div className="w-[26rem]">
      <MenuSection>Recent tracks</MenuSection>
      <div className="grid grid-cols-2 gap-1">
        {recent.map((entry) => (
          <NavigationMenuLink
            key={entry.trackId}
            aria-current={
              location.pathname === trackPath(activeFormulaKey, entry.trackId)
                ? "page"
                : undefined
            }
            render={
              <Link to={trackPath(activeFormulaKey, entry.trackId, keptTab)} />
            }
            className={cn(listItemClass, "gap-3 p-2")}
          >
            <TrackOutline track={entry.track} className="h-9 w-12 shrink-0" />
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
          </NavigationMenuLink>
        ))}
      </div>
      <div className="mt-1 flex items-center justify-between border-t border-tone-800 px-2.5 pt-2 pb-1 text-xs">
        <NavigationMenuLink
          render={<Link to={tracksPath(activeFormulaKey)} />}
          className="text-tone-100 hover:underline"
        >
          All {index.entries.length} tracks →
        </NavigationMenuLink>
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
  /** Omitted when the build has no changelog (no git history). */
  onOpenChangelog?: () => void;
}) {
  const { mode, setShowUploadModal, formulaOptions, activeFormulaKey } =
    useTelemetry();
  const location = useLocation();
  const navigate = useNavigate();
  // An open panel stays open when you click a Sessions or Tracks label (it is
  // inside the menu, so not an outside click), so close it on every
  // navigation. `location.key` changes even when the click lands on the page
  // you are already on, where the pathname would not. Set during render so
  // the panel never paints over the new page.
  const [navMenu, setNavMenu] = useState<string | null>(null);
  const [navKey, setNavKey] = useState(location.key);
  if (navKey !== location.key) {
    setNavKey(location.key);
    setNavMenu(null);
  }
  // The shared popup anchors to the open section's whole item rather than
  // its chevron trigger, so the panel lines up under the label.
  const navItems = useRef<Record<string, HTMLLIElement | null>>({});
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
      <div
        className={cn(pageGutterClass, "flex h-14 items-center gap-2 sm:gap-4")}
      >
        {/* The mark alone: the name is in the tab title and the tooltip, and
            the scope picker beside it says which game this is. */}
        <Link
          to={home}
          aria-label={`${APP_NAME}, sessions home`}
          title={APP_NAME}
          className="grid size-9 place-items-center rounded-lg text-tone-50 transition-colors hover:bg-tone-900"
        >
          <AppLogo className="size-[22px]" />
        </Link>
        {formulaOptions.length > 1 && activeFormulaKey && (
          <FormulaScopeSelect
            options={formulaOptions}
            value={activeFormulaKey}
            onChange={handleFormulaScopeChange}
          />
        )}
        {activeFormulaKey && (
          <NavigationMenu
            value={navMenu}
            onValueChange={(value) => setNavMenu(value as string | null)}
            delay={150}
            closeDelay={150}
            className="sm:ml-2"
            aria-label="Main navigation"
          >
            <NavigationMenuList className="flex items-center gap-1">
              <NavSection
                value="sessions"
                to={home}
                label="Sessions"
                active={onSessions}
                itemRef={(el) => {
                  navItems.current.sessions = el;
                }}
              >
                <SessionsMenu />
              </NavSection>
              <NavSection
                value="tracks"
                to={tracksPath(activeFormulaKey)}
                label="Tracks"
                active={onTracks}
                itemRef={(el) => {
                  navItems.current.tracks = el;
                }}
              >
                <TracksMenu />
              </NavSection>
            </NavigationMenuList>
            <NavigationMenuPopup
              anchor={() =>
                (navMenu ? navItems.current[navMenu] : null) ?? null
              }
            />
          </NavigationMenu>
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
        {/* Stays put once read: unseen entries get the dot, a seen changelog
            just fades back so it is still there to reopen. */}
        {onOpenChangelog && (
          <button
            type="button"
            onClick={onOpenChangelog}
            title="What's new"
            aria-label="What's new"
            className={cn(
              "relative hidden rounded-lg p-1.5 transition-colors hover:bg-tone-900 hover:text-tone-100 sm:block",
              hasUnseenChangelog ? "text-tone-400" : "text-tone-600",
            )}
          >
            <Bell className="size-4" />
            {hasUnseenChangelog && (
              <span
                aria-hidden
                className="absolute top-1 right-1 size-1.5 rounded-full bg-brand ring-2 ring-canvas"
              />
            )}
          </button>
        )}
        <button
          type="button"
          onClick={() => setCommandPaletteOpen(true)}
          aria-label="Search"
          className={cn(
            cardSurface,
            "flex items-center gap-2.5 rounded-lg py-1.5 pr-1.5 pl-2.5 text-sm text-tone-500 transition-colors hover:text-tone-300",
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
