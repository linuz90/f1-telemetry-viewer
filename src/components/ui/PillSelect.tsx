import { ChevronDown } from "lucide-react";
import { cn } from "../../utils/cn";

export type PillSelectValue = string | number;

export interface PillSelectOption {
  value: PillSelectValue;
  label: string;
  disabled?: boolean;
}

type PillSelectWidth = "auto" | "session" | "full";

const WIDTH: Record<PillSelectWidth, string> = {
  auto: "w-auto",
  session: "w-[min(20rem,calc(100vw-3rem))]",
  full: "w-full",
};

export function PillSelect({
  value,
  onChange,
  options,
  ariaLabel,
  dotColor,
  width = "auto",
  className,
}: {
  value: PillSelectValue;
  onChange: (value: string) => void;
  options: readonly PillSelectOption[];
  ariaLabel: string;
  dotColor?: string;
  width?: PillSelectWidth;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "relative inline-flex min-w-0 max-w-full items-center",
        "text-zinc-200",
        WIDTH[width],
        className,
      )}
    >
      <span
        className="pointer-events-none absolute left-3 size-1.5 rounded-full bg-zinc-500/60"
        style={{ backgroundColor: dotColor }}
      />
      <select
        value={String(value)}
        onChange={(event) => onChange(event.target.value)}
        aria-label={ariaLabel}
        className="h-7.5 w-full min-w-0 appearance-none rounded-lg border border-zinc-800/80 bg-zinc-900/70 py-1.5 pl-6.5 pr-8 text-xs font-medium outline-none transition-colors hover:border-zinc-700 focus:ring-1 focus:ring-zinc-500/40"
      >
        {options.map((option) => (
          <option
            key={String(option.value)}
            value={String(option.value)}
            disabled={option.disabled}
          >
            {option.label}
          </option>
        ))}
      </select>
      <ChevronDown className="pointer-events-none absolute right-2.5 size-3 text-zinc-500" />
    </span>
  );
}
