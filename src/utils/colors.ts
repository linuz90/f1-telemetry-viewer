import { COMPOUND_COLORS, TEAM_COLORS, TEAM_NAMES } from "../constants/colors";

/** Get compound color with fallback. */
export function getCompoundColor(compound: string): string {
  return COMPOUND_COLORS[compound] ?? "#a1a1aa";
}

/** Parse a `#rrggbb` color into an `r, g, b` triplet usable inside `rgba()`. */
export function hexToRgbTriplet(hex: string): string {
  const value = hex.replace("#", "");
  const r = parseInt(value.slice(0, 2), 16);
  const g = parseInt(value.slice(2, 4), 16);
  const b = parseInt(value.slice(4, 6), 16);
  return `${r}, ${g}, ${b}`;
}

/** Get team color with fallback. */
export function getTeamColor(team: string): string {
  return TEAM_COLORS[team] ?? "#a1a1aa";
}

/** Get display name for teams exported as numeric IDs in newer telemetry. */
export function getTeamName(team: string): string {
  return TEAM_NAMES[team] ?? team;
}
