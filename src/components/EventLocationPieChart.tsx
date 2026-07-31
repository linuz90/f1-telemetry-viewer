import { useMemo, useState } from "react";
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import type {
  EventFocusMode,
  EventLocationBreakdown,
} from "../analysis/eventLocationBreakdown";
import {
  buildEventLocationBreakdown,
  eventMatchesDriverFocus,
  excludePitLaneOvertakes,
  isAggregateLocationLabel,
} from "../analysis/eventLocationBreakdown";
import {
  CHART_THEME,
  LOCATION_BREAKDOWN_COLORS,
  LOCATION_OTHER_COLOR,
} from "../constants/colors";
import type { DriverData, RaceControlEvent } from "../types/telemetry";
import { isPitLaneOvertake } from "../utils/raceControl";
import { EmptyState } from "./EmptyState";
// Aliased: `Tooltip` here would collide with the recharts chart tooltip below.
import { Tooltip as HoverTooltip } from "./Tooltip";
import { FocusToggle } from "./ui/FocusToggle";
import { SectionHeader } from "./ui/SectionHeader";
import { HStack } from "./ui/Stack";

/** Raw events behind `breakdown`; required by either toggle to re-bucket. */
interface EventLocationSource {
  events: RaceControlEvent[];
  /** Race-control message type this chart covers (e.g. "OVERTAKE"). */
  messageType: string;
}

/**
 * Enables the "Focus driver only" toggle. Omit entirely (e.g. in aggregate
 * track view) to render the chart without one.
 */
interface EventLocationFocus {
  /** Driver the toggle narrows to. */
  driver: DriverData;
  /** How the toggle filters events for this chart (directional vs commutative). */
  mode: EventFocusMode;
}

interface EventLocationPieChartProps {
  title: string;
  /** Singular noun for the events, e.g. "overtake" / "collision". */
  unit: string;
  /** Breakdown shown when every toggle is off; must already exclude pit-lane. */
  breakdown: EventLocationBreakdown;
  /** Shown when no events of this type were recorded at all. */
  emptyMessage: string;
  /** Raw events; needed for any toggle to rebuild the breakdown. */
  source?: EventLocationSource;
  /** Opt-in focus-driver toggle; omit to render without one. */
  focus?: EventLocationFocus;
  /** Opt-in "Pit lane overtakes" toggle. Overtake charts only. */
  pitLaneToggle?: boolean;
}

/**
 * Pit-lane detection needs per-driver pitting flags that Pits n' Giggles only
 * started exporting in v4.4.0. Older sessions still count those passes as
 * regular overtakes, and there is no way to reclassify them after the fact —
 * say so rather than letting the toggle look broken.
 */
const PIT_LANE_TOOLTIP =
  "Pit-lane passes are only detected in sessions recorded with Pits n' " +
  "Giggles v4.4.0 or later. Earlier sessions still count them as overtakes.";

interface ColoredSlice {
  label: string;
  count: number;
  color: string;
}

/**
 * Donut chart breaking down where on track a given race-control event type
 * happened. Hued slices are direct-labelled in the legend (the categorical
 * palette sits in the CVD floor band, so color is never the only cue); the
 * aggregate "Other"/"Unknown" buckets stay grey.
 */
export function EventLocationPieChart({
  title,
  unit,
  breakdown,
  emptyMessage,
  source,
  focus,
  pitLaneToggle,
}: EventLocationPieChartProps) {
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const [focusOnly, setFocusOnly] = useState(false);
  const [showPitLane, setShowPitLane] = useState(false);

  // Re-bucket only when a toggle moves off its default; otherwise reuse the
  // breakdown the caller already built.
  const activeBreakdown = useMemo(() => {
    if (!source || (!focusOnly && !showPitLane)) return breakdown;
    let events = showPitLane
      ? source.events
      : excludePitLaneOvertakes(source.events);
    if (focusOnly && focus) {
      events = events.filter((event) =>
        eventMatchesDriverFocus(event, focus.driver, focus.mode),
      );
    }
    return buildEventLocationBreakdown(events, source.messageType);
  }, [breakdown, focus, focusOnly, showPitLane, source]);

  // Whether this chart's data can actually distinguish pit-lane passes. The
  // toggle is shown either way — a switch that comes and goes per track reads
  // as a bug — but it explains itself when there is nothing to reveal.
  const hasPitLaneOvertakes = useMemo(
    () =>
      Boolean(pitLaneToggle) && Boolean(source?.events.some(isPitLaneOvertake)),
    [pitLaneToggle, source],
  );

  const { slices, total, locatedCount } = activeBreakdown;

  const hint =
    total > 0 ? `${total} ${unit}${total === 1 ? "" : "s"}` : undefined;

  const noDataMessage =
    focusOnly && focus
      ? `No ${unit}s ${focus.mode === "overtaker" ? "by" : "involving"} ${focus.driver["driver-name"]} in this session.`
      : // Everything of this type was a pit-lane pass, so the toggle is the
        // only way back to a non-empty pie.
        hasPitLaneOvertakes && !showPitLane
        ? `Every ${unit} here happened in the pit lane. Turn on "Pit lane" to include them.`
        : emptyMessage;

  let hueIndex = 0;
  const colored: ColoredSlice[] = slices.map((slice) => {
    const color = isAggregateLocationLabel(slice.label)
      ? LOCATION_OTHER_COLOR
      : LOCATION_BREAKDOWN_COLORS[
          hueIndex++ % LOCATION_BREAKDOWN_COLORS.length
        ];
    return { ...slice, color };
  });

  return (
    <div>
      <SectionHeader
        size="sm"
        title={title}
        hint={hint}
        action={
          // Only offer toggles when there's a pie to filter. Key off the base
          // (all-driver) located count, not the filtered result, so they don't
          // disappear when a focused driver has no events.
          source && (pitLaneToggle || (focus && breakdown.locatedCount > 0)) ? (
            <HStack wrap justify="end" className="gap-x-3 gap-y-1.5">
              {focus && breakdown.locatedCount > 0 && (
                <FocusToggle
                  value={focusOnly}
                  onChange={() => setFocusOnly((value) => !value)}
                />
              )}
              {pitLaneToggle && (
                <HoverTooltip
                  text={
                    hasPitLaneOvertakes
                      ? PIT_LANE_TOOLTIP
                      : `No pit-lane ${unit}s detected here. ${PIT_LANE_TOOLTIP}`
                  }
                >
                  <span className="inline-flex">
                    <FocusToggle
                      label="Pit lane"
                      value={showPitLane}
                      onChange={() => setShowPitLane((value) => !value)}
                    />
                  </span>
                </HoverTooltip>
              )}
            </HStack>
          ) : undefined
        }
      />
      {total === 0 ? (
        <EmptyState title={title} message={noDataMessage} />
      ) : locatedCount === 0 ? (
        // Events exist, but this export did not include the fields needed to
        // place them on track. Avoid inferring exporter age from version strings:
        // some current-version files can still omit location detail.
        <EmptyState
          title={title}
          message="Track-location fields were not recorded for these events."
        />
      ) : (
        <div className="flex flex-col items-center gap-5 sm:flex-row">
          <div className="relative h-48 w-48 shrink-0">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={colored}
                  dataKey="count"
                  nameKey="label"
                  innerRadius={56}
                  outerRadius={82}
                  paddingAngle={2}
                  stroke={CHART_THEME.tooltipBg}
                  strokeWidth={2}
                  startAngle={90}
                  endAngle={-270}
                  onMouseEnter={(_, index) => setActiveIndex(index)}
                  onMouseLeave={() => setActiveIndex(null)}
                >
                  {colored.map((slice) => (
                    <Cell key={slice.label} fill={slice.color} />
                  ))}
                </Pie>
                <Tooltip
                  allowEscapeViewBox={{ x: true, y: true }}
                  content={({ active, payload }) => {
                    if (!active || !payload?.length) return null;
                    const datum = payload[0]?.payload as ColoredSlice;
                    if (!datum) return null;
                    const pct = Math.round((datum.count / total) * 100);
                    return (
                      <div
                        className="rounded-lg p-2 text-xs"
                        style={{
                          backgroundColor: CHART_THEME.tooltipBg,
                          border: `1px solid ${CHART_THEME.tooltipBorder}`,
                        }}
                      >
                        <div className="mb-0.5 flex items-center gap-1.5 text-zinc-200">
                          <span
                            className="inline-block size-2 rounded-sm"
                            style={{ backgroundColor: datum.color }}
                          />
                          {datum.label}
                        </div>
                        <div className="font-mono tabular-nums text-zinc-400">
                          {datum.count} {unit}
                          {datum.count === 1 ? "" : "s"} · {pct}%
                        </div>
                      </div>
                    );
                  }}
                />
              </PieChart>
            </ResponsiveContainer>
            {activeIndex === null && (
              <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                <span className="text-2xl font-semibold tabular-nums text-zinc-100">
                  {total}
                </span>
                <span className="text-2xs uppercase tracking-wide text-zinc-500">
                  {unit}s
                </span>
              </div>
            )}
          </div>
          <ul className="grid w-full grid-cols-1 gap-1.5 xs:grid-cols-2 sm:grid-cols-1">
            {colored.map((slice) => {
              const pct = Math.round((slice.count / total) * 100);
              return (
                <li
                  key={slice.label}
                  className="flex items-center justify-between gap-3 text-xs"
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <span
                      className="size-2.5 shrink-0 rounded-sm"
                      style={{ backgroundColor: slice.color }}
                    />
                    <span className="truncate text-zinc-300">
                      {slice.label}
                    </span>
                  </span>
                  <span className="shrink-0 font-mono tabular-nums text-zinc-500">
                    {slice.count} · {pct}%
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
