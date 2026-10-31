import { cva } from "class-variance-authority";
import type { ReactNode } from "react";
import { cn } from "../../utils/cn";

/**
 * The one header for every titled block, sized by what it heads:
 * - `lg`: a page section spanning several cards (Tyre life, Sessions).
 * - `md`: one card's title, inside it or directly above it (Worth a look).
 *   `Panel` renders it, and components that sit inside a bare `Panel` render
 *   it themselves so the two read the same.
 * - `sm`: a subsection inside a card (Damage, Classification).
 */
const headerVariants = cva(
  "flex flex-wrap items-start justify-between gap-x-3 gap-y-2",
  {
    variants: { size: { lg: "mb-3", md: "mb-3", sm: "mb-2" } },
  },
);
const titleVariants = cva("", {
  variants: {
    size: {
      lg: "text-lg font-semibold tracking-tight text-tone-50",
      md: "font-semibold text-tone-50",
      sm: "text-sm font-semibold text-tone-300",
    },
  },
});
const hintVariants = cva("mt-0.5 text-tone-500", {
  variants: { size: { lg: "text-sm", md: "text-xs", sm: "text-xs" } },
});

export function SectionHeader({
  title,
  hint,
  action,
  size = "md",
  className,
}: {
  title?: ReactNode;
  hint?: ReactNode;
  action?: ReactNode;
  size?: "lg" | "md" | "sm";
  className?: string;
}) {
  const Tag = size === "sm" ? "h3" : "h2";

  return (
    <div className={cn(headerVariants({ size }), className)}>
      <div className="min-w-0">
        {title && <Tag className={titleVariants({ size })}>{title}</Tag>}
        {hint && <p className={hintVariants({ size })}>{hint}</p>}
      </div>
      {action}
    </div>
  );
}
