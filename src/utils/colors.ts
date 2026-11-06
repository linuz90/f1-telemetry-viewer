import { COMPOUND_COLORS, TEAM_COLORS, TEAM_NAMES } from "../constants/colors";

/** Get compound color with fallback. */
export function getCompoundColor(compound: string): string {
  return COMPOUND_COLORS[compound] ?? "var(--color-tone-400)";
}

const TEAM_COLOR_BY_KEY = new Map(
  Object.entries(TEAM_COLORS).map(([team, color]) => [
    team.toLowerCase(),
    color,
  ]),
);
const TEAM_KEY_ALIASES: Record<string, string> = {
  rb: "rb f1 team",
  sauber: "kick sauber",
};

/**
 * Team color with fallback. F1 26 exports suffix the season and vary the case
 * ("Audi '26", "Mclaren '26", "RB"), so the lookup ignores both.
 */
export function getTeamColor(team: string): string {
  const key = team
    .trim()
    .toLowerCase()
    .replace(/\s*'\d{2}$/, "");
  return (
    TEAM_COLORS[team] ??
    TEAM_COLOR_BY_KEY.get(TEAM_KEY_ALIASES[key] ?? key) ??
    "#a1a1aa"
  );
}

/** Get display name for teams exported as numeric IDs in newer telemetry. */
export function getTeamName(team: string): string {
  return TEAM_NAMES[team] ?? team;
}
