import { forwardRef, type InputHTMLAttributes, type ReactNode } from "react";
import { cn } from "../../utils/cn";
import { FORM_CONTROL_SIZE_STYLES, type FormControlSize } from "./formControl";

export type InputSize = FormControlSize;

const SIZE: Record<
  InputSize,
  {
    input: string;
    leftAdornment: string;
    leftPadding: string;
    rightAdornment: string;
    rightPadding: string;
  }
> = {
  sm: {
    input: cn(
      FORM_CONTROL_SIZE_STYLES.sm.control,
      FORM_CONTROL_SIZE_STYLES.sm.yPadding,
      "px-2.5",
    ),
    leftAdornment: "left-2.5 size-3 [&>svg]:size-full",
    leftPadding: "pl-7",
    rightAdornment: "right-2 size-3 [&>svg]:size-full",
    rightPadding: "pr-7",
  },
  md: {
    input: cn(
      FORM_CONTROL_SIZE_STYLES.md.control,
      FORM_CONTROL_SIZE_STYLES.md.yPadding,
      "px-3",
    ),
    leftAdornment: "left-3 size-3.5 [&>svg]:size-full",
    leftPadding: "pl-8",
    rightAdornment: "right-2.5 size-3.5 [&>svg]:size-full",
    rightPadding: "pr-8",
  },
};

export interface InputProps extends Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "size"
> {
  size?: InputSize;
  leftAdornment?: ReactNode;
  rightAdornment?: ReactNode;
  containerClassName?: string;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  {
    size = "md",
    leftAdornment,
    rightAdornment,
    className,
    containerClassName,
    ...props
  },
  ref,
) {
  const styles = SIZE[size];

  return (
    <span className={cn("relative block min-w-0", containerClassName)}>
      {leftAdornment && (
        <span
          className={cn(
            "pointer-events-none absolute top-1/2 -translate-y-1/2 text-zinc-600",
            styles.leftAdornment,
          )}
        >
          {leftAdornment}
        </span>
      )}
      <input
        ref={ref}
        className={cn(
          "w-full min-w-0 border border-zinc-800/80 bg-zinc-950/70 text-zinc-200 outline-none transition-colors placeholder:text-zinc-600 hover:border-zinc-700 focus:border-zinc-600 focus:ring-1 focus:ring-zinc-600/50 disabled:cursor-not-allowed disabled:opacity-50",
          styles.input,
          leftAdornment && styles.leftPadding,
          rightAdornment && styles.rightPadding,
          className,
        )}
        {...props}
      />
      {rightAdornment && (
        <span
          className={cn(
            "absolute top-1/2 -translate-y-1/2 text-zinc-500",
            styles.rightAdornment,
          )}
        >
          {rightAdornment}
        </span>
      )}
    </span>
  );
});
