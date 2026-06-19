import { getCompoundColor } from "../../utils/colors";
import { cn } from "../../utils/cn";

export function CompoundSwatchLabel({
  compound,
  size = "sm",
  className,
  labelClassName,
}: {
  compound: string;
  size?: "xs" | "sm";
  className?: string;
  labelClassName?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex min-w-0 items-center gap-1.5",
        size === "xs" ? "text-2xs" : "text-xs",
        className,
      )}
    >
      <span
        className={cn(
          "inline-block shrink-0 rounded-full",
          size === "xs" ? "size-2" : "size-2.5",
        )}
        style={{ backgroundColor: getCompoundColor(compound) }}
      />
      <span className={cn("truncate text-zinc-300", labelClassName)}>
        {compound}
      </span>
    </span>
  );
}
