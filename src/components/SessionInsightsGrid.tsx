import {
  AlertTriangle,
  ArrowUpDown,
  Battery,
  CheckCircle2,
  Circle,
  CircleHelp,
  Cloud,
  Crosshair,
  Flag,
  Fuel,
  Gauge,
  Timer,
  Trophy,
  Wrench,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { cn } from "../utils/cn";
import type {
  SessionInsight,
  SessionInsightTone,
  SessionInsightType,
} from "../utils/sessionInsights";
import { ACCENT_TOKENS, type AccentColor } from "./Card";
import { Tooltip } from "./Tooltip";
import { podiumIcon, positionTone } from "./dashboard/helpers";
import { CompoundBadge } from "./ui/CompoundBadge";
import { highlightDetailValues } from "./ui/HighlightedDetailText";
import { InsightTile } from "./ui/InsightTile";
import { SectionHeader } from "./ui/SectionHeader";

interface SessionInsightsGridProps {
  insights: SessionInsight[];
  hint?: string;
}

const ICON_MAP: Record<SessionInsightType, LucideIcon> = {
  sector: Crosshair,
  tyre: Circle,
  pit: Wrench,
  pace: Zap,
  speed: Gauge,
  ers: Battery,
  history: Trophy,
  fuel: Fuel,
  result: Flag,
  lap: Timer,
  validity: CheckCircle2,
  "race-flow": ArrowUpDown,
  incident: AlertTriangle,
  context: Cloud,
};

const DEFAULT_ACCENT: Record<SessionInsightType, AccentColor> = {
  sector: "cyan",
  tyre: "lime",
  pit: "orange",
  pace: "emerald",
  speed: "sky",
  ers: "cyan",
  history: "zinc",
  fuel: "amber",
  result: "zinc",
  lap: "purple",
  validity: "emerald",
  "race-flow": "cyan",
  incident: "rose",
  context: "sky",
};

function rankColor(
  rank: number | undefined,
  total: number | undefined,
): string {
  if (rank == null || total == null || total <= 1) return "text-zinc-100";
  const pct = rank / (total - 1);
  if (pct <= 0.15) return "text-emerald-300";
  if (pct <= 0.35) return "text-cyan-300";
  if (pct <= 0.6) return "text-amber-300";
  return "text-rose-300";
}

function toneColor(tone: SessionInsightTone | undefined): string {
  switch (tone) {
    case "positive":
      return "text-ahead";
    case "negative":
      return "text-behind";
    case "warning":
      return "text-warning";
    case "best":
      return "text-best";
    case "muted":
      return "text-zinc-500";
    default:
      return "text-zinc-100";
  }
}

function tooltipBadge(text: string) {
  return (
    <Tooltip text={text}>
      <span className="inline-flex size-5 items-center justify-center rounded-full text-zinc-500 transition-colors hover:text-zinc-300 focus-visible:outline focus-visible:outline-1 focus-visible:outline-zinc-500">
        <CircleHelp className="size-3.5" />
      </span>
    </Tooltip>
  );
}

function insightBadge(insight: SessionInsight) {
  if (!insight.compound && !insight.tooltip) return undefined;

  return (
    <span className="flex items-center gap-1.5">
      {insight.compound && <CompoundBadge compound={insight.compound} />}
      {insight.tooltip && tooltipBadge(insight.tooltip)}
    </span>
  );
}

function podiumAccent(position: number | undefined): AccentColor | undefined {
  if (position === 1) return "amber";
  if (position === 2) return "zinc";
  if (position === 3) return "orange";
  return undefined;
}

export function SessionInsightsGrid({
  insights,
  hint,
}: SessionInsightsGridProps) {
  if (!insights.length) return null;

  return (
    <section>
      <SectionHeader title="Key Insights" hint={hint} />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {insights.map((insight, index) => {
          const resultPosition =
            insight.type === "result" && insight.rank != null
              ? insight.rank + 1
              : undefined;
          const PodiumIcon = podiumIcon(resultPosition);
          const Icon = ICON_MAP[insight.type];
          const accent =
            podiumAccent(resultPosition) ??
            insight.accent ??
            DEFAULT_ACCENT[insight.type];
          const tokens = ACCENT_TOKENS[accent];
          const valueColor =
            PodiumIcon && resultPosition != null
              ? positionTone(resultPosition)
              : insight.rank != null
                ? rankColor(insight.rank, insight.rankTotal)
                : toneColor(insight.value === "—" ? "muted" : insight.tone);
          const valueIsLong = insight.value.length > 18;
          const showRankFooter =
            insight.type === "result" &&
            insight.rank != null &&
            insight.rankTotal != null;
          const extraDetailsArePeerLines = insight.type === "sector";

          return (
            <InsightTile
              key={`${insight.type}-${insight.label}-${index}`}
              title={insight.label}
              icon={Icon}
              accent={accent}
              badge={insightBadge(insight)}
              className="h-full min-h-[8.25rem]"
            >
              <div
                className={cn(
                  "break-words font-mono tabular-nums",
                  valueIsLong
                    ? "text-sm leading-snug font-semibold"
                    : "text-xl font-medium",
                  valueColor,
                )}
              >
                {PodiumIcon && resultPosition != null ? (
                  <span className="inline-flex items-center gap-2">
                    <PodiumIcon className="size-5 opacity-80" />
                    <span>{insight.value}</span>
                  </span>
                ) : (
                  insight.value
                )}
              </div>
              {insight.detail && (
                <div className="mt-2 break-words font-mono text-sm leading-relaxed tabular-nums text-zinc-400">
                  {highlightDetailValues(insight.detail)}
                </div>
              )}
              {insight.extraDetails?.map((detail) => (
                <div
                  key={detail}
                  className={cn(
                    "mt-1 break-words font-mono leading-relaxed tabular-nums",
                    extraDetailsArePeerLines
                      ? "text-sm text-zinc-400"
                      : "text-xs text-zinc-500",
                  )}
                >
                  {highlightDetailValues(detail)}
                </div>
              ))}
              {showRankFooter && (
                <div
                  className={cn(
                    "mt-2 font-mono text-2xs font-medium uppercase tracking-wide",
                    tokens.iconText,
                  )}
                >
                  {insight.rank! + 1} of {insight.rankTotal}
                </div>
              )}
            </InsightTile>
          );
        })}
      </div>
    </section>
  );
}
