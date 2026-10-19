import { ChartSpline } from "lucide-react";
import { useRecordedLapCounts } from "../../hooks/useLapRecordings";
import { pluralize } from "../../utils/format";
import { cn } from "../../utils/cn";

/**
 * Marks a session whose lap recordings have at least one complete lap.
 * `sessionSlugs` includes the saves dedupe hid behind the row
 * (`sessionSaveSlugs()`), so restarted runs count toward it.
 */
export function RecordedLapsIcon({
  sessionSlugs,
  className,
}: {
  sessionSlugs: readonly string[];
  className?: string;
}) {
  const counts = useRecordedLapCounts();
  const count = sessionSlugs.reduce(
    (sum, slug) => sum + (counts.get(slug) ?? 0),
    0,
  );
  if (!count) return null;
  const label = `Lap telemetry: ${pluralize(count, "lap")} recorded start to finish`;
  return (
    <span
      title={label}
      aria-label={label}
      className={cn("inline-flex shrink-0 text-cyan-400/80", className)}
    >
      <ChartSpline className="size-3" />
    </span>
  );
}
