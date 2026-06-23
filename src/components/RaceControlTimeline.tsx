import {
  AlertTriangle,
  Car,
  Circle,
  Flag,
  Gauge,
  Search,
  Timer,
  Trophy,
  Wrench,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { DriverData, RaceControlEvent } from "../types/telemetry";
import { cn } from "../utils/cn";
import { getTeamColor, getTeamName } from "../utils/colors";
import {
  eventMatchesRaceControlFocus,
  formatRaceControlClock,
  formatRaceControlEvent,
  formatRaceControlLap,
  formatRaceControlLocation,
  getRaceControlDriverInfos,
  getUnknownRaceControlDetails,
  humanizeRaceControlType,
  isKeyRaceControlEvent,
  raceControlEventMatchesSearch,
} from "../utils/raceControl";
import { EmptyState } from "./EmptyState";
import { Badge } from "./ui/Badge";
import { Button } from "./ui/Button";
import { Eyebrow } from "./ui/Eyebrow";
import { FocusToggle } from "./ui/FocusToggle";
import { Input } from "./ui/Input";
import { PillSelect, type PillSelectOption } from "./ui/PillSelect";
import { ScrollArea } from "./ui/ScrollArea";
import { SectionHeader } from "./ui/SectionHeader";
import { SegmentedControl } from "./ui/SegmentedControl";
import { HStack } from "./ui/Stack";

interface RaceControlTimelineProps {
  events: RaceControlEvent[];
  focusedDriver?: DriverData;
}

type ViewMode = "key" | "all";

const VIEW_MODE_OPTIONS = [
  { value: "key", label: "Key events" },
  { value: "all", label: "All events" },
] as const;

const ALL_MESSAGE_TYPES = "all";
const EVENT_PAGE_SIZE = 80;
const EVENT_VIEWPORT_HEIGHT = "min-h-[22rem] md:min-h-[35rem]";

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

export function RaceControlTimeline({
  events,
  focusedDriver,
}: RaceControlTimelineProps) {
  const [viewMode, setViewMode] = useState<ViewMode>("key");
  const [focusOnly, setFocusOnly] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [messageTypeFilter, setMessageTypeFilter] = useState(ALL_MESSAGE_TYPES);
  const [visiblePageCount, setVisiblePageCount] = useState(1);

  const keyEventCount = useMemo(
    () => events.filter(isKeyRaceControlEvent).length,
    [events],
  );

  const firstTimestamp = events[0]?.timestamp;

  const baseEvents = useMemo(
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

  const messageTypeOptions = useMemo<PillSelectOption[]>(() => {
    const counts = new Map<string, number>();
    for (const event of baseEvents) {
      const type = event["message-type"];
      counts.set(type, (counts.get(type) ?? 0) + 1);
    }

    return [
      { value: ALL_MESSAGE_TYPES, label: `All types (${baseEvents.length})` },
      ...[...counts.entries()]
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .map(([type, count]) => ({
          value: type,
          label: `${humanizeRaceControlType(type)} (${count})`,
        })),
    ];
  }, [baseEvents]);

  useEffect(() => {
    if (
      messageTypeFilter !== ALL_MESSAGE_TYPES &&
      !messageTypeOptions.some((option) => option.value === messageTypeFilter)
    ) {
      setMessageTypeFilter(ALL_MESSAGE_TYPES);
    }
  }, [messageTypeFilter, messageTypeOptions]);

  useEffect(() => {
    setVisiblePageCount(1);
  }, [focusOnly, messageTypeFilter, searchQuery, viewMode]);

  const visibleEvents = useMemo(
    () =>
      baseEvents.filter((event) => {
        if (
          messageTypeFilter !== ALL_MESSAGE_TYPES &&
          event["message-type"] !== messageTypeFilter
        ) {
          return false;
        }

        return raceControlEventMatchesSearch(
          event,
          searchQuery,
          firstTimestamp,
        );
      }),
    [baseEvents, firstTimestamp, messageTypeFilter, searchQuery],
  );

  const pagedEvents = useMemo(
    () => visibleEvents.slice(0, visiblePageCount * EVENT_PAGE_SIZE),
    [visibleEvents, visiblePageCount],
  );

  const groups = useMemo(() => {
    const grouped: {
      key: string;
      label: string;
      events: RaceControlEvent[];
    }[] = [];
    const indexByKey = new Map<string, number>();

    for (const event of pagedEvents) {
      const key =
        event["lap-number"] == null ? "session" : `lap-${event["lap-number"]}`;
      let index = indexByKey.get(key);
      if (index == null) {
        index = grouped.length;
        indexByKey.set(key, index);
        grouped.push({ key, label: formatRaceControlLap(event), events: [] });
      }
      grouped[index].events.push(event);
    }

    return grouped;
  }, [pagedEvents]);

  if (!events.length) return null;

  const hasMoreEvents = pagedEvents.length < visibleEvents.length;

  return (
    <div>
      <SectionHeader
        size="sm"
        title="Race Control"
        hint={`${keyEventCount} key event${keyEventCount === 1 ? "" : "s"} / ${events.length} total`}
        className="mb-5"
        action={
          <HStack wrap className="gap-4">
            <SegmentedControl
              ariaLabel="Race control events"
              size="sm"
              value={viewMode}
              onChange={setViewMode}
              options={VIEW_MODE_OPTIONS}
            />
            {focusedDriver && (
              <FocusToggle
                label="Focus driver"
                value={focusOnly}
                onChange={() => setFocusOnly((value) => !value)}
              />
            )}
          </HStack>
        }
      />

      <div className="mb-4 grid gap-2 lg:grid-cols-[minmax(0,1fr)_auto]">
        <Input
          type="search"
          size="md"
          value={searchQuery}
          onChange={(event) => setSearchQuery(event.target.value)}
          placeholder="Search events, drivers, locations..."
          aria-label="Search race-control events"
          leftAdornment={<Search aria-hidden="true" />}
        />
        <PillSelect
          value={messageTypeFilter}
          onChange={setMessageTypeFilter}
          options={messageTypeOptions}
          ariaLabel="Filter race-control event type"
          width="compact"
          size="md"
        />
      </div>

      {visibleEvents.length === 0 ? (
        <div className={cn(EVENT_VIEWPORT_HEIGHT, "pt-3")}>
          <EmptyState
            title="Race Control"
            message="No race-control events match this view."
          />
        </div>
      ) : (
        <ScrollArea
          axis="y"
          className={
            pagedEvents.length > 8
              ? cn(
                  EVENT_VIEWPORT_HEIGHT,
                  "scroll-mask-down-[1.5rem] max-h-[560px] pr-2 -mr-2",
                )
              : ""
          }
        >
          <div className="space-y-5 pb-0.5">
            {groups.map((group) => (
              <section key={group.key} className="space-y-2">
                <HStack className="sticky top-0 z-10 -mx-1 gap-2 bg-card-surface px-1 py-1.5">
                  <Eyebrow className="text-zinc-500">{group.label}</Eyebrow>
                  <span className="h-px flex-1 bg-zinc-800/70" />
                </HStack>
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
        </ScrollArea>
      )}
      <HStack
        wrap
        justify="between"
        className="mt-3 gap-2 text-xs text-zinc-500"
      >
        <span>
          Showing {pagedEvents.length} of {visibleEvents.length} matching event
          {visibleEvents.length === 1 ? "" : "s"}
        </span>
        {hasMoreEvents && (
          <Button
            size="sm"
            variant="subtle"
            onClick={() => setVisiblePageCount((count) => count + 1)}
          >
            Show{" "}
            {Math.min(
              EVENT_PAGE_SIZE,
              visibleEvents.length - pagedEvents.length,
            )}{" "}
            more
          </Button>
        )}
      </HStack>
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
  const location = formatRaceControlLocation(event);
  const driverInfos = getRaceControlDriverInfos(event);
  const primaryDriver = driverInfos[0];
  const details = EVENT_STYLES[event["message-type"]]
    ? []
    : getUnknownRaceControlDetails(event);

  return (
    <div className="rounded-md border border-zinc-800/80 bg-zinc-950/60 px-3 py-2.5 shadow-sm shadow-black/10">
      <HStack align="start" className="gap-3">
        <HStack
          as="span"
          justify="center"
          className={cn("mt-0.5 size-8 shrink-0 rounded-lg", style.iconClass)}
        >
          <Icon className="size-5" />
        </HStack>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
            <span className="min-w-0 text-sm leading-snug text-zinc-200">
              {formatRaceControlEvent(event)}
            </span>
            <HStack
              wrap
              justify="end"
              className="shrink-0 gap-x-2 gap-y-1 sm:max-w-[45%]"
            >
              <Badge size="xs" shape="square" className={style.badgeClass}>
                {style.label}
              </Badge>
              {location && (
                <Badge
                  size="xs"
                  shape="square"
                  className="bg-sky-500/10 text-sky-300"
                >
                  {location}
                </Badge>
              )}
            </HStack>
          </div>
          {(primaryDriver || clock) && (
            <div
              className={cn(
                "mt-1.5 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1",
                primaryDriver ? "justify-between" : "justify-end",
              )}
            >
              {primaryDriver && (
                <HStack as="p" className="gap-1.5 text-xs text-zinc-500">
                  <span
                    className="inline-block size-1.5 rounded-full"
                    style={{
                      backgroundColor: getTeamColor(primaryDriver.team),
                    }}
                  />
                  <span>
                    {primaryDriver.name} - {getTeamName(primaryDriver.team)}
                  </span>
                </HStack>
              )}
              {clock && (
                <span className="ml-auto font-mono text-2xs text-zinc-500">
                  {clock}
                </span>
              )}
            </div>
          )}
          {details.length > 0 && (
            <HStack align="stretch" wrap className="mt-1 gap-1">
              {details.map((detail) => (
                <Badge
                  key={detail}
                  size="xs"
                  shape="square"
                  className="bg-zinc-950/80 text-zinc-500"
                >
                  {detail}
                </Badge>
              ))}
            </HStack>
          )}
        </div>
      </HStack>
    </div>
  );
}
