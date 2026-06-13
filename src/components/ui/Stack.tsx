import type { ComponentPropsWithoutRef, ElementType, ReactNode } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../../utils/cn";

// `min-w-0` is part of the primitive because most app rows live inside cards,
// sidebars, or grids where overflowing text should shrink instead of stretching
// the whole layout. Custom spacing stays as Tailwind in className so call sites
// do not need to learn a parallel gap scale.
const hstackVariants = cva(
  "flex min-w-0 flex-row flex-nowrap items-center gap-2",
  {
    variants: {
      align: {
        start: "items-start",
        center: "items-center",
        end: "items-end",
        stretch: "items-stretch",
        baseline: "items-baseline",
      },
      justify: {
        start: "justify-start",
        center: "justify-center",
        end: "justify-end",
        between: "justify-between",
      },
      wrap: {
        true: "flex-wrap",
      },
    },
    defaultVariants: {
      justify: "start",
    },
  },
);

const vstackVariants = cva("flex min-w-0 flex-col items-stretch gap-4", {
  variants: {
    align: {
      start: "items-start",
      center: "items-center",
      end: "items-end",
      stretch: "items-stretch",
      baseline: "items-baseline",
    },
    justify: {
      start: "justify-start",
      center: "justify-center",
      end: "justify-end",
      between: "justify-between",
    },
  },
  defaultVariants: {
    justify: "start",
  },
});

type HStackVariants = VariantProps<typeof hstackVariants>;
type VStackVariants = VariantProps<typeof vstackVariants>;

type StackProps<T extends ElementType, Variants> = {
  as?: T;
  children?: ReactNode;
  className?: string;
} & Variants &
  Omit<
    ComponentPropsWithoutRef<T>,
    "as" | "className" | "children" | "align" | "justify" | "wrap"
  >;

export function HStack<T extends ElementType = "div">({
  as,
  align,
  justify,
  wrap,
  className,
  children,
  ...props
}: StackProps<T, HStackVariants>) {
  const Component = as ?? "div";

  return (
    <Component
      className={cn(hstackVariants({ align, justify, wrap }), className)}
      {...props}
    >
      {children}
    </Component>
  );
}

export function VStack<T extends ElementType = "div">({
  as,
  align,
  justify,
  className,
  children,
  ...props
}: StackProps<T, VStackVariants>) {
  const Component = as ?? "div";

  return (
    <Component
      className={cn(vstackVariants({ align, justify }), className)}
      {...props}
    >
      {children}
    </Component>
  );
}
