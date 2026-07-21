import { ChevronDown, type LucideIcon } from "lucide-react";
import { cn } from "../../utils/cn";
import {
  FORM_CONTROL_CHROME_STYLES,
  FORM_CONTROL_CONTAINER_STYLES,
  FORM_CONTROL_SIZE_STYLES,
  FORM_CONTROL_WIDTH_STYLES,
  type FormControlSize,
  type FormControlWidth,
} from "./formControl";

export type PillSelectValue = string | number;

export interface PillSelectOption {
  value: PillSelectValue;
  label: string;
  disabled?: boolean;
}

export type PillSelectWidth = FormControlWidth;
export type PillSelectSize = FormControlSize;

const SIZE: Record<
  PillSelectSize,
  { indicator: string; dot: string; icon: string; select: string }
> = {
  sm: {
    indicator: "left-2.5",
    dot: "size-1.5",
    icon: "right-2 size-3",
    select: cn(
      FORM_CONTROL_SIZE_STYLES.sm.control,
      FORM_CONTROL_SIZE_STYLES.sm.yPadding,
      "pl-6 pr-7",
    ),
  },
  md: {
    indicator: "left-3",
    dot: "size-1.5",
    icon: "right-2.5 size-3",
    select: cn(
      FORM_CONTROL_SIZE_STYLES.md.control,
      FORM_CONTROL_SIZE_STYLES.md.yPadding,
      "pl-6.5 pr-8",
    ),
  },
};

export function PillSelect({
  value,
  onChange,
  options,
  ariaLabel,
  dotColor,
  leadingIcon: LeadingIcon,
  width = "auto",
  size = "md",
  className,
}: {
  value: PillSelectValue;
  onChange: (value: string) => void;
  options: readonly PillSelectOption[];
  ariaLabel: string;
  dotColor?: string;
  /** Replaces the default color dot when set. */
  leadingIcon?: LucideIcon;
  width?: PillSelectWidth;
  size?: PillSelectSize;
  className?: string;
}) {
  const styles = SIZE[size];
  return (
    <span
      className={cn(
        FORM_CONTROL_CONTAINER_STYLES,
        "items-center",
        "text-zinc-200",
        FORM_CONTROL_WIDTH_STYLES[width],
        className,
      )}
    >
      {LeadingIcon ? (
        <LeadingIcon
          aria-hidden="true"
          className={cn(
            "pointer-events-none absolute size-3 text-zinc-500",
            styles.indicator,
          )}
        />
      ) : (
        <span
          className={cn(
            "pointer-events-none absolute rounded-full bg-zinc-500/60",
            styles.indicator,
            styles.dot,
          )}
          style={{ backgroundColor: dotColor }}
        />
      )}
      <select
        value={String(value)}
        onChange={(event) => onChange(event.target.value)}
        aria-label={ariaLabel}
        className={cn(
          FORM_CONTROL_CHROME_STYLES,
          "appearance-none",
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
