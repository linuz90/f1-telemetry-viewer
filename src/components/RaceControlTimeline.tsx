import { useMemo, useState } from "react";
import {
  AlertTriangle,
  Car,
  Circle,
  Flag,
  Gauge,
  Timer,
  Trophy,
  Wrench,
  Zap,
  type LucideIcon,
} from "lucide-react";
import type { DriverData, RaceControlEvent } from "../types/telemetry";
import { cn } from "../utils/cn";
import { getTeamColor, getTeamName } from "../utils/colors";
import {
  eventMatchesRaceControlFocus,
  formatRaceControlClock,
  formatRaceControlEvent,
  formatRaceControlLap,
  getRaceControlDriverInfos,
  getUnknownRaceControlDetails,
  humanizeRaceControlType,
  isKeyRaceControlEvent,
} from "../utils/raceControl";
import { EmptyState } from "./EmptyState";

interface RaceControlTimelineProps {
  events: RaceControlEvent[];
  focusedDriver?: DriverData;
}

type ViewMode = "key" | "all";

interface EventStyle {
  label: string;
  icon: LucideIcon;
  iconClass: string;
  badgeClass: string;
}

const DEFAULT_STYLE: EventStyle = {
  label: "Event",
  icon: Circle,
  iconClass: "bg-zinc-800 text-zinc-400",
  badgeClass: "bg-zinc-800/80 text-zinc-400",
};

const EVENT_STYLES: Record<string, EventStyle> = {
  PENALTY: {
    label: "Penalty",
    icon: AlertTriangle,
    iconClass: "bg-amber-500/15 text-amber-400",
    badgeClass: "bg-amber-500/15 text-amber-300",
  },
  COLLISION: {
    label: "Collision",
    icon: Car,
    iconClass: "bg-red-500/15 text-red-400",
    badgeClass: "bg-red-500/15 text-red-300",
  },
  CAR_DAMAGE: {
    label: "Damage",
    icon: Wrench,
    iconClass: "bg-orange-500/15 text-orange-400",
    badgeClass: "bg-orange-500/15 text-orange-300",
  },
  RETIREMENT: {
    label: "Retirement",
    icon: Flag,
    iconClass: "bg-red-500/15 text-red-400",
    badgeClass: "bg-red-500/15 text-red-300",
  },
  PITTING: {
    label: "Pit",
    icon: Wrench,
    iconClass: "bg-cyan-500/15 text-cyan-400",
    badgeClass: "bg-cyan-500/15 text-cyan-300",
  },
  WING_CHANGE: {
    label: "Wing",
    icon: Wrench,
    iconClass: "bg-sky-500/15 text-sky-400",
    badgeClass: "bg-sky-500/15 text-sky-300",
  },
  TYRE_CHANGE: {
    label: "Tyres",
    icon: Circle,
    iconClass: "bg-zinc-700 text-zinc-300",
    badgeClass: "bg-zinc-800/80 text-zinc-300",
  },
  FASTEST_LAP: {
    label: "Fastest lap",
    icon: Zap,
    iconClass: "bg-purple-500/15 text-purple-400",
    badgeClass: "bg-purple-500/15 text-purple-300",
  },
  RACE_WINNER: {
    label: "Winner",
    icon: Trophy,
    iconClass: "bg-emerald-500/15 text-emerald-400",
    badgeClass: "bg-emerald-500/15 text-emerald-300",
  },
  CHEQUERED_FLAG: {
    label: "Flag",
    icon: Flag,
    iconClass: "bg-zinc-700 text-zinc-300",
    badgeClass: "bg-zinc-800/80 text-zinc-300",
  },
  OVERTAKE: {
    label: "Overtake",
    icon: Zap,
    iconClass: "bg-emerald-500/15 text-emerald-400",
    badgeClass: "bg-emerald-500/15 text-emerald-300",
  },
  SPEED_TRAP_RECORD: {
    label: "Speed trap",
    icon: Gauge,
    iconClass: "bg-blue-500/15 text-blue-400",
    badgeClass: "bg-blue-500/15 text-blue-300",
  },
  START_LIGHTS: {
    label: "Start",
    icon: Timer,
    iconClass: "bg-red-500/15 text-red-400",
    badgeClass: "bg-red-500/15 text-red-300",
  },
  LIGHTS_OUT: {
    label: "Start",
    icon: Flag,
    iconClass: "bg-emerald-500/15 text-emerald-400",
    badgeClass: "bg-emerald-500/15 text-emerald-300",
  },
  FLASHBACK: {
    label: "Flashback",
    icon: Timer,
    iconClass: "bg-yellow-500/15 text-yellow-400",
    badgeClass: "bg-yellow-500/15 text-yellow-300",
  },
};

export function RaceControlTimeline({ events, focusedDriver }: RaceControlTimelineProps) {
  const [viewMode, setViewMode] = useState<ViewMode>("key");
  const [focusOnly, setFocusOnly] = useState(false);

  const keyEventCount = useMemo(
    () => events.filter(isKeyRaceControlEvent).length,
    [events],
  );

  const firstTimestamp = events[0]?.timestamp;

  const visibleEvents = useMemo(
    () =>
      events.filter((event) => {
        if (viewMode === "key" && !isKeyRaceControlEvent(event)) return false;
        if (focusOnly && !eventMatchesRaceControlFocus(event, focusedDriver)) {
          return false;
        }
        return true;
      }),
    [events, focusedDriver, focusOnly, viewMode],
  );

  const groups = useMemo(() => {
    const grouped: { key: string; label: string; events: RaceControlEvent[] }[] = [];
    const indexByKey = new Map<string, number>();

    for (const event of visibleEvents) {
      const key = event["lap-number"] == null ? "session" : `lap-${event["lap-number"]}`;
      let index = indexByKey.get(key);
      if (index == null) {
        index = grouped.length;
        indexByKey.set(key, index);
        grouped.push({ key, label: formatRaceControlLap(event), events: [] });
      }
      grouped[index].events.push(event);
    }

    return grouped;
  }, [visibleEvents]);

  if (!events.length) return null;

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-zinc-300">Race Control</h3>
          <p className="mt-0.5 text-xs text-zinc-500">
            {keyEventCount} key event{keyEventCount === 1 ? "" : "s"} / {events.length} total
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex gap-0.5 rounded-lg bg-zinc-900/80 p-0.5">
            {(["key", "all"] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => setViewMode(mode)}
                className={cn(
                  "rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
                  viewMode === mode
                    ? "bg-zinc-800 text-zinc-100"
                    : "text-zinc-500 hover:text-zinc-300",
                )}
              >
                {mode === "key" ? "Key events" : "All events"}
              </button>
            ))}
          </div>

          {focusedDriver && (
            <label className="flex items-center gap-2 text-xs text-zinc-400 cursor-pointer select-none">
              Focus driver
              <button
                type="button"
                role="switch"
                aria-checked={focusOnly}
                onClick={() => setFocusOnly((value) => !value)}
                className={cn("relative inline-flex h-4 w-7 items-center rounded-full transition-colors", focusOnly ? "bg-cyan-600" : "bg-zinc-800")}
              >
                <span
                  className={cn("inline-block h-3 w-3 rounded-full bg-white transition-transform", focusOnly ? "translate-x-3.5" : "translate-x-0.5")}
                />
              </button>
            </label>
          )}
        </div>
      </div>

      {visibleEvents.length === 0 ? (
        <EmptyState
          title="Race Control"
          message="No race-control events match this view."
        />
      ) : (
        <div className={visibleEvents.length > 8 ? "scroll-mask-down-[1.5rem] max-h-[560px] overflow-y-auto pr-2 -mr-2" : ""}>
          <div className="space-y-5 pb-0.5">
            {groups.map((group) => (
              <section key={group.key} className="space-y-2">
                <div className="sticky top-0 z-10 -mx-1 flex items-center gap-2 bg-card-surface px-1 py-1.5">
                  <span className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
                    {group.label}
                  </span>
                  <span className="h-px flex-1 bg-zinc-800/70" />
                </div>
                <div className="space-y-1.5">
                  {group.events.map((event) => (
                    <RaceControlEventRow
                      key={`${event.id}-${event["message-type"]}`}
                      event={event}
                      firstTimestamp={firstTimestamp}
                    />
                  ))}
                </div>
              </section>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function RaceControlEventRow({
  event,
  firstTimestamp,
}: {
  event: RaceControlEvent;
  firstTimestamp: number | undefined;
}) {
  const style = EVENT_STYLES[event["message-type"]] ?? {
    ...DEFAULT_STYLE,
    label: humanizeRaceControlType(event["message-type"]),
  };
  const Icon = style.icon;
  const clock = formatRaceControlClock(event, firstTimestamp);
  const driverInfos = getRaceControlDriverInfos(event);
  const primaryDriver = driverInfos[0];
  const details = EVENT_STYLES[event["message-type"]]
    ? []
    : getUnknownRaceControlDetails(event);

  return (
    <div className="rounded-md border border-zinc-800/80 bg-zinc-950/60 px-3 py-2.5 shadow-sm shadow-black/10">
      <div className="flex gap-3">
        <span className={cn("mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg", style.iconClass)}>
          <Icon className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-sm leading-snug text-zinc-200">{formatRaceControlEvent(event)}</span>
            <span className={cn("rounded px-1.5 py-0.5 text-2xs font-semibold", style.badgeClass)}>
              {style.label}
            </span>
            {clock && (
              <span className="font-mono text-2xs text-zinc-500">{clock}</span>
            )}
          </div>
          {primaryDriver && (
            <p className="mt-1.5 flex items-center gap-1.5 text-xs text-zinc-500">
              <span
                className="inline-block size-1.5 rounded-full"
                style={{ backgroundColor: getTeamColor(primaryDriver.team) }}
              />
              <span>{primaryDriver.name} - {getTeamName(primaryDriver.team)}</span>
            </p>
          )}
          {details.length > 0 && (
            <div className="mt-1 flex flex-wrap gap-1">
              {details.map((detail) => (
                <span
                  key={detail}
                  className="rounded bg-zinc-950/80 px-1.5 py-0.5 text-2xs text-zinc-500"
                >
                  {detail}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
