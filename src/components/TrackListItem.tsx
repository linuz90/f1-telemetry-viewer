import { NavLink } from "react-router-dom";
import { cn } from "../utils/cn";
import { trackPath } from "../utils/routes";
import { getTrackCountryName } from "../utils/tracks";
import { TrackFlag } from "./TrackFlag";
import { HStack } from "./ui/Stack";

export type TrackListBestLapKind = "quali" | "tt";

interface TrackListItemProps {
  track: string;
  formulaKey?: string;
  totalSessionCount: number;
  bestLapTime?: string;
  bestLapKind?: TrackListBestLapKind;
  bestLapSessionCount?: number;
  isSyntheticOnly: boolean;
}

/** Two-line track sidebar row with its country, best lap, and evidence count. */
export function TrackListItem({
  track,
  formulaKey,
  totalSessionCount,
  bestLapTime,
  bestLapKind,
  bestLapSessionCount,
  isSyntheticOnly,
}: TrackListItemProps) {
  const country = getTrackCountryName(track);
  const countryLabel =
    country && country.localeCompare(track, "en", { sensitivity: "base" }) !== 0
      ? country
      : null;
  const supportingCount = bestLapKind
    ? (bestLapSessionCount ?? 0)
    : totalSessionCount;
  const content = (
    <>
      <TrackFlag track={track} size="small" className="shrink-0" />
      <span className="min-w-0 flex-1 leading-tight">
        <span className="block truncate font-medium">{track}</span>
        {countryLabel && (
          <span className="mt-0.5 block truncate text-xs font-normal text-zinc-400">
            {countryLabel}
          </span>
        )}
      </span>
      <span className="shrink-0 text-right leading-tight">
        <span
          className={cn(
            "block font-mono text-sm tabular-nums",
            bestLapTime ? "text-best" : "text-zinc-700",
          )}
        >
          {bestLapTime ?? "—"}
        </span>
        <span className="mt-0.5 block text-[11px] text-zinc-400 tabular-nums">
          {bestLapKind ? `${bestLapKind === "tt" ? "TT" : "Quali"} PB · ` : ""}
          {supportingCount} {supportingCount === 1 ? "session" : "sessions"}
        </span>
      </span>
    </>
  );

  if (isSyntheticOnly) {
    return (
      <HStack
        title="Demo data — upload your telemetry to explore this track"
        className="gap-3 rounded-xl px-2 py-2.5 text-sm text-zinc-400"
      >
        {content}
      </HStack>
    );
  }

  return (
    <NavLink
      to={formulaKey ? trackPath(formulaKey, track) : "#"}
      className={({ isActive }) =>
        cn(
          "flex items-center gap-3 rounded-xl px-2 py-2.5 text-sm transition-colors",
          isActive
            ? "bg-zinc-800/70 text-white"
            : "text-zinc-400 hover:bg-zinc-900/60 hover:text-zinc-200",
        )
      }
    >
      {content}
    </NavLink>
  );
}
