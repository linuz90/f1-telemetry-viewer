import type { ReactNode } from "react";
import { cn } from "../../utils/cn";

export type InsightValueSize = "sm" | "md" | "lg" | "xl";
export type InsightDetailSize = "xs" | "sm" | "md";

const VALUE_SIZE: Record<InsightValueSize, string> = {
  sm: "text-sm leading-snug font-semibold",
  md: "text-lg font-medium",
  lg: "text-xl font-medium",
  xl: "text-2xl font-medium",
};

const DETAIL_SIZE: Record<InsightDetailSize, string> = {
  xs: "text-2xs leading-snug",
  sm: "text-xs leading-relaxed",
  md: "text-sm leading-relaxed",
};

export function InsightValue({
  children,
  size = "lg",
  tone = "text-zinc-100",
  className,
}: {
  children: ReactNode;
  size?: InsightValueSize;
  tone?: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "break-words font-mono tabular-nums",
        VALUE_SIZE[size],
        tone,
        className,
      )}
    >
      {children}
    </div>
  );
}

export function InsightDetail({
  children,
  size = "md",
  tone = "text-zinc-400",
  className,
}: {
  children: ReactNode;
  size?: InsightDetailSize;
  tone?: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "break-words font-mono tabular-nums",
        DETAIL_SIZE[size],
        tone,
        className,
      )}
    >
      {children}
    </div>
  );
}
