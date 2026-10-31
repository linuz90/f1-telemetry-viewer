import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { ChevronDown } from "lucide-react";
import { cn } from "../../utils/cn";
import {
  NavigationMenuContent,
  NavigationMenuItem,
  NavigationMenuTrigger,
} from "../ui/NavigationMenu";

/**
 * A top-bar section: the label is a link to the section's page, and hovering
 * it (or ArrowDown from the keyboard) opens a panel of shortcuts. Phones hide
 * the panel and keep the plain link.
 */
export function NavHoverMenu({
  to,
  label,
  active,
  children,
}: {
  to: string;
  label: string;
  active: boolean;
  children: ReactNode;
}) {
  return (
    <NavigationMenuItem>
      <NavigationMenuTrigger
        nativeButton={false}
        // Base UI marks a non-button trigger role="button"; this one is a link
        // first, so screen readers should announce it as one.
        role="link"
        render={<Link to={to} aria-current={active ? "page" : undefined} />}
        className={cn(
          "group inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-sm outline-none transition-colors focus-visible:ring-1 focus-visible:ring-tone-600",
          active
            ? "font-medium text-tone-50"
            : "text-tone-400 hover:text-tone-100",
        )}
      >
        {label}
        <ChevronDown
          aria-hidden
          className="size-3 text-tone-600 transition-transform group-data-popup-open:rotate-180 max-sm:hidden"
        />
      </NavigationMenuTrigger>
      <NavigationMenuContent>{children}</NavigationMenuContent>
    </NavigationMenuItem>
  );
}

export function MenuSection({ children }: { children: ReactNode }) {
  return (
    <div className="px-2.5 pt-2 pb-1 text-xs text-tone-500">{children}</div>
  );
}
