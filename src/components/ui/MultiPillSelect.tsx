import { Fragment } from "react";
import { Select } from "@base-ui/react/select";
import { cva } from "class-variance-authority";
import { Check, ChevronDown } from "lucide-react";
import { cn } from "../../utils/cn";
import { menuItemClass, menuSurfaceClass, popMotionClass } from "./surfaces";
import {
  FORM_CONTROL_CHROME_STYLES,
  FORM_CONTROL_CONTAINER_STYLES,
  FORM_CONTROL_SIZE_STYLES,
  FORM_CONTROL_WIDTH_STYLES,
  type FormControlSize,
} from "./formControl";
import type { PillSelectOption, PillSelectWidth } from "./PillSelect";

const triggerVariants = cva(
  cn(
    FORM_CONTROL_CHROME_STYLES,
    "flex items-center justify-between gap-2 px-3",
  ),
  {
    variants: {
      size: {
        sm: FORM_CONTROL_SIZE_STYLES.sm.control,
        md: FORM_CONTROL_SIZE_STYLES.md.control,
      },
    },
    defaultVariants: { size: "md" },
  },
);

export function MultiPillSelect({
  value,
  onChange,
  options,
  ariaLabel,
  width = "auto",
  size = "md",
  className,
}: {
  value: string[];
  onChange: (value: string[]) => void;
  options: readonly PillSelectOption[];
  ariaLabel: string;
  width?: PillSelectWidth;
  size?: FormControlSize;
  className?: string;
}) {
  const [allOption, ...typeOptions] = options;
  const allValue = String(allOption?.value ?? "");
  const triggerLabel =
    value.length === 0
      ? (allOption?.label ?? "All types")
      : value.length === 1
        ? (typeOptions.find((option) => String(option.value) === value[0])
            ?.label ?? value[0])
        : `${value.length} types`;

  return (
    <Select.Root
      multiple
      value={value.length ? value : [allValue]}
      // The first option resets the filter; it is not a type to combine.
      onValueChange={(next) =>
        onChange(
          value.length > 0 && next.includes(allValue)
            ? []
            : next.filter((entry) => entry !== allValue),
        )
      }
    >
      <div
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
          <span className="truncate">{triggerLabel}</span>
          <Select.Icon>
            <ChevronDown
              aria-hidden
              className="size-3 shrink-0 text-tone-500"
            />
          </Select.Icon>
        </Select.Trigger>
      </div>
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
              "min-w-[max(12rem,var(--anchor-width))] max-w-[calc(100vw-2rem)] outline-none",
            )}
          >
            <Select.List className="max-h-[min(24rem,calc(var(--available-height)-0.75rem))] overflow-y-auto">
              {options.map((option, index) => (
                <Fragment key={String(option.value)}>
                  {index === 1 && (
                    <Select.Separator className="my-1 h-px bg-tone-800" />
                  )}
                  <Select.Item
                    value={String(option.value)}
                    label={option.label}
                    disabled={option.disabled}
                    className={cn(menuItemClass, "text-xs text-tone-300")}
                  >
                    <span className="flex size-3.5 shrink-0 items-center justify-center">
                      <Select.ItemIndicator>
                        <Check aria-hidden className="size-3.5" />
                      </Select.ItemIndicator>
                    </span>
                    <Select.ItemText>{option.label}</Select.ItemText>
                  </Select.Item>
                </Fragment>
              ))}
            </Select.List>
          </Select.Popup>
        </Select.Positioner>
      </Select.Portal>
    </Select.Root>
  );
}
