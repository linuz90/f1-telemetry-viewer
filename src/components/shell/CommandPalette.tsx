import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { useNavigate } from "react-router-dom";
import {
  ChartSpline,
  CornerDownLeft,
  Map as MapIcon,
  Route,
  Search,
  SlidersHorizontal,
  Sparkles,
  Timer,
  TrendingUp,
  type LucideIcon,
} from "lucide-react";
import { useTelemetry } from "../../context/TelemetryContext";
import { useScopedSessions, useTrackIndex } from "../../hooks/useSessionLog";
import { sessionRowLabel, summaryKind } from "../../analysis/sessionKind";
import { getTrackDisplayName, getTrackId } from "../../utils/tracks";
import { getTeamColor } from "../../utils/colors";
import { msToLapTime } from "../../utils/format";
import {
  formPath,
  sessionSummaryPath,
  trackPath,
  tracksPath,
} from "../../utils/routes";
import { cn } from "../../utils/cn";
import {
  formatDayLabel,
  sessionClock,
  sessionResult,
} from "../sessions/sessionFormat";
import { sessionBestLapMs, sessionDayKey } from "../../analysis/sessionLog";
import { recentTracks } from "../../analysis/trackIndex";
import type { SessionSummary } from "../../types/telemetry";
import { TrackFlag } from "../TrackFlag";
import { TrackOutline } from "../TrackOutline";
import {
  setCommandPaletteOpen,
  useCommandPaletteOpen,
} from "./commandPaletteStore";

type PaletteGroup = "Tracks" | "Sessions" | "Drivers" | "Jump to";

interface PaletteItem {
  key: string;
  group: PaletteGroup;
  label: string;
  /** Second line: when, where, how much. */
  sub?: string;
  /** Leading square: a flag, a team colour, or an icon. */
  visual: ReactNode;
  /** Right side: a result, a PB, a circuit outline (lit on the active row). */
  trailing?: (active: boolean) => ReactNode;
  /** Lower-cased words a query token can prefix-match. */
  words: string[];
  run: () => void;
}

const GROUP_LIMIT: Record<PaletteGroup, number> = {
  Tracks: 4,
  Sessions: 6,
  Drivers: 4,
  "Jump to": 5,
};

const TRACK_JUMPS = [
  {
    tab: "overview",
    label: "Race plan",
    icon: Route,
    words: ["plan", "strategy", "fuel", "race"],
  },
  {
    tab: "setups",
    label: "Setups",
    icon: SlidersHorizontal,
    words: ["setup", "setups"],
  },
  {
    tab: "lap-telemetry",
    label: "Lap telemetry",
    icon: ChartSpline,
    words: ["telemetry", "laps", "compare"],
  },
  {
    tab: "qualifying",
    label: "Qualifying",
    icon: Timer,
    words: ["quali", "qualifying"],
  },
] as const;

function wordsOf(...texts: string[]): string[] {
  return texts
    .join(" ")
    .toLowerCase()
    .split(/[^a-z0-9:.']+/)
    .filter(Boolean);
}

function matches(item: PaletteItem, tokens: string[]): boolean {
  return tokens.every((token) =>
    item.words.some((word) => word.startsWith(token)),
  );
}

function VisualBox({
  children,
  style,
  className,
}: {
  children: ReactNode;
  style?: CSSProperties;
  className?: string;
}) {
  return (
    <span
      aria-hidden
      style={style}
      className={cn(
        "grid size-8 shrink-0 place-items-center rounded-lg bg-tone-800/80",
        className,
      )}
    >
      {children}
    </span>
  );
}

function FlagVisual({ track }: { track: string }) {
  return (
    <VisualBox>
      <TrackFlag track={track} size="small" className="rounded-[3px]" />
    </VisualBox>
  );
}

function IconVisual({ icon: Icon }: { icon: LucideIcon }) {
  return (
    <VisualBox>
      <Icon className="size-4 text-tone-300" />
    </VisualBox>
  );
}

function DriverVisual({ name, team }: { name: string; team?: string }) {
  const color = team ? getTeamColor(team) : "var(--color-tone-500)";
  // "Lewis Hamilton" → LH; a one-word gamertag ("CanNibalS_84") takes its
  // first two letters.
  const alnum = (text: string) => text.replace(/[^\p{L}\p{N}]/gu, "");
  const parts = name.trim().split(/\s+/).map(alnum).filter(Boolean);
  const initials = (
    parts.length > 1
      ? parts
          .slice(0, 2)
          .map((part) => part[0])
          .join("")
      : (parts[0] ?? "").slice(0, 2)
  ).toUpperCase();
  return (
    <VisualBox
      className="text-[11px] font-semibold"
      style={{
        backgroundColor: `color-mix(in oklab, ${color} 22%, transparent)`,
        color,
      }}
    >
      {initials || "?"}
    </VisualBox>
  );
}

function SessionTrailing({
  session,
  isPb,
}: {
  session: SessionSummary;
  isPb: boolean;
}) {
  const result = sessionResult(session);
  if (result) {
    return (
      <span className="text-sm whitespace-nowrap">
        <b
          className={cn(
            "font-semibold text-tone-50",
            result.tone === "best" && "text-best",
          )}
        >
          {result.main}
        </b>
        {result.detail && (
          <span
            className={cn(
              "ml-1 text-xs",
              result.tone === "gain"
                ? "text-ahead"
                : result.tone === "loss"
                  ? "text-behind"
                  : "text-tone-500",
            )}
          >
            {result.detail}
          </span>
        )}
      </span>
    );
  }
  const best = sessionBestLapMs(session);
  return best ? (
    <span
      className={cn("font-mono text-sm", isPb ? "text-best" : "text-tone-300")}
    >
      {msToLapTime(best)}
    </span>
  ) : null;
}

/** "Online · 21 drivers", "vs AI 110", "Hot laps". */
function sessionContext(session: SessionSummary): string {
  if (session.isOnline) {
    const drivers = session.classifiedDriverCount ?? session.onlineDriverCount;
    return drivers ? `Online · ${drivers} drivers` : "Online";
  }
  if (summaryKind(session) === "time-trial") return "Hot laps";
  return session.aiDifficulty ? `vs AI ${session.aiDifficulty}` : "Offline";
}

/**
 * ⌘K anywhere: tracks, sessions ("sakh q", "24 oct", "monza race"), drivers,
 * and jumps straight to a tab ("sakhir setups"). Plain prefix matching over a
 * small in-memory index; results open the page. With no query it starts from
 * where you were: recent tracks, the latest sessions, the main pages.
 */
export function CommandPalette({
  onOpenChangelog,
}: {
  onOpenChangelog: () => void;
}) {
  const open = useCommandPaletteOpen();
  const navigate = useNavigate();
  const { activeFormulaKey } = useTelemetry();
  const sessions = useScopedSessions();
  const trackIndex = useTrackIndex();
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) {
      setQuery("");
      setActive(0);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  const index = useMemo<PaletteItem[]>(() => {
    if (!activeFormulaKey) return [];
    const go = (to: string) => () => navigate(to);
    const items: PaletteItem[] = [];
    const pbByTrack = new Map(
      trackIndex.entries.map((e) => [e.trackId, e.qualiPbMs]),
    );
    for (const entry of trackIndex.entries) {
      const name = getTrackDisplayName(entry.track);
      items.push({
        key: `track-${entry.trackId}`,
        group: "Tracks",
        label: name,
        sub: `${entry.sessionCount} session${entry.sessionCount === 1 ? "" : "s"} · last ${formatDayLabel(entry.lastDate.slice(0, 10))}`,
        visual: <FlagVisual track={entry.track} />,
        trailing: (active) => (
          <span className="flex items-center gap-3">
            {entry.qualiPbMs && (
              <span className="font-mono text-sm text-best">
                {msToLapTime(entry.qualiPbMs)}
              </span>
            )}
            <TrackOutline
              track={entry.track}
              glow={active}
              className="h-7 w-11"
            />
          </span>
        ),
        words: wordsOf(name, entry.trackId, entry.track),
        run: go(trackPath(activeFormulaKey, entry.trackId)),
      });
      for (const jump of TRACK_JUMPS) {
        items.push({
          key: `jump-${entry.trackId}-${jump.tab}`,
          group: "Jump to",
          label: `${name} ${jump.label.toLowerCase()}`,
          sub: `Track page › ${jump.label}`,
          visual: <IconVisual icon={jump.icon} />,
          words: [...wordsOf(name, entry.trackId), ...jump.words],
          run: go(trackPath(activeFormulaKey, entry.trackId, jump.tab)),
        });
      }
    }
    const drivers = new Map<
      string,
      { name: string; team?: string; slug: string; date: string; count: number }
    >();
    for (const session of sessions) {
      const day = formatDayLabel(sessionDayKey(session));
      const kind = summaryKind(session);
      const trackName = getTrackDisplayName(session.track);
      const best = sessionBestLapMs(session);
      items.push({
        key: `session-${session.slug}`,
        group: "Sessions",
        label: `${trackName} ${sessionRowLabel(session).toLowerCase()}`,
        sub: `${day} · ${sessionClock(session)} · ${sessionContext(session)}`,
        visual: <FlagVisual track={session.track} />,
        trailing: () => (
          <SessionTrailing
            session={session}
            isPb={
              kind === "qualifying" &&
              best != null &&
              best === pbByTrack.get(getTrackId(session.track))
            }
          />
        ),
        words: wordsOf(
          trackName,
          session.track,
          sessionRowLabel(session),
          kind === "qualifying" ? "quali q" : kind,
          day,
          session.isOnline ? "online" : "offline practice",
        ),
        run: go(sessionSummaryPath(session)),
      });
      for (const rival of session.rivals ?? []) {
        const known = drivers.get(rival.key);
        if (!known || session.date > known.date) {
          drivers.set(rival.key, {
            name: rival.name,
            team: rival.team,
            slug: session.slug,
            date: session.date,
            count: (known?.count ?? 0) + 1,
          });
        } else {
          known.count += 1;
        }
      }
    }
    // Most races together first: the rivals you know.
    const byCount = [...drivers].sort((a, b) => b[1].count - a[1].count);
    for (const [key, driver] of byCount) {
      const session = sessions.find((s) => s.slug === driver.slug)!;
      items.push({
        key: `driver-${key}`,
        group: "Drivers",
        label: driver.name,
        sub: `Last raced at ${getTrackDisplayName(session.track)}, ${formatDayLabel(sessionDayKey(session))}`,
        visual: <DriverVisual name={driver.name} team={driver.team} />,
        trailing: () => (
          <span className="text-xs text-tone-500">
            {driver.count} race{driver.count === 1 ? "" : "s"} together
          </span>
        ),
        words: wordsOf(driver.name),
        run: go(
          `${sessionSummaryPath(session)}?tab=results&driver=${encodeURIComponent(key)}`,
        ),
      });
    }
    items.push(
      {
        key: "form",
        group: "Jump to",
        label: "Your online form",
        sub: "Grid and finish, race by race",
        visual: <IconVisual icon={TrendingUp} />,
        words: ["form", "online", "season", "results"],
        run: go(formPath(activeFormulaKey)),
      },
      {
        key: "tracks",
        group: "Jump to",
        label: "All tracks",
        sub: `${trackIndex.entries.length} driven`,
        visual: <IconVisual icon={MapIcon} />,
        words: ["tracks", "all"],
        run: go(tracksPath(activeFormulaKey)),
      },
      {
        key: "whats-new",
        group: "Jump to",
        label: "What's new",
        sub: "Recent changes to the viewer",
        visual: <IconVisual icon={Sparkles} />,
        words: ["what's", "whats", "new", "changelog"],
        run: onOpenChangelog,
      },
    );
    return items;
  }, [activeFormulaKey, navigate, onOpenChangelog, sessions, trackIndex]);

  const sections = useMemo<{ heading: string; items: PaletteItem[] }[]>(() => {
    const tokens = wordsOf(query);
    if (tokens.length === 0) {
      const recent = recentTracks(trackIndex, 3).map(
        (e) => `track-${e.trackId}`,
      );
      return [
        {
          heading: "Recent tracks",
          items: recent
            .map((key) => index.find((i) => i.key === key))
            .filter((i): i is PaletteItem => i != null),
        },
        {
          heading: "Latest sessions",
          items: index.filter((i) => i.group === "Sessions").slice(0, 3),
        },
        {
          heading: "Go to",
          items: index.filter((i) =>
            ["form", "tracks", "whats-new"].includes(i.key),
          ),
        },
      ].filter((section) => section.items.length > 0);
    }
    return (["Tracks", "Sessions", "Drivers", "Jump to"] as const)
      .map((group) => ({
        heading: group,
        items: index
          .filter((item) => item.group === group && matches(item, tokens))
          .slice(0, GROUP_LIMIT[group]),
      }))
      .filter((section) => section.items.length > 0);
  }, [index, query, trackIndex]);
  const results = useMemo(
    () => sections.flatMap((section) => section.items),
    [sections],
  );

  useEffect(() => setActive(0), [query]);
  useEffect(() => {
    listRef.current
      ?.querySelector(`[data-index="${active}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [active]);

  if (!open) return null;

  const close = () => setCommandPaletteOpen(false);
  const run = (item: PaletteItem | undefined) => {
    if (!item) return;
    close();
    item.run();
  };

  let row = -1;
  return (
    <div
      className="fixed inset-0 z-[70] flex justify-center bg-tone-1000/50 px-4 pt-[10vh] backdrop-blur-[2px]"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) close();
      }}
    >
      <div
        role="dialog"
        aria-label="Search"
        className="h-max w-full max-w-2xl overflow-hidden rounded-2xl bg-tone-900 shadow-2xl shadow-tone-1000/50 ring-1 ring-tone-800"
      >
        <div className="flex items-center gap-3 border-b border-tone-800 px-4">
          <Search aria-hidden className="size-4 text-tone-500" />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") close();
              if (event.key === "ArrowDown") {
                event.preventDefault();
                setActive((i) => Math.min(results.length - 1, i + 1));
              }
              if (event.key === "ArrowUp") {
                event.preventDefault();
                setActive((i) => Math.max(0, i - 1));
              }
              if (event.key === "Enter") run(results[active]);
            }}
            placeholder="Search tracks, sessions, drivers"
            className="h-14 flex-1 bg-transparent text-base text-tone-50 outline-none placeholder:text-tone-500"
          />
          <kbd className="rounded-md px-1.5 py-0.5 text-xs text-tone-500 ring-1 ring-tone-800">
            esc
          </kbd>
        </div>
        <div
          ref={listRef}
          className="max-h-[min(72vh,620px)] overflow-y-auto p-2"
        >
          {results.length === 0 && (
            <p className="px-3 py-8 text-center text-sm text-tone-500">
              Nothing matches “{query}”. Try a track, “quali”, a date like “24
              oct”, or a driver.
            </p>
          )}
          {sections.map((section) => (
            <div key={section.heading} className="pb-1">
              <div className="px-2.5 pt-2 pb-1.5 text-xs font-medium text-tone-500">
                {section.heading}
              </div>
              {section.items.map((item) => {
                row += 1;
                const i = row;
                return (
                  <button
                    key={item.key}
                    type="button"
                    data-index={i}
                    onMouseMove={() => i !== active && setActive(i)}
                    onClick={() => run(item)}
                    className={cn(
                      "flex w-full items-center gap-3 rounded-xl px-2.5 py-1.5 text-left",
                      i === active && "bg-tone-800/80",
                    )}
                  >
                    {item.visual}
                    <span className="min-w-0 flex-1">
                      <span
                        className={cn(
                          "block truncate text-sm",
                          i === active ? "text-tone-50" : "text-tone-100",
                        )}
                      >
                        {item.label}
                      </span>
                      {item.sub && (
                        <span className="block truncate text-xs text-tone-500">
                          {item.sub}
                        </span>
                      )}
                    </span>
                    {item.trailing && (
                      <span className="shrink-0 tabular-nums">
                        {item.trailing(i === active)}
                      </span>
                    )}
                    <CornerDownLeft
                      aria-hidden
                      className={cn(
                        "size-3.5 shrink-0 text-tone-500",
                        i === active ? "opacity-100" : "opacity-0",
                      )}
                    />
                  </button>
                );
              })}
            </div>
          ))}
        </div>
        <div className="border-t border-tone-800 px-4 py-2 text-xs text-tone-500">
          ↑↓ move · ↵ open · try “sakhir setups”, “monza race” or a driver
        </div>
      </div>
    </div>
  );
}
