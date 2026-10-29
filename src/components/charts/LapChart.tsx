import { useMemo, useState, type ReactNode } from "react";
import { getCompoundColor } from "../../utils/colors";
import { msToLapTime } from "../../utils/format";
import { cn } from "../../utils/cn";
import { useElementWidth } from "./useElementWidth";

/**
 * The lap chart: every chart whose x axis is laps (race story, lap times,
 * tyre wear, long runs, time trials) is this one component, so they share one
 * look and one crosshair. Panels stack on a shared lap axis; the compound strip
 * sits underneath, safety-car periods are grey washes (yellow would read as
 * Medium), pit stops are hairlines, and the driver's own contacts and warnings
 * ride a lane on top. Lap times read like any time axis, quicker laps lower,
 * and the scale fits the clean laps; pit and SC laps are pinned in an "off
 * scale" gutter above the plot instead of flattening the rest. Faded dot = not counted, flat line = stint average,
 * hollow dot = grid or start.
 */

export type ChartSeriesTone = "you" | "compare";

export interface PositionPanel {
  kind: "position";
  height: number;
  /** Shown in the left gutter when the chart stacks panels. */
  label?: string;
  /** Index 0 is the grid, index n the end of lap n. */
  trace: number[];
  /** Worst position shown (the axis runs P1 to this). */
  maxPosition: number;
  endLabel?: string;
  notes?: { lap: number; position: number; text: string }[];
}

export interface TimeSeries {
  key: string;
  tone: ChartSeriesTone;
  /** Lap times in ms, index lap - 1; null for laps without a time. */
  lapsMs: (number | null)[];
  /** Laps left out of averages, with why (shown faded and in the tooltip). */
  excluded?: ReadonlyMap<number, string>;
  averages?: { from: number; to: number; ms: number }[];
  notes?: { lap: number; text: string }[];
}

export interface TimePanel {
  kind: "time";
  height: number;
  /** Shown in the left gutter when the chart stacks panels. */
  label?: string;
  series: TimeSeries[];
}

export interface WearPanel {
  kind: "wear";
  height: number;
  /** Shown in the left gutter when the chart stacks panels. */
  label?: string;
  /** Worst-wheel wear %, index lap - 1. */
  wear: (number | null)[];
}

export type LapChartPanel = PositionPanel | TimePanel | WearPanel;

export interface LapChartStint {
  from: number;
  to: number;
  compound: string;
  label?: string;
}

export interface LapChartTooltipRow {
  tone?: ChartSeriesTone | "event";
  value: string;
  label: string;
}

const TONE_VAR: Record<ChartSeriesTone, string> = {
  you: "var(--color-chart-you)",
  compare: "var(--color-chart-compare)",
};

const GUTTER_H = 22;
const PANEL_GAP = 20;
/** Stacked panels get more air and a label each, so they read as two charts. */
const STACKED_PANEL_GAP = 44;
const PANEL_LABEL: Record<LapChartPanel["kind"], string> = {
  position: "Position",
  time: "Lap time",
  wear: "Tyre wear",
};
const EVENT_LANE = 18;
const AXIS_H = 18;

function niceStep(rangeS: number): number {
  if (rangeS <= 1.6) return 0.5;
  if (rangeS <= 4) return 1;
  if (rangeS <= 10) return 2;
  return 5;
}

function tickLabel(ms: number, stepS: number): string {
  const total = ms / 1000;
  const minutes = Math.floor(total / 60);
  const seconds = total - minutes * 60;
  const digits = stepS < 1 ? 1 : 0;
  return `${minutes}:${seconds.toFixed(digits).padStart(digits ? 4 : 2, "0")}`;
}

/** Fit the scale to the clean laps of every series. */
function timeDomain(panel: TimePanel): [number, number] {
  const clean = panel.series.flatMap((s) =>
    s.lapsMs.filter(
      (ms, i): ms is number => ms != null && ms > 0 && !s.excluded?.has(i + 1),
    ),
  );
  if (clean.length === 0) return [0, 1];
  const lo = Math.min(...clean);
  const hi = Math.max(...clean);
  const pad = Math.max(150, (hi - lo) * 0.08);
  return [lo - pad, hi + pad];
}

export function LapChart({
  laps,
  panels,
  bands = [],
  pits = [],
  stints: allStints = [],
  events = [],
  tooltip,
  compact = false,
  className,
}: {
  laps: number;
  panels: LapChartPanel[];
  bands?: { from: number; to: number; label: string }[];
  /** In-laps; a hairline is drawn at the end of each. */
  pits?: number[];
  stints?: LapChartStint[];
  events?: { lap: number; kind: "contact" | "warning" }[];
  tooltip?: (
    lap: number,
  ) => { title: string; rows: LapChartTooltipRow[] } | null;
  compact?: boolean;
  className?: string;
}) {
  const [ref, width] = useElementWidth<HTMLDivElement>();
  const [hover, setHover] = useState<{ lap: number; y: number } | null>(null);

  // A stint can run into a lap the chart does not draw (an untimed final
  // lap), so clip the strip to the laps on the axis.
  const stints = allStints
    .filter((stint) => stint.from <= laps)
    .map((stint) => ({ ...stint, to: Math.min(stint.to, laps) }));
  const L = compact ? 4 : 52;
  const R = compact ? 4 : 16;
  const plotW = Math.max(40, width - L - R);
  const slot = plotW / Math.max(1, laps);
  const xCenter = (lap: number) => L + (lap - 0.5) * slot;
  const xEdge = (lap: number) => L + lap * slot;

  // A single driver's line is neutral ink; blue marks you only when there is
  // another driver on the chart to tell you apart from.
  const compared = panels.some(
    (panel) =>
      panel.kind === "time" && panel.series.some((s) => s.tone === "compare"),
  );
  const tone: Record<ChartSeriesTone, string> = {
    you: compared ? TONE_VAR.you : "var(--color-tone-200)",
    compare: TONE_VAR.compare,
  };
  const stacked = panels.length > 1 && !compact;

  const layout = useMemo(() => {
    let y = events.length && !compact ? EVENT_LANE : 0;
    return panels.map((panel, index) => {
      const top =
        y +
        (index === 0
          ? compact
            ? 4
            : stacked
              ? 22
              : 14
          : stacked
            ? STACKED_PANEL_GAP
            : PANEL_GAP);
      const domain = panel.kind === "time" ? timeDomain(panel) : null;
      const hasOffScale =
        panel.kind === "time" &&
        panel.series.some((s) =>
          s.lapsMs.some((ms) => ms != null && domain && ms > domain[1]),
        );
      const gutter = hasOffScale && !compact ? GUTTER_H : 0;
      y = top + gutter + panel.height;
      return {
        panel,
        top,
        plotTop: top + gutter,
        bottom: top + gutter + panel.height,
        gutter,
        domain,
      };
    });
  }, [panels, events.length, compact, stacked]);
  const plotBottom = layout.at(-1)?.bottom ?? 0;
  const contentBottom = layout.at(-1)?.bottom ?? 0;
  const height = contentBottom + (compact ? 4 : AXIS_H + 4);

  const elements: ReactNode[] = [];
  // One mark per kind per lap: a pile-up of contacts on one lap is one ✕,
  // and the tooltip lists them.
  const eventsByLap = new Map<number, ("contact" | "warning")[]>();
  for (const event of events) {
    const kinds = eventsByLap.get(event.lap) ?? [];
    if (!kinds.includes(event.kind))
      eventsByLap.set(event.lap, [...kinds, event.kind]);
  }

  layout.forEach(({ panel, top, plotTop, bottom, gutter, domain }, pi) => {
    const key = `p${pi}`;
    if (stacked) {
      elements.push(
        <text
          key={`${key}-label`}
          x={0}
          y={top - 9}
          className="fill-tone-400 text-[10.5px] font-semibold tracking-wide uppercase"
        >
          {panel.label ?? PANEL_LABEL[panel.kind]}
        </text>,
      );
      if (pi > 0) {
        const previous = layout[pi - 1];
        const y = (previous.bottom + top) / 2 - 6;
        elements.push(
          <line
            key={`${key}-divider`}
            x1={0}
            x2={L + plotW}
            y1={y}
            y2={y}
            className="stroke-tone-800"
          />,
        );
      }
    }
    for (const band of bands) {
      elements.push(
        <rect
          key={`${key}-band-${band.from}`}
          x={xEdge(band.from - 1)}
          y={top}
          width={xEdge(band.to) - xEdge(band.from - 1)}
          height={bottom - top}
          className="fill-tone-0/[0.05]"
        />,
      );
      if (pi === 0 && !compact) {
        elements.push(
          <text
            key={`${key}-bandl-${band.from}`}
            x={(xEdge(band.from - 1) + xEdge(band.to)) / 2}
            y={top - 4}
            textAnchor="middle"
            className="fill-tone-400 text-[10px] font-semibold tracking-wider"
          >
            {band.label}
          </text>,
        );
      }
    }
    if (!compact) {
      for (const pit of pits) {
        elements.push(
          <line
            key={`${key}-pit-${pit}`}
            x1={xEdge(pit)}
            x2={xEdge(pit)}
            y1={top}
            y2={bottom}
            className="stroke-tone-700"
          />,
        );
      }
    }

    if (panel.kind === "position") {
      const y = (p: number) =>
        top + ((p - 1) / Math.max(1, panel.maxPosition - 1)) * (bottom - top);
      const x = (i: number) => (i === 0 ? L : xEdge(i));
      if (!compact) {
        const step = panel.maxPosition > 12 ? 5 : 2;
        for (let p = 1; p <= panel.maxPosition; p += step) {
          elements.push(
            <g key={`${key}-g${p}`}>
              <line
                x1={L}
                x2={L + plotW}
                y1={y(p)}
                y2={y(p)}
                className="stroke-tone-800"
              />
              <text
                x={L - 8}
                y={y(p) + 3.5}
                textAnchor="end"
                className="fill-tone-500 text-[10.5px] tabular-nums"
              >
                P{p}
              </text>
            </g>,
          );
        }
      }
      const points = panel.trace
        .map((p, i) =>
          p > 0
            ? `${x(i).toFixed(1)},${y(Math.min(p, panel.maxPosition)).toFixed(1)}`
            : null,
        )
        .filter(Boolean);
      elements.push(
        <polyline
          key={`${key}-line`}
          points={points.join(" ")}
          fill="none"
          stroke={tone.you}
          strokeWidth={2}
          strokeLinejoin="round"
          strokeLinecap="round"
        />,
      );
      const first = panel.trace[0];
      const lastIndex = panel.trace.length - 1;
      const last = panel.trace[lastIndex];
      if (first > 0) {
        elements.push(
          <circle
            key={`${key}-start`}
            cx={x(0)}
            cy={y(first)}
            r={compact ? 3 : 4}
            stroke={tone.you}
            strokeWidth={2}
            className="fill-tone-900"
          />,
        );
      }
      if (last > 0) {
        elements.push(
          <circle
            key={`${key}-end`}
            cx={x(lastIndex)}
            cy={y(Math.min(last, panel.maxPosition))}
            r={compact ? 3.5 : 4.5}
            fill={tone.you}
            className="stroke-tone-900"
            strokeWidth={2}
          />,
        );
        if (panel.endLabel && !compact) {
          elements.push(
            <text
              key={`${key}-endl`}
              x={x(lastIndex) - 10}
              y={y(Math.min(last, panel.maxPosition)) - 9}
              textAnchor="end"
              className="fill-tone-100 text-[11px] font-medium"
            >
              {panel.endLabel}
            </text>,
          );
        }
      }
      for (const note of panel.notes ?? []) {
        if (compact) continue;
        // Sit the label on the side the trace leaves empty over the next few
        // laps: a flat or climbing line keeps the space below it free.
        const ahead = panel.trace.slice(note.lap + 1, note.lap + 4);
        const falls = ahead.some((p) => p > note.position);
        const climbs = ahead.some((p) => p < note.position);
        const py = y(Math.min(note.position, panel.maxPosition));
        const below = (!falls || climbs) && py + 15 <= bottom;
        elements.push(
          <text
            key={`${key}-note-${note.lap}`}
            x={x(note.lap) + 8}
            y={below ? py + 15 : py - 7}
            className="fill-tone-400 text-[10.5px]"
          >
            {note.text}
          </text>,
        );
      }
    }

    if (panel.kind === "time" && domain) {
      const [lo, hi] = domain;
      const y = (ms: number) =>
        bottom - ((ms - lo) / (hi - lo)) * (bottom - plotTop);
      // Off-scale laps (pit, SC) sit in the gutter above the plot.
      const offScaleY = top + 9;
      const step = niceStep((hi - lo) / 1000) * 1000;
      if (!compact) {
        for (let t = Math.ceil(lo / step) * step; t <= hi; t += step) {
          elements.push(
            <g key={`${key}-t${t}`}>
              <line
                x1={L}
                x2={L + plotW}
                y1={y(t)}
                y2={y(t)}
                className="stroke-tone-800"
              />
              <text
                x={L - 8}
                y={y(t) + 3.5}
                textAnchor="end"
                className="fill-tone-500 text-[10.5px] tabular-nums"
              >
                {tickLabel(t, step / 1000)}
              </text>
            </g>,
          );
        }
        if (gutter) {
          elements.push(
            <g key={`${key}-gutter`}>
              <line
                x1={L}
                x2={L + plotW}
                y1={plotTop - 3}
                y2={plotTop - 3}
                className="stroke-tone-800"
                strokeDasharray="2 3"
              />
              <text
                x={L - 8}
                y={offScaleY + 3.5}
                textAnchor="end"
                className="fill-tone-500 text-[10px]"
              >
                off scale
              </text>
            </g>,
          );
        }
      }
      const stintOf = (lap: number) =>
        stints.findIndex((s) => lap >= s.from && lap <= s.to);
      for (const series of panel.series) {
        const color = tone[series.tone];
        // Lines join clean laps only, broken at stint changes.
        let segment: string[] = [];
        let segmentStint = -1;
        const flush = () => {
          if (segment.length > 1) {
            elements.push(
              <polyline
                key={`${key}-${series.key}-seg-${elements.length}`}
                points={segment.join(" ")}
                fill="none"
                stroke={color}
                strokeWidth={2}
                strokeLinejoin="round"
                strokeLinecap="round"
                opacity={series.tone === "compare" ? 0.85 : 1}
              />,
            );
          }
          segment = [];
        };
        series.lapsMs.forEach((ms, i) => {
          const lap = i + 1;
          if (ms == null || ms <= 0) return;
          const excluded = series.excluded?.has(lap) || ms > hi;
          if (excluded) return;
          const s = stintOf(lap);
          if (segment.length && s !== segmentStint) flush();
          segmentStint = s;
          segment.push(`${xCenter(lap).toFixed(1)},${y(ms).toFixed(1)}`);
        });
        flush();
        series.lapsMs.forEach((ms, i) => {
          const lap = i + 1;
          if (ms == null || ms <= 0) return;
          const offScale = ms > hi;
          const excluded = series.excluded?.has(lap) || offScale;
          if (series.tone === "compare" && excluded) return;
          if (offScale && !gutter) return;
          elements.push(
            <circle
              key={`${key}-${series.key}-d${lap}`}
              cx={xCenter(lap)}
              cy={offScale ? offScaleY : y(ms)}
              r={series.tone === "you" ? (compact ? 2.5 : 3.6) : 2.8}
              fill={color}
              opacity={excluded ? 0.35 : 1}
              className={excluded ? "" : "stroke-tone-900"}
              strokeWidth={excluded ? 0 : 1.5}
            />,
          );
        });
        for (const average of series.averages ?? []) {
          elements.push(
            <line
              key={`${key}-${series.key}-avg-${average.from}`}
              x1={xCenter(average.from) - 6}
              x2={xCenter(average.to) + 6}
              y1={y(average.ms)}
              y2={y(average.ms)}
              stroke={color}
              strokeWidth={1.5}
              opacity={0.5}
            />,
          );
          if (!compact) {
            // Beside the line's end, or above it when that would run off
            // the right edge (a stint that ends on the last lap).
            const fits = xCenter(average.to) + 62 <= width;
            elements.push(
              <text
                key={`${key}-${series.key}-avgl-${average.from}`}
                x={fits ? xCenter(average.to) + 10 : xCenter(average.to) + 6}
                y={fits ? y(average.ms) + 4 : y(average.ms) - 6}
                textAnchor={fits ? "start" : "end"}
                className="fill-tone-400 text-[10.5px] tabular-nums"
              >
                {msToLapTime(average.ms)}
              </text>,
            );
          }
        }
        for (const note of series.notes ?? []) {
          const ms = series.lapsMs[note.lap - 1];
          if (ms == null || compact) continue;
          const offScale = ms > hi;
          elements.push(
            <text
              key={`${key}-${series.key}-n${note.lap}`}
              x={xCenter(note.lap)}
              y={(offScale ? offScaleY : y(ms)) - 9}
              textAnchor="middle"
              className="fill-tone-400 text-[10px]"
            >
              {note.text}
            </text>,
          );
        }
      }
    }

    if (panel.kind === "wear") {
      const max = 80;
      const y = (v: number) => top + (1 - v / max) * (bottom - top);
      if (!compact) {
        for (const v of [0, 25, 50]) {
          elements.push(
            <g key={`${key}-w${v}`}>
              <line
                x1={L}
                x2={L + plotW}
                y1={y(v)}
                y2={y(v)}
                className="stroke-tone-800"
              />
              <text
                x={L - 8}
                y={y(v) + 3.5}
                textAnchor="end"
                className="fill-tone-500 text-[10.5px] tabular-nums"
              >
                {v}%
              </text>
            </g>,
          );
        }
        elements.push(
          <g key={`${key}-limit`}>
            <line
              x1={L}
              x2={L + plotW}
              y1={y(75)}
              y2={y(75)}
              className="stroke-tone-400"
              strokeOpacity={0.5}
            />
            <text
              x={L - 8}
              y={y(75) + 3.5}
              textAnchor="end"
              className="fill-tone-500 text-[10.5px]"
            >
              75%
            </text>
          </g>,
        );
      }
      for (const stint of stints.length
        ? stints
        : [{ from: 1, to: laps, compound: "" }]) {
        const pts: [number, number][] = [];
        for (let lap = stint.from; lap <= stint.to; lap++) {
          const v = panel.wear[lap - 1];
          if (v != null) pts.push([xCenter(lap), y(v)]);
        }
        if (pts.length === 0) continue;
        elements.push(
          <polyline
            key={`${key}-wl-${stint.from}`}
            points={pts
              .map(([px, py]) => `${px.toFixed(1)},${py.toFixed(1)}`)
              .join(" ")}
            fill="none"
            stroke={tone.you}
            strokeWidth={2}
            strokeLinejoin="round"
          />,
        );
        const [ex, ey] = pts[pts.length - 1];
        const endWear = panel.wear[stint.to - 1];
        elements.push(
          <circle
            key={`${key}-wd-${stint.from}`}
            cx={ex}
            cy={ey}
            r={4}
            fill={tone.you}
            className="stroke-tone-900"
            strokeWidth={2}
          />,
        );
        if (endWear != null && !compact) {
          elements.push(
            <text
              key={`${key}-wt-${stint.from}`}
              x={ex}
              y={ey - 9}
              textAnchor="middle"
              className="fill-tone-100 text-[11px] font-medium tabular-nums"
            >
              {Math.round(endWear)}%
            </text>,
          );
        }
      }
    }
  });

  if (!compact) {
    for (const [lap, kinds] of eventsByLap) {
      kinds.forEach((kind, i) => {
        elements.push(
          <text
            key={`ev-${lap}-${i}`}
            x={xCenter(lap) + (i - (kinds.length - 1) / 2) * 9}
            y={12}
            textAnchor="middle"
            className={cn(
              "text-[11px] font-bold",
              kind === "contact" ? "fill-tone-100" : "fill-warning",
            )}
          >
            {kind === "contact" ? "✕" : "!"}
          </text>,
        );
      });
    }
    if (events.length) {
      elements.push(
        <text
          key="ev-label"
          x={L - 8}
          y={12}
          textAnchor="end"
          className="fill-tone-500 text-[10px]"
        >
          you
        </text>,
      );
    }
    const step = laps > 40 ? 10 : 5;
    for (let lap = 1; lap <= laps; lap++) {
      if (lap !== 1 && lap % step !== 0 && lap !== laps) continue;
      if (
        lap !== laps &&
        laps - lap < step / 2 &&
        lap % step === 0 &&
        lap !== 1
      )
        continue;
      elements.push(
        <text
          key={`x${lap}`}
          x={xCenter(lap)}
          y={contentBottom + 14}
          textAnchor="middle"
          className="fill-tone-500 text-[10.5px] tabular-nums"
        >
          L{lap}
        </text>,
      );
    }
  }

  const tip = hover && tooltip ? tooltip(hover.lap) : null;

  return (
    <div ref={ref} className={cn("relative select-none", className)}>
      <svg
        // Fluid width: a fixed pixel width would set the grid/flex parent's
        // min-content to the pre-measure fallback and push it off-screen.
        width="100%"
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        className="block overflow-visible"
      >
        {elements}
        {hover && (
          <line
            x1={xCenter(hover.lap)}
            x2={xCenter(hover.lap)}
            y1={4}
            y2={plotBottom}
            className="pointer-events-none stroke-tone-0/30"
          />
        )}
        {tooltip && (
          <rect
            x={L}
            y={0}
            width={plotW}
            height={height}
            fill="transparent"
            className="cursor-crosshair"
            onPointerMove={(event) => {
              const rect = (
                event.currentTarget.ownerSVGElement as SVGSVGElement
              ).getBoundingClientRect();
              const px = event.clientX - rect.left;
              const lap = Math.min(
                laps,
                Math.max(1, Math.floor((px - L) / slot) + 1),
              );
              setHover({ lap, y: event.clientY - rect.top });
            }}
            onPointerLeave={() => setHover(null)}
          />
        )}
      </svg>
      {stints.length > 0 && (
        <div
          className="relative mt-2 h-6"
          style={{ marginLeft: L, marginRight: R }}
        >
          {stints.map((stint) => (
            <div
              key={stint.from}
              className="absolute top-0 flex h-6 items-center justify-center overflow-hidden rounded-md border-2 border-tone-900 text-xs font-semibold whitespace-nowrap"
              style={{
                left: `${((stint.from - 1) / laps) * 100}%`,
                width: `${((stint.to - stint.from + 1) / laps) * 100}%`,
                backgroundColor: getCompoundColor(stint.compound),
                color:
                  stint.compound === "Soft" || stint.compound === "Wet"
                    ? "#fff"
                    : "#18181b",
              }}
            >
              {!compact && (
                <span className="truncate px-1">
                  {plotW * ((stint.to - stint.from + 1) / laps) > 70
                    ? (stint.label ??
                      `${stint.compound} · ${stint.to - stint.from + 1}`)
                    : stint.compound.charAt(0)}
                </span>
              )}
            </div>
          ))}
        </div>
      )}
      {tip && hover && (
        <div
          className="pointer-events-none absolute z-10 min-w-44 rounded-xl bg-tone-900 px-3 py-2 text-xs shadow-xl shadow-tone-1000/30 ring-1 ring-tone-700"
          style={{
            left:
              xCenter(hover.lap) + 190 > width
                ? undefined
                : xCenter(hover.lap) + 12,
            right:
              xCenter(hover.lap) + 190 > width
                ? width - xCenter(hover.lap) + 12
                : undefined,
            top: Math.max(0, hover.y - 24),
          }}
        >
          <div className="mb-1 text-tone-400">{tip.title}</div>
          {tip.rows.map((row, i) => (
            <div
              key={i}
              className="grid grid-cols-[12px_auto_1fr] items-baseline gap-2 py-0.5"
            >
              <span
                className="inline-block h-0.5 w-3 rounded-full"
                style={{
                  background:
                    row.tone && row.tone !== "event"
                      ? tone[row.tone]
                      : "transparent",
                }}
              />
              <b className="font-semibold text-tone-50 tabular-nums">
                {row.value}
              </b>
              <span className="text-tone-400">{row.label}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Legend keys that mirror the marks: a short line per series. */
export function LapChartLegend({
  items,
}: {
  items: { tone: ChartSeriesTone; label: string }[];
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-tone-400">
      {items.map((item) => (
        <span key={item.label} className="inline-flex items-center gap-1.5">
          <span
            className="inline-block h-0.5 w-3 rounded-full"
            style={{ background: TONE_VAR[item.tone] }}
          />
          {item.label}
        </span>
      ))}
    </div>
  );
}
