import type { ReactNode } from "react";
import { cn } from "../../utils/cn";

/**
 * Canonical section header. Used for top-level sections OUTSIDE cards
 * (Insights, Tracks, Strategy…) and for the title block INSIDE chart cards
 * (Pace Evolution, Best Lap Over Time…). Same font / weight / color in both
 * positions so the page reads as one family.
 */
export function SectionHeader({
  title,
  hint,
  action,
  size = "md",
  className = "",
}: {
  title: ReactNode;
  hint?: ReactNode;
  action?: ReactNode;
  size?: "sm" | "md";
  className?: string;
}) {
  const titleClassName =
    size === "sm"
      ? "text-sm font-semibold text-zinc-300"
      : "text-lg font-semibold text-zinc-100";
  const containerClassName = size === "sm" ? "mb-2" : "mb-3";

  return (
    <div
      className={cn(
        "flex flex-wrap items-start justify-between gap-x-3 gap-y-2",
        containerClassName,
        className,
      )}
    >
      <div className="min-w-0">
        <h3 className={titleClassName}>{title}</h3>
        {hint && (
          <p className="mt-0.5 font-mono text-xs tabular-nums text-zinc-500">
            {hint}
          </p>
        )}
      </div>
      {action}
    </div>
  );
}
