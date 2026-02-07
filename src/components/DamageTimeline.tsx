import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import type { PerLapInfo } from "../types/telemetry";
import { CHART_THEME, TOOLTIP_STYLE } from "../utils/colors";

interface DamageTimelineProps {
  perLapInfo: PerLapInfo[];
}

interface DamageField {
  key: string;
  label: string;
  color: string;
  getValue: (d: PerLapInfo) => number;
}

const DAMAGE_FIELDS: DamageField[] = [
  {
    key: "frontWing",
    label: "Front Wing",
    color: "#f97316",
    getValue: (d) =>
      Math.max(
        d["car-damage-data"]["front-left-wing-damage"] ?? 0,
        d["car-damage-data"]["front-right-wing-damage"] ?? 0,
      ),
  },
  {
    key: "rearWing",
    label: "Rear Wing",
    color: "#eab308",
    getValue: (d) => d["car-damage-data"]["rear-wing-damage"] ?? 0,
  },
  {
    key: "floor",
    label: "Floor",
    color: "#22d3ee",
    getValue: (d) => d["car-damage-data"]["floor-damage"] ?? 0,
  },
  {
    key: "diffuser",
    label: "Diffuser",
    color: "#a855f7",
    getValue: (d) => d["car-damage-data"]["diffuser-damage"] ?? 0,
  },
  {
    key: "sidepod",
    label: "Sidepod",
    color: "#ec4899",
    getValue: (d) => d["car-damage-data"]["sidepod-damage"] ?? 0,
  },
  {
    key: "engine",
    label: "Engine",
    color: "#ef4444",
    getValue: (d) => d["car-damage-data"]["engine-damage"] ?? 0,
  },
  {
    key: "gearbox",
    label: "Gearbox",
    color: "#10b981",
    getValue: (d) => d["car-damage-data"]["gear-box-damage"] ?? 0,
  },
];

interface FaultEvent {
  lap: number;
  label: string;
}

const FAULT_CHECKS: { key: keyof PerLapInfo["car-damage-data"]; label: string }[] = [
  { key: "drs-fault" as keyof PerLapInfo["car-damage-data"], label: "DRS Fault" },
  { key: "ers-fault" as keyof PerLapInfo["car-damage-data"], label: "ERS Fault" },
  { key: "engine-blown" as keyof PerLapInfo["car-damage-data"], label: "Engine Blown" },
  { key: "engine-seized" as keyof PerLapInfo["car-damage-data"], label: "Engine Seized" },
];

export function DamageTimeline({ perLapInfo }: DamageTimelineProps) {
  if (!perLapInfo.length) return null;

  // Build chart data
  const data = perLapInfo.map((lap) => {
    const entry: Record<string, number> = { lap: lap["lap-number"] };
    for (const field of DAMAGE_FIELDS) {
      entry[field.key] = field.getValue(lap);
    }
    return entry;
  });

  // Determine which fields have non-zero values
  const activeFields = DAMAGE_FIELDS.filter((field) =>
    data.some((d) => d[field.key] > 0),
  );

  // Check if any damage occurred at all
  if (activeFields.length === 0) {
    // Also check for boolean faults
    const faults = detectFaults(perLapInfo);
    if (faults.length === 0) return null;
    // Only faults, no damage chart needed — just show badges
    return (
      <div>
        <h3 className="text-sm font-semibold text-zinc-300 mb-2">Damage</h3>
        <FaultBadges faults={faults} />
      </div>
    );
  }

  const faults = detectFaults(perLapInfo);

  return (
    <div>
      <h3 className="text-sm font-semibold text-zinc-300 mb-2">Damage</h3>
      <ResponsiveContainer width="100%" height={200}>
        <AreaChart data={data} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={CHART_THEME.grid} />
          <XAxis
            dataKey="lap"
            stroke={CHART_THEME.axis}
            fontSize={11}
            label={{ value: "Lap", position: "insideBottom", offset: -2, fill: CHART_THEME.axis, fontSize: 11 }}
          />
          <YAxis
            stroke={CHART_THEME.axis}
            fontSize={11}
            domain={[0, 100]}
            ticks={[0, 25, 50, 75, 100]}
            tickFormatter={(v) => `${v}%`}
            width={35}
          />
          <Tooltip
            {...TOOLTIP_STYLE}
            labelFormatter={(lap) => `Lap ${lap}`}
            formatter={(value: number | undefined, name: string | undefined) => [value != null ? `${value.toFixed(0)}%` : "–", name ?? ""]}
          />
          {activeFields.map((field) => (
            <Area
              key={field.key}
              type="monotone"
              dataKey={field.key}
              name={field.label}
              stroke={field.color}
              fill={field.color}
              fillOpacity={0.1}
              strokeWidth={1.5}
            />
          ))}
        </AreaChart>
      </ResponsiveContainer>
      {faults.length > 0 && <FaultBadges faults={faults} />}
    </div>
  );
}

function detectFaults(perLapInfo: PerLapInfo[]): FaultEvent[] {
  const faults: FaultEvent[] = [];
  const seen = new Set<string>();
  for (const lap of perLapInfo) {
    for (const { key, label } of FAULT_CHECKS) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if ((lap["car-damage-data"] as any)[key] && !seen.has(key)) {
        seen.add(key);
        faults.push({ lap: lap["lap-number"], label });
      }
    }
  }
  return faults;
}

function FaultBadges({ faults }: { faults: FaultEvent[] }) {
  return (
    <div className="flex flex-wrap gap-2 mt-2">
      {faults.map((fault, i) => (
        <span
          key={i}
          className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold bg-red-500/15 text-red-400"
        >
          Lap {fault.lap}: {fault.label}
        </span>
      ))}
    </div>
  );
}
