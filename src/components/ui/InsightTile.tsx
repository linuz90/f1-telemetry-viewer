import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { cn } from "../../utils/cn";
import {
  ACCENT_TOKENS,
  accentCardClass,
  cardHighlight,
  type AccentColor,
} from "../Card";
import { Eyebrow } from "./Eyebrow";
import { HStack } from "./Stack";

/**
 * Shared shell for "insight" tiles — the accent surface (or neutral zinc),
 * the small icon + mono uppercase eyebrow + optional right-aligned badge
 * header, and a `children` body. Callers stay free to lay out their stats
 * however they need.
 *
 * Used by the Track Race-tab key-insight grid (`TrackKeyInsights`), the
 * Qualifying / Time Trial stat strips, the dashboard `InsightCard` (with
 * `to` + `background` for the TrackLayout overlay), and the dashboard
 * `RivalCard`.
 *
 * `accent` is optional: omit for a neutral zinc surface; pass an `AccentColor`
 * to get the same tinted gradient + ringed border used elsewhere.
 * `to` makes the tile a clickable `<Link>` with a hover-brighten effect.
 * `background` slots in an absolute-positioned decoration (e.g. `TrackLayout`);
 * the header and body stack above it via their own positioning context.
 */
export function InsightTile({
  title,
  icon: Icon,
  accent,
  badge,
  to,
  background,
  className = "",
  children,
}: {
  title: string;
  icon: LucideIcon;
  accent?: AccentColor;
  badge?: ReactNode;
  to?: string;
  background?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  const tokens = accent ? ACCENT_TOKENS[accent] : null;
  const surface = accent
    ? accentCardClass(accent)
    : cn("bg-zinc-900/70", cardHighlight);
  const headerColor = tokens?.iconText ?? "text-zinc-400";
  const hoverClass = to ? "transition-all hover:brightness-125" : "";
  const wrapperClass = cn(
    "relative flex flex-col flex-nowrap gap-1 overflow-hidden rounded-2xl p-3.5",
    surface,
    hoverClass,
    className,
  );

  const content = (
    <>
      {background}
      <HStack className="relative gap-2">
        <Icon className={cn("size-3.5", headerColor)} />
        <Eyebrow className={headerColor}>{title}</Eyebrow>
        {badge && <span className="ml-auto">{badge}</span>}
      </HStack>
      <div className="relative mt-2.5">{children}</div>
    </>
  );

  if (to) {
    return (
      <Link to={to} className={wrapperClass}>
        {content}
      </Link>
    );
  }
  return <div className={wrapperClass}>{content}</div>;
}
