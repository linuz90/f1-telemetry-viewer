import { ChevronDown } from "lucide-react";
import { cn } from "../../utils/cn";

export type PillSelectValue = string | number;

export interface PillSelectOption {
  value: PillSelectValue;
  label: string;
  disabled?: boolean;
}

export type PillSelectWidth = "auto" | "compact" | "session" | "full";
export type PillSelectSize = "sm" | "md";

const WIDTH: Record<PillSelectWidth, string> = {
  auto: "w-auto",
  compact: "w-[min(15rem,calc(100vw-3rem))]",
  session: "w-[min(20rem,calc(100vw-3rem))]",
  full: "w-full",
};

const SIZE: Record<
  PillSelectSize,
  { dot: string; icon: string; select: string }
> = {
  sm: {
    dot: "left-2.5 size-1.5",
    icon: "right-2 size-3",
    select: "h-6.5 rounded-md py-1 pl-6 pr-7 text-2xs",
  },
  md: {
    dot: "left-3 size-1.5",
    icon: "right-2.5 size-3",
    select: "h-7.5 rounded-lg py-1.5 pl-6.5 pr-8 text-xs",
  },
};

export function PillSelect({
  value,
  onChange,
  options,
  ariaLabel,
  dotColor,
  width = "auto",
  size = "md",
  className,
}: {
  value: PillSelectValue;
  onChange: (value: string) => void;
  options: readonly PillSelectOption[];
  ariaLabel: string;
  dotColor?: string;
  width?: PillSelectWidth;
  size?: PillSelectSize;
  className?: string;
}) {
  const styles = SIZE[size];
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
        className={cn(
          "pointer-events-none absolute rounded-full bg-zinc-500/60",
          styles.dot,
        )}
        style={{ backgroundColor: dotColor }}
      />
      <select
        value={String(value)}
        onChange={(event) => onChange(event.target.value)}
        aria-label={ariaLabel}
        className={cn(
          "w-full min-w-0 appearance-none border border-zinc-800/80 bg-zinc-900/70 font-medium outline-none transition-colors hover:border-zinc-700 focus:ring-1 focus:ring-zinc-500/40",
          styles.select,
        )}
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
      <ChevronDown
        className={cn(
          "pointer-events-none absolute text-zinc-500",
          styles.icon,
        )}
      />
    </span>
  );
}
