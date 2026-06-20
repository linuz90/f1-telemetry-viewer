// Minimal track-layout SVGs sourced from julesr0y/f1-circuits-svg (CC BY 4.0).
// SVGs were sanitized at download time to use stroke:currentColor so they
// inherit the consumer's text color.

import { TRACK_LAYOUT_KEYS } from "../constants/tracks";

const LAYOUTS = import.meta.glob("../assets/tracks/*.svg", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

const lookup: Record<string, string> = Object.fromEntries(
  Object.entries(LAYOUTS).map(([path, svg]) => {
    const name = path
      .split("/")
      .pop()!
      .replace(/\.svg$/, "");
    return [name, svg];
  }),
);

/** Returns the raw SVG markup for a track, or null when unmapped. */
export function getTrackLayoutSvg(track: string): string | null {
  // Strip suffixes like "Reverse" / "Short" — they reuse the base layout.
  const base = track.replace(/\s+(Reverse|Short)$/i, "").trim();
  const key = TRACK_LAYOUT_KEYS[base] ?? TRACK_LAYOUT_KEYS[track];
  if (!key) return null;
  return lookup[key] ?? null;
}
