import { cn } from "../../utils/cn";

/**
 * Section-caption "eyebrow" — the small sentence-case label used above
 * stats, in card headers, and as group titles. Defaults to `text-tone-500`;
 * tinted variants pass a color override via `className`.
 */
export function Eyebrow({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  const tone = className ?? "text-tone-500";
  return <span className={cn("text-xs font-medium", tone)}>{children}</span>;
}
