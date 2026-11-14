import type { ReactNode, Ref } from "react";
import { Link } from "react-router-dom";
import { ChevronDown } from "lucide-react";
import { cn } from "../../utils/cn";
import {
  NavigationMenuContent,
  NavigationMenuItem,
  NavigationMenuTrigger,
} from "../ui/NavigationMenu";

/**
 * A top-bar section with two separate controls: the label is a plain link to
 * the section's page, and the chevron beside it is a button that opens a panel
 * of shortcuts (on click, hover or ArrowDown). The label used to open the
 * panel on hover as well, which testers missed and then clicked expecting a
 * menu (F1V-2). Phones hide the chevron and the panel and keep the link.
 */
export function NavSection({
  value,
  to,
  label,
  active,
  itemRef,
  children,
}: {
  value: string;
  to: string;
  label: string;
  active: boolean;
  /** The whole item, which the shared popup anchors to so it opens under the label. */
  itemRef: Ref<HTMLLIElement>;
  children: ReactNode;
}) {
  return (
    <NavigationMenuItem
      ref={itemRef}
      value={value}
      className="flex items-center"
    >
      {/* pointer-events-auto: while a panel is open from hover, Base UI's
          safe triangle sets `pointer-events: none` on the whole list and
          exempts only the trigger, which would swallow clicks on the label. */}
      <Link
        to={to}
        aria-current={active ? "page" : undefined}
        className={cn(
          "pointer-events-auto rounded-lg py-1.5 pr-1 pl-2 text-sm outline-none transition-colors focus-visible:ring-1 focus-visible:ring-tone-600 max-sm:pr-2",
          active
            ? "font-medium text-tone-50"
            : "text-tone-400 hover:text-tone-100",
        )}
      >
        {label}
      </Link>
      <NavigationMenuTrigger
        aria-label={`${label} shortcuts`}
        className="group grid size-6 place-items-center rounded-md text-tone-500 outline-none transition-colors hover:bg-tone-900 hover:text-tone-200 focus-visible:ring-1 focus-visible:ring-tone-600 data-popup-open:bg-tone-900 data-popup-open:text-tone-200 max-sm:hidden"
      >
        <ChevronDown
          aria-hidden
          className="size-3.5 transition-transform group-data-popup-open:rotate-180"
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
