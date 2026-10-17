import { ChevronDown } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { cn } from "../../utils/cn";
import { CheckboxMenuItem } from "./CheckboxMenuItem";
import {
  FORM_CONTROL_CHROME_STYLES,
  FORM_CONTROL_CONTAINER_STYLES,
  FORM_CONTROL_SIZE_STYLES,
  FORM_CONTROL_WIDTH_STYLES,
  type FormControlSize,
} from "./formControl";
import type { PillSelectOption, PillSelectWidth } from "./PillSelect";

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
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handlePointerDown(e: PointerEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    }
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [open]);

  const [allOption, ...typeOptions] = options;

  const triggerLabel = (() => {
    if (value.length === 0) return allOption?.label ?? "All types";
    if (value.length === 1) {
      const opt = typeOptions.find((o) => String(o.value) === value[0]);
      return opt?.label ?? value[0];
    }
    return `${value.length} types`;
  })();

  function toggle(optValue: string) {
    if (value.includes(optValue)) {
      onChange(value.filter((v) => v !== optValue));
    } else {
      onChange([...value, optValue]);
    }
  }

  const styles = FORM_CONTROL_SIZE_STYLES[size];

  return (
    <div
      ref={containerRef}
      className={cn(
        FORM_CONTROL_CONTAINER_STYLES,
        FORM_CONTROL_WIDTH_STYLES[width],
        className,
      )}
    >
      <button
        type="button"
        aria-label={ariaLabel}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={cn(
          FORM_CONTROL_CHROME_STYLES,
          "flex items-center justify-between gap-2 px-3",
          styles.control,
        )}
      >
        <span className="truncate">{triggerLabel}</span>
        <ChevronDown className="size-3 shrink-0 text-zinc-500" />
      </button>

      {open && (
        <div className="absolute right-0 top-full z-50 mt-1 w-full min-w-[12rem] overflow-hidden rounded-md border border-zinc-800 bg-zinc-900 py-1 shadow-lg shadow-black/20">
          <CheckboxMenuItem
            checked={value.length === 0}
            onToggle={() => onChange([])}
          >
            {allOption?.label}
          </CheckboxMenuItem>

          <div className="my-1 h-px bg-zinc-800" />

          {typeOptions.map((option) => (
            <CheckboxMenuItem
              key={String(option.value)}
              checked={value.includes(String(option.value))}
              disabled={option.disabled}
              onToggle={() => toggle(String(option.value))}
            >
              {option.label}
            </CheckboxMenuItem>
          ))}
        </div>
      )}
    </div>
  );
}
