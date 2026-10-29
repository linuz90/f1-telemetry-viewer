import type { ReactNode } from "react";
import { NavLink } from "react-router-dom";
import { ChevronDown } from "lucide-react";
import { cn } from "../../utils/cn";

/**
 * A top-bar link that opens a quick menu after a short hover or on keyboard
 * focus, while a click still navigates. Pure CSS so there is no extra
 * dependency; touch screens (`hover: none`) and phone-width windows, where
 * the menu would not fit, never show it and just navigate.
 */
export function NavHoverMenu({
  to,
  label,
  active,
  children,
  align = "start",
}: {
  to: string;
  label: string;
  active: boolean;
  children: ReactNode;
  align?: "start" | "end";
}) {
  return (
    <div className="group/nav relative">
      <NavLink
        to={to}
        end
        className={cn(
          "inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-sm transition-colors",
          active
            ? "font-medium text-tone-50"
            : "text-tone-400 hover:text-tone-100",
        )}
      >
        {label}
        <ChevronDown
          aria-hidden
          className="size-3 text-tone-600 transition-transform group-hover/nav:rotate-180 max-sm:hidden"
        />
      </NavLink>
      <div
        className={cn(
          "invisible absolute top-full z-50 pt-2 opacity-0 transition-[opacity,visibility,translate] duration-150",
          "-translate-y-1 group-hover/nav:visible group-hover/nav:translate-y-0 group-hover/nav:opacity-100 group-hover/nav:delay-150",
          "group-focus-within/nav:visible group-focus-within/nav:translate-y-0 group-focus-within/nav:opacity-100",
          "max-sm:hidden [@media(hover:none)]:hidden",
          align === "start" ? "-left-2" : "-right-2",
        )}
      >
        <div className="rounded-xl bg-tone-900 p-1.5 text-sm shadow-2xl shadow-tone-1000/40 ring-1 ring-tone-800">
          {children}
        </div>
      </div>
    </div>
  );
}

export function MenuSection({ children }: { children: ReactNode }) {
  return (
    <div className="px-2.5 pt-2 pb-1 text-xs text-tone-500">{children}</div>
  );
}
