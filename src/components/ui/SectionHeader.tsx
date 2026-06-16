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
  className = "",
}: {
  title: ReactNode;
  hint?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "mb-3 flex flex-wrap items-end justify-between gap-x-3 gap-y-2",
        className,
      )}
    >
      <div className="min-w-0">
        <h3 className="text-base font-semibold text-zinc-100">{title}</h3>
        {hint && <p className="mt-0.5 text-xs text-zinc-500">{hint}</p>}
      </div>
      {action}
    </div>
  );
}
