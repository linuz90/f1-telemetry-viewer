import {
  AlertTriangle,
  BadgeCheck,
  CircleAlert,
  Sparkles,
  ThumbsUp,
  type LucideIcon,
} from "lucide-react";
import {
  formatStartReactionTick,
  START_REACTION_RAIL_MAX_SECONDS,
  START_REACTION_RAIL_TICKS,
  type StartReactionModel,
  type StartReactionRating,
} from "../analysis/startReactionAnalysis";
import { Card } from "./Card";
import { Tooltip } from "./Tooltip";
import { Badge, type BadgeTone } from "./ui/Badge";
import { SectionHeader } from "./ui/SectionHeader";

interface StartReactionCardProps {
  model: StartReactionModel;
}

function tickPct(seconds: number): number {
  return (seconds / START_REACTION_RAIL_MAX_SECONDS) * 100;
}

const RATING_STYLES: Record<
  StartReactionRating,
  {
    icon: LucideIcon;
    text: string;
    marker: string;
    railGlow: string;
    badgeTone: BadgeTone;
  }
> = {
  exceptional: {
    icon: Sparkles,
    text: "text-best",
    marker: "bg-best shadow-purple-400/25 ring-purple-400/20",
    railGlow: "from-transparent via-best/20 to-transparent",
    badgeTone: "purple",
  },
  optimal: {
    icon: BadgeCheck,
    text: "text-ahead",
    marker: "bg-ahead shadow-green-400/25 ring-green-400/20",
    railGlow: "from-transparent via-ahead/20 to-transparent",
    badgeTone: "green",
  },
  good: {
    icon: ThumbsUp,
    text: "text-ahead",
    marker: "bg-ahead shadow-green-400/25 ring-green-400/20",
    railGlow: "from-transparent via-ahead/20 to-transparent",
    badgeTone: "green",
  },
  bad: {
    icon: AlertTriangle,
    text: "text-warning",
    marker: "bg-warning shadow-orange-400/25 ring-orange-400/20",
    railGlow: "from-transparent via-warning/20 to-transparent",
    badgeTone: "amber",
  },
  terrible: {
    icon: CircleAlert,
    text: "text-behind",
    marker: "bg-behind shadow-red-400/25 ring-red-400/20",
    railGlow: "from-transparent via-behind/20 to-transparent",
    badgeTone: "red",
  },
};

const RATING_TOOLTIP =
  "Viewer benchmark bands, not official F1 or game thresholds: under 0.18s exceptional, under 0.23s optimal, under 0.30s good, up to 0.50s slow.";

export function StartReactionCard({ model }: StartReactionCardProps) {
  const styles = RATING_STYLES[model.rating];
  const RatingIcon = styles.icon;
  const railDetail = model.isDisplayClamped
    ? `above ${formatStartReactionTick(START_REACTION_RAIL_MAX_SECONDS)} rail`
    : "lights out to launch";

  return (
    <Card as="section">
      <SectionHeader
        size="sm"
        title="Your Start Reaction"
        action={
          <Tooltip text={RATING_TOOLTIP}>
            <Badge tone={styles.badgeTone} className="gap-1.5">
              <RatingIcon className="size-3" aria-hidden="true" />
              {model.label}
            </Badge>
          </Tooltip>
        }
      />
      <div className="grid gap-5 sm:grid-cols-[minmax(8rem,0.85fr)_minmax(0,2fr)] sm:items-end">
        <div className="min-w-0">
          <p
            className={`font-mono text-2xl font-semibold tabular-nums ${styles.text}`}
          >
            {model.formatted}
          </p>
          <p className="mt-1 text-sm text-zinc-500">{model.detail}</p>
        </div>

        <div
          className="min-w-0 px-2 pb-1"
          role="img"
          aria-label={`Your start reaction ${model.formatted}${model.isDisplayClamped ? ", above chart rail" : ""}`}
        >
          <div className="relative h-9">
            <div className="absolute inset-x-0 top-3.5 h-2 overflow-hidden bg-zinc-800/80">
              <span
                className={`absolute top-0 h-full w-[50%] -translate-x-1/2 bg-gradient-to-r ${styles.railGlow}`}
                style={{ left: `${model.markerPct}%` }}
              />
            </div>
            {START_REACTION_RAIL_TICKS.map((tick) => (
              <span
                key={tick}
                className="absolute top-2.5 h-4 w-px -translate-x-1/2 bg-zinc-600"
                style={{ left: `${tickPct(tick)}%` }}
              />
            ))}
            <span
              className={`absolute top-4.5 size-4 -translate-x-1/2 -translate-y-1/2 rounded-full shadow-lg ring-4 ${styles.marker}`}
              style={{ left: `${model.markerPct}%` }}
            />
          </div>

          <div className="relative h-4 font-mono text-2xs tabular-nums text-zinc-500">
            {START_REACTION_RAIL_TICKS.map((tick) => (
              <span
                key={tick}
                className="absolute top-0 -translate-x-1/2 whitespace-nowrap"
                style={{ left: `${tickPct(tick)}%` }}
              >
                {formatStartReactionTick(tick)}
              </span>
            ))}
          </div>
          <p className="mt-1 text-right text-2xs text-zinc-600">{railDetail}</p>
        </div>
      </div>
    </Card>
  );
}
