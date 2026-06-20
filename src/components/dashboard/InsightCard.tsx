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
import { cn } from "../../utils/cn";
import type {
  InsightKind,
  InsightScope,
  TrackInsight,
} from "../../analysis/dashboardInsights";
import { sessionPath } from "../../utils/routes";
import { ACCENT_TOKENS, type AccentColor } from "../../constants/accents";
import { TrackFlag } from "../TrackFlag";
import { TrackLayout } from "../TrackLayout";
import { Badge } from "../ui/Badge";
import { InsightDetail, InsightValue } from "../ui/InsightText";
import { InsightTile } from "../ui/InsightTile";
import { HStack } from "../ui/Stack";
import { trackFormulaPath } from "./helpers";

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
  const to = insight.sessionSlug
    ? sessionPath(insight.formulaKey, insight.sessionSlug)
    : trackFormulaPath(insight.track, insight.formulaKey);
  const scopeBadge = SCOPE_LABEL[insight.scope];

  return (
    <InsightTile
      title={style.title}
      icon={style.icon}
      accent={style.accent}
      to={to}
      badge={
        scopeBadge ? (
          <Badge
            size="xs"
            shape="square"
            tone="zinc"
            className="tracking-wider"
          >
            {scopeBadge}
          </Badge>
        ) : undefined
      }
      background={
        <TrackLayout
          track={insight.track}
          className={cn(
            "pointer-events-none absolute right-6 top-1/2 size-34 -translate-y-1/2 opacity-6 [&>svg]:size-full [&_path]:![stroke-width:7]",
            tokens.iconText,
          )}
        />
      }
    >
      <HStack justify="between" className="gap-3">
        <div className="min-w-0">
          <HStack className="gap-1.5 truncate text-base font-semibold">
            <TrackFlag track={insight.track} />
            <span className="truncate">{insight.track}</span>
          </HStack>
          <InsightDetail size="sm" tone="text-zinc-500" className="mt-1">
            {insight.detail}
          </InsightDetail>
        </div>
        <InsightValue
          size="xl"
          tone={tokens.accent}
          className="shrink-0 text-right"
        >
          {insight.headline}
        </InsightValue>
      </HStack>
    </InsightTile>
  );
}
