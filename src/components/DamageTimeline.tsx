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
import { HStack } from "./ui/Stack";

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
          <CartesianGrid vertical={false} stroke={CHART_THEME.grid} />
          <XAxis
            dataKey="lap"
            stroke={CHART_THEME.axis}
            tickLine={false}
            tickFormatter={(lap) => `L${lap}`}
            minTickGap={16}
            fontSize={11}
          />
          <YAxis
            stroke={CHART_THEME.axis}
            tickLine={false}
            axisLine={false}
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
            // Damage arrives in jumps, so the line steps rather than curves.
            <Area
              key={field.key}
              type="stepAfter"
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
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-tone-400">
        {activeFields.map((field) => (
          <span key={field.key} className="inline-flex items-center gap-1.5">
            <span
              aria-hidden
              className="size-2 rounded-full"
              style={{ backgroundColor: DAMAGE_FIELD_COLORS[field.key] }}
            />
            {field.label}
            <b className="font-semibold text-tone-100 tabular-nums">
              {Math.max(...analysis.data.map((row) => row[field.key]))}%
            </b>
          </span>
        ))}
      </div>
      {analysis.faults.length > 0 && <FaultBadges faults={analysis.faults} />}
    </div>
  );
}

function FaultBadges({ faults }: { faults: DamageFault[] }) {
  return (
    <HStack align="stretch" wrap className="mt-2 gap-2">
      {faults.map((fault, i) => (
        <Badge key={i} tone="red">
          Lap {fault.lap}: {fault.label}
        </Badge>
      ))}
    </HStack>
  );
}
