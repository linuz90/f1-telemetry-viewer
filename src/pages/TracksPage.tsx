import { useState } from "react";
import { Link } from "react-router-dom";
import { useTelemetry } from "../context/TelemetryContext";
import { useTrackIndex } from "../hooks/useSessionLog";
import type { TrackIndexEntry } from "../analysis/trackIndex";
import { getTrackDisplayName } from "../utils/tracks";
import { msToLapTime } from "../utils/format";
import { trackPath } from "../utils/routes";
import { cn } from "../utils/cn";
import { TrackFlag } from "../components/TrackFlag";
import { TrackOutline } from "../components/TrackOutline";
import { formatDayLabel } from "../components/sessions/sessionFormat";

type Order = "calendar" | "recent" | "driven";

export function TrackCard({
  entry,
  formulaKey,
  highlight,
}: {
  entry: TrackIndexEntry;
  formulaKey: string;
  highlight?: boolean;
}) {
  return (
    <Link
      to={trackPath(formulaKey, entry.trackId)}
      className={cn(
        "group rounded-2xl bg-tone-900 p-4 ring-1 transition-shadow",
        highlight ? "ring-brand/40" : "ring-tone-800 hover:ring-tone-700",
      )}
    >
      <TrackOutline
        track={entry.track}
        glow={highlight}
        className="mx-auto h-20 w-full"
      />
      <div className="mt-3 flex items-center gap-2 font-semibold text-tone-50">
        <TrackFlag track={entry.track} />
        {getTrackDisplayName(entry.track)}
      </div>
      <div className="mt-1.5 flex flex-wrap justify-between gap-x-3 text-xs text-tone-400">
        <span>
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
  const latest = [...index.entries].sort((a, b) =>
    b.lastDate.localeCompare(a.lastDate),
  )[0];
  const entries =
    order === "calendar"
      ? index.entries
      : [...index.entries].sort((a, b) =>
          order === "recent"
            ? b.lastDate.localeCompare(a.lastDate)
            : b.sessionCount - a.sessionCount,
        );

  return (
    <div className="mx-auto max-w-6xl px-4 pt-6 pb-16 sm:px-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-tone-50">
            Tracks
          </h1>
          <p className="mt-1 text-sm text-tone-500">
            {index.entries.length} driven in{" "}
            {activeFormula?.label ?? "this scope"}
          </p>
        </div>
        <div className="flex rounded-xl bg-tone-900 p-1 text-sm ring-1 ring-tone-800">
          {(["calendar", "recent", "driven"] as const).map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => setOrder(value)}
              className={cn(
                "rounded-lg px-3 py-1",
                order === value
                  ? "bg-tone-800 font-medium text-tone-50"
                  : "text-tone-400 hover:text-tone-100",
              )}
            >
              {value === "calendar"
                ? "Calendar"
                : value === "recent"
                  ? "Recent"
                  : "Most driven"}
            </button>
          ))}
        </div>
      </div>
      <div className="mt-5 grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
        {entries.map((entry) => (
          <TrackCard
            key={entry.trackId}
            entry={entry}
            formulaKey={activeFormulaKey}
            highlight={entry === latest}
          />
        ))}
      </div>
      {index.notDriven.length > 0 && (
        <>
          <div className="mt-8 mb-3 flex items-baseline gap-2">
            <h2 className="font-semibold text-tone-50">Not driven yet</h2>
            <span className="text-sm text-tone-500">
              on the {activeFormula?.label} calendar
            </span>
          </div>
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
