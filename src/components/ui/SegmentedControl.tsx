export interface SegmentedOption<T extends string = string> {
  value: T;
  label: string;
}

interface Props<T extends string> {
  options: readonly SegmentedOption<T>[];
  value: T;
  onChange: (next: T) => void;
  /** "sm" is used in compact menus; "md" is the default for page-level controls. */
  size?: "sm" | "md";
  ariaLabel?: string;
  /** Stretch buttons equally to fill the container width. */
  fullWidth?: boolean;
  /** Allow horizontal scrolling when content overflows. */
  scrollable?: boolean;
  className?: string;
}

const SIZE = {
  sm: { container: "gap-0.5 p-0.5", button: "px-2 py-1 text-[11px]" },
  md: { container: "gap-1 p-1", button: "px-3 py-1.5 text-xs" },
} as const;

export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  size = "md",
  ariaLabel,
  fullWidth = false,
  scrollable = false,
  className,
}: Props<T>) {
  const styles = SIZE[size];
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className={`flex rounded-lg bg-zinc-900/60 ${styles.container}${scrollable ? " max-w-full overflow-x-auto" : ""}${className ? ` ${className}` : ""}`}
    >
      {options.map((opt) => {
        const active = value === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(opt.value)}
            className={`rounded-md font-medium transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-zinc-600 ${styles.button} ${
              fullWidth ? "flex-1" : "shrink-0"
            } ${active ? "bg-zinc-800 text-zinc-100" : "text-zinc-500 hover:text-zinc-300"}`}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
