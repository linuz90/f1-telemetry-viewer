import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import {
  buildDamageAnalysis,
  DAMAGE_SERIES_FIELDS,
  type DamageFault,
} from "../analysis/damageAnalysis";
import type { PerLapInfo } from "../types/telemetry";
import { Badge } from "./ui/Badge";
import { CHART_THEME, DAMAGE_COLORS, TOOLTIP_STYLE } from "../constants/colors";
import { EmptyState } from "./EmptyState";
import { SectionHeader } from "./ui/SectionHeader";

interface DamageTimelineProps {
  perLapInfo: PerLapInfo[];
}

const DAMAGE_FIELD_COLORS: Record<string, string> = {
  frontWing: DAMAGE_COLORS.frontWing,
  rearWing: DAMAGE_COLORS.rearWing,
  floor: DAMAGE_COLORS.floor,
  diffuser: DAMAGE_COLORS.diffuser,
  sidepod: DAMAGE_COLORS.sidepod,
  engine: DAMAGE_COLORS.engine,
  gearbox: DAMAGE_COLORS.gearbox,
};

export function DamageTimeline({ perLapInfo }: DamageTimelineProps) {
  // Need at least 2 data points to draw a meaningful timeline
  if (perLapInfo.length < 2) {
    return (
      <EmptyState
        title="Damage"
        message="Not enough lap data was recorded to show the damage timeline."
      />
    );
  }

  const analysis = buildDamageAnalysis(perLapInfo);
  const activeFields = DAMAGE_SERIES_FIELDS.filter((field) =>
    analysis.activeFieldKeys.includes(field.key),
  );

  // Check if any damage occurred at all
  if (activeFields.length === 0) {
    if (analysis.faults.length === 0) return null;
    // Only faults, no damage chart needed — just show badges
    return (
      <div>
        <SectionHeader size="sm" title="Damage" />
        <FaultBadges faults={analysis.faults} />
      </div>
    );
  }

  return (
    <div>
      <SectionHeader size="sm" title="Damage" />
      <ResponsiveContainer width="100%" height={200}>
        <AreaChart
          data={analysis.data}
          margin={{ top: 5, right: 20, bottom: 5, left: 0 }}
        >
          <CartesianGrid strokeDasharray="3 3" stroke={CHART_THEME.grid} />
          <XAxis
            dataKey="lap"
            stroke={CHART_THEME.axis}
            fontSize={11}
            label={{
              value: "Lap",
              position: "insideBottom",
              offset: -2,
              fill: CHART_THEME.axis,
              fontSize: 11,
            }}
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
            formatter={(
              value: number | undefined,
              name: string | undefined,
            ) => [value != null ? `${value.toFixed(0)}%` : "–", name ?? ""]}
          />
          {activeFields.map((field) => (
            <Area
              key={field.key}
              type="monotone"
              dataKey={field.key}
              name={field.label}
              stroke={DAMAGE_FIELD_COLORS[field.key]}
              fill={DAMAGE_FIELD_COLORS[field.key]}
              fillOpacity={0.1}
              strokeWidth={1.5}
            />
          ))}
        </AreaChart>
      </ResponsiveContainer>
      {analysis.faults.length > 0 && <FaultBadges faults={analysis.faults} />}
    </div>
  );
}

function FaultBadges({ faults }: { faults: DamageFault[] }) {
  return (
    <div className="flex flex-wrap gap-2 mt-2">
      {faults.map((fault, i) => (
        <Badge key={i} tone="red">
          Lap {fault.lap}: {fault.label}
        </Badge>
      ))}
    </div>
  );
}
