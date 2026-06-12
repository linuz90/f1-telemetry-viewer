import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { cardHighlight } from "./Card";

/**
 * Single visual primitive for "a row in a session list". Used by the
 * dashboard's Recent Results and by the track page's Session History so they
 * share chrome, hover behavior, and right-edge alignment. Callers compose:
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
      <div className="flex min-w-0 items-center gap-2">{leading}</div>
      <div className="ml-auto hidden min-w-0 flex-1 truncate text-right text-xs text-zinc-500 sm:block">
        {meta}
      </div>
      <div className="flex shrink-0 items-center gap-3">{trailing}</div>
    </>
  );
  if (to == null) {
    return (
      <div
        title="Demo data — upload your telemetry to explore detail"
        className={`flex items-center gap-3 rounded-xl bg-zinc-900/40 px-3 py-2 opacity-70 ${cardHighlight}`}
      >
        {inner}
      </div>
    );
  }
  return (
    <Link
      to={to}
      className={`flex items-center gap-3 rounded-xl bg-zinc-900/60 px-3 py-2 transition-colors hover:bg-zinc-800/60 ${cardHighlight}`}
    >
      {inner}
    </Link>
  );
}
