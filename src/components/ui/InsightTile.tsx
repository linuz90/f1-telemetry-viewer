import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { ACCENT_TOKENS, accentCardClass, cardHighlight, type AccentColor } from "../Card";
import { HStack } from "./Stack";

/**
 * Shared shell for "insight" tiles — the header pattern (small icon + mono
 * uppercase eyebrow + optional right-aligned badge) plus the accent surface.
 * Body is `children`, so callers stay free to lay out their stats however
 * they need. Used by the Track Race-tab key-insight grid (`TrackKeyInsights`)
 * and the Qualifying / Time Trial stat strips on the same page. Dashboard's
 * `InsightCard` still has its own header copy because it wraps in `<Link>`
 * and overlays a `TrackLayout` background — worth folding in later but a
 * larger refactor than this primitive needs.
 *
 * `accent` is optional: omit for a neutral zinc surface; pass an `AccentColor`
 * to get the same tinted gradient + ringed border used elsewhere.
 */
export function InsightTile({
  title,
  icon: Icon,
  accent,
  badge,
  className = "",
  children,
}: {
  title: string;
  icon: LucideIcon;
  accent?: AccentColor;
  badge?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  const tokens = accent ? ACCENT_TOKENS[accent] : null;
  const surface = accent
    ? accentCardClass(accent)
    : `bg-zinc-900/70 ${cardHighlight}`;
  const headerColor = tokens?.iconText ?? "text-zinc-400";

  return (
    <div className={`relative overflow-hidden rounded-2xl ${surface} p-3.5 ${className}`}>
      <HStack className="relative gap-2">
        <Icon className={`size-3.5 ${headerColor}`} />
        <span
          className={`text-[11px] font-mono font-semibold uppercase tracking-wider ${headerColor}`}
        >
          {title}
        </span>
        {badge && <span className="ml-auto">{badge}</span>}
      </HStack>
      <div className="relative mt-2.5">{children}</div>
    </div>
  );
}
