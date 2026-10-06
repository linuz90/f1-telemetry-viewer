import { ChartSpline } from "lucide-react";
import { Link } from "react-router-dom";
import { cn } from "../../utils/cn";

/** Lap-row entry point: opens the lap as A in the Lap Telemetry section. */
export function LapTraceLink({
  href,
  className,
}: {
  href: string;
  className?: string;
}) {
  return (
    <Link
      to={href}
      preventScrollReset
      replace
      title="Open in Lap Telemetry"
      aria-label="Open in Lap Telemetry"
      className={cn(
        "inline-flex items-center rounded p-0.5 align-middle text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-cyan-300",
        className,
      )}
    >
      <ChartSpline className="size-3.5" />
    </Link>
  );
}
