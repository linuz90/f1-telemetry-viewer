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
import { CHART_THEME, DAMAGE_COLORS } from "../constants/colors";
import { chartTooltipClass } from "./charts/chartStyles";
import { cn } from "../utils/cn";
import { Panel } from "./ui/Panel";
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

/**
 * The driver's damage and faults, lap by lap, beside the lap times they
 * explain. A clean race, or one too short to chart, shows nothing.
 */
export function DamageTimeline({ perLapInfo }: DamageTimelineProps) {
  if (perLapInfo.length < 2) return null;

  const analysis = buildDamageAnalysis(perLapInfo);
  const activeFields = DAMAGE_SERIES_FIELDS.filter((field) =>
    analysis.activeFieldKeys.includes(field.key),
  );

  if (activeFields.length === 0) {
    if (analysis.faults.length === 0) return null;
    // Only faults, no damage chart needed — just show badges
    return (
      <Panel title="Damage">
        <FaultBadges faults={analysis.faults} />
      </Panel>
    );
  }

  return (
    <Panel title="Damage" hint="Hover any lap">
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
            content={({ active, label, payload }) =>
              active && payload?.length ? (
                <div className={cn(chartTooltipClass, "px-3 py-2")}>
                  <div className="mb-0.5 text-tone-400">Lap {label}</div>
                  {payload.map((entry) => (
                    <div
                      key={String(entry.dataKey)}
                      className="flex items-center gap-1.5 text-tone-200"
                    >
                      <span
                        aria-hidden
                        className="size-2 rounded-full"
                        style={{ backgroundColor: entry.color }}
                      />
                      {entry.name}
                      <span className="ml-auto pl-3 font-mono tabular-nums">
                        {typeof entry.value === "number"
                          ? `${entry.value.toFixed(0)}%`
                          : "–"}
                      </span>
                    </div>
                  ))}
                </div>
              ) : null
            }
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
    </Panel>
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
