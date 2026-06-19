import type { ButtonHTMLAttributes } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../../utils/cn";

export const buttonVariants = cva(
  "inline-flex items-center justify-center gap-1.5 whitespace-nowrap font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-zinc-600 disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        primary: "rounded-lg bg-red-600 text-white hover:bg-red-500",
        secondary:
          "rounded-lg bg-zinc-800 text-zinc-200 hover:bg-zinc-700 hover:text-zinc-100",
        subtle:
          "rounded-lg bg-zinc-900 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200",
        ghost:
          "rounded-md text-zinc-500 hover:bg-zinc-900/60 hover:text-zinc-200",
        danger: "rounded-lg bg-red-700/95 text-white hover:bg-red-600",
      },
      size: {
        xs: "px-2 py-1 text-xs",
        sm: "px-3 py-1.5 text-xs",
        md: "px-4 py-2 text-sm",
        icon: "size-8 p-1.5",
      },
    },
    defaultVariants: {
      variant: "secondary",
      size: "md",
    },
  },
);

export function Button({
  className,
  variant,
  size,
  type = "button",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof buttonVariants>) {
  return (
    <button
      type={type}
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    />
  );
}
