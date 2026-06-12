import {
  AlertTriangle,
  Award,
  CloudRain,
  Crosshair,
  Disc,
  Flame,
  Gauge,
  Mountain,
  PieChart,
  Rocket,
  Sparkles,
  Swords,
  Target,
  Timer,
  TimerReset,
  TrendingUp,
  Trophy,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { Link } from "react-router-dom";
import type {
  InsightKind,
  InsightScope,
  TrackInsight,
} from "../../utils/dashboardStats";
import { ACCENT_TOKENS, accentCardClass, type AccentColor } from "../Card";
import { TrackFlag } from "../TrackFlag";
import { TrackLayout } from "../TrackLayout";
import { trackFormulaPath } from "./helpers";
import { sessionFormulaPath } from "../../utils/routes";

interface InsightStyle {
  title: string;
  icon: LucideIcon;
  accent: AccentColor;
}

const INSIGHT_STYLES: Record<InsightKind, InsightStyle> = {
  "best-track": { title: "Best Track", icon: Trophy, accent: "amber" },
  "toughest-track": { title: "Toughest Track", icon: Mountain, accent: "rose" },
  "best-qualifier": { title: "Best Qualifier", icon: Timer, accent: "cyan" },
  "toughest-qualifier": {
    title: "Toughest Qualifier",
    icon: TimerReset,
    accent: "rose",
  },
  "race-craft": { title: "Race Craft", icon: Swords, accent: "emerald" },
  "most-improved": {
    title: "Most Improved",
    icon: TrendingUp,
    accent: "violet",
  },
  "most-consistent": {
    title: "Most Consistent",
    icon: Target,
    accent: "fuchsia",
  },
  "hot-streak": { title: "Hot Streak", icon: Flame, accent: "orange" },
  "comeback-drive": {
    title: "Comeback Drive",
    icon: Rocket,
    accent: "emerald",
  },
  "podium-specialist": {
    title: "Podium Specialist",
    icon: Award,
    accent: "amber",
  },
  "penalty-magnet": {
    title: "Penalty Magnet",
    icon: AlertTriangle,
    accent: "rose",
  },
  "wet-weather": { title: "Wet Weather", icon: CloudRain, accent: "sky" },
  "race-consistency": {
    title: "Race Consistency",
    icon: Crosshair,
    accent: "fuchsia",
  },
  "fastest-lap-king": {
    title: "Fastest Lap King",
    icon: Zap,
    accent: "violet",
  },
  "lap-one-starter": { title: "Lap-1 Starter", icon: Rocket, accent: "sky" },
  "top-speed-king": { title: "Top Speed King", icon: Gauge, accent: "cyan" },
  "tyre-whisperer": { title: "Tyre Whisperer", icon: Disc, accent: "lime" },
  "sector-specialist": {
    title: "Sector Specialist",
    icon: PieChart,
    accent: "fuchsia",
  },
  "net-overtakes": {
    title: "Net Overtakes",
    icon: Sparkles,
    accent: "emerald",
  },
};

// The section header already says race insights use online results when available,
// so the ONLINE chip on every card is redundant. Only label non-default scopes.
const SCOPE_LABEL: Partial<Record<InsightScope, string>> = {
  race: "RACES",
  quali: "QUALI",
};

export function InsightCard({ insight }: { insight: TrackInsight }) {
  const style = INSIGHT_STYLES[insight.kind];
  const tokens = ACCENT_TOKENS[style.accent];
  const Icon = style.icon;
  const to = insight.sessionSlug
    ? sessionFormulaPath(insight.sessionSlug, insight.formulaKey)
    : trackFormulaPath(insight.track, insight.formulaKey);

  return (
    <Link
      to={to}
      className={`relative block overflow-hidden rounded-2xl ${accentCardClass(style.accent)} p-3.5 transition-all hover:brightness-125`}
    >
      <TrackLayout
        track={insight.track}
        className={`pointer-events-none absolute right-6 top-1/2 size-34 -translate-y-1/2 ${tokens.iconText} opacity-6 [&>svg]:size-full [&_path]:![stroke-width:7]`}
      />
      <div className="relative flex items-center gap-2">
        <Icon className={`size-3.5 ${tokens.iconText}`} />
        <span
          className={`text-[11px] font-mono font-semibold uppercase tracking-wider ${tokens.iconText}`}
        >
          {style.title}
        </span>
        {SCOPE_LABEL[insight.scope] && (
          <span className="ml-auto rounded-sm bg-zinc-900/80 px-1.5 py-0.5 text-[9px] font-semibold tracking-wider text-zinc-500">
            {SCOPE_LABEL[insight.scope]}
          </span>
        )}
      </div>
      <div className="relative mt-2.5 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 truncate text-base font-semibold">
            <TrackFlag track={insight.track} />
            <span className="truncate">{insight.track}</span>
          </div>
          <div className="mt-1 truncate text-xs text-zinc-500">
            {insight.detail}
          </div>
        </div>
        <div
          className={`shrink-0 text-right font-mono text-2xl font-semibold tabular-nums ${tokens.accent}`}
        >
          {insight.headline}
        </div>
      </div>
    </Link>
  );
}
