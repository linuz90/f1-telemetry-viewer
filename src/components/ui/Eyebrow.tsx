import { cn } from "../../utils/cn";

/**
 * Section-caption "eyebrow" — the mono uppercase tracking label used above
 * stats, in card headers, and as group titles. Defaults to `text-zinc-500`;
 * tinted variants (e.g. `InsightTile` matching its accent) pass a color
 * override via `className`.
 */
export function Eyebrow({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  const tone = className ?? "text-zinc-500";
  return (
    <span
      className={cn(
        "text-2xs font-mono font-semibold uppercase tracking-wider",
        tone,
      )}
    >
      {children}
    </span>
  );
}
