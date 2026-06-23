import type { ComponentPropsWithoutRef } from "react";
import { cn } from "../../utils/cn";

type ScrollAxis = "x" | "y" | "both";
type ScrollTone = "default" | "subtle";
type ScrollGutter = "auto" | "stable" | "both";

export const scrollAxisClass: Record<ScrollAxis, string> = {
  x: "overflow-x-auto",
  y: "overflow-y-auto",
  both: "overflow-auto",
};

export const scrollbarClass: Record<ScrollTone, string> = {
  default:
    "scrollbar-thin scrollbar-thumb-zinc-800 scrollbar-track-transparent hover:scrollbar-thumb-zinc-700",
  subtle:
    "scrollbar-thin scrollbar-thumb-white/[0.06] scrollbar-track-transparent hover:scrollbar-thumb-white/[0.12]",
};

export const scrollbarGutterClass: Record<ScrollGutter, string> = {
  auto: "",
  stable: "scrollbar-gutter-stable",
  both: "scrollbar-gutter-both",
};

type ScrollAreaProps = ComponentPropsWithoutRef<"div"> & {
  axis?: ScrollAxis;
  tone?: ScrollTone;
  gutter?: ScrollGutter;
};

export function ScrollArea({
  axis = "y",
  tone = "default",
  gutter = "auto",
  className,
  ...props
}: ScrollAreaProps) {
  return (
    <div
      className={cn(
        scrollAxisClass[axis],
        scrollbarClass[tone],
        scrollbarGutterClass[gutter],
        className,
      )}
      {...props}
    />
  );
}
