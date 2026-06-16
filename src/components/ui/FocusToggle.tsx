import { cn } from "../../utils/cn";

/**
 * "Focus driver only" toggle used above the qualifying and race results tables.
 * Tiny iOS-style switch with a fixed label.
 */
export function FocusToggle({
  value,
  onChange,
  label = "Focus driver only",
}: {
  value: boolean;
  onChange: () => void;
  label?: string;
}) {
  return (
    <label className="flex items-center gap-2 text-xs text-zinc-400 cursor-pointer select-none">
      {label}
      <button
        type="button"
        role="switch"
        aria-checked={value}
        onClick={onChange}
        className={cn(
          "relative inline-flex h-4 w-7 items-center rounded-full transition-colors",
          value ? "bg-cyan-600" : "bg-zinc-800",
        )}
      >
        <span
          className={cn(
            "inline-block h-3 w-3 rounded-full bg-white transition-transform",
            value ? "translate-x-3.5" : "translate-x-0.5",
          )}
        />
      </button>
    </label>
  );
}
