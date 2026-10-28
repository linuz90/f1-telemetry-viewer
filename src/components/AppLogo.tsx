import { cn } from "../utils/cn";

/**
 * The viewer's mark (the favicon and touch icon) drawn as SVG so it stays
 * sharp and follows the theme: the gauge arc and hub take the text colour, the
 * needle and bars the brand red. Geometry measured from the 180 px icon.
 */
export function AppLogo({ className }: { className?: string }) {
  return (
    <svg
      viewBox="18 40 140 84"
      aria-hidden
      className={cn("h-5 w-auto shrink-0", className)}
    >
      <path
        d="M24 118 A70 70 0 0 1 126.9 56.2"
        fill="none"
        stroke="currentColor"
        strokeWidth={6.5}
      />
      <polygon
        points="132.5,56.5 73.6,108.5 67.4,100.5"
        fill="var(--color-brand)"
      />
      <circle cx={70.5} cy={104.5} r={7.8} fill="currentColor" />
      <rect x={98} y={101} width={14} height={19} fill="var(--color-brand)" />
      <rect x={118} y={84} width={14} height={36} fill="var(--color-brand)" />
      <rect x={138} y={65} width={14} height={55} fill="var(--color-brand)" />
    </svg>
  );
}
