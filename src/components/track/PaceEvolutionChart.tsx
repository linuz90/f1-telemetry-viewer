import { useMemo, useState } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { PaceEvolutionPoint, RaceContext } from "../../utils/stats";
import { CHART_THEME, TOOLTIP_STYLE, getCompoundColor } from "../../utils/colors";
import { msToLapTime } from "../../utils/format";
import { cardClass } from "../Card";
import { SegmentedControl } from "../ui/SegmentedControl";
import { SectionHeader } from "../ui/SectionHeader";

/**
 * Pace Evolution — race-on-race best 3-lap pace window by compound. Replaces
 * the old "Tyre Management" and "Top Speed Trend" charts: those plotted a
 * single noisy number per race; this one plots representative pace itself,
 * split by compound, so the comparison is the one drivers actually care about
 * ("is my Hard pace improving here?").
 *
 * The metric is the average of the FASTEST 3 clean laps on that compound —
 * not the median across the whole stint, which would unfairly penalize long
 * stints whose median is dragged down by tyre-deg laps in the tail. See the
 * header comment on `buildPaceEvolution` in stats.ts for the rationale.
 *
 * Compounds with < 3 clean laps in a session are gated out upstream so a
 * tiny stint doesn't yank a line around.
 *
 * Context filter: a 2-car online sparring session and a 20-car AI race are
 * not the same pace problem (clean air vs traffic), so the chart lets you
 * narrow to one bucket. The tooltip always shows each point's context so the
 * underlying mix is visible even when "All" is selected.
 */

type ContextFilter = "all" | "clean-air" | "full-grid";

const CONTEXT_FILTER_OPTIONS: { value: ContextFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "clean-air", label: "Clean air" },
  { value: "full-grid", label: "Full grid" },
];

function contextLabel(ctx: RaceContext): string {
  const where = ctx.isOnline ? "Online" : "Offline";
  const drivers = `${ctx.driverCount} driver${ctx.driverCount === 1 ? "" : "s"}`;
  // Surface the leader-share override so it's visible WHY a 20-car race is
  // sitting in the clean-air bucket. Threshold mirrors LEADER_SHARE_OVERRIDE
  // in stats.ts; kept loose (≥ 0.5) so even sub-threshold leading shows up.
  const lead =
    ctx.leaderShare >= 0.5
      ? ` · led ${Math.round(ctx.leaderShare * 100)}% of clean laps`
      : "";
  return `${where} · ${drivers}${lead}`;
}

export function PaceEvolutionChart({ data }: { data: PaceEvolutionPoint[] }) {
  const [filter, setFilter] = useState<ContextFilter>("all");

  // Apply filter while preserving original idx so race numbers stay anchored.
  const filtered = useMemo(() => {
    if (filter === "all") return data;
    return data.filter((d) => d.context.kind === filter);
  }, [data, filter]);

  // Show the filter control only when ≥2 distinct contexts exist — otherwise
  // it's a no-op widget and just adds visual noise.
  const distinctKinds = new Set(data.map((d) => d.context.kind));
  const showFilter = distinctKinds.size > 1;

  // Collect every compound that appears in the (filtered) data, in display order.
  const compoundOrder = ["Soft", "Medium", "Hard", "Intermediate", "Wet"];
  const present = new Set<string>();
  for (const d of filtered) {
    for (const c of Object.keys(d.paces)) present.add(c);
  }
  const compounds = compoundOrder.filter((c) => present.has(c));

  // Flatten paces.<compound> → top-level keys for Recharts dataKey.
  const flatData = filtered.map((d) => {
    const row: Record<string, number | string> = {
      idx: d.idx,
      label: d.label,
      date: d.date,
    };
    for (const c of compounds) {
      const ms = d.paces[c];
      if (ms != null) row[c] = ms / 1000;
    }
    return row;
  });

  return (
    <section className={cardClass}>
      <SectionHeader
        title="Pace Evolution"
        hint="Avg. of fastest 3 clean laps by compound, race-on-race"
        action={
          showFilter ? (
            <SegmentedControl<ContextFilter>
              ariaLabel="Race context filter"
              options={CONTEXT_FILTER_OPTIONS}
              value={filter}
              onChange={setFilter}
            />
          ) : undefined
        }
      />


      {filtered.length === 0 ? (
        <div className="py-12 text-center text-sm text-zinc-500">
          No races match this filter.
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={220}>
          <LineChart
            data={flatData}
            margin={{ top: 5, right: 20, bottom: 5, left: 0 }}
          >
            <CartesianGrid strokeDasharray="3 3" stroke={CHART_THEME.grid} />
            <XAxis
              dataKey="idx"
              stroke={CHART_THEME.axis}
              fontSize={11}
              tickFormatter={(v) => `R${v}`}
            />
            <YAxis
              stroke={CHART_THEME.axis}
              fontSize={11}
              tickFormatter={(v) => msToLapTime(v * 1000)}
              domain={["auto", "auto"]}
            />
            <Tooltip
              {...TOOLTIP_STYLE}
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const row = payload[0]?.payload as
                  | (Record<string, number | string> & {
                      label?: string;
                      date?: string;
                    })
                  | undefined;
                if (!row) return null;
                const point = filtered.find((d) => d.idx === row.idx);
                return (
                  <div
                    style={{
                      ...TOOLTIP_STYLE.contentStyle,
                      padding: "8px 12px",
                      color: "#e4e4e7",
                    }}
                  >
                    <div style={{ color: "#a1a1aa", marginBottom: 2, fontSize: 11 }}>
                      {row.date} · {row.label}
                    </div>
                    {point && (
                      <div
                        style={{
                          color: "#71717a",
                          marginBottom: 6,
                          fontSize: 11,
                        }}
                      >
                        {contextLabel(point.context)}
                      </div>
                    )}
                    {compounds.map((c) => {
                      const ms = point?.paces[c];
                      const n = point?.counts[c];
                      if (ms == null) return null;
                      return (
                        <div
                          key={c}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 6,
                            fontFamily: "monospace",
                            fontSize: 12,
                            lineHeight: 1.6,
                          }}
                        >
                          <span
                            style={{
                              display: "inline-block",
                              width: 8,
                              height: 8,
                              borderRadius: 2,
                              backgroundColor: getCompoundColor(c),
                            }}
                          />
                          <span style={{ color: "#d4d4d8", minWidth: 60 }}>
                            {c}
                          </span>
                          <span>{msToLapTime(ms)}</span>
                          {n != null && (
                            <span style={{ color: "#71717a", fontSize: 11 }}>
                              ({n} laps)
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                );
              }}
            />
            {compounds.map((c) => {
              const color = getCompoundColor(c);
              return (
                <Line
                  key={c}
                  type="monotone"
                  dataKey={c}
                  stroke={color}
                  strokeWidth={2}
                  dot={{ fill: color, r: 4 }}
                  // `connectNulls` so a missing compound in one race doesn't
                  // break the line for that compound across other races.
                  connectNulls
                />
              );
            })}
          </LineChart>
        </ResponsiveContainer>
      )}
      {filtered.length > 0 && (
        <div className="flex flex-wrap gap-3 mt-2 text-xs text-zinc-500">
          {compounds.map((c) => (
            <span key={c} className="flex items-center gap-1.5">
              <span
                className="inline-block w-2.5 h-2.5 rounded-sm"
                style={{ backgroundColor: getCompoundColor(c) }}
              />
              {c}
            </span>
          ))}
        </div>
      )}
    </section>
  );
}
