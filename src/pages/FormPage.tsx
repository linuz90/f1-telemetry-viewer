import {
  tableClass,
  tableHeadClass,
  tableHeadCellClass,
  tableCellClass,
  tableRowClass,
} from "../components/ui/table";
import { StatDoors } from "../components/session/SessionParts";
import { pageClass, pageGutterClass } from "../components/ui/page";
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ChevronRight } from "lucide-react";
import { useTelemetry } from "../context/TelemetryContext";
import { useScopedSessions } from "../hooks/useSessionLog";
import { buildOnlineForm } from "../analysis/onlineForm";
import { getTrackDisplayName } from "../utils/tracks";
import { dashboardPath, sessionSummaryPath } from "../utils/routes";
import { cn } from "../utils/cn";
import { cardSurface } from "../components/ui/surfaces";
import { FormChart } from "../components/charts/FormChart";
import { TrackFlag } from "../components/TrackFlag";
import { formatDayLabel } from "../components/sessions/sessionFormat";
import { Panel } from "../components/ui/Panel";
import { SectionHeader } from "../components/ui/SectionHeader";
import { Breadcrumb, PageHeader } from "../components/ui/PageHeader";
import {
  SegmentedControl,
  type SegmentedOption,
} from "../components/ui/SegmentedControl";

type Length = "all" | "full" | "short";

const LENGTH_OPTIONS: readonly SegmentedOption<Length>[] = [
  { value: "all", label: "All" },
  { value: "full", label: "Full length" },
  { value: "short", label: "Short" },
];

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
      <div className={cn(pageGutterClass, "py-10 text-sm text-tone-500")}>
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
    <div className={pageClass}>
      <PageHeader
        breadcrumb={
          <Breadcrumb to={dashboardPath(activeFormulaKey)} label="Sessions">
            Your form
          </Breadcrumb>
        }
        title="Your online form"
        subtitle={`${activeFormula?.label} · ${stats.starts} races since ${formatDayLabel(first.session.date.split("T")[0])}`}
      />

      <StatDoors
        stats={[
          {
            label: "Avg finish",
            value:
              stats.averageFinish != null
                ? `P${stats.averageFinish.toFixed(1)}`
                : "—",
            note: `${stats.cleanFinishSessions.length} finished races`,
          },
          {
            label: recent.count === 1 ? "Last race" : `Last ${recent.count}`,
            value:
              recent.averageGrid != null && recent.averageFinish != null
                ? `P${recent.averageGrid.toFixed(1)} → P${recent.averageFinish.toFixed(1)}`
                : "—",
            note: "avg grid → avg finish",
          },
          {
            label: "Podiums",
            value: String(podiums),
            note: `${stats.wins} win${stats.wins === 1 ? "" : "s"} · ${stats.p2} second${stats.p2 === 1 ? "" : "s"} · ${stats.p3} third${stats.p3 === 1 ? "" : "s"}`,
          },
          {
            label: "Front row",
            value: stats.gridStarts
              ? `${Math.round((stats.frontRowStarts / stats.gridStarts) * 100)}%`
              : "—",
            note: `${stats.frontRowStarts} of ${stats.gridStarts} starts · ${stats.dnfCount} DNF${stats.dnfCount === 1 ? "" : "s"}`,
          },
        ]}
      />

      <Panel
        title="Race by race"
        hint="Grid ○ to finish ●, oldest first · hover a race, click to open it"
        className="mt-4"
        action={
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
        }
      >
        <FormChart races={form.races} />
      </Panel>

      <SectionHeader
        size="lg"
        title="Every race"
        className="mt-8"
        action={
          <SegmentedControl<Length>
            size="sm"
            ariaLabel="Race length"
            options={LENGTH_OPTIONS}
            value={length}
            onChange={setLength}
          />
        }
      />
      <div className={cn(cardSurface, "overflow-hidden")}>
        <table className={tableClass}>
          <thead className={tableHeadClass}>
            <tr>
              <th
                className={tableHeadCellClass({ layout: "edge", size: "sm" })}
              >
                Date
              </th>
              <th
                className={tableHeadCellClass({ layout: "edge", size: "sm" })}
              >
                Track
              </th>
              <th
                className={tableHeadCellClass({
                  align: "right",
                  layout: "edge",
                  size: "sm",
                })}
              >
                Grid
              </th>
              <th
                className={tableHeadCellClass({
                  align: "right",
                  layout: "edge",
                  size: "sm",
                })}
              >
                Finish
              </th>
              <th
                className={tableHeadCellClass({
                  align: "right",
                  layout: "edge",
                  size: "sm",
                })}
              >
                ±
              </th>
              <th className={tableHeadCellClass({ className: "w-6" })} />
            </tr>
          </thead>
          <tbody>
            {rows.map((race) => (
              <tr
                key={race.session.slug}
                className={cn(tableRowClass, "hover:bg-tone-800/50")}
              >
                <td
                  className={tableCellClass({
                    layout: "edge",
                    className: "text-tone-400",
                  })}
                >
                  <Link to={sessionSummaryPath(race.session)} className="block">
                    {formatDayLabel(race.session.date.split("T")[0])}
                  </Link>
                </td>
                <td
                  className={tableCellClass({
                    layout: "edge",
                    className: "text-tone-100",
                  })}
                >
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
                <td
                  className={tableCellClass({
                    align: "right",
                    layout: "edge",
                    className: "text-tone-300 tabular-nums",
                  })}
                >
                  {race.grid ? `P${race.grid}` : "—"}
                </td>
                <td
                  className={tableCellClass({
                    align: "right",
                    layout: "edge",
                    className: "font-semibold tabular-nums",
                  })}
                >
                  {race.finish != null ? (
                    <span className="text-tone-50">P{race.finish}</span>
                  ) : (
                    <span className="text-behind">DNF</span>
                  )}
                </td>
                <td
                  className={cn(
                    tableCellClass({
                      align: "right",
                      layout: "edge",
                      className: "tabular-nums",
                    }),
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
