import {
  AlertOctagon,
  AlertTriangle,
  Crosshair,
  Crown,
  Flame,
  Gauge,
  Swords,
  Target,
  Users,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { cn } from "../../utils/cn";
import { getTeamColor } from "../../utils/colors";
import type {
  RivalCard as RivalCardData,
  RivalCardKind,
} from "../../analysis/rivalStats";
import type { AccentColor } from "../../constants/accents";
import { InsightDetail, InsightValue } from "../ui/InsightText";
import { InsightTile } from "../ui/InsightTile";

interface RivalCardStyle {
  title: string;
  icon: LucideIcon;
  accent: AccentColor;
}

const RIVAL_CARD_STYLES: Record<RivalCardKind, RivalCardStyle> = {
  "closest-teammate": {
    title: "Closest Teammate",
    icon: Users,
    accent: "violet",
  },
  "frequent-rival": { title: "Frequent Rival", icon: Swords, accent: "orange" },
  "pace-benchmark": { title: "Pace Benchmark", icon: Gauge, accent: "cyan" },
  "most-consistent-rival": {
    title: "Most Consistent",
    icon: Target,
    accent: "fuchsia",
  },
  "overtake-king": { title: "Overtake King", icon: Flame, accent: "emerald" },
  nemesis: { title: "Nemesis", icon: Crosshair, accent: "rose" },
  "fastest-lap-king": { title: "Fastest Lap King", icon: Zap, accent: "lime" },
  "pole-position-king": { title: "Pole King", icon: Crown, accent: "amber" },
  "dnf-king": { title: "DNF King", icon: AlertOctagon, accent: "sky" },
  "penalty-magnet": {
    title: "Penalty Magnet",
    icon: AlertTriangle,
    accent: "rose",
  },
};

/**
 * Trailing-unit pattern: any non-numeric suffix at the end of the headline
 * (e.g. "s" in "+1.021s", "×" in "13×"). Rendered smaller than the main number
 * to give the card a sports-stat-card hierarchy.
 */
const HEADLINE_UNIT_RE = /^(.+?)([a-zA-Z×%]+)$/;

/**
 * Headline parts. `sign` is split out so the renderer can color it by
 * direction (emerald = rival slower / you faster; rose = rival faster /
 * you slower). The rest of the number keeps the card's kind accent — that
 * way every card still reads as its category at a glance, but the sign tells
 * you the read direction without thinking. Plain "+" / "−" are detected; the
 * "±" used by the consistency card is intentionally NOT a direction sign.
 */
function splitHeadline(headline: string): {
  sign?: "+" | "−";
  value: string;
  unit?: string;
} {
  let rest = headline;
  let sign: "+" | "−" | undefined;
  if (rest.startsWith("+") || rest.startsWith("−") || rest.startsWith("-")) {
    sign = rest.startsWith("-") ? "−" : (rest[0] as "+" | "−");
    rest = rest.slice(1);
  }
  const match = rest.match(HEADLINE_UNIT_RE);
  if (!match) return { sign, value: rest };
  return { sign, value: match[1]!, unit: match[2] };
}

export function RivalCard({ card }: { card: RivalCardData }) {
  const style = RIVAL_CARD_STYLES[card.kind];
  // Online lobbies report team as a numeric code (e.g. "211") which isn't
  // a useful label, so we only render the team color chip. The colors util
  // returns a neutral fallback for unknown codes.
  const teamColor = card.team ? getTeamColor(card.team) : undefined;
  const { sign, value, unit } = splitHeadline(card.headline);
  // "+" = rival is slower than you = you're faster → emerald
  // "−" = rival is faster than you = you're slower → rose
  const signClass =
    sign === "+"
      ? "text-emerald-300"
      : sign === "−"
        ? "text-rose-300"
        : undefined;
  return (
    <InsightTile title={style.title} icon={style.icon} accent={style.accent}>
      <div className="flex max-w-full items-center gap-2">
        {teamColor && (
          <span
            className="inline-block size-2.5 shrink-0 rounded-sm"
            style={{ backgroundColor: teamColor }}
            aria-hidden
          />
        )}
        <span className="truncate text-sm font-semibold text-zinc-100">
          {card.driverName}
        </span>
      </div>

      {/* Neutral hero number — the card's category color lives on the
          title chip, icon, and soft border glow, so the headline can stay
          quiet and the section as a whole reads less like a rainbow. The
          sign is the one place we still tint: emerald = you're ahead,
          rose = you're behind. Against a white number it reads as a clean
          indicator rather than the two-tone clash of accent-on-accent. */}
      <InsightValue
        size="xl"
        className="mt-1 flex items-baseline font-bold leading-none tracking-tight"
      >
        {sign && (
          <span className={cn("text-3xl font-mono", signClass)}>{sign}</span>
        )}
        <span className="text-3xl font-mono text-zinc-100">{value}</span>
        {unit && (
          <span className="ml-0.5 text-2xl font-mono text-zinc-400">
            {unit}
          </span>
        )}
      </InsightValue>

      <InsightDetail
        size="xs"
        tone="text-zinc-500"
        className="mt-3 border-t border-white/[0.05] pt-2 font-medium"
      >
        {card.detail}
      </InsightDetail>
    </InsightTile>
  );
}
