import { ChevronDown } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { cn } from "../../utils/cn";
import { CheckboxMenuItem } from "../ui/CheckboxMenuItem";
import {
  DEFAULT_PANE_VISIBILITY,
  PANE_SPECS,
  type PaneId,
  type PaneVisibility,
} from "./panes";

/** Dropdown that shows or hides each trace pane the current laps can draw. */
export function TracePaneMenu({
  available,
  visibility,
  onChange,
}: {
  available: readonly PaneId[];
  visibility: PaneVisibility;
  onChange: (next: PaneVisibility) => void;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      // Claims the key so LapComparisonView's Esc-to-reset-zoom skips it.
      event.preventDefault();
      setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const visibleCount = available.filter((id) => visibility[id]).length;
  const isDefault = available.every(
    (id) => visibility[id] === DEFAULT_PANE_VISIBILITY[id],
  );

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className={cn(
          "flex items-center gap-1.5 rounded-lg bg-zinc-900/60 px-2.5 py-1.5 text-xs font-medium transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-zinc-600",
          open ? "text-zinc-100" : "text-zinc-300 hover:text-zinc-100",
        )}
      >
        Traces
        <span className="tabular-nums text-zinc-500">
          {visibleCount}/{available.length}
        </span>
        <ChevronDown
          className={cn(
            "size-3 text-zinc-500 transition-transform",
            open && "rotate-180",
          )}
        />
      </button>

      {open && (
        <div
          role="group"
          aria-label="Visible traces"
          className="absolute left-0 top-full z-20 mt-1 w-44 overflow-hidden rounded-md border border-zinc-800 bg-zinc-900 py-1 shadow-lg shadow-black/20"
        >
          {available.map((id) => (
            <CheckboxMenuItem
              key={id}
              checked={visibility[id]}
              // Keep one pane so the chart never collapses to a bare axis.
              disabled={visibility[id] && visibleCount === 1}
              onToggle={() =>
                onChange({ ...visibility, [id]: !visibility[id] })
              }
            >
              {PANE_SPECS[id].label}
            </CheckboxMenuItem>
          ))}
          {!isDefault && (
            <>
              <div className="my-1 h-px bg-zinc-800" />
              <button
                type="button"
                role="menuitem"
                onClick={() => onChange(DEFAULT_PANE_VISIBILITY)}
                className="w-full px-3 py-2 text-left text-xs text-zinc-400 transition-colors hover:bg-zinc-800/60 hover:text-zinc-200"
              >
                Reset to default
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
