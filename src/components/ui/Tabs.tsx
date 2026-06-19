import { cn } from "../../utils/cn";

export interface TabOption<T extends string = string> {
  value: T;
  label: string;
}

interface Props<T extends string> {
  options: readonly TabOption<T>[];
  value: T;
  onChange: (next: T) => void;
  ariaLabel?: string;
  className?: string;
}

/**
 * Underline tab strip — uppercase eyebrow labels with an active underline.
 * Distinct from `SegmentedControl` (pill style); use when tabs sit flush at
 * the top of a panel/sidebar and need to read as section navigation.
 */
export function Tabs<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
  className,
}: Props<T>) {
  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className={cn("flex", className)}
    >
      {options.map((opt) => {
        const active = value === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(opt.value)}
            className={cn(
              "flex-1 pb-2 font-mono text-2xs font-semibold uppercase tracking-wider transition-colors",
              active
                ? "text-white border-b-2 border-white"
                : "text-zinc-500 hover:text-zinc-300",
            )}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
