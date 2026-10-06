import { Check } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "../../utils/cn";

/**
 * Checkbox row for dropdowns that toggle several options. A toggle button,
 * not a `menuitemcheckbox`: the dropdowns have no arrow-key menu navigation.
 */
export function CheckboxMenuItem({
  checked,
  onToggle,
  disabled,
  children,
}: {
  checked: boolean;
  onToggle: () => void;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={checked}
      disabled={disabled}
      onClick={onToggle}
      className={cn(
        "flex w-full items-center gap-2.5 px-3 py-2 text-left text-xs transition-colors hover:bg-zinc-800/60",
        checked ? "text-zinc-100" : "text-zinc-400",
        disabled && "cursor-not-allowed opacity-40",
      )}
    >
      <span
        className={cn(
          "flex size-3.5 shrink-0 items-center justify-center rounded-sm border",
          checked ? "border-zinc-500 bg-zinc-600" : "border-zinc-700",
        )}
      >
        {checked && <Check className="size-2 text-zinc-200" />}
      </span>
      <span className="truncate">{children}</span>
    </button>
  );
}
