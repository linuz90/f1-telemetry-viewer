import { useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { Bot, Flag, SlidersHorizontal, Trophy, type LucideIcon } from "lucide-react";
import { SegmentedControl } from "./ui/SegmentedControl";

export type SessionTypeFilter = "all" | "race" | "quali";
export type SessionModeFilter = "all" | "online" | "ai";

export interface SessionListFilters {
  type: SessionTypeFilter;
  mode: SessionModeFilter;
  formula: string | null;
}

export const DEFAULT_FILTERS: SessionListFilters = {
  type: "all",
  mode: "all",
  formula: null,
};

export interface FormulaOption {
  key: string;
  label: string;
}

interface Props {
  value: SessionListFilters;
  onChange: (next: SessionListFilters) => void;
  /** Formula options to show; section is hidden when fewer than 2. */
  formulaOptions: FormulaOption[];
  /** Resolved active formula key (after fallback to first option). */
  activeFormulaKey: string | null;
}

/** Counts how many filter dimensions differ from defaults. Formula counts only when offered. */
function countActive(value: SessionListFilters, formulaOptions: FormulaOption[]): number {
  let n = 0;
  if (value.type !== DEFAULT_FILTERS.type) n += 1;
  if (value.mode !== DEFAULT_FILTERS.mode) n += 1;
  // Only count formula when it's user-selectable AND differs from the first (default) option.
  if (formulaOptions.length > 1 && value.formula && value.formula !== formulaOptions[0]?.key) {
    n += 1;
  }
  return n;
}

export function SessionListFilterMenu({ value, onChange, formulaOptions, activeFormulaKey }: Props) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const location = useLocation();

  const activeCount = countActive(value, formulaOptions);
  const showFormulaSection = formulaOptions.length > 1;

  // Close on outside click and Escape
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // Close when route changes (matches mobile sidebar behavior)
  useEffect(() => {
    setOpen(false);
  }, [location.pathname]);

  const isDefault = activeCount === 0;

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="Filters"
        aria-expanded={open}
        className={`relative flex items-center justify-center rounded-md p-1.5 transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-zinc-600 ${
          open || !isDefault
            ? "bg-zinc-900 text-zinc-200"
            : "text-zinc-500 hover:bg-zinc-900/60 hover:text-zinc-300"
        }`}
      >
        <SlidersHorizontal className="h-3.5 w-3.5" />
        {activeCount > 0 && (
          <span className="absolute top-1 right-1 h-1.5 w-1.5 rounded-full bg-sky-400/80 ring-2 ring-zinc-900" />
        )}
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Session filters"
          className="absolute right-0 top-full z-20 mt-1.5 w-64 max-w-[calc(100vw-2rem)] rounded-xl bg-zinc-950 ring-1 ring-white/[0.06] shadow-xl divide-y divide-white/[0.05]"
        >
          <Section label="Session type" icon={Flag}>
            <SegmentedControl<SessionTypeFilter>
              size="sm"
              fullWidth
              options={[
                { value: "all", label: "All" },
                { value: "race", label: "Race" },
                { value: "quali", label: "Quali" },
              ]}
              value={value.type}
              onChange={(type) => onChange({ ...value, type })}
            />
          </Section>

          <Section label="Mode" icon={Bot}>
            <SegmentedControl<SessionModeFilter>
              size="sm"
              fullWidth
              options={[
                { value: "all", label: "All" },
                { value: "ai", label: "AI" },
                { value: "online", label: "Online" },
              ]}
              value={value.mode}
              onChange={(mode) => onChange({ ...value, mode })}
            />
          </Section>

          {showFormulaSection && (
            <Section label="Formula" icon={Trophy}>
              <SegmentedControl
                size="sm"
                fullWidth
                options={formulaOptions.map((f) => ({ value: f.key, label: f.label }))}
                value={activeFormulaKey ?? formulaOptions[0]?.key ?? ""}
                onChange={(next) => onChange({ ...value, formula: next })}
              />
            </Section>
          )}

          {!isDefault && (
            <div className="flex items-center justify-between px-3 py-2">
              <span className="text-[11px] text-zinc-500">
                {activeCount} {activeCount === 1 ? "filter" : "filters"} active
              </span>
              <button
                type="button"
                onClick={() => onChange(DEFAULT_FILTERS)}
                className="rounded text-[11px] font-medium text-sky-400 transition-colors hover:text-sky-300 focus:outline-none focus-visible:ring-1 focus-visible:ring-zinc-600"
              >
                Reset
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Section({
  label,
  icon: Icon,
  children,
}: {
  label: string;
  icon: LucideIcon;
  children: React.ReactNode;
}) {
  return (
    <div className="px-3 py-2.5">
      <div className="mb-1.5 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
        <Icon className="h-3 w-3" />
        {label}
      </div>
      {children}
    </div>
  );
}

