import { Battery, Crosshair, Circle, Fuel, Gauge, Wrench, Zap, Trophy, type LucideIcon } from "lucide-react";
import type { StrategyInsight } from "../utils/stats";
import { cardClass } from "./Card";
import { Tooltip } from "./Tooltip";

interface StrategyInsightsCardProps {
  insights: StrategyInsight[];
}

const ICON_MAP: Record<StrategyInsight["type"], LucideIcon> = {
  sector: Crosshair,
  tyre: Circle,
  pit: Wrench,
  pace: Zap,
  speed: Gauge,
  ers: Battery,
  history: Trophy,
  fuel: Fuel,
};

/** Get color for a ranking position relative to total */
function rankColor(rank: number | undefined, total: number | undefined): string {
  if (rank == null || total == null || total <= 1) return "text-zinc-200";
  const pct = rank / (total - 1); // 0 = best, 1 = worst
  if (pct <= 0.15) return "text-emerald-400";
  if (pct <= 0.35) return "text-cyan-400";
  if (pct <= 0.6) return "text-amber-400";
  return "text-red-400";
}

export function StrategyInsightsCard({ insights }: StrategyInsightsCardProps) {
  if (!insights.length) return null;

  return (
    <div className={cardClass}>
      <h3 className="text-xs font-semibold text-zinc-500 uppercase tracking-wide mb-3">
        Insights
      </h3>
      <div className="space-y-0 divide-y divide-zinc-800/60">
        {insights.map((insight, i) => {
          const Icon = ICON_MAP[insight.type];
          const hasRank = insight.rank != null;
          const valueColor = hasRank
            ? rankColor(insight.rank, insight.rankTotal)
            : "text-zinc-200";

          const label = (
            <span className="text-xs text-zinc-400 w-28 shrink-0">
              {insight.label}
            </span>
          );

          return (
            <div
              key={i}
              className="flex items-center gap-4 py-2.5 first:pt-0 last:pb-0"
            >
              <Icon className="w-4 h-4 text-zinc-600 shrink-0" />
              {insight.tooltip ? (
                <Tooltip text={insight.tooltip}>{label}</Tooltip>
              ) : (
                label
              )}
              <span className={`text-sm font-bold font-mono shrink-0 ${valueColor}`}>
                {insight.value}
              </span>
              <span className="text-xs text-zinc-500">
                {insight.detail}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
