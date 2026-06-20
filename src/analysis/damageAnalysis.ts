import type { PerLapInfo } from "../types/telemetry";

/**
 * Damage telemetry normalization for race/session charts.
 *
 * Raw exports split car damage across many component-specific percentages and
 * boolean faults. The UI needs two simpler views: continuous series for the
 * damage chart, and sparse "something got worse here" lap markers for the lap
 * chart. Keeping both projections here prevents chart components from each
 * deciding their own incident semantics.
 */

export interface DamageSeriesField {
  key: string;
  label: string;
  getValue: (lap: PerLapInfo) => number;
}

export interface DamageFault {
  lap: number;
  label: string;
}

export interface DamageAnalysis {
  data: Record<string, number>[];
  activeFieldKeys: string[];
  faults: DamageFault[];
}

export const DAMAGE_SERIES_FIELDS: DamageSeriesField[] = [
  {
    key: "frontWing",
    label: "Front Wing",
    // The game reports front wing damage per side, but the chart is a single
    // readable component. Max side damage best matches what the driver feels.
    getValue: (lap) =>
      Math.max(
        lap["car-damage-data"]["front-left-wing-damage"] ?? 0,
        lap["car-damage-data"]["front-right-wing-damage"] ?? 0,
      ),
  },
  {
    key: "rearWing",
    label: "Rear Wing",
    getValue: (lap) => lap["car-damage-data"]["rear-wing-damage"] ?? 0,
  },
  {
    key: "floor",
    label: "Floor",
    getValue: (lap) => lap["car-damage-data"]["floor-damage"] ?? 0,
  },
  {
    key: "diffuser",
    label: "Diffuser",
    getValue: (lap) => lap["car-damage-data"]["diffuser-damage"] ?? 0,
  },
  {
    key: "sidepod",
    label: "Sidepod",
    getValue: (lap) => lap["car-damage-data"]["sidepod-damage"] ?? 0,
  },
  {
    key: "engine",
    label: "Engine",
    getValue: (lap) => lap["car-damage-data"]["engine-damage"] ?? 0,
  },
  {
    key: "gearbox",
    label: "Gearbox",
    getValue: (lap) => lap["car-damage-data"]["gear-box-damage"] ?? 0,
  },
];

const FAULT_CHECKS: {
  key: keyof PerLapInfo["car-damage-data"];
  label: string;
}[] = [
  { key: "drs-fault", label: "DRS Fault" },
  { key: "ers-fault", label: "ERS Fault" },
  { key: "engine-blown", label: "Engine Blown" },
  { key: "engine-seized", label: "Engine Seized" },
];

export function detectDamageFaults(
  perLapInfo: readonly PerLapInfo[],
): DamageFault[] {
  const faults: DamageFault[] = [];
  const seen = new Set<string>();
  for (const lap of perLapInfo) {
    for (const { key, label } of FAULT_CHECKS) {
      // Fault booleans remain true once triggered. Emit only the first lap so
      // the timeline reads like an event log, not a repeated state dump.
      if (lap["car-damage-data"][key] && !seen.has(key)) {
        seen.add(key);
        faults.push({ lap: lap["lap-number"], label });
      }
    }
  }
  return faults;
}

export function buildDamageAnalysis(
  perLapInfo: readonly PerLapInfo[],
): DamageAnalysis {
  const data = perLapInfo.map((lap) => {
    const entry: Record<string, number> = { lap: lap["lap-number"] };
    for (const field of DAMAGE_SERIES_FIELDS) {
      entry[field.key] = field.getValue(lap);
    }
    return entry;
  });

  return {
    data,
    // Hide flat zero-percent series: they add legend clutter while saying
    // "no damage", which the empty chart state already communicates.
    activeFieldKeys: DAMAGE_SERIES_FIELDS.filter((field) =>
      data.some((row) => row[field.key] > 0),
    ).map((field) => field.key),
    faults: detectDamageFaults(perLapInfo),
  };
}

const DAMAGE_INCREASE_FIELDS = [
  "front-left-wing-damage",
  "front-right-wing-damage",
  "rear-wing-damage",
  "floor-damage",
  "diffuser-damage",
  "sidepod-damage",
  "engine-damage",
  "gear-box-damage",
] as const;

/**
 * Laps where a damage component increased. LapTimeChart uses these as a small
 * red backdrop so incidents line up with pace drops without duplicating the
 * full damage chart.
 */
export function buildDamageIncreaseLaps(
  perLapInfo: readonly PerLapInfo[],
): number[] {
  const laps: number[] = [];
  for (let index = 1; index < perLapInfo.length; index++) {
    const previous = perLapInfo[index - 1]!["car-damage-data"];
    const current = perLapInfo[index]!["car-damage-data"];
    for (const field of DAMAGE_INCREASE_FIELDS) {
      if ((current[field] ?? 0) > (previous[field] ?? 0)) {
        laps.push(perLapInfo[index]!["lap-number"]);
        break;
      }
    }
  }
  return laps;
}
