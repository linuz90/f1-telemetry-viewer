import { useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { SlidersHorizontal, type LucideIcon } from "lucide-react";
import {
  DEFAULT_FILTERS,
  type SessionListFilters,
  type SessionModeFilter,
  type SessionTypeFilter,
} from "../hooks/useSessionFilters";
import { cn } from "../utils/cn";
import { SESSION_MODE_META } from "./sessionModeMeta";
import { SESSION_TYPE_FILTER_META } from "./sessionTypeMeta";
import { SegmentedControl } from "./ui/SegmentedControl";
import { HStack } from "./ui/Stack";

interface Props {
  value: SessionListFilters;
  onChange: (next: SessionListFilters) => void;
}

function countActive(value: SessionListFilters): number {
  let n = 0;
  if (value.type !== DEFAULT_FILTERS.type) n += 1;
  if (value.mode !== DEFAULT_FILTERS.mode) n += 1;
  return n;
}

function getButtonIcon(value: SessionListFilters): {
  icon: LucideIcon;
  label: string;
} {
  if (value.type !== "all") {
    const meta = SESSION_TYPE_FILTER_META[value.type];
    return { icon: meta.icon, label: meta.buttonLabel };
  }
  if (value.mode !== "all") {
    const meta = SESSION_MODE_META[value.mode];
    return { icon: meta.icon, label: meta.buttonLabel };
  }
  return { icon: SlidersHorizontal, label: "Filters" };
}

const SessionTypeIcon = SESSION_TYPE_FILTER_META.race.icon;
const ModeIcon = SESSION_MODE_META.ai.icon;

export function SessionListFilterMenu({ value, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const location = useLocation();

  const activeCount = countActive(value);
  const buttonIcon = getButtonIcon(value);
  const ButtonIcon = buttonIcon.icon;

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
        aria-label={
          activeCount > 0
            ? `${buttonIcon.label}, ${activeCount} active`
            : buttonIcon.label
        }
        aria-expanded={open}
        className={cn(
          "relative flex items-center justify-center rounded-md p-1.5 transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-zinc-600",
          open || !isDefault
            ? "bg-zinc-900 text-zinc-200"
            : "text-zinc-500 hover:bg-zinc-900/60 hover:text-zinc-300",
        )}
      >
        <ButtonIcon className="h-3.5 w-3.5" />
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Session filters"
          className="absolute right-0 top-full z-20 mt-1.5 w-56 max-w-[calc(100vw-2rem)] rounded-xl bg-zinc-950 ring-1 ring-white/[0.06] shadow-xl divide-y divide-white/[0.05]"
        >
          <Section label="Session type" icon={SessionTypeIcon}>
            <SegmentedControl<SessionTypeFilter>
              size="sm"
              fullWidth
              options={[
                { value: "all", label: "All" },
                {
                  value: "race",
                  label: SESSION_TYPE_FILTER_META.race.label,
                },
                {
                  value: "quali",
                  label: SESSION_TYPE_FILTER_META.quali.label,
                },
                {
                  value: "tt",
                  label: SESSION_TYPE_FILTER_META.tt.label,
                },
              ]}
              value={value.type}
              onChange={(type) => onChange({ ...value, type })}
            />
          </Section>

          <Section label="Mode" icon={ModeIcon}>
            <SegmentedControl<SessionModeFilter>
              size="sm"
              fullWidth
              options={[
                { value: "all", label: "All" },
                { value: "ai", label: SESSION_MODE_META.ai.label },
                { value: "online", label: SESSION_MODE_META.online.label },
              ]}
              value={value.mode}
              onChange={(mode) => onChange({ ...value, mode })}
            />
          </Section>

          {!isDefault && (
            <HStack justify="between" className="px-3 py-2">
              <span className="text-xs text-zinc-500">
                {activeCount} {activeCount === 1 ? "filter" : "filters"} active
              </span>
              <button
                type="button"
                onClick={() => onChange(DEFAULT_FILTERS)}
                className="rounded text-xs font-medium text-sky-400 transition-colors hover:text-sky-300 focus:outline-none focus-visible:ring-1 focus-visible:ring-zinc-600"
              >
                Reset
              </button>
            </HStack>
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
      <HStack className="mb-1.5 gap-1.5 font-mono text-2xs font-semibold uppercase tracking-wider text-zinc-500">
        <Icon className="h-3 w-3" />
        {label}
      </HStack>
      {children}
    </div>
  );
}
