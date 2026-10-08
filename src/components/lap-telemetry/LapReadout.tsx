import { useMemo, useState, type ReactNode } from "react";
import {
  lowerBound,
  type LapSeries,
  type LapSeriesSet,
} from "../../analysis/lapTelemetryAnalysis";
import { CHART_THEME } from "../../constants/colors";
import { LAP_INPUT_GHOST_STORAGE_KEY } from "../../constants/storage";
import { F1_26_COMPARISON_KEY } from "../../constants/formulas";
import { cn } from "../../utils/cn";
import { getFormulaComparisonKey } from "../../utils/sessionTypes";
import { getTrackCorners } from "../../utils/tracks";
import { readStoredBoolean, writeStoredBoolean } from "../../utils/storage";
import { FocusToggle } from "../ui/FocusToggle";
import { useHoverDistance, type HoverStore } from "./hoverStore";
import { PlaybackControls } from "./PlaybackControls";
import type { LapPlayback } from "./useLapPlayback";
import type { SlotLap } from "./types";

/** Throttle/brake history drawn behind the cursor, like an onboard input trace. */
const TRAIL_M = 250;
/** Battery change over this stretch decides the Deploy/Harvest label. */
const ERS_TREND_M = 30;
/** Below this change (MJ over ERS_TREND_M) the battery reads as holding. */
const ERS_TREND_MIN_MJ = 0.005;
/** Matches the Battery pane's fixed axis. */
const BATTERY_MAX_MJ = 4;
/** Full steering lock (±100%) drawn as a quarter turn of the wheel. */
const WHEEL_LOCK_DEG = 90;
/**
 * The header names a turn within this of its marker. Markers sit up to ~50 m
 * from the game's slowest point (see AGENTS.md, Lap telemetry), and a corner's
 * braking and exit reach about this far either side.
 */
const TURN_LABEL_RANGE_M = 120;

/** "0:42.315", keeping "0.000" at the line where msToLapTime shows "-". */
function formatElapsed(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${(seconds - minutes * 60).toFixed(3).padStart(6, "0")}`;
}

/**
 * `ers.deploy_mode` is the game's UDP enum: 0 None, 1 Medium, 2 Hotlap,
 * 3 the manual burst. 2025 cars call that Overtake; the 2026 Season Pack
 * renamed it Boost, and its new Overtake Mode (unlocked within 1 s of the car
 * ahead) has no value of its own in current exports.
 */
function ersModeLabel(mode: number, is2026: boolean): string | null {
  switch (Math.round(mode)) {
    case 0:
      return "None";
    case 1:
      return "Medium";
    case 2:
      return "Hotlap";
    case 3:
      return is2026 ? "Boost" : "Overtake";
    default:
      return null;
  }
}

function turnLabel(
  distance: number,
  corners: readonly { number: number; distanceM: number }[],
): string | null {
  let nearest: (typeof corners)[number] | null = null;
  for (const corner of corners) {
    if (
      Math.abs(corner.distanceM - distance) <= TURN_LABEL_RANGE_M &&
      (!nearest ||
        Math.abs(corner.distanceM - distance) <
          Math.abs(nearest.distanceM - distance))
    )
      nearest = corner;
  }
  return nearest ? `T${nearest.number}` : null;
}

function sectorLabel(
  distance: number,
  sectorStarts?: [number, number],
): string {
  if (!sectorStarts) return "";
  return distance < sectorStarts[0]
    ? "S1"
    : distance < sectorStarts[1]
      ? "S2"
      : "S3";
}

/**
 * Pinned onboard-style readout for the hovered distance: one input card per
 * lap, so skimming the traces shows what each driver was doing with their
 * feet, hands and battery. Keeps its height while idle to avoid layout jumps.
 */
export function LapReadout({
  series,
  slots,
  hoverStore,
  playback,
  sectorStarts,
  track,
  showBattery,
}: {
  series: LapSeriesSet;
  slots: readonly SlotLap[];
  hoverStore: HoverStore;
  playback: LapPlayback;
  /** Exporter track name, to name the turn at the cursor. */
  track?: string;
  sectorStarts?: [number, number];
  /** False for cars that record no battery trace. */
  showBattery: boolean;
}) {
  const hover = useHoverDistance(hoverStore);
  const corners = useMemo(
    () => (track ? getTrackCorners(track, series.trackLengthM) : []),
    [track, series.trackLengthM],
  );
  // Opt-in: the overlaid traces below already compare laps, so the cards
  // stay a clean onboard view unless asked.
  const [ghosting, setGhosting] = useState(() =>
    readStoredBoolean(LAP_INPUT_GHOST_STORAGE_KEY),
  );
  const toggleGhosting = () => {
    setGhosting(!ghosting);
    writeStoredBoolean(LAP_INPUT_GHOST_STORAGE_KEY, !ghosting);
  };
  // The grid is uniform, so one index serves every lap's channels.
  const index =
    hover === null
      ? null
      : Math.min(series.grid.length - 1, lowerBound(series.grid, hover));
  // Lap A's clock, the one playback runs on.
  const elapsed = index === null ? null : (series.laps[0]?.time[index] ?? null);
  const head =
    hover === null
      ? "Play the lap or hover the traces"
      : [
          elapsed === null ? null : formatElapsed(elapsed),
          `${(hover / 1000).toFixed(3)} km`,
          sectorStarts ? sectorLabel(hover, sectorStarts) : null,
          turnLabel(hover, corners),
        ]
          .filter(Boolean)
          .join(" · ");

  return (
    <div className="rounded-xl bg-zinc-950/40 px-3 py-2 ring-1 ring-inset ring-white/[0.04]">
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2.5">
          <PlaybackControls playback={playback} />
          <span className="truncate font-mono text-2xs tabular-nums text-zinc-500">
            {head}
          </span>
        </div>
        {slots.length > 1 && (
          <FocusToggle
            label="Ghost compared lap"
            value={ghosting}
            onChange={toggleGhosting}
          />
        )}
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        {slots.map((slot, slotIndex) => {
          const lap = series.laps.find((entry) => entry.key === slot.key);
          const gap = series.gaps.find((entry) => entry.key === slot.key);
          // Each card ghosts the lap it is compared with: A for the
          // comparisons, B for A, matching the gap and the tips.
          const ghostKey = slots[slotIndex === 0 ? 1 : 0]?.key;
          const ghost = ghosting
            ? series.laps.find((entry) => entry.key === ghostKey)
            : undefined;
          return (
            <InputCard
              key={slot.key}
              slot={slot}
              lap={lap}
              ghost={ghost}
              grid={series.grid}
              index={index}
              // Gap is A's, so it reads "A +0.045" on the comparison's card.
              gapS={
                slotIndex > 0 && gap && index !== null ? gap.gapS[index] : null
              }
              showBattery={showBattery}
            />
          );
        })}
      </div>
    </div>
  );
}

function InputCard({
  slot,
  lap,
  ghost,
  grid,
  index,
  gapS,
  showBattery,
}: {
  slot: SlotLap;
  lap: LapSeries | undefined;
  /** The compared lap, drawn faintly behind this one's inputs. */
  ghost: LapSeries | undefined;
  grid: Float64Array;
  index: number | null;
  gapS: number | null;
  showBattery: boolean;
}) {
  const at = lap && index !== null ? index : null;
  const channels = lap?.channels;
  const read = (values: Float32Array | undefined) =>
    at !== null && values ? values[at] : null;
  const throttle = read(channels?.throttle);
  const brake = read(channels?.brake);
  const steering = read(channels?.steering);
  const gear = read(channels?.gear);
  const speed = read(channels?.speed);
  const battery = read(channels?.ersMj);
  const ersModeValue = read(channels?.ersMode);
  const recording = slot.candidate.recording;
  const ersMode =
    ersModeValue === null
      ? null
      : ersModeLabel(
          ersModeValue,
          getFormulaComparisonKey(recording.formula, recording.gameYear) ===
            F1_26_COMPARISON_KEY,
        );
  const ghostChannels = ghost?.channels;

  const step = grid.length > 1 ? grid[1] - grid[0] : 1;
  let ersTrend: "deploy" | "harvest" | null = null;
  if (showBattery && at !== null && channels && battery !== null) {
    const before =
      channels.ersMj[Math.max(0, at - Math.round(ERS_TREND_M / step))];
    const delta = battery - before;
    if (delta > ERS_TREND_MIN_MJ) ersTrend = "harvest";
    else if (delta < -ERS_TREND_MIN_MJ) ersTrend = "deploy";
  }
  // Leaving a deploy mode for None does not cut power at once: deployment
  // tapers over ~200 m (2026 rules derate at 50 kW/s), and once settled None
  // never drains at full throttle in the recordings. So None plus a falling
  // battery is the derate, not a mislabelled mode.
  const derating =
    ersModeValue !== null &&
    Math.round(ersModeValue) === 0 &&
    ersTrend === "deploy";

  return (
    <div
      className="flex flex-col gap-1.5 rounded-lg bg-zinc-950/60 px-2.5 py-2"
      style={{
        boxShadow: `inset 0 0 0 1px color-mix(in srgb, ${slot.color} 28%, transparent)`,
      }}
    >
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className="min-w-0 truncate text-zinc-300">
          <span
            className="mr-1.5 inline-block size-2 rounded-full align-middle"
            style={{ backgroundColor: slot.color }}
          />
          <span className="text-zinc-500">{slot.slot}</span> {slot.label}
        </span>
        {gapS !== null && (
          <span className="shrink-0 font-mono text-2xs tabular-nums">
            <span className="text-zinc-600">A </span>
            <span
              className={cn(
                gapS > 0.0005
                  ? "text-behind"
                  : gapS < -0.0005
                    ? "text-ahead"
                    : "text-zinc-400",
              )}
            >
              {gapS >= 0 ? "+" : "−"}
              {Math.abs(gapS).toFixed(3)}
            </span>
          </span>
        )}
      </div>

      <div className="flex h-16 items-stretch gap-2.5">
        <InputTrail
          throttle={channels?.throttle}
          brake={channels?.brake}
          ghostThrottle={ghostChannels?.throttle}
          ghostBrake={ghostChannels?.brake}
          end={at}
          length={Math.round(TRAIL_M / step)}
        />
        <div className="flex shrink-0 gap-1">
          <InputBar
            label="T"
            readout={throttle === null ? "–" : `${Math.round(throttle)}`}
            value={throttle}
            ghostValue={read(ghostChannels?.throttle)}
            max={100}
            color={CHART_THEME.ahead}
          />
          <InputBar
            label="B"
            readout={brake === null ? "–" : `${Math.round(brake)}`}
            value={brake}
            ghostValue={read(ghostChannels?.brake)}
            max={100}
            color={CHART_THEME.behind}
          />
          {showBattery && (
            <InputBar
              label="ERS"
              // Battery % is the store's share of BATTERY_MAX_MJ, the same as
              // the recording's own `ers.store_energy` (J / 40,000).
              readout={
                battery === null ? (
                  "–"
                ) : (
                  <>
                    {Math.round((battery / BATTERY_MAX_MJ) * 100)}%
                    {/* Always laid out so the percentage never shifts. */}
                    <span
                      className={cn(
                        "ml-px text-[8px]",
                        ersTrend === "harvest"
                          ? "text-ahead"
                          : ersTrend === "deploy"
                            ? "text-warning"
                            : "invisible",
                      )}
                      title={
                        ersTrend === "harvest"
                          ? "Charging"
                          : ersTrend === "deploy"
                            ? "Draining"
                            : undefined
                      }
                    >
                      {ersTrend === "harvest" ? "▲" : "▼"}
                    </span>
                  </>
                )
              }
              readoutColor={CHART_THEME.harvest}
              wide
              value={battery}
              ghostValue={read(ghostChannels?.ersMj)}
              max={BATTERY_MAX_MJ}
              color={CHART_THEME.harvest}
              title={battery === null ? undefined : `${battery.toFixed(2)} MJ`}
            />
          )}
        </div>
        <div className="relative flex w-10 shrink-0 items-center justify-center">
          {ghostChannels && at !== null && (
            <SteeringWheel
              steering={ghostChannels.steering[at]}
              className="absolute text-zinc-300 opacity-25"
            />
          )}
          <SteeringWheel
            steering={steering}
            className={cn(
              "relative",
              steering === null ? "text-zinc-700" : "text-zinc-300",
            )}
          />
        </div>
        <div className="flex w-14 shrink-0 flex-col items-end justify-center font-mono tabular-nums leading-none">
          {/* Captioned so the big number never reads as a turn number. */}
          <span className="flex items-baseline gap-1">
            <span className="text-[9px] uppercase text-zinc-600">Gear</span>
            <span className="text-2xl font-semibold text-zinc-100">
              {gear === null ? "–" : gear <= 0 ? "N" : Math.round(gear)}
            </span>
          </span>
          <span className="mt-1 text-sm text-zinc-300">
            {speed === null ? "–" : Math.round(speed)}
          </span>
          <span className="mt-0.5 text-[9px] text-zinc-600">km/h</span>
          {showBattery && (
            // Never empty, so the centred column cannot jump.
            <span
              className={cn(
                "mt-1 text-[9px] font-semibold uppercase tracking-wide",
                derating
                  ? "text-zinc-600"
                  : ersModeValue !== null && Math.round(ersModeValue) === 3
                    ? "text-warning"
                    : "text-zinc-500",
              )}
              title={
                derating
                  ? "None selected; electrical power still tapering off"
                  : "ERS deploy mode"
              }
            >
              {derating ? "Derating" : (ersMode ?? "–")}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

/** Last stretch of throttle (green) and brake (red) up to the cursor, over the compared lap's faint ghost. */
function InputTrail({
  throttle,
  brake,
  ghostThrottle,
  ghostBrake,
  end,
  length,
}: {
  throttle?: Float32Array;
  brake?: Float32Array;
  ghostThrottle?: Float32Array;
  ghostBrake?: Float32Array;
  end: number | null;
  length: number;
}) {
  const path = (values?: Float32Array) => {
    if (!values || end === null) return "";
    const start = end - length;
    const parts: string[] = [];
    for (let i = Math.max(0, start); i <= end; i += 1) {
      const x = ((i - start) / length) * 100;
      const y = 100 - Math.min(100, Math.max(0, values[i]));
      parts.push(
        `${parts.length === 0 ? "M" : "L"}${x.toFixed(2)} ${y.toFixed(2)}`,
      );
    }
    return parts.join("");
  };
  return (
    <svg
      viewBox="0 -4 100 108"
      preserveAspectRatio="none"
      className="min-w-0 flex-1 rounded bg-white/[0.015]"
      aria-hidden
    >
      {[
        { values: ghostBrake, color: CHART_THEME.behind },
        { values: ghostThrottle, color: CHART_THEME.ahead },
      ].map(({ values, color }) => (
        <path
          key={color}
          d={path(values)}
          fill="none"
          stroke={color}
          strokeOpacity={0.3}
          strokeWidth={1.25}
          vectorEffect="non-scaling-stroke"
        />
      ))}
      <path
        d={path(brake)}
        fill="none"
        stroke={CHART_THEME.behind}
        strokeWidth={1.5}
        vectorEffect="non-scaling-stroke"
      />
      <path
        d={path(throttle)}
        fill="none"
        stroke={CHART_THEME.ahead}
        strokeWidth={1.5}
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

function InputBar({
  label,
  readout,
  readoutColor,
  wide = false,
  value,
  ghostValue,
  max,
  color,
  title,
}: {
  label: string;
  /** Value printed above the bar. */
  readout: ReactNode;
  readoutColor?: string;
  /** Room for a "100%" readout. */
  wide?: boolean;
  value: number | null;
  /** The compared lap's value, a dim bar behind this one: it shows only where it reaches higher. */
  ghostValue: number | null;
  max: number;
  color: string;
  title?: string;
}) {
  const level = (v: number) => Math.min(1, Math.max(0, v / max)) * 100;
  const fill = value === null ? 0 : level(value);
  return (
    <div
      className={cn("flex flex-col items-center gap-0.5", wide ? "w-8" : "w-5")}
      title={title}
    >
      <span
        className="whitespace-nowrap font-mono text-2xs font-medium leading-none tabular-nums text-zinc-400"
        style={readoutColor ? { color: readoutColor } : undefined}
      >
        {readout}
      </span>
      <div className="relative w-5 flex-1 overflow-hidden rounded-sm bg-white/[0.06]">
        {ghostValue !== null && (
          <div
            className="absolute inset-x-0 bottom-0 opacity-30"
            style={{ height: `${level(ghostValue)}%`, backgroundColor: color }}
          />
        )}
        <div
          className="absolute inset-x-0 bottom-0"
          style={{ height: `${fill}%`, backgroundColor: color }}
        />
      </div>
      <span className="text-[9px] leading-none text-zinc-600">{label}</span>
    </div>
  );
}

/** Wheel outline turned by the steering input. */
function SteeringWheel({
  steering,
  className,
}: {
  steering: number | null;
  className?: string;
}) {
  const angle =
    steering === null
      ? 0
      : (Math.min(100, Math.max(-100, steering)) / 100) * WHEEL_LOCK_DEG;
  return (
    <svg
      viewBox="-20 -14 40 28"
      className={cn("w-10", className)}
      style={{ transform: `rotate(${angle.toFixed(1)}deg)` }}
      aria-hidden
    >
      <path
        d="M-18 -6 Q-18 -11 -13 -11 L13 -11 Q18 -11 18 -6 L18 6 Q18 11 13 11 L8 11 L5 6 L-5 6 L-8 11 L-13 11 Q-18 11 -18 6 Z"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.6}
        strokeLinejoin="round"
      />
      <rect
        x={-7}
        y={-6}
        width={14}
        height={8}
        rx={1.5}
        fill="currentColor"
        opacity={0.35}
      />
      <line
        x1={0}
        y1={-11}
        x2={0}
        y2={-8}
        stroke={CHART_THEME.behind}
        strokeWidth={1.6}
      />
    </svg>
  );
}
