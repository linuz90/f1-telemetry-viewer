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
  "Average of all complete green-flag laps after excluding lap 1, pit in/out laps, and abnormal per-stint outliers. At least 3 laps are required; rankings require half the session's reference evidence.";

export const ERS_HARVEST_UTILIZATION_TOOLTIP =
  "Average of each eligible lap's recorded MGU-K harvest divided by the exporter-recorded MGU-K limit. 100% means the saved harvest counter matched that recorded limit; it is not remaining battery charge or a physical efficiency rating. Green-flag laps only; pre-race baseline and final reset snapshot excluded. Slightly over 100% can occur because telemetry counters reset between packets.";
