import { cva } from "class-variance-authority";
import type { ReactNode } from "react";
import { cn } from "../../utils/cn";

export type InsightValueSize = "sm" | "md" | "lg" | "xl";
export type InsightDetailSize = "xs" | "sm" | "md";

const valueVariants = cva("break-words tracking-tight", {
  variants: {
    size: {
      sm: "text-sm leading-snug font-semibold",
      md: "text-lg font-medium",
      lg: "text-xl font-medium",
      xl: "text-2xl font-medium",
    },
  },
});

const detailVariants = cva("break-words", {
  variants: {
    size: {
      xs: "text-2xs leading-snug",
      sm: "text-xs leading-relaxed",
      md: "text-sm leading-relaxed",
    },
  },
});

export function InsightValue({
  children,
  size = "lg",
  tone = "text-tone-100",
  className,
}: {
  children: ReactNode;
  size?: InsightValueSize;
  tone?: string;
  className?: string;
}) {
  return (
    <div className={cn(valueVariants({ size }), tone, className)}>
      {children}
    </div>
  );
}

export function InsightDetail({
  children,
  size = "md",
  tone = "text-tone-400",
  className,
}: {
  children: ReactNode;
  size?: InsightDetailSize;
  tone?: string;
  className?: string;
}) {
  return (
    <div className={cn(detailVariants({ size }), tone, className)}>
      {children}
    </div>
  );
}
