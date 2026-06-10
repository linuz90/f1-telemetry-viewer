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

/** Shared chart theme colors (zinc palette) */
export const CHART_THEME = {
  grid: "#27272a",       // zinc-800
  axis: "#71717a",       // zinc-500
  tooltipBg: "#18181b",  // zinc-900
  tooltipBorder: "#27272a", // zinc-800
  tooltipLabel: "#a1a1aa",  // zinc-400
  muted: "#52525b",      // zinc-600
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
