import { cva } from "class-variance-authority";
import { forwardRef, type InputHTMLAttributes, type ReactNode } from "react";
import { cn } from "../../utils/cn";
import { FORM_CONTROL_SIZE_STYLES, type FormControlSize } from "./formControl";

export type InputSize = FormControlSize;

const inputVariants = cva(
  "w-full min-w-0 border border-tone-800/80 bg-tone-950/70 text-tone-200 outline-none transition-colors placeholder:text-tone-600 hover:border-tone-700 focus:border-tone-600 focus:ring-1 focus:ring-tone-600/50 disabled:cursor-not-allowed disabled:opacity-50",
  {
    variants: {
      size: {
        sm: cn(
          FORM_CONTROL_SIZE_STYLES.sm.control,
          FORM_CONTROL_SIZE_STYLES.sm.yPadding,
          "px-2.5",
        ),
        md: cn(
          FORM_CONTROL_SIZE_STYLES.md.control,
          FORM_CONTROL_SIZE_STYLES.md.yPadding,
          "px-3",
        ),
      },
      left: { true: "" },
      right: { true: "" },
    },
    compoundVariants: [
      { size: "sm", left: true, class: "pl-7" },
      { size: "md", left: true, class: "pl-8" },
      { size: "sm", right: true, class: "pr-7" },
      { size: "md", right: true, class: "pr-8" },
    ],
  },
);
const adornmentVariants = cva("absolute top-1/2 -translate-y-1/2", {
  variants: {
    size: { sm: "size-3 [&>svg]:size-full", md: "size-3.5 [&>svg]:size-full" },
    side: { left: "pointer-events-none text-tone-600", right: "text-tone-500" },
  },
  compoundVariants: [
    { size: "sm", side: "left", class: "left-2.5" },
    { size: "md", side: "left", class: "left-3" },
    { size: "sm", side: "right", class: "right-2" },
    { size: "md", side: "right", class: "right-2.5" },
  ],
});

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
  return (
    <span className={cn("relative block min-w-0", containerClassName)}>
      {leftAdornment && (
        <span className={cn(adornmentVariants({ size, side: "left" }))}>
          {leftAdornment}
        </span>
      )}
      <input
        ref={ref}
        className={cn(
          inputVariants({
            size,
            left: !!leftAdornment,
            right: !!rightAdornment,
          }),
          className,
        )}
        {...props}
      />
      {rightAdornment && (
        <span className={cn(adornmentVariants({ size, side: "right" }))}>
          {rightAdornment}
        </span>
      )}
    </span>
  );
});
