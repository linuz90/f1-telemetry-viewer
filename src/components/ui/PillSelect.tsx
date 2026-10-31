import type { ReactNode } from "react";
import { Select } from "@base-ui/react/select";
import { cva } from "class-variance-authority";
import { Check, ChevronDown, type LucideIcon } from "lucide-react";
import { cn } from "../../utils/cn";
import { menuItemClass, menuSurfaceClass, popMotionClass } from "./surfaces";
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
  /** Consecutive options with the same group render under one heading. */
  group?: string;
}

const triggerVariants = cva(
  cn(FORM_CONTROL_CHROME_STYLES, "flex items-center gap-2 text-left"),
  {
    variants: {
      size: {
        sm: cn(FORM_CONTROL_SIZE_STYLES.sm.control, "px-2.5"),
        md: cn(FORM_CONTROL_SIZE_STYLES.md.control, "px-3"),
      },
    },
    defaultVariants: { size: "md" },
  },
);

const renderOption = (option: PillSelectOption) => (
  <Select.Item
    key={String(option.value)}
    value={String(option.value)}
    label={option.label}
    disabled={option.disabled}
    className={cn(menuItemClass, "text-xs text-tone-300")}
  >
    <Select.ItemText className="min-w-0 flex-1">{option.label}</Select.ItemText>
    <Select.ItemIndicator>
      <Check aria-hidden className="size-3.5" />
    </Select.ItemIndicator>
  </Select.Item>
);

function renderOptions(options: readonly PillSelectOption[]) {
  const out: ReactNode[] = [];
  for (let i = 0; i < options.length; ) {
    const group = options[i].group;
    if (!group) {
      out.push(renderOption(options[i++]));
      continue;
    }
    const members: PillSelectOption[] = [];
    while (i < options.length && options[i].group === group)
      members.push(options[i++]);
    out.push(
      <Select.Group key={`group-${group}-${i}`}>
        <Select.GroupLabel className="px-2.5 pt-2 pb-1 text-2xs font-medium text-tone-500">
          {group}
        </Select.GroupLabel>
        {members.map(renderOption)}
      </Select.Group>,
    );
  }
  return out;
}

export type PillSelectWidth = FormControlWidth;
export type PillSelectSize = FormControlSize;

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
  return (
    <Select.Root
      value={String(value)}
      onValueChange={(next) => next !== null && onChange(next)}
      items={options.map((option) => ({
        value: String(option.value),
        label: option.label,
      }))}
    >
      <span
        className={cn(
          FORM_CONTROL_CONTAINER_STYLES,
          FORM_CONTROL_WIDTH_STYLES[width],
          className,
        )}
      >
        <Select.Trigger
          aria-label={ariaLabel}
          className={triggerVariants({ size })}
        >
          {LeadingIcon ? (
            <LeadingIcon
              aria-hidden
              className="size-3 shrink-0 text-tone-500"
            />
          ) : (
            <span
              aria-hidden
              className="size-1.5 shrink-0 rounded-full bg-tone-500/60"
              style={{ backgroundColor: dotColor }}
            />
          )}
          <Select.Value className="min-w-0 flex-1 truncate" />
          <Select.Icon>
            <ChevronDown
              aria-hidden
              className="size-3 shrink-0 text-tone-500"
            />
          </Select.Icon>
        </Select.Trigger>
      </span>
      <Select.Portal>
        <Select.Positioner
          sideOffset={6}
          align="end"
          alignItemWithTrigger={false}
          className="z-50 outline-none"
        >
          <Select.Popup
            className={cn(
              menuSurfaceClass,
              popMotionClass,
              "min-w-(--anchor-width) max-w-[min(24rem,calc(100vw-2rem))] outline-none",
            )}
          >
            <Select.List className="max-h-[min(24rem,calc(var(--available-height)-0.75rem))] overflow-y-auto">
              {renderOptions(options)}
            </Select.List>
          </Select.Popup>
        </Select.Positioner>
      </Select.Portal>
    </Select.Root>
  );
}
