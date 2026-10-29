import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ChevronRight } from "lucide-react";
import { useTelemetry } from "../context/TelemetryContext";
import { useScopedSessions } from "../hooks/useSessionLog";
import { buildOnlineForm } from "../analysis/onlineForm";
import { getTrackDisplayName } from "../utils/tracks";
import { dashboardPath, sessionSummaryPath } from "../utils/routes";
import { cn } from "../utils/cn";
import { FormChart } from "../components/charts/FormChart";
import { TrackFlag } from "../components/TrackFlag";
import { formatDayLabel } from "../components/sessions/sessionFormat";

type Length = "all" | "full" | "short";

function Stat({
  label,
  value,
  note,
}: {
  label: string;
  value: string;
  note?: string;
}) {
  return (
    <div className="bg-tone-900 px-4 py-3.5">
      <div className="text-xs text-tone-500">{label}</div>
      <div className="mt-1 text-2xl font-semibold tracking-tight text-tone-50">
        {value}
      </div>
      {note && <div className="mt-0.5 text-xs text-tone-500">{note}</div>}
    </div>
  );
}

/** The form card's full story: season numbers, race by race, every race. */
export function FormPage() {
  const { activeFormulaKey, activeFormula } = useTelemetry();
  const scoped = useScopedSessions();
  const form = useMemo(
    () => buildOnlineForm(scoped, activeFormulaKey),
    [scoped, activeFormulaKey],
  );
  const [length, setLength] = useState<Length>("all");

  if (!form) {
    return (
      <div className="mx-auto max-w-6xl px-4 py-10 text-sm text-tone-500 sm:px-6">
        No race results in this scope yet.
      </div>
    );
  }
  const { stats, recent } = form;
  const podiums = stats.wins + stats.p2 + stats.p3;
  const rows = [...form.races]
    .reverse()
    .filter((r) =>
      length === "all" ? true : length === "short" ? r.short : !r.short,
    );
  const first = form.races[0];

  return (
    <div className="mx-auto max-w-6xl px-4 pt-6 pb-16 sm:px-6">
      <div className="text-xs text-tone-500">
        <Link
          to={dashboardPath(activeFormulaKey)}
          className="hover:text-tone-200"
        >
          Sessions
        </Link>{" "}
        › Your form
      </div>
      <h1 className="mt-1 text-2xl font-semibold tracking-tight text-tone-50">
        Your online form
      </h1>
      <p className="mt-1 text-sm text-tone-500">
        {activeFormula?.label} · {stats.starts} races since{" "}
        {formatDayLabel(first.session.date.split("T")[0])}
      </p>

      <div className="mt-5 grid grid-cols-2 gap-px overflow-hidden rounded-2xl bg-tone-800 ring-1 ring-tone-800 md:grid-cols-4">
        <Stat
          label="Avg finish"
          value={
            stats.averageFinish != null
              ? `P${stats.averageFinish.toFixed(1)}`
              : "—"
          }
          note={`${stats.cleanFinishSessions.length} finished races`}
        />
        <Stat
          label={recent.count === 1 ? "Last race" : `Last ${recent.count}`}
          value={
            recent.averageGrid != null && recent.averageFinish != null
              ? `P${recent.averageGrid.toFixed(1)} → P${recent.averageFinish.toFixed(1)}`
              : "—"
          }
          note="avg grid → avg finish"
        />
        <Stat
          label="Podiums"
          value={String(podiums)}
          note={`${stats.wins} win${stats.wins === 1 ? "" : "s"} · ${stats.p2} second${stats.p2 === 1 ? "" : "s"} · ${stats.p3} third${stats.p3 === 1 ? "" : "s"}`}
        />
        <Stat
          label="Front row"
          value={
            stats.gridStarts
              ? `${Math.round((stats.frontRowStarts / stats.gridStarts) * 100)}%`
              : "—"
          }
          note={`${stats.frontRowStarts} of ${stats.gridStarts} starts · ${stats.dnfCount} DNF${stats.dnfCount === 1 ? "" : "s"}`}
        />
      </div>

      <section className="mt-4 rounded-2xl bg-tone-900 p-5 ring-1 ring-tone-800">
        <div className="mb-2 flex flex-wrap items-baseline justify-between gap-3">
          <div>
            <h2 className="font-semibold text-tone-50">Race by race</h2>
            <p className="text-xs text-tone-500">
              Grid ○ to finish ●, oldest first · hover a race, click to open it
            </p>
          </div>
          <div className="flex gap-3 text-xs text-tone-400">
            <span className="inline-flex items-center gap-1.5">
              <i className="h-0.5 w-3 rounded bg-ahead" />
              gained
            </span>
            <span className="inline-flex items-center gap-1.5">
              <i className="h-0.5 w-3 rounded bg-behind" />
              lost
            </span>
            <span className="inline-flex items-center gap-1.5">
              <i className="size-2 rounded-full bg-tone-50" />
              podium
            </span>
          </div>
        </div>
        <FormChart races={form.races} />
      </section>

      <div className="mt-8 mb-3 flex items-center gap-3">
        <h2 className="text-lg font-semibold tracking-tight text-tone-50">
          Every race
        </h2>
        <div className="flex rounded-lg bg-tone-900 p-0.5 text-xs ring-1 ring-tone-800">
          {(["all", "full", "short"] as const).map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => setLength(value)}
              className={cn(
                "rounded-md px-2.5 py-1",
                length === value
                  ? "bg-tone-800 text-tone-50"
                  : "text-tone-400 hover:text-tone-100",
              )}
            >
              {value === "all"
                ? "All"
                : value === "full"
                  ? "Full length"
                  : "Short"}
            </button>
          ))}
        </div>
      </div>
      <div className="overflow-hidden rounded-2xl bg-tone-900 ring-1 ring-tone-800">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-tone-500">
              <th className="px-4 py-2 font-normal">Date</th>
              <th className="px-4 py-2 font-normal">Track</th>
              <th className="px-4 py-2 text-right font-normal">Grid</th>
              <th className="px-4 py-2 text-right font-normal">Finish</th>
              <th className="px-4 py-2 text-right font-normal">±</th>
              <th className="w-6" />
            </tr>
          </thead>
          <tbody>
            {rows.map((race) => (
              <tr
                key={race.session.slug}
                className="border-t border-tone-800/70 hover:bg-tone-800/50"
              >
                <td className="px-4 py-2.5 text-tone-400">
                  <Link to={sessionSummaryPath(race.session)} className="block">
                    {formatDayLabel(race.session.date.split("T")[0])}
                  </Link>
                </td>
                <td className="px-4 py-2.5 text-tone-100">
                  <Link
                    to={sessionSummaryPath(race.session)}
                    className="flex items-center gap-2"
                  >
                    <TrackFlag track={race.session.track} />
                    {getTrackDisplayName(race.session.track)}
                    {race.short && (
                      <span className="rounded px-1.5 text-[11px] text-tone-500 ring-1 ring-tone-700">
                        {race.session.playerRaceResult?.totalLaps} laps
                      </span>
                    )}
                  </Link>
                </td>
                <td className="px-4 py-2.5 text-right text-tone-300 tabular-nums">
                  {race.grid ? `P${race.grid}` : "—"}
                </td>
                <td className="px-4 py-2.5 text-right font-semibold tabular-nums">
                  {race.finish != null ? (
                    <span className="text-tone-50">P{race.finish}</span>
                  ) : (
                    <span className="text-behind">DNF</span>
                  )}
                </td>
                <td
                  className={cn(
                    "px-4 py-2.5 text-right tabular-nums",
                    race.gain == null || race.gain === 0
                      ? "text-tone-500"
                      : race.gain > 0
                        ? "text-ahead"
                        : "text-behind",
                  )}
                >
                  {race.gain == null
                    ? "—"
                    : race.gain > 0
                      ? `+${race.gain}`
                      : race.gain === 0
                        ? "0"
                        : `−${-race.gain}`}
                </td>
                <td className="pr-3 text-tone-600">
                  <ChevronRight className="size-3.5" />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-xs text-tone-500">
        {stats.modeDetail} Races that ended in the first laps (restarts or
        disconnects) aren't counted.
      </p>
    </div>
  );
}
