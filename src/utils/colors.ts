/** Tyre compound colors */
export const COMPOUND_COLORS: Record<string, string> = {
  Soft: "#ef4444",
  Medium: "#eab308",
  Hard: "#e5e7eb",
  Intermediate: "#22c55e",
  Inters: "#22c55e",
  Wet: "#3b82f6",
  Wets: "#3b82f6",
  // Fallback for actual compound names
  C1: "#e5e7eb",
  C2: "#e5e7eb",
  C3: "#eab308",
  C4: "#ef4444",
  C5: "#ef4444",
};

/** F1 team colors (2024/2025 grid) */
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

const TEAM_NAMES: Record<string, string> = {
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

/** Get compound color with fallback */
export function getCompoundColor(compound: string): string {
  return COMPOUND_COLORS[compound] ?? "#a1a1aa";
}

/** Get team color with fallback */
export function getTeamColor(team: string): string {
  return TEAM_COLORS[team] ?? "#a1a1aa";
}

/** Get display name for teams exported as numeric IDs in newer telemetry. */
export function getTeamName(team: string): string {
  return TEAM_NAMES[team] ?? team;
}

/** Per-wheel colors for tyre wear charts */
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

/** Fallback when a SC status doesn't resolve — keeps shading on screen. */
export const SC_FALLBACK = "#f59e0b";

/** Sector ranking colors for qualifying / sector comparisons. Purple is the
 *  app-wide "session best" accent; green/yellow are the relative tiers below. */
export const PERF_COLORS = {
  best: "#7c3aed",      // purple-600
  normal: "#16a34a",    // green-600
  worst: "#ca8a04",     // yellow-600
  invalid: "#52525b40", // zinc-600 @ 25% alpha
} as const;

/** Per-sector colors used in sector-improvement charts and best-sector cards. */
export const SECTOR_COLORS = {
  S1: "#3b82f6", // blue-500
  S2: "#8b5cf6", // violet-500
  S3: "#ec4899", // pink-500
} as const;

/** Per-component damage colors used in the damage timeline chart. */
export const DAMAGE_COLORS = {
  frontWing: "#f97316", // orange-500
  rearWing: "#eab308",  // yellow-500
  floor: "#22d3ee",     // cyan-400
  diffuser: "#a855f7",  // purple-500
  sidepod: "#ec4899",   // pink-500
  engine: "#ef4444",    // red-500
  gearbox: "#10b981",   // emerald-500
} as const;

/** Shared chart theme colors (zinc palette + semantic series tokens).
 *
 *  Semantic mapping mirrors the rest of the UI:
 *   - `best`    → purple, app-wide "session best" accent
 *   - `player`  → cyan, the active/current driver
 *   - `ahead`   → green, gains / improvement / valid
 *   - `behind`  → red, losses / errors / invalid
 *   - `rival`   → orange, alternate series / pit / wear warning
 *   - `harvest` → sky, ERS harvest line
 */
export const CHART_THEME = {
  grid: "#27272a",          // zinc-800
  axis: "#71717a",          // zinc-500
  tooltipBg: "#18181b",     // zinc-900
  tooltipBorder: "#27272a", // zinc-800
  tooltipLabel: "#a1a1aa",  // zinc-400
  muted: "#52525b",         // zinc-600
  best: "#a855f7",          // purple-500
  player: "#22d3ee",        // cyan-400
  ahead: "#22c55e",         // green-500
  behind: "#ef4444",        // red-500
  rival: "#f97316",         // orange-500
  harvest: "#38bdf8",       // sky-400
  valid: "#10b981",         // emerald-500
} as const;

/** Reusable tooltip content style */
export const TOOLTIP_STYLE = {
  contentStyle: {
    backgroundColor: CHART_THEME.tooltipBg,
    border: `1px solid ${CHART_THEME.tooltipBorder}`,
    borderRadius: "8px",
    fontSize: "12px",
  },
  labelStyle: { color: CHART_THEME.tooltipLabel },
} as const;
