import { ChevronDown, Plus, X } from "lucide-react";
import { cn } from "../../utils/cn";
import { msToLapTime } from "../../utils/format";
import type { SlotLap } from "./types";

export function LapChips({
  slots,
  fastestKey,
  canAdd,
  onOpenPicker,
  onRemove,
}: {
  slots: readonly SlotLap[];
  /** Purple marks only the fastest selected lap's time. */
  fastestKey?: string;
  canAdd: boolean;
  onOpenPicker: (slotIndex: number) => void;
  onRemove: (slotIndex: number) => void;
}) {
  return (
    <div className="flex flex-wrap items-stretch gap-2">
      {slots.map((slot, index) => (
        <div
          key={slot.key}
          className="flex min-w-0 max-w-full items-stretch rounded-xl bg-zinc-800/60 ring-1 ring-inset ring-white/[0.05]"
        >
          <button
            type="button"
            onClick={() => onOpenPicker(index)}
            className="flex min-w-0 items-center gap-2.5 rounded-xl py-1.5 pl-2.5 pr-2 text-left transition-colors hover:bg-zinc-700/40"
            aria-label={`Change lap ${slot.slot}`}
          >
            <span
              className="flex size-5 shrink-0 items-center justify-center rounded-md font-mono text-2xs font-bold text-zinc-950"
              style={{ backgroundColor: slot.color }}
            >
              {slot.slot}
            </span>
            <span className="min-w-0">
              <span className="flex items-baseline gap-2">
                <span
                  className={cn(
                    "font-mono text-sm font-semibold tabular-nums",
                    slot.key === fastestKey ? "text-best" : "text-zinc-100",
                  )}
                >
                  {msToLapTime(slot.candidate.lapTimeMs)}
                </span>
                <span className="truncate text-sm text-zinc-200">
                  {slot.label}
                </span>
              </span>
              <span className="block truncate text-2xs text-zinc-500">
                {slot.detail}
              </span>
            </span>
            <ChevronDown className="size-3 shrink-0 text-zinc-500" />
          </button>
          {slots.length > 1 && (
            <button
              type="button"
              onClick={() => onRemove(index)}
              className="flex items-center rounded-r-xl px-2 text-zinc-500 transition-colors hover:bg-zinc-700/40 hover:text-zinc-200"
              aria-label={`Remove lap ${slot.slot}`}
            >
              <X className="size-3.5" />
            </button>
          )}
        </div>
      ))}
      {canAdd && (
        <button
          type="button"
          onClick={() => onOpenPicker(slots.length)}
          className="flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-medium text-zinc-400 border border-dashed border-zinc-700 transition-colors hover:bg-zinc-800/50 hover:text-zinc-200"
        >
          <Plus className="size-3.5" />
          Compare with a lap
        </button>
      )}
    </div>
  );
}
