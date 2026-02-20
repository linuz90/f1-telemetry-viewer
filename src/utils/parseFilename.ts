/**
 * Shared filename parsing utilities for P&G telemetry files.
 * Used by both the Vite plugin (Node) and the zip loader (browser).
 * No `path` module dependency — works in all environments.
 */

/** Get the basename of a file path without extension */
function basename(filepath: string): string {
  const name = filepath.split("/").pop() ?? filepath;
  return name.endsWith(".json") ? name.slice(0, -5) : name;
}

/** Convert a telemetry filename to a URL-safe slug */
export function toSlug(filename: string): string {
  return basename(filename).toLowerCase().replace(/_/g, "-");
}

/**
 * Parses a P&G telemetry filename into structured metadata.
 * Pattern: [SessionType]_[Track]_[YYYY]_[MM]_[DD]_[HH]_[mm]_[ss].json
 */
export function parseFilename(filename: string) {
  const base = basename(filename);
  const parts = base.split("_");

  // Last 6 parts are always the datetime
  const dateParts = parts.slice(-6);
  const date = `${dateParts[0]}-${dateParts[1]}-${dateParts[2]}T${dateParts[3]}:${dateParts[4]}:${dateParts[5]}`;

  // Everything before the date is session type + track (+ optional modifiers)
  const prefix = parts.slice(0, -6);

  let sessionType: string;
  let trackStart: number;

  if (prefix[0] === "One" && prefix[1] === "Shot") {
    sessionType = "One Shot Qualifying";
    trackStart = 3;
  } else if (prefix[0] === "Short") {
    sessionType = "Short Qualifying";
    trackStart = 2;
  } else if (prefix[0] === "Time" && prefix[1] === "Trial") {
    sessionType = "Time Trial";
    trackStart = 2;
  } else {
    sessionType = prefix[0];
    trackStart = 1;
  }

  const track = prefix[trackStart] ?? "Unknown";

  return { sessionType, track, date };
}
