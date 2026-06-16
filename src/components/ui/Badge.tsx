import { cn } from "../../utils/cn";

export type BadgeTone = "red" | "amber" | "yellow" | "green" | "sky" | "rose" | "purple" | "zinc";
export type BadgeSize = "sm" | "xs";
export type BadgeShape = "pill" | "square";

const SIZE: Record<BadgeSize, string> = {
  sm: "px-2 py-0.5 text-2xs font-semibold",
  xs: "px-1 py-0.5 text-[9px] font-bold",
};

const SHAPE: Record<BadgeShape, string> = {
  pill: "rounded-full",
  square: "rounded",
};

const TONE: Record<BadgeTone, string> = {
  red: "bg-red-500/10 text-red-400",
  amber: "bg-amber-500/10 text-amber-300",
  yellow: "bg-yellow-500/20 text-yellow-400",
  green: "bg-green-500/10 text-green-400",
  sky: "bg-sky-500/10 text-sky-300",
  rose: "bg-rose-500/10 text-rose-300",
  purple: "bg-purple-500/10 text-purple-300",
  zinc: "bg-zinc-800/80 text-zinc-400",
};

/**
 * Small rounded status badge — counts, alerts, tags.
 *
 * - `size`: `sm` (default, `text-2xs`) or `xs` (`text-[9px]`, tighter padding,
 *   bolder — used for in-row chips like INVALID / SC / penalties).
 * - `shape`: `pill` (default, `rounded-full`) or `square` (`rounded`) for
 *   in-text tags where a full pill looks too bubbly.
 * - `tone`: optional palette preset. Omit when the caller wants to supply
 *   bg/text colors via `className` (e.g. semantic colors like `text-behind`
 *   for invalid-lap chips that need higher contrast on tinted row bg).
 */
export function Badge({
  tone,
  size = "sm",
  shape = "pill",
  className,
  children,
}: {
  tone?: BadgeTone;
  size?: BadgeSize;
  shape?: BadgeShape;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center",
        SHAPE[shape],
        SIZE[size],
        tone && TONE[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}
