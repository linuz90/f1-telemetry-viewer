import {
  memo,
  useEffect,
  useId,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  lowerBound,
  sectorGaps,
  type LapSeriesSet,
} from "../../analysis/lapTelemetryAnalysis";
import { CHART_THEME } from "../../constants/colors";
import { cn } from "../../utils/cn";
import { formatSignedSeconds } from "../../utils/format";
import { useHoverDistance, type HoverStore } from "./hoverStore";
import {
  PANE_MAX_HEIGHT,
  PANE_MIN_HEIGHT,
  PANE_SPECS,
  paneHeight,
  usePaneHeights,
  type PaneId,
  type PaneSpec,
} from "./panes";
import type { SlotLap } from "./types";

const GUTTER_LEFT = 52;
const GUTTER_RIGHT = 8;
const AXIS_HEIGHT = 34;
const PANE_GAP = 6;
const MIN_DRAG_PX = 8;
/** Grab-area height, centred on the gap below each pane and wider than it. */
const RESIZE_HIT_PX = 10;
const RESIZE_KEY_STEP = 8;
/** Room the pane's own label takes in the top-left corner. */
const PANE_LABEL_PX = 64;
const SECTOR_DELTA_HALF_PX = 30;

function useElementWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      setWidth(Math.round(entry.contentRect.width));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return [ref, width] as const;
}

function visibleRange(
  grid: Float64Array,
  domain: [number, number],
): [number, number] {
  const i0 = Math.max(0, lowerBound(grid, domain[0]) - 1);
  const i1 = Math.min(grid.length - 1, lowerBound(grid, domain[1]));
  return [i0, i1];
}

/** Line path with per-pixel min/max decimation so spikes survive zooming out. */
function linePath(
  grid: Float64Array,
  values: ArrayLike<number>,
  [i0, i1]: [number, number],
  x: (d: number) => number,
  y: (v: number) => number,
  plotWidth: number,
): string {
  const perPixel = (i1 - i0 + 1) / Math.max(plotWidth, 1);
  const parts: string[] = [];
  const point = (i: number) =>
    `${x(grid[i]).toFixed(1)} ${y(values[i]).toFixed(1)}`;
  if (perPixel <= 2) {
    for (let i = i0; i <= i1; i += 1)
      parts.push(`${i === i0 ? "M" : "L"}${point(i)}`);
    return parts.join("");
  }
  const bucket = Math.ceil(perPixel);
  for (let start = i0; start <= i1; start += bucket) {
    const end = Math.min(i1, start + bucket - 1);
    let lo = start;
    let hi = start;
    for (let i = start; i <= end; i += 1) {
      if (values[i] < values[lo]) lo = i;
      if (values[i] > values[hi]) hi = i;
    }
    const [first, second] = lo < hi ? [lo, hi] : [hi, lo];
    parts.push(
      `${parts.length === 0 ? "M" : "L"}${point(first)}L${point(second)}`,
    );
  }
  return parts.join("");
}

function paneDomain(
  spec: PaneSpec,
  id: PaneId,
  series: LapSeriesSet,
  range: [number, number],
): [number, number] {
  if (spec.fixed) return spec.fixed;
  let lo = Infinity;
  let hi = -Infinity;
  const arrays =
    id === "gap"
      ? series.gaps.map((gap) => gap.gapS)
      : series.laps.map((lap) => lap.channels[spec.channel!]);
  for (const values of arrays) {
    for (let i = range[0]; i <= range[1]; i += 1) {
      lo = Math.min(lo, values[i]);
      hi = Math.max(hi, values[i]);
    }
  }
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return [0, 1];
  if (id === "gap") {
    const extent = Math.max(Math.abs(lo), Math.abs(hi), 0.05) * 1.15;
    return [-extent, extent];
  }
  if (spec.symmetric) {
    const extent = Math.max(Math.abs(lo), Math.abs(hi), 10);
    return [-extent, extent];
  }
  if (spec.step)
    return [Math.max(0, Math.floor(lo) - 0.5), Math.ceil(hi) + 0.5];
  const pad = Math.max((hi - lo) * 0.06, 1);
  return [lo - pad, hi + pad];
}

interface PaneProps {
  id: PaneId;
  series: LapSeriesSet;
  slots: readonly SlotLap[];
  width: number;
  height: number;
  domain: [number, number];
  highlight?: { from: number; to: number };
  sectorStarts?: [number, number];
}

const TracePane = memo(function TracePane({
  id,
  series,
  slots,
  width,
  height,
  domain,
  highlight,
  sectorStarts,
}: PaneProps) {
  const spec = PANE_SPECS[id];
  const plotWidth = Math.max(1, width - GUTTER_LEFT - GUTTER_RIGHT);
  const range = visibleRange(series.grid, domain);
  const [lo, hi] = paneDomain(spec, id, series, range);
  const x = (d: number) =>
    GUTTER_LEFT + ((d - domain[0]) / (domain[1] - domain[0])) * plotWidth;
  const y = (v: number) => 4 + (1 - (v - lo) / (hi - lo)) * (height - 8);
  const bands = bandRects(domain, sectorStarts, x);

  const lines =
    id === "gap"
      ? series.gaps.map((gap) => ({
          key: gap.key,
          color:
            slots.find((slot) => slot.key === gap.key)?.color ??
            CHART_THEME.muted,
          path: linePath(series.grid, gap.gapS, range, x, y, plotWidth),
        }))
      : series.laps
          .map((lap) => ({
            key: lap.key,
            color:
              slots.find((slot) => slot.key === lap.key)?.color ??
              CHART_THEME.muted,
            path: linePath(
              series.grid,
              lap.channels[spec.channel!],
              range,
              x,
              y,
              plotWidth,
            ),
          }))
          // Draw A last so the lap under study sits on top.
          .reverse();

  const firstGap = id === "gap" ? series.gaps[0] : undefined;
  const zeroY = y(0);
  const areaPath = firstGap
    ? `${linePath(series.grid, firstGap.gapS, range, x, y, plotWidth)}L${x(series.grid[range[1]]).toFixed(1)} ${zeroY.toFixed(1)}L${x(series.grid[range[0]]).toFixed(1)} ${zeroY.toFixed(1)}Z`
    : undefined;
  const uid = useId();
  const gradientId = `${uid}-gap-fill`;
  const clipId = `${uid}-clip`;

  return (
    <svg
      width={width}
      height={height}
      className="block overflow-visible"
      aria-hidden
    >
      <defs>
        <clipPath id={clipId}>
          <rect x={GUTTER_LEFT} y={0} width={plotWidth} height={height} />
        </clipPath>
        {firstGap && (
          <linearGradient
            id={gradientId}
            gradientUnits="userSpaceOnUse"
            x1="0"
            y1="0"
            x2="0"
            y2={height}
          >
            <stop
              offset={zeroY / height}
              stopColor={CHART_THEME.behind}
              stopOpacity={0.22}
            />
            <stop
              offset={zeroY / height}
              stopColor={CHART_THEME.ahead}
              stopOpacity={0.22}
            />
          </linearGradient>
        )}
      </defs>
      <rect
        x={GUTTER_LEFT}
        y={0}
        width={plotWidth}
        height={height}
        rx={6}
        fill="rgba(255,255,255,0.015)"
      />
      {bands.map((band) => (
        <rect
          key={band.key}
          x={band.x}
          y={0}
          width={band.width}
          height={height}
          fill="rgba(255,255,255,0.025)"
        />
      ))}
      {highlight && highlight.to > domain[0] && highlight.from < domain[1] && (
        <rect
          x={Math.max(GUTTER_LEFT, x(highlight.from))}
          y={0}
          width={Math.max(
            0,
            Math.min(GUTTER_LEFT + plotWidth, x(highlight.to)) -
              Math.max(GUTTER_LEFT, x(highlight.from)),
          )}
          height={height}
          fill="rgba(255,255,255,0.06)"
        />
      )}
      {(id === "gap" || spec.symmetric) && (
        <line
          x1={GUTTER_LEFT}
          x2={GUTTER_LEFT + plotWidth}
          y1={zeroY}
          y2={zeroY}
          stroke={CHART_THEME.grid}
          strokeWidth={1}
        />
      )}
      <g clipPath={`url(#${clipId})`}>
        {areaPath && <path d={areaPath} fill={`url(#${gradientId})`} />}
        {lines.map((line) => (
          <path
            key={line.key}
            d={line.path}
            fill="none"
            stroke={line.color}
            strokeWidth={1.6}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        ))}
      </g>
      {/* Label inside the plot's top-left corner; ticks own the gutter. */}
      <text
        x={GUTTER_LEFT + 6}
        y={13}
        className="font-mono text-[10px] font-medium uppercase tracking-wider"
        // A halo in the card colour keeps the label legible over traces.
        stroke="#18181b"
        strokeWidth={3}
        paintOrder="stroke"
      >
        <tspan className="fill-zinc-400">{spec.label}</tspan>
        {spec.unit && (
          <tspan className="fill-zinc-600" dx={5}>
            {spec.unit}
          </tspan>
        )}
      </text>
      {id === "gap" && sectorStarts && (
        <SectorDeltas
          series={series}
          slots={slots}
          domain={domain}
          sectorStarts={sectorStarts}
          x={x}
          plotRight={GUTTER_LEFT + plotWidth}
        />
      )}
      <text
        x={GUTTER_LEFT - 6}
        y={y(hi) + 10}
        textAnchor="end"
        className="fill-zinc-600 font-mono text-[10px] tabular-nums"
      >
        {spec.format(
          id === "gap" || spec.step ? hi - (spec.step ? 0.5 : 0) : hi,
        )}
      </text>
      <text
        x={GUTTER_LEFT - 6}
        y={y(lo) - 3}
        textAnchor="end"
        className="fill-zinc-600 font-mono text-[10px] tabular-nums"
      >
        {spec.format(spec.step ? lo + 0.5 : lo)}
      </text>
    </svg>
  );
});

/**
 * Time A lost or gained in each sector, centred in the sector along the top
 * of the Gap pane, one row per comparison lap.
 */
function SectorDeltas({
  series,
  slots,
  domain,
  sectorStarts,
  x,
  plotRight,
}: {
  series: LapSeriesSet;
  slots: readonly SlotLap[];
  domain: [number, number];
  sectorStarts: [number, number];
  x: (d: number) => number;
  plotRight: number;
}) {
  const rows = sectorGaps(series, sectorStarts);
  const bounds = [0, ...sectorStarts, series.trackLengthM];
  return rows.map((row, rowIndex) =>
    row.deltasS.map((delta, sector) => {
      const start = x(Math.max(domain[0], bounds[sector]));
      const end = Math.min(
        plotRight,
        x(Math.min(domain[1], bounds[sector + 1])),
      );
      // Keep clear of the pane label, and skip sectors too narrow to label.
      const cx = Math.max((start + end) / 2, GUTTER_LEFT + PANE_LABEL_PX);
      if (cx - SECTOR_DELTA_HALF_PX < start || cx + SECTOR_DELTA_HALF_PX > end)
        return null;
      // Under 5 ms rounds to ±0.00: neither side gained.
      const fill =
        Math.abs(delta) < 0.005
          ? CHART_THEME.axis
          : delta > 0
            ? CHART_THEME.behind
            : CHART_THEME.ahead;
      const slot = slots.find((s) => s.key === row.key);
      return (
        <text
          key={`${row.key}-${sector}`}
          x={cx}
          y={13 + rowIndex * 13}
          textAnchor="middle"
          className="font-mono text-[10px] font-medium tabular-nums"
          stroke="#18181b"
          strokeWidth={3}
          paintOrder="stroke"
        >
          {rows.length > 1 && slot && (
            <tspan fill={slot.color} dx={-2}>
              {`${slot.slot} `}
            </tspan>
          )}
          <tspan fill={fill}>{formatSignedSeconds(delta * 1000, 2)}</tspan>
        </text>
      );
    }),
  );
}

function bandRects(
  domain: [number, number],
  sectorStarts: [number, number] | undefined,
  x: (d: number) => number,
) {
  if (!sectorStarts) return [];
  // Shade sector 2 only: alternating bands read as sectors without labels on every pane.
  const from = Math.max(domain[0], sectorStarts[0]);
  const to = Math.min(domain[1], sectorStarts[1]);
  return to > from ? [{ key: "s2", x: x(from), width: x(to) - x(from) }] : [];
}

function niceStep(span: number): number {
  const raw = span / 6;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const normalized = raw / magnitude;
  const factor =
    normalized < 1.5 ? 1 : normalized < 3.5 ? 2.5 : normalized < 7.5 ? 5 : 10;
  return factor * magnitude;
}

function DistanceAxis({
  width,
  domain,
  sectorStarts,
}: {
  width: number;
  domain: [number, number];
  sectorStarts?: [number, number];
}) {
  const plotWidth = Math.max(1, width - GUTTER_LEFT - GUTTER_RIGHT);
  const x = (d: number) =>
    GUTTER_LEFT + ((d - domain[0]) / (domain[1] - domain[0])) * plotWidth;
  const step = niceStep(domain[1] - domain[0]);
  const ticks: number[] = [];
  for (let d = Math.ceil(domain[0] / step) * step; d <= domain[1]; d += step)
    ticks.push(d);
  const sectorLabels = sectorStarts
    ? ([
        ["S1", 0, sectorStarts[0]],
        ["S2", sectorStarts[0], sectorStarts[1]],
        ["S3", sectorStarts[1], Infinity],
      ] as const)
    : [];
  return (
    <svg width={width} height={AXIS_HEIGHT} className="block" aria-hidden>
      {ticks.map((d) => (
        <text
          key={d}
          x={x(d)}
          y={13}
          textAnchor="middle"
          className="fill-zinc-600 font-mono text-[10px] tabular-nums"
        >
          {step >= 1000
            ? `${d / 1000} km`
            : `${(d / 1000).toFixed(step >= 100 ? 1 : 2)} km`}
        </text>
      ))}
      {/* Sector names sit on their own row, centred in each sector. */}
      {sectorLabels.map(([label, from, to]) => {
        const start = Math.max(domain[0], from);
        const end = Math.min(domain[1], to);
        if (end <= start) return null;
        return (
          <text
            key={label}
            x={(x(start) + x(end)) / 2}
            y={29}
            textAnchor="middle"
            className="fill-zinc-500 font-mono text-[10px] font-semibold"
          >
            {label}
          </text>
        );
      })}
    </svg>
  );
}

/** Drag a pane's bottom edge to resize it; double-click restores its default. */
function PaneResizeHandle({
  label,
  top,
  width,
  height,
  onResize,
}: {
  label: string;
  top: number;
  width: number;
  height: number;
  onResize: (height: number | null) => void;
}) {
  const dragStart = useRef<{ y: number; height: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const endDrag = () => {
    dragStart.current = null;
    setDragging(false);
  };
  return (
    <div
      role="separator"
      aria-orientation="horizontal"
      aria-label={`Resize ${label} trace`}
      aria-valuenow={height}
      aria-valuemin={PANE_MIN_HEIGHT}
      aria-valuemax={PANE_MAX_HEIGHT}
      tabIndex={0}
      title="Drag to resize, double-click to reset"
      className="group absolute z-10 flex cursor-row-resize items-center focus:outline-none"
      style={{
        top: top - RESIZE_HIT_PX / 2,
        left: GUTTER_LEFT,
        width: width - GUTTER_LEFT - GUTTER_RIGHT,
        height: RESIZE_HIT_PX,
        touchAction: "none",
      }}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.currentTarget.setPointerCapture(event.pointerId);
        dragStart.current = { y: event.clientY, height };
        setDragging(true);
      }}
      onPointerMove={(event) => {
        const start = dragStart.current;
        if (start) onResize(start.height + event.clientY - start.y);
      }}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onDoubleClick={() => onResize(null)}
      onKeyDown={(event) => {
        if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
        event.preventDefault();
        onResize(
          height + (event.key === "ArrowDown" ? 1 : -1) * RESIZE_KEY_STEP,
        );
      }}
    >
      <div
        className={cn(
          "h-0.5 w-full rounded-full transition-colors group-hover:bg-zinc-500/70 group-focus-visible:bg-zinc-500/70",
          dragging && "bg-zinc-400/80 group-hover:bg-zinc-400/80",
        )}
      />
    </div>
  );
}

function Crosshair({
  store,
  width,
  domain,
}: {
  store: HoverStore;
  width: number;
  domain: [number, number];
}) {
  const hover = useHoverDistance(store);
  if (hover === null || hover < domain[0] || hover > domain[1]) return null;
  const plotWidth = Math.max(1, width - GUTTER_LEFT - GUTTER_RIGHT);
  const left =
    GUTTER_LEFT + ((hover - domain[0]) / (domain[1] - domain[0])) * plotWidth;
  return (
    <div
      className="pointer-events-none absolute inset-y-0 w-px bg-zinc-300/60"
      style={{ left }}
    />
  );
}

export interface LapTraceChartsProps {
  series: LapSeriesSet;
  slots: readonly SlotLap[];
  panes: readonly PaneId[];
  domain: [number, number];
  onDomainChange: (domain: [number, number] | null) => void;
  highlight?: { from: number; to: number };
  sectorStarts?: [number, number];
  hoverStore: HoverStore;
}

/**
 * Stacked distance-aligned traces drawn as plain SVG. Recharts re-renders
 * every synced chart on pointer moves, which lags with six panes of two
 * 2,600-point laps, so traces are static paths and the crosshair is an
 * overlay fed by the hover store.
 */
export function LapTraceCharts({
  series,
  slots,
  panes,
  domain,
  onDomainChange,
  highlight,
  sectorStarts,
  hoverStore,
}: LapTraceChartsProps) {
  const [containerRef, width] = useElementWidth<HTMLDivElement>();
  const [heights, setPaneHeight] = usePaneHeights();
  const [drag, setDrag] = useState<{ start: number; current: number } | null>(
    null,
  );
  const plotWidth = Math.max(1, width - GUTTER_LEFT - GUTTER_RIGHT);

  const distanceAt = (event: ReactPointerEvent<HTMLDivElement>): number => {
    const rect = event.currentTarget.getBoundingClientRect();
    const px = Math.min(
      Math.max(event.clientX - rect.left - GUTTER_LEFT, 0),
      plotWidth,
    );
    return domain[0] + (px / plotWidth) * (domain[1] - domain[0]);
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const distance = distanceAt(event);
    hoverStore.set(distance);
    if (drag) setDrag({ ...drag, current: distance });
  };

  const handlePointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!drag) return;
    const end = distanceAt(event);
    const [from, to] = drag.start < end ? [drag.start, end] : [end, drag.start];
    setDrag(null);
    if (((to - from) / (domain[1] - domain[0])) * plotWidth >= MIN_DRAG_PX) {
      onDomainChange([from, to]);
    } else {
      // A plain click parks the playback head there (and keeps playing from it).
      hoverStore.seek(end);
    }
  };

  const paneHeights = panes.map((pane) => paneHeight(heights, pane));
  const paneBottoms = paneHeights.map(
    (_, index) =>
      paneHeights.slice(0, index + 1).reduce((sum, h) => sum + h, 0) +
      PANE_GAP * index,
  );
  const panesHeight = paneBottoms.at(-1) ?? 0;
  const x = (d: number) =>
    GUTTER_LEFT + ((d - domain[0]) / (domain[1] - domain[0])) * plotWidth;

  return (
    <div ref={containerRef} className="relative select-none">
      {width > 0 && (
        <>
          <div className="flex flex-col" style={{ gap: PANE_GAP }}>
            {panes.map((pane, index) => (
              <TracePane
                key={pane}
                id={pane}
                series={series}
                slots={slots}
                width={width}
                height={paneHeights[index]}
                domain={domain}
                highlight={highlight}
                sectorStarts={sectorStarts}
              />
            ))}
          </div>
          <DistanceAxis
            width={width}
            domain={domain}
            sectorStarts={sectorStarts}
          />
          <div
            className={cn(
              "absolute left-0 top-0 cursor-crosshair",
              drag && "cursor-col-resize",
            )}
            style={{ width, height: panesHeight, touchAction: "pan-y" }}
            onPointerMove={handlePointerMove}
            onPointerLeave={() => {
              if (!drag) hoverStore.set(null);
            }}
            onPointerDown={(event) => {
              if (event.button !== 0) return;
              event.currentTarget.setPointerCapture(event.pointerId);
              const distance = distanceAt(event);
              setDrag({ start: distance, current: distance });
            }}
            onPointerUp={handlePointerUp}
            onPointerCancel={() => setDrag(null)}
            onDoubleClick={() => onDomainChange(null)}
          >
            <Crosshair store={hoverStore} width={width} domain={domain} />
            {drag && (
              <div
                className="pointer-events-none absolute inset-y-0 bg-zinc-200/10 ring-1 ring-inset ring-zinc-300/30"
                style={{
                  left: Math.min(x(drag.start), x(drag.current)),
                  width: Math.abs(x(drag.current) - x(drag.start)),
                }}
              />
            )}
          </div>
          {/* After the zoom overlay so the edges win the pointer over it. */}
          {panes.map((pane, index) => (
            <PaneResizeHandle
              key={pane}
              label={PANE_SPECS[pane].label}
              // Centre the grab area on the gap below the pane, not its edge.
              top={paneBottoms[index] + PANE_GAP / 2}
              width={width}
              height={paneHeights[index]}
              onResize={(height) => setPaneHeight(pane, height)}
            />
          ))}
        </>
      )}
    </div>
  );
}
