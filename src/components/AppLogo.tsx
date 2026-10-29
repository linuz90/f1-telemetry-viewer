import { cn } from "../utils/cn";

/**
 * The viewer's mark: a stopwatch with a red slice of elapsed time. The case
 * and crown take the text colour, the slice the brand red. `public/favicon.svg`
 * (the source of `favicon.ico`, not linked itself) and the touch icon draw
 * the same geometry on a dark tile; regenerate them if this changes.
 */
export function AppLogo({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 64 64"
      aria-hidden
      className={cn("size-5 shrink-0", className)}
    >
      <circle
        cx="32"
        cy="36"
        r="20"
        fill="none"
        stroke="currentColor"
        strokeWidth={6.5}
      />
      <rect x="26" y="4" width="12" height="6.5" rx="2" fill="currentColor" />
      <rect x="29.5" y="9" width="5" height="6" fill="currentColor" />
      <path
        d="M32 36 L32 22.5 A13.5 13.5 0 0 1 43.06 43.74 Z"
        fill="var(--color-brand)"
      />
    </svg>
  );
}
