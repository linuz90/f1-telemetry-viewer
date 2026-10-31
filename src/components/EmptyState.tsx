import type { ReactNode } from "react";
import { CircleOff, type LucideIcon } from "lucide-react";
import { cn } from "../utils/cn";

interface EmptyStateProps {
  icon?: LucideIcon;
  title: ReactNode;
  message?: ReactNode;
  className?: string;
}

/**
 * Placeholder for a card or chart with nothing to show yet: a small glyph,
 * a title and one line of why, centred in a minimum height so an empty card
 * keeps the size of a full one. Grows to fill a flex-column parent, so a
 * `Panel` with `flex flex-col` centres it beside a taller neighbour.
 */
export function EmptyState({
  icon: Icon = CircleOff,
  title,
  message,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex min-h-44 flex-1 flex-col items-center justify-center px-4 py-6 text-center",
        className,
      )}
    >
      <div className="grid size-9 place-items-center rounded-full bg-tone-800 ring-1 ring-tone-700/60">
        <Icon className="size-4 text-tone-400" />
      </div>
      <p className="mt-3 text-sm font-medium text-tone-300">{title}</p>
      {message && (
        <p className="mt-1 max-w-xs text-xs/5 text-balance text-tone-500">
          {message}
        </p>
      )}
    </div>
  );
}
