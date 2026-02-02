/** Base card styles shared across the app */
export const cardClass = "rounded-lg border border-zinc-800 bg-zinc-950 p-4";
export const cardClassCompact = "rounded-md border border-zinc-800 bg-zinc-950 p-3";

/**
 * Card — a simple container with the app's standard dark surface + subtle border.
 * Accepts all props that a `<div>` does; pass `as="section"` for semantic sections.
 */
export function Card({
  as: Tag = "div",
  className = "",
  children,
  ...rest
}: React.HTMLAttributes<HTMLElement> & { as?: "div" | "section" }) {
  return (
    <Tag className={`${cardClass} ${className}`} {...rest}>
      {children}
    </Tag>
  );
}
