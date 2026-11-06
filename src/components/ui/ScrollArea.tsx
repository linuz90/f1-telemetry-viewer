import { cva } from "class-variance-authority";
import type { ComponentProps } from "react";
import { cn } from "../../utils/cn";

type ScrollAxis = "x" | "y" | "both";
type ScrollTone = "default" | "subtle";
type ScrollGutter = "auto" | "stable" | "both";

const scrollVariants = cva("", {
  variants: {
    axis: { x: "overflow-x-auto", y: "overflow-y-auto", both: "overflow-auto" },
    tone: {
      default:
        "scrollbar-thin scrollbar-thumb-tone-800 scrollbar-track-transparent hover:scrollbar-thumb-tone-700",
      subtle:
        "scrollbar-thin scrollbar-thumb-tone-0/[0.06] scrollbar-track-transparent hover:scrollbar-thumb-tone-0/[0.12]",
    },
    gutter: {
      auto: "",
      stable: "scrollbar-gutter-stable",
      both: "scrollbar-gutter-both",
    },
  },
});

// Standalone scrollers share the variants without needing a wrapper element.
export const scrollAxisClass = {
  x: scrollVariants({ axis: "x" }),
  y: scrollVariants({ axis: "y" }),
  both: scrollVariants({ axis: "both" }),
};
export const scrollbarClass = {
  default: scrollVariants({ tone: "default" }),
  subtle: scrollVariants({ tone: "subtle" }),
};
export const scrollbarGutterClass = {
  auto: scrollVariants({ gutter: "auto" }),
  stable: scrollVariants({ gutter: "stable" }),
  both: scrollVariants({ gutter: "both" }),
};

type ScrollAreaProps = ComponentProps<"div"> & {
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
      className={cn(scrollVariants({ axis, tone, gutter }), className)}
      {...props}
    />
  );
}
