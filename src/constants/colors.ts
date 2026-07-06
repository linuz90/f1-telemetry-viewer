/** Tyre compound colors. */
export const COMPOUND_COLORS: Record<string, string> = {
  Soft: "#ef4444",
  Medium: "#eab308",
  Hard: "#e5e7eb",
  Intermediate: "#22c55e",
  Inters: "#22c55e",
  Wet: "#3b82f6",
  Wets: "#3b82f6",
  // Fallback for actual compound names.
  C1: "#e5e7eb",
  C2: "#e5e7eb",
  C3: "#eab308",
  C4: "#ef4444",
  C5: "#ef4444",
};

/** F1 team colors, including numeric IDs from newer telemetry exports. */
export const TEAM_COLORS: Record<string, string> = {
  Ferrari: "#e8002d",
  Mercedes: "#27f4d2",
  "Red Bull Racing": "#3671c6",
  McLaren: "#ff8000",
  "Aston Martin": "#229971",
  Alpine: "#ff87bc",
  Williams: "#64c4ff",
  "RB F1 Team": "#6692ff",
  "Kick Sauber": "#52e252",
  Haas: "#b6babd",
  Audi: "#52e252",
  Cadillac: "#fbbf24",
  "220": "#27f4d2",
  "221": "#e8002d",
  "222": "#3671c6",
  "223": "#64c4ff",
  "224": "#229971",
  "225": "#ff87bc",
  "226": "#6692ff",
  "227": "#b6babd",
  "228": "#ff8000",
  "229": "#52e252",
  "230": "#fbbf24",
};

export const TEAM_NAMES: Record<string, string> = {
  "220": "Mercedes",
  "221": "Ferrari",
  "222": "Red Bull Racing",
  "223": "Williams",
  "224": "Aston Martin",
  "225": "Alpine",
  "226": "RB F1 Team",
  "227": "Haas",
  "228": "McLaren",
  "229": "Audi",
  "230": "Cadillac",
};

/** Per-wheel colors for tyre wear charts. */
export const WHEEL_COLORS = {
  FL: "#3b82f6",
  FR: "#22c55e",
  RL: "#f59e0b",
  RR: "#ef4444",
} as const;

/** Safety car / VSC reference-area shading. Amber for full SC, yellow for VSC. */
export const SC_COLORS: Record<string, string> = {
  SAFETY_CAR: "#f59e0b",
  FULL_SAFETY_CAR: "#f59e0b",
  VIRTUAL_SAFETY_CAR: "#eab308",
};

/** Fallback when a SC status doesn't resolve, keeping shading on screen. */
export const SC_FALLBACK = "#f59e0b";

/** Sector ranking colors. Purple is the app-wide "session best" accent. */
export const PERF_COLORS = {
  best: "#7c3aed",
  normal: "#16a34a",
  worst: "#ca8a04",
  invalid: "#52525b40",
} as const;

export type PerformanceTone = keyof typeof PERF_COLORS;

/** Per-sector colors used in sector-improvement charts and best-sector cards. */
export const SECTOR_COLORS = {
  S1: "#3b82f6",
  S2: "#8b5cf6",
  S3: "#ec4899",
} as const;

/** Per-component damage colors used in the damage timeline chart. */
export const DAMAGE_COLORS = {
  frontWing: "#f97316",
  rearWing: "#eab308",
  floor: "#22d3ee",
  diffuser: "#a855f7",
  sidepod: "#ec4899",
  engine: "#ef4444",
  gearbox: "#10b981",
} as const;

/** Shared chart theme colors (zinc palette + semantic series tokens). */
export const CHART_THEME = {
  grid: "#27272a",
  axis: "#71717a",
  tooltipBg: "#18181b",
  tooltipBorder: "#27272a",
  tooltipLabel: "#a1a1aa",
  muted: "#52525b",
  best: "#a855f7",
  player: "#22d3ee",
  ahead: "#22c55e",
  behind: "#ef4444",
  rival: "#f97316",
  harvest: "#38bdf8",
  valid: "#10b981",
} as const;

/**
 * Categorical palette for location-breakdown pie charts (overtake / collision
 * locations). Eight fixed hues assigned in order (never cycled by rank across
 * repaints), ordered so adjacent slices stay distinct. Drawn from the same
 * Tailwind-500 family the rest of the app's charts use (see SECTOR_COLORS,
 * DAMAGE_COLORS, CHART_THEME) so it reads as one system; slices carry a direct
 * label via the legend rather than relying on color alone. "Other" / "Unknown"
 * buckets use `LOCATION_OTHER_COLOR` so an aggregate slice never reads as a hue.
 */
export const LOCATION_BREAKDOWN_COLORS = [
  "#3b82f6", // blue-500
  "#f97316", // orange-500
  "#22c55e", // green-500
  "#a855f7", // purple-500
  "#22d3ee", // cyan-400
  "#ec4899", // pink-500
  "#eab308", // yellow-500
  "#ef4444", // red-500
] as const;

/** Muted grey for the aggregate "Other" / "Unknown" slices. */
export const LOCATION_OTHER_COLOR = CHART_THEME.muted;

/** Reusable Recharts tooltip content style. */
export const TOOLTIP_STYLE = {
  contentStyle: {
    backgroundColor: CHART_THEME.tooltipBg,
    border: `1px solid ${CHART_THEME.tooltipBorder}`,
    borderRadius: "8px",
    fontSize: "12px",
  },
  labelStyle: { color: CHART_THEME.tooltipLabel },
} as const;
