import { useEffect, useState } from "react";
import type { LapSeriesChannel } from "../../analysis/lapTelemetryAnalysis";
import {
  LAP_TRACE_HEIGHTS_STORAGE_KEY,
  LAP_TRACE_PANES_STORAGE_KEY,
} from "../../constants/storage";
import { readStoredString, writeStoredString } from "../../utils/storage";

export type PaneId =
  | "gap"
  | "speed"
  | "throttle"
  | "brake"
  | "gear"
  | "steering"
  | "ers"
  | "rpm";

export interface PaneSpec {
  label: string;
  /** Column header in the hover readout. */
  short: string;
  unit: string;
  channel?: LapSeriesChannel;
  fixed?: [number, number];
  symmetric?: boolean;
  step?: boolean;
  format: (value: number) => string;
  /** Readout value, when it needs more precision than the axis labels. */
  readout?: (value: number) => string;
  defaultVisible: boolean;
}

/** Every trace pane, in display order. */
export const PANE_SPECS: Record<PaneId, PaneSpec> = {
  gap: {
    label: "Gap",
    short: "Gap",
    unit: "s",
    format: (v) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toFixed(2)}`,
    defaultVisible: true,
  },
  speed: {
    label: "Speed",
    short: "Speed",
    unit: "km/h",
    channel: "speed",
    format: (v) => `${Math.round(v)}`,
    defaultVisible: true,
  },
  throttle: {
    label: "Throttle",
    short: "Thr",
    unit: "%",
    channel: "throttle",
    fixed: [0, 100],
    format: (v) => `${Math.round(v)}`,
    defaultVisible: true,
  },
  brake: {
    label: "Brake",
    short: "Brk",
    unit: "%",
    channel: "brake",
    fixed: [0, 100],
    format: (v) => `${Math.round(v)}`,
    defaultVisible: true,
  },
  gear: {
    label: "Gear",
    short: "Gear",
    unit: "",
    channel: "gear",
    step: true,
    format: (v) => `${Math.round(v)}`,
    defaultVisible: true,
  },
  steering: {
    label: "Steering",
    short: "Steer",
    unit: "%",
    channel: "steering",
    symmetric: true,
    format: (v) => `${Math.round(v)}`,
    defaultVisible: true,
  },
  ers: {
    label: "Battery",
    short: "Batt",
    unit: "MJ",
    channel: "ersMj",
    fixed: [0, 4],
    format: (v) => v.toFixed(1),
    readout: (v) => v.toFixed(2),
    defaultVisible: true,
  },
  rpm: {
    label: "RPM",
    short: "RPM",
    unit: "",
    channel: "rpm",
    format: (v) => `${(v / 1000).toFixed(1)}k`,
    // Rarely explains a gap on its own, so it is opt-in.
    defaultVisible: false,
  },
};

export const PANE_IDS = Object.keys(PANE_SPECS) as PaneId[];

export type PaneVisibility = Record<PaneId, boolean>;

export const DEFAULT_PANE_VISIBILITY = Object.fromEntries(
  PANE_IDS.map((id) => [id, PANE_SPECS[id].defaultVisible]),
) as PaneVisibility;

/** Stored overrides over the defaults, so default changes still reach users. */
function readPaneVisibility(): PaneVisibility {
  let stored: unknown;
  try {
    stored = JSON.parse(readStoredString(LAP_TRACE_PANES_STORAGE_KEY) ?? "{}");
  } catch {
    stored = {};
  }
  const overrides = (
    stored && typeof stored === "object" ? stored : {}
  ) as Partial<Record<PaneId, unknown>>;
  return Object.fromEntries(
    PANE_IDS.map((id) => {
      const value = overrides[id];
      return [
        id,
        typeof value === "boolean" ? value : DEFAULT_PANE_VISIBILITY[id],
      ];
    }),
  ) as PaneVisibility;
}

/** Visible trace panes, remembered across lap selections and visits. */
export function usePaneVisibility() {
  const [visibility, setVisibility] = useState(readPaneVisibility);
  const update = (next: PaneVisibility) => {
    setVisibility(next);
    const overrides = Object.fromEntries(
      PANE_IDS.filter((id) => next[id] !== DEFAULT_PANE_VISIBILITY[id]).map(
        (id) => [id, next[id]],
      ),
    );
    writeStoredString(LAP_TRACE_PANES_STORAGE_KEY, JSON.stringify(overrides));
  };
  return [visibility, update] as const;
}

/** Every pane starts the same height; drag-resize bounds keep the label and both axis ticks fitting. */
export const PANE_DEFAULT_HEIGHT = 120;
export const PANE_MIN_HEIGHT = 40;
export const PANE_MAX_HEIGHT = 360;

/** Only resized panes are stored, so default heights can still change. */
export type PaneHeights = Partial<Record<PaneId, number>>;

const clampHeight = (height: number) =>
  Math.round(Math.min(PANE_MAX_HEIGHT, Math.max(PANE_MIN_HEIGHT, height)));

function readPaneHeights(): PaneHeights {
  let stored: unknown;
  try {
    stored = JSON.parse(
      readStoredString(LAP_TRACE_HEIGHTS_STORAGE_KEY) ?? "{}",
    );
  } catch {
    stored = {};
  }
  const values = (
    stored && typeof stored === "object" ? stored : {}
  ) as Partial<Record<PaneId, unknown>>;
  return Object.fromEntries(
    PANE_IDS.flatMap((id) => {
      const value = values[id];
      return typeof value === "number" && Number.isFinite(value)
        ? [[id, clampHeight(value)]]
        : [];
    }),
  ) as PaneHeights;
}

export function paneHeight(heights: PaneHeights, id: PaneId): number {
  return heights[id] ?? PANE_DEFAULT_HEIGHT;
}

/** Per-pane trace heights, remembered across lap selections and visits. */
export function usePaneHeights() {
  const [heights, setHeights] = useState(readPaneHeights);
  useEffect(() => {
    writeStoredString(LAP_TRACE_HEIGHTS_STORAGE_KEY, JSON.stringify(heights));
  }, [heights]);
  /** `null` restores the pane's default height. */
  const setPaneHeight = (id: PaneId, height: number | null) => {
    setHeights((current) => {
      const next = { ...current };
      if (height === null || clampHeight(height) === PANE_DEFAULT_HEIGHT)
        delete next[id];
      else next[id] = clampHeight(height);
      return next;
    });
  };
  return [heights, setPaneHeight] as const;
}
