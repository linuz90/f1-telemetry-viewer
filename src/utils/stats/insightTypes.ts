export interface StrategyInsight {
  type:
    | "tyre"
    | "sector"
    | "pit"
    | "pace"
    | "history"
    | "fuel"
    | "speed"
    | "ers";
  /** Short label shown above the value */
  label: string;
  /** The big prominent value (e.g. "3rd", "1:42.891", "+0.8%/lap") */
  value: string;
  /** Smaller context line below the value */
  detail: string;
  /** Additional context lines, used when a compact card needs peer rows. */
  extraDetails?: string[];
  /** Tooltip shown on hover — explains how the value was calculated */
  tooltip?: string;
  /** Ranking position (0-indexed) — used for color coding. undefined = neutral. */
  rank?: number;
  /** Total drivers in ranking — used alongside rank */
  rankTotal?: number;
}

export const RACE_PACE_TOOLTIP =
  "Average lap time excluding lap 1, pit in/out laps, safety car periods, and incident outliers";
