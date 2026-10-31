import { pageClass } from "../components/ui/page";
import { PageHeader } from "../components/ui/PageHeader";
import { SectionHeader } from "../components/ui/SectionHeader";
import { cardHoverClass, cardSurface } from "../components/ui/surfaces";
import { useState } from "react";
import {
  SegmentedControl,
  type SegmentedOption,
} from "../components/ui/SegmentedControl";
import { Link } from "react-router-dom";
import { useTelemetry } from "../context/TelemetryContext";
import { useTrackIndex } from "../hooks/useSessionLog";
import type { TrackIndexEntry } from "../analysis/trackIndex";
import { getTrackDisplayName } from "../utils/tracks";
import { msToLapTime } from "../utils/format";
import { trackPath } from "../utils/routes";
import { cn } from "../utils/cn";
import { SessionKindIcon } from "../components/SessionKindIcon";
import { TrackFlag } from "../components/TrackFlag";
import { TrackOutline } from "../components/TrackOutline";
import { formatDayLabel } from "../components/sessions/sessionFormat";

type Order = "calendar" | "recent" | "driven";

const ORDER_OPTIONS: readonly SegmentedOption<Order>[] = [
  { value: "calendar", label: "Calendar" },
  { value: "recent", label: "Recent" },
  { value: "driven", label: "Most driven" },
];

export function TrackCard({
  entry,
  formulaKey,
}: {
  entry: TrackIndexEntry;
  formulaKey: string;
}) {
  return (
    <Link
      to={trackPath(formulaKey, entry.trackId)}
      className={cn(cardSurface, cardHoverClass, "group p-4")}
    >
      <TrackOutline track={entry.track} className="mx-auto h-20 w-full" />
      <div className="mt-3 flex items-center gap-2 font-semibold text-tone-50">
        <TrackFlag track={entry.track} />
        {getTrackDisplayName(entry.track)}
      </div>
      <div className="mt-1.5 grid gap-0.5 text-xs text-tone-400">
        <span>
          <SessionKindIcon kind="qualifying" className="mr-1 text-tone-500" />
          Quali PB{" "}
          <b
            className={cn(
              "font-mono font-semibold",
              entry.qualiPbMs ? "text-best" : "text-tone-500",
            )}
          >
            {entry.qualiPbMs ? msToLapTime(entry.qualiPbMs) : "—"}
          </b>
        </span>
        <span>
          <SessionKindIcon kind="race" className="mr-1 text-tone-500" />
          Last race{" "}
          <b className="font-semibold text-tone-100">
            {entry.lastRace
              ? entry.lastRace.dnf
                ? "DNF"
                : `P${entry.lastRace.position}`
              : "—"}
          </b>
        </span>
      </div>
      <div className="mt-1 text-xs text-tone-500">
        {entry.sessionCount} session{entry.sessionCount === 1 ? "" : "s"} ·{" "}
        {formatDayLabel(entry.lastDate.split("T")[0])}
      </div>
    </Link>
  );
}

/** Every circuit driven in scope, in calendar order, and the ones still to drive. */
export function TracksPage() {
  const { activeFormulaKey, activeFormula } = useTelemetry();
  const index = useTrackIndex();
  const [order, setOrder] = useState<Order>("calendar");
  if (!activeFormulaKey) return null;
  const entries =
    order === "calendar"
      ? index.entries
      : [...index.entries].sort((a, b) =>
          order === "recent"
            ? b.lastDate.localeCompare(a.lastDate)
            : b.sessionCount - a.sessionCount,
        );

  return (
    <div className={pageClass}>
      <PageHeader
        title="Tracks"
        subtitle={`${index.entries.length} driven in ${activeFormula?.label ?? "this scope"}`}
        action={
          <SegmentedControl<Order>
            ariaLabel="Track order"
            options={ORDER_OPTIONS}
            value={order}
            onChange={setOrder}
          />
        }
      />
      <div className="mt-5 grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
        {entries.map((entry) => (
          <TrackCard
            key={entry.trackId}
            entry={entry}
            formulaKey={activeFormulaKey}
          />
        ))}
      </div>
      {index.notDriven.length > 0 && (
        <>
          <SectionHeader
            size="lg"
            title="Not driven yet"
            hint={`On the ${activeFormula?.label} calendar`}
            className="mt-8"
          />
          <div className="flex flex-wrap gap-2">
            {index.notDriven.map((trackId) => (
              <span
                key={trackId}
                className="inline-flex items-center gap-1.5 rounded-full border border-dashed border-tone-700 px-3 py-1 text-sm text-tone-400"
              >
                <TrackFlag track={trackId} />
                {getTrackDisplayName(trackId)}
              </span>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
