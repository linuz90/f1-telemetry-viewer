import type { LapHistoryEntry } from "../types/telemetry";

/** Convert milliseconds to lap time string (e.g. 84903 -> "1:24.903") */
export function msToLapTime(ms: number): string {
  if (ms <= 0) return "-";
  const minutes = Math.floor(ms / 60000);
  const seconds = ((ms % 60000) / 1000).toFixed(3);
  return minutes > 0 ? `${minutes}:${seconds.padStart(6, "0")}` : seconds;
}

/** Convert milliseconds to sector time string (e.g. 33341 -> "33.341") */
export function msToSectorTime(ms: number): string {
  if (ms <= 0) return "-";
  const minutes = Math.floor(ms / 60000);
  const seconds = ((ms % 60000) / 1000).toFixed(3);
  return minutes > 0 ? `${minutes}:${seconds.padStart(6, "0")}` : seconds;
}

export type SectorNumber = 1 | 2 | 3;

const SECTOR_TIME_FIELDS = {
  1: {
    ms: "sector-1-time-in-ms",
    minutes: "sector-1-time-minutes",
  },
  2: {
    ms: "sector-2-time-in-ms",
    minutes: "sector-2-time-minutes",
  },
  3: {
    ms: "sector-3-time-in-ms",
    minutes: "sector-3-time-minutes",
  },
} as const;

/** PnG stores sector minutes separately from the millisecond remainder. */
export function sectorTimeMs(
  lap: LapHistoryEntry,
  sector: SectorNumber,
): number {
  const fields = SECTOR_TIME_FIELDS[sector];
  const ms = lap[fields.ms];
  const minutes = lap[fields.minutes] ?? 0;

  return minutes * 60_000 + ms;
}

export function bestSectorTimeMs(
  laps: readonly LapHistoryEntry[],
  sector: SectorNumber,
): number {
  const values = laps
    .map((lap) => sectorTimeMs(lap, sector))
    .filter((value) => value > 0);

  return values.length > 0 ? Math.min(...values) : 0;
}

/** Format wear percentage to 1 decimal place */
export function formatWear(wear: number): string {
  return `${wear.toFixed(1)}%`;
}

/** Format a date string for display */
export function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/**
 * Friendly grouping label: "Today" / "Yesterday" for the last two days,
 * otherwise weekday + day + month, and the year only when it differs from now.
 * Compared against `now` (defaults to current time) so the result is stable per render.
 */
export function formatRelativeDate(
  dateStr: string,
  now: Date = new Date(),
): string {
  const d = new Date(dateStr);
  const startOf = (x: Date) =>
    new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const dayMs = 24 * 60 * 60 * 1000;
  const diffDays = Math.round((startOf(now) - startOf(d)) / dayMs);
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  return d.toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    ...(d.getFullYear() !== now.getFullYear() ? { year: "numeric" } : {}),
  });
}

/** Format time portion of a date string */
export function formatTime(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}

/** Format a date as short month + day (e.g. "Jan 30") */
export function formatShortDate(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString("en-GB", { month: "short", day: "numeric" });
}

/** Check if a lap is valid based on bit flags (15 = all 4 sectors valid) */
export function isLapValid(flags: number): boolean {
  return flags === 15;
}

/** Format a gap string (e.g. "+1.234s" or "Leader") */
export function formatGap(ms: number): string {
  if (ms === 0) return "Leader";
  const sign = ms > 0 ? "+" : "-";
  return `${sign}${(Math.abs(ms) / 1000).toFixed(3)}s`;
}

export function pluralize(
  count: number,
  singular: string,
  plural = `${singular}s`,
): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

export function joinMetaParts(
  parts: readonly (string | null | undefined | false)[],
): string {
  return parts.filter(Boolean).join(" · ");
}

export function formatSignedSeconds(valueMs: number, decimals = 3): string {
  const sign = valueMs >= 0 ? "+" : "−";
  return `${sign}${(Math.abs(valueMs) / 1000).toFixed(decimals)}s`;
}

export function formatEnergyMj(value: number, decimals = 1): string {
  return `${value.toFixed(decimals)} MJ`;
}

export function formatEnergyMjPerLap(value: number, decimals = 1): string {
  return `${formatEnergyMj(value, decimals)}/lap`;
}

export function formatFuelKg(value: number, decimals = 1): string {
  return `${value.toFixed(decimals)} kg`;
}

export function formatKgPerLap(value: number, decimals = 2): string {
  return `${value.toFixed(decimals)} kg/lap`;
}

/**
 * Format session type for display (shorter labels).
 *
 * F2 weekends in PnG exports use `session-type: "Race"` for the Sprint and
 * `session-type: "Race 2"` for the Feature Race. F1 never uses "Race 2", so the
 * formula check here is the safe way to relabel without affecting F1 results.
 */
export function formatSessionType(type: string, formula?: string): string {
  if (formula && /^\s*(formula\s+)?f2\b/i.test(formula)) {
    if (type === "Race") return "Sprint";
    if (type === "Race 2") return "Feature Race";
  }
  switch (type) {
    case "One Shot Qualifying":
      return "One-Shot Quali";
    case "Short Qualifying":
      return "Short Quali";
    case "Short Sprint Shootout":
      return "Sprint Shootout";
    case "Short Session Shootout":
      return "Session Shootout";
    default:
      return type;
  }
}

/** Get emoji icon for a session type */
export function getSessionIcon(type: string): string {
  if (type.startsWith("Race")) return "\u{1F3C1}"; // 🏁

  switch (type) {
    case "Short Qualifying":
    case "Short Quali":
    case "Short Sprint Shootout":
    case "Sprint Shootout":
    case "Short Session Shootout":
    case "Session Shootout":
      return "\u23F1\uFE0F"; // ⏱️
    case "One Shot Qualifying":
    case "One-Shot Quali":
      return "\u{1F3AF}"; // 🎯
    case "Time Trial":
      return "\u{1F3CE}\uFE0F"; // 🏎️
    default:
      return "\u{1F3C1}"; // 🏁
  }
}
