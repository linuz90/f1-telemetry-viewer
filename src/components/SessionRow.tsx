import type { ReactNode } from "react";
import { NavLink } from "react-router-dom";
import { cn } from "../utils/cn";
import { cardHighlight } from "./Card";
import { HStack } from "./ui/Stack";

/**
 * Single visual primitive for "a row in a session list". Used by the
 * dashboard's Recent Activity and by track/detail Session History so they share
 * chrome, hover behavior, and right-edge alignment. Callers compose:
 *   leading   — identity (track flag + name, or session-type icon + label)
 *   meta      — dim dot-separated context (sm+ only)
 *   trailing  — strong right-edge result (position badge, best-lap chip, ...)
 */
interface SessionRowProps {
  /** Detail-page path. When null, the row renders non-interactive (no Link wrapper). */
  to: string | null;
  leading: ReactNode;
  meta?: ReactNode;
  trailing: ReactNode;
}

export function SessionRow({ to, leading, meta, trailing }: SessionRowProps) {
  const inner = (
    <>
      <HStack className="flex-1 overflow-hidden">{leading}</HStack>
      <div className="ml-auto hidden min-w-0 flex-1 truncate text-right text-xs text-zinc-500 sm:block">
        {meta}
      </div>
      <HStack className="ml-auto shrink-0 gap-3 sm:ml-0">{trailing}</HStack>
    </>
  );
  if (to == null) {
    return (
      <HStack
        title="Demo data — upload your telemetry to explore detail"
        className={cn(
          "gap-3 rounded-xl bg-zinc-900/40 px-3 py-2 opacity-70",
          cardHighlight,
        )}
      >
        {inner}
      </HStack>
    );
  }
  return (
    <NavLink to={to} className="block rounded-xl">
      {({ isActive }) => (
        <HStack
          className={cn(
            "gap-3 rounded-xl px-3 py-2 transition-colors",
            isActive
              ? "bg-zinc-800/70 text-white"
              : "bg-zinc-900/60 hover:bg-zinc-800/60",
            cardHighlight,
          )}
        >
          {inner}
        </HStack>
      )}
    </NavLink>
  );
}
