import { SlidersHorizontal } from "lucide-react";
import type { SessionListFilters } from "../hooks/useSessionFilters";
import { SESSION_MODE_META } from "./sessionModeMeta";
import { SESSION_TYPE_FILTER_META } from "./sessionTypeMeta";
import { HStack } from "./ui/Stack";

interface Props {
  value: SessionListFilters;
  matchingCount: number;
  totalCount: number;
  onReset: () => void;
}

export function SessionListActiveFilters({
  value,
  matchingCount,
  totalCount,
  onReset,
}: Props) {
  const labels = [
    value.type === "all" ? null : SESSION_TYPE_FILTER_META[value.type].label,
    value.mode === "all" ? null : SESSION_MODE_META[value.mode].label,
  ].filter((label): label is string => label !== null);

  return (
    <div className="mt-1.5 px-2 pb-2">
      <HStack className="gap-2 rounded-lg bg-zinc-900/45 px-2.5 py-2 ring-1 ring-inset ring-white/[0.06]">
        <SlidersHorizontal className="size-3.5 shrink-0 text-sky-400" />
        <div className="min-w-0 flex-1" aria-live="polite">
          <p className="font-mono text-3xs font-semibold uppercase tracking-wider text-sky-400/80">
            Filters active
          </p>
          <p className="mt-0.5 truncate text-xs font-medium text-zinc-200">
            {labels.join(" · ")} only
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-0.5">
          <button
            type="button"
            onClick={onReset}
            className="rounded px-1 py-0.5 text-xs font-medium text-sky-300 transition-colors hover:bg-sky-400/10 hover:text-sky-200 focus:outline-none focus-visible:ring-1 focus-visible:ring-sky-400/60"
          >
            Reset
          </button>
          <span
            aria-label={`${matchingCount} of ${totalCount} sessions match the active filters`}
            className="font-mono text-3xs text-zinc-500"
          >
            {matchingCount}/{totalCount}{" "}
            {totalCount === 1 ? "session" : "sessions"}
          </span>
        </div>
      </HStack>
    </div>
  );
}
