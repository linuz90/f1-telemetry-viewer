import { useMemo, useState } from "react";
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import type {
  EventFocusMode,
  EventLocationBreakdown,
} from "../analysis/eventLocationBreakdown";
import {
  buildEventLocationBreakdown,
  eventMatchesDriverFocus,
  isAggregateLocationLabel,
} from "../analysis/eventLocationBreakdown";
import {
  CHART_THEME,
  LOCATION_BREAKDOWN_COLORS,
  LOCATION_OTHER_COLOR,
} from "../constants/colors";
import type { DriverData, RaceControlEvent } from "../types/telemetry";
import { EmptyState } from "./EmptyState";
import { FocusToggle } from "./ui/FocusToggle";
import { SectionHeader } from "./ui/SectionHeader";

/**
 * Enables the "Focus driver only" toggle. Omit entirely (e.g. in aggregate
 * track view) to render the chart without a toggle.
 */
interface EventLocationFocus {
  /** Driver the toggle narrows to. */
  driver: DriverData;
  /** How the toggle filters events for this chart (directional vs commutative). */
  mode: EventFocusMode;
  /** Raw events, re-bucketed when the toggle is on. */
  events: RaceControlEvent[];
  /** Race-control message type this chart covers (e.g. "OVERTAKE"). */
  messageType: string;
}

interface EventLocationPieChartProps {
  title: string;
  /** Singular noun for the events, e.g. "overtake" / "collision". */
  unit: string;
  /** Breakdown shown by default (and when the focus toggle is off). */
  breakdown: EventLocationBreakdown;
  /** Shown when no events of this type were recorded at all. */
  emptyMessage: string;
  /** Opt-in focus-driver toggle; omit to render without one. */
  focus?: EventLocationFocus;
}

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
  focus,
}: EventLocationPieChartProps) {
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const [focusOnly, setFocusOnly] = useState(false);

  // Re-bucket only when focused; otherwise reuse the given breakdown.
  const activeBreakdown = useMemo(() => {
    if (!focusOnly || !focus) return breakdown;
    const focusedEvents = focus.events.filter((event) =>
      eventMatchesDriverFocus(event, focus.driver, focus.mode),
    );
    return buildEventLocationBreakdown(focusedEvents, focus.messageType);
  }, [focusOnly, focus, breakdown]);

  const { slices, total, locatedCount } = activeBreakdown;

  const hint =
    total > 0 ? `${total} ${unit}${total === 1 ? "" : "s"}` : undefined;

  const noDataMessage =
    focusOnly && focus
      ? `No ${unit}s ${focus.mode === "overtaker" ? "by" : "involving"} ${focus.driver["driver-name"]} in this session.`
      : emptyMessage;

  let hueIndex = 0;
  const colored: ColoredSlice[] = slices.map((slice) => {
    const color = isAggregateLocationLabel(slice.label)
      ? LOCATION_OTHER_COLOR
      : LOCATION_BREAKDOWN_COLORS[hueIndex++ % LOCATION_BREAKDOWN_COLORS.length];
    return { ...slice, color };
  });

  return (
    <div>
      <SectionHeader
        size="sm"
        title={title}
        hint={hint}
        action={
          // Only offer the toggle when there's a pie to filter. Key off the
          // base (all-driver) located count, not the filtered result, so it
          // doesn't disappear when a focused driver has no events.
          focus && breakdown.locatedCount > 0 ? (
            <FocusToggle
              value={focusOnly}
              onChange={() => setFocusOnly((value) => !value)}
            />
          ) : undefined
        }
      />
      {total === 0 ? (
        <EmptyState title={title} message={noDataMessage} />
      ) : locatedCount === 0 ? (
        // Events exist but predate the location data. Say when it landed so the
        // absence is explained rather than the section silently vanishing.
        <EmptyState
          title={title}
          message="Track locations are recorded from Pits n' Giggles v4.3.0 onwards; this session data is from an older version."
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
                    <span className="truncate text-zinc-300">{slice.label}</span>
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
