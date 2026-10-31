import type { ComponentProps, ReactNode } from "react";
import { cn } from "../../utils/cn";
import { SectionHeader } from "./SectionHeader";
import { cardClass } from "./surfaces";

/**
 * The card every page section sits in: `cardClass` with an optional header.
 * The header is a `SectionHeader`, so card titles read the same on session,
 * track and form pages.
 */
export function Panel({
  title,
  hint,
  action,
  className,
  children,
  ...props
}: Omit<ComponentProps<"section">, "title"> & {
  title?: ReactNode;
  hint?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <section {...props} className={cn(cardClass, className)}>
      {(title || action) && (
        <SectionHeader title={title} hint={hint} action={action} />
      )}
      {children}
    </section>
  );
}

/** Two panels side by side from `lg` up. */
export const panelGridClass = "grid gap-5 lg:grid-cols-2";
