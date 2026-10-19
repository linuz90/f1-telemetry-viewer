import { ChevronDown } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "../../utils/cn";

/**
 * Button that shows or hides a section, with a chevron that turns when open.
 * Callers style the label; the chevron and expanded state stay consistent.
 */
export function DisclosureToggle({
  open,
  onOpenChange,
  controls,
  className,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Id of the element this toggle shows or hides. */
  controls?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-expanded={open}
      aria-controls={controls}
      onClick={() => onOpenChange(!open)}
      className={cn(
        "group inline-flex items-center gap-1.5 rounded-md text-left transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-zinc-600",
        className,
      )}
    >
      {children}
      <ChevronDown
        aria-hidden
        className={cn(
          "size-4 shrink-0 text-zinc-500 transition-transform group-hover:text-zinc-300",
          open && "rotate-180",
        )}
      />
    </button>
  );
}
