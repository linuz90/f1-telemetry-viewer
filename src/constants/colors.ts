/** Tyre compound colors. */
export const COMPOUND_COLORS: Record<string, string> = {
  Soft: "#ef4444",
  Medium: "#eab308",
  // Hard reads near-white on dark cards and grey on light ones (index.css).
  Hard: "var(--color-compound-hard)",
  Intermediate: "#22c55e",
  Inters: "#22c55e",
  Wet: "#3b82f6",
  Wets: "#3b82f6",
  // Fallback for actual compound names.
  C1: "var(--color-compound-hard)",
  C2: "var(--color-compound-hard)",
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

/** Sector ranking colors. Purple is the app-wide "session best" accent. */
export const PERF_COLORS = {
  best: "#7c3aed",
  normal: "#16a34a",
  worst: "#ca8a04",
  invalid: "#52525b40",
} as const;

export type PerformanceTone = keyof typeof PERF_COLORS;

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

/** Shared chart theme colors. Neutrals and the you/compare series are CSS
 *  variables (index.css) so charts follow the light/dark theme; Recharts and
 *  SVG attributes accept `var()` directly. */
export const CHART_THEME = {
  grid: "var(--color-tone-800)",
  axis: "var(--color-tone-500)",
  tooltipBg: "var(--color-tone-900)",
  tooltipBorder: "var(--color-tone-800)",
  tooltipLabel: "var(--color-tone-400)",
  muted: "var(--color-tone-600)",
  best: "#a855f7",
  player: "var(--color-chart-you)",
  ahead: "#22c55e",
  behind: "#ef4444",
  rival: "var(--color-chart-compare)",
  harvest: "#38bdf8",
  valid: "#10b981",
} as const;

/** Lap Telemetry slots A and B reuse the app's player/rival tokens. */
export const LAP_SLOT_COLORS = [CHART_THEME.player, CHART_THEME.rival] as const;

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
