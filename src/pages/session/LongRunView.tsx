import { useMemo, useState, type ReactNode } from "react";
import type { TelemetrySession } from "../../types/telemetry";
import { useScopedSessions } from "../../hooks/useSessionLog";
import { useSession } from "../../hooks/useSession";
import { summaryKind } from "../../analysis/sessionKind";
import {
  buildLongRunStints,
  buildLongRunWorthALook,
  compareLongRuns,
  type WorthTarget,
} from "../../analysis/worthALook";
import {
  buildDriverLapSeries,
  buildSafetyCarBands,
} from "../../analysis/lapChartModel";
import { findFocusedDriver, findPlayer } from "../../utils/stats/drivers";
import { getTrackId } from "../../utils/tracks";
import { msToLapTime } from "../../utils/format";
import { getCompoundColor } from "../../utils/colors";
import { PUNCTURE_THRESHOLD } from "../../utils/stats/tyres";
import { LapChart } from "../../components/charts/LapChart";
import {
  SessionShell,
  useSessionTab,
} from "../../components/session/SessionShell";
import {
  Panel,
  SetupSheet,
  WorthList,
} from "../../components/session/SessionParts";
import { LapTelemetrySection } from "../../components/lap-telemetry/LapTelemetrySection";
import { DuplicateNotice } from "../../components/DuplicateNotice";
import { formatDayLabel } from "../../components/sessions/sessionFormat";
import { LapTable } from "./LapTable";

const TABS = [
  { key: "overview", label: "Overview" },
  { key: "laps", label: "Laps" },
  { key: "tyres", label: "Tyres" },
  { key: "lap-telemetry", label: "Lap telemetry" },
  { key: "car", label: "Car" },
] as const;

/**
 * A long run: an offline race saved before the flag. It has no result to
 * show, so it answers practice questions: pace and wear on each tyre, and how
 * it compares with the last run here at the same race length.
 */
export function LongRunView({
  session,
  slug,
}: {
  session: TelemetrySession;
  slug: string;
}) {
  const [tab, setTab] = useSessionTab(TABS);
  const scoped = useScopedSessions();
  const meta = scoped.find((s) => s.slug === slug);
  const driver = findFocusedDriver(session);
  const [expanded, setExpanded] = useState(false);
  const raceLaps = session["session-info"]["total-laps"];

  // The previous long run at this track and race length, for the comparison.
  const previousMeta = meta
    ? scoped.find(
        (s) =>
          s.slug !== meta.slug &&
          s.date < meta.date &&
          // Two saves of one session (a manual save, then another) are the
          // same run, not a previous one.
          (!meta.sessionUid || s.sessionUid !== meta.sessionUid) &&
          summaryKind(s) === "long-run" &&
          getTrackId(s.track) === getTrackId(meta.track) &&
          (s.playerRaceResult?.totalLaps ?? raceLaps) === raceLaps &&
          (s.stints?.length ?? 0) > 0,
      )
    : undefined;
  const { session: previous } = useSession(previousMeta?.slug);
  const previousDriver = previous ? findPlayer(previous) : undefined;

  const stints = useMemo(
    () => (driver ? buildLongRunStints(driver) : []),
    [driver],
  );
  const series = useMemo(
    () => (driver ? buildDriverLapSeries(driver, session) : null),
    [driver, session],
  );
  const comparisons = useMemo(
    () =>
      driver && previousDriver && previousMeta
        ? compareLongRuns(
            { driver },
            { driver: previousDriver, date: previousMeta.date },
          )
        : [],
    [driver, previousDriver, previousMeta],
  );
  const headlineComparison = [...comparisons].sort(
    (a, b) => Math.abs(b.deltaMs) - Math.abs(a.deltaMs),
  )[0];
  const worth = useMemo(
    () =>
      buildLongRunWorthALook({
        stints,
        comparisons,
        headlineCompound: headlineComparison?.compound ?? null,
      }),
    [stints, comparisons, headlineComparison],
  );

  const shell = (children: ReactNode) => (
    <SessionShell
      session={session}
      slug={slug}
      kind="long-run"
      tabs={TABS}
      activeTab={tab}
      onTabChange={setTab}
    >
      {children}
      <DuplicateNotice
        count={meta?.duplicateCount ?? 0}
        isAutoSave={meta?.isAutoSave}
      />
    </SessionShell>
  );
  if (!driver || !series)
    return shell(
      <p className="text-sm text-tone-500">No laps in this save.</p>,
    );

  const laps = series.lapsMs.length;
  const bands = buildSafetyCarBands(driver);
  const thin = stints.filter((s) => s.cleanLaps > 0 && s.cleanLaps < 3);
  const previousLabel =
    previousMeta &&
    meta &&
    previousMeta.date.split("T")[0] === meta.date.split("T")[0]
      ? `${previousMeta.date.split("T")[1]?.slice(0, 5)} run`
      : previousMeta
        ? `${formatDayLabel(previousMeta.date.split("T")[0])} run`
        : "last run";
  const headline = headlineComparison
    ? Math.abs(headlineComparison.deltaMs) < 50
      ? `${headlineComparison.compound}s matched your ${previousLabel}, within ${(Math.abs(headlineComparison.deltaMs) / 1000).toFixed(3)} s a lap.`
      : `${headlineComparison.compound}s ran ${(Math.abs(headlineComparison.deltaMs) / 1000).toFixed(3)} s a lap ${headlineComparison.deltaMs > 0 ? "slower" : "faster"} than your ${previousLabel}.`
    : stints
        .filter((s) => s.averageMs != null)
        .map((s) => `${s.compound} ${msToLapTime(s.averageMs!)}`)
        .join(" · ") || "Not enough clean laps for a pace number.";
  const openTarget = (target: WorthTarget) => {
    if (TABS.some((t) => t.key === target))
      setTab(target as (typeof TABS)[number]["key"]);
  };
  const chartStints = series.stints.map((s) => ({
    from: s.from,
    to: s.to,
    compound: s.compound,
  }));
  const tooltip = (lap: number) => {
    const ms = series.lapsMs[lap - 1];
    const reason = series.excluded.get(lap);
    return {
      title: `Lap ${lap}`,
      rows: ms
        ? [
            {
              tone: "you" as const,
              value: msToLapTime(ms),
              label: `${series.compoundByLap.get(lap) ?? ""}${reason ? ` · not counted: ${reason}` : ""}`,
            },
          ]
        : [],
    };
  };
  const timePanel = (height: number) => ({
    kind: "time" as const,
    height,
    series: [
      {
        key: "you",
        tone: "you" as const,
        lapsMs: series.lapsMs,
        excluded: series.excluded,
        averages: series.stints
          .filter((s) => s.averageMs != null)
          .map((s) => ({ from: s.from, to: s.to, ms: s.averageMs! })),
      },
    ],
  });

  return shell(
    <>
      {tab === "overview" && (
        <>
          <section className="rounded-2xl bg-tone-900 p-5 ring-1 ring-tone-800 sm:p-6">
            <p className="max-w-3xl text-lg leading-snug font-medium text-tone-50">
              {headline}
            </p>
            {headlineComparison?.setupNote && (
              <p className="mt-1 text-sm text-tone-400">
                {headlineComparison.setupNote}
              </p>
            )}
            <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {stints.map((stint) => (
                <div
                  key={stint.startLap}
                  className="rounded-xl bg-tone-800/40 p-4 ring-1 ring-tone-800"
                >
                  <div className="flex items-center gap-2 text-sm">
                    <span
                      className="size-3 rounded-full"
                      style={{
                        backgroundColor: getCompoundColor(stint.compound),
                      }}
                    />
                    <b className="font-semibold text-tone-50">
                      {stint.compound}
                    </b>
                    <span className="ml-auto text-xs text-tone-500">
                      laps {stint.startLap}–{stint.endLap}
                    </span>
                  </div>
                  <div className="mt-2 font-mono text-3xl font-semibold tracking-tight text-tone-50">
                    {stint.averageMs ? msToLapTime(stint.averageMs) : "—"}
                  </div>
                  <div className="text-xs text-tone-500">
                    {stint.averageMs
                      ? `average, ${stint.cleanLaps} clean laps`
                      : "too few clean laps"}{" "}
                    · best {stint.bestMs ? msToLapTime(stint.bestMs) : "—"}
                  </div>
                  <div className="mt-3 border-t border-tone-800 pt-2.5 text-sm text-tone-400">
                    <b className="font-semibold text-tone-50">
                      {stint.wearPerLap.toFixed(1)}%
                    </b>{" "}
                    wear a lap ·{" "}
                    <b className="font-semibold text-tone-50">
                      ~{stint.lifeLaps} laps
                    </b>{" "}
                    to {PUNCTURE_THRESHOLD}%
                  </div>
                </div>
              ))}
            </div>
            <LapChart
              className="mt-5"
              laps={laps}
              panels={[timePanel(170)]}
              bands={bands}
              pits={series.pitInLaps}
              stints={chartStints}
              tooltip={tooltip}
            />
            <p className="mt-2 text-xs text-tone-500">
              Faded dots are left out of the averages: the start, in-laps and
              pit laps.
              {thin.length > 0 &&
                ` ${thin.map((s) => `${s.compound}s rest on ${s.cleanLaps} clean lap${s.cleanLaps === 1 ? "" : "s"}`).join(", ")}, so treat that number as rough.`}
            </p>
          </section>
          <WorthList
            items={worth}
            onOpen={openTarget}
            expanded={expanded}
            onExpand={() => setExpanded(true)}
          />
        </>
      )}
      {tab === "laps" && (
        <>
          <Panel
            title="Lap times"
            hint="Hover any lap. Faded dots are left out of the averages."
          >
            <LapChart
              laps={laps}
              panels={[timePanel(200)]}
              bands={bands}
              pits={series.pitInLaps}
              stints={chartStints}
              tooltip={tooltip}
            />
          </Panel>
          <Panel title="Every lap">
            <LapTable driver={driver} series={series} />
          </Panel>
        </>
      )}
      {tab === "tyres" && (
        <Panel title="Tyre wear" hint="Worst wheel, lap by lap">
          <LapChart
            laps={laps}
            panels={[{ kind: "wear", height: 170, wear: series.wear }]}
            pits={series.pitInLaps}
            stints={chartStints}
            tooltip={(lap) => ({
              title: `Lap ${lap}`,
              rows:
                series.wear[lap - 1] != null
                  ? [
                      {
                        tone: "you",
                        value: `${Math.round(series.wear[lap - 1]!)}%`,
                        label: `worst wheel · ${series.compoundByLap.get(lap) ?? ""}`,
                      },
                    ]
                  : [],
            })}
          />
        </Panel>
      )}
      {tab === "lap-telemetry" && (
        <LapTelemetrySection
          scope={{
            kind: "session",
            sessionSlug: slug,
            duplicateSlugs: meta?.duplicateSlugs,
            focusedDriverIndex: driver.index,
          }}
        />
      )}
      {tab === "car" && driver["car-setup"]?.["is-valid"] && (
        <div className="grid items-start gap-5 lg:grid-cols-2">
          <Panel>
            <SetupSheet
              setup={driver["car-setup"]}
              title="Setup used"
              meta="This long run"
            />
          </Panel>
        </div>
      )}
    </>,
  );
}
