import { useMemo, useState, type ReactNode } from "react";
import {
  CircleCheck,
  History,
  Play,
  Sparkles,
  TrendingDown,
} from "lucide-react";
import type { TelemetrySession } from "../../types/telemetry";
import { useScopedSessions } from "../../hooks/useSessionLog";
import { useTrackHistory } from "../../hooks/useTrackHistory";
import { useLapTraceLinks } from "../../hooks/useLapRecordings";
import {
  buildQualiSummary,
  buildTimeTrialWorthALook,
  timeTrialHeadline,
  type WorthTarget,
} from "../../analysis/worthALook";
import { buildDriverLapSeries } from "../../analysis/lapChartModel";
import { findFocusedDriver } from "../../utils/stats/drivers";
import {
  isCompleteValidLap,
  hasCompleteLapTiming,
} from "../../utils/stats/laps";
import { msToLapTime } from "../../utils/format";
import { LapChart } from "../../components/charts/LapChart";
import {
  SessionShell,
  useSessionTab,
} from "../../components/session/SessionShell";
import {
  Panel,
  SetupSheet,
  StatDoors,
  WorthList,
  type StatDoor,
} from "../../components/session/SessionParts";
import { SectorComparison } from "../../components/SectorComparison";
import { LapTelemetrySection } from "../../components/lap-telemetry/LapTelemetrySection";

const TABS = [
  { key: "overview", label: "Overview" },
  { key: "laps", label: "Laps" },
  { key: "lap-telemetry", label: "Lap telemetry" },
  { key: "car", label: "Car" },
] as const;

/**
 * Time trial: the PB story. The classification's stored ghost/PB is never a
 * lap of this session; everything here comes from the session's own laps.
 */
export function TimeTrialView({
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
  const info = session["session-info"];
  const trackName = meta?.track ?? String(info["track-id"]);
  const { pbs, loading: pbsLoading } = useTrackHistory(
    trackName,
    slug,
    info.formula,
    session["game-year"],
  );
  const lapTraceHref = useLapTraceLinks(slug, driver?.index);
  const [expanded, setExpanded] = useState(false);

  const summary = useMemo(
    () => (driver ? buildQualiSummary(session, driver) : null),
    [session, driver],
  );
  const series = useMemo(
    () => (driver ? buildDriverLapSeries(driver, session) : null),
    [driver, session],
  );
  const worth = useMemo(
    () =>
      driver && summary
        ? buildTimeTrialWorthALook({ driver, summary, pbs })
        : [],
    [driver, summary, pbs],
  );

  const shell = (children: ReactNode) => (
    <SessionShell
      session={session}
      slug={slug}
      kind="time-trial"
      tabs={TABS}
      activeTab={tab}
      onTabChange={setTab}
    >
      {children}
    </SessionShell>
  );
  if (!driver || !summary || !series) {
    return shell(
      <p className="text-sm text-tone-500">
        No complete laps in this time trial.
      </p>,
    );
  }

  const laps = driver["session-history"]["lap-history-data"];
  const timed = laps.filter(hasCompleteLapTiming);
  const valid = laps.filter(isCompleteValidLap);
  const firstValid = valid[0];
  const previousPb =
    pbs && pbs.bestTimeTrialLapMs > 0 ? pbs.bestTimeTrialLapMs : 0;
  const isNewPb = !previousPb || summary.bestMs < previousPb;
  const openTarget = (target: WorthTarget) => {
    if (TABS.some((t) => t.key === target))
      setTab(target as (typeof TABS)[number]["key"]);
  };
  const stats: StatDoor[] = [
    {
      label: "Ideal lap",
      icon: Sparkles,
      value: summary.idealMs ? msToLapTime(summary.idealMs) : "—",
      note: "your best valid sectors",
      onOpen: () => setTab("laps"),
    },
    {
      label: "Valid laps",
      icon: CircleCheck,
      value: (
        <>
          {valid.length}{" "}
          <span className="text-sm font-medium text-tone-500">
            of {timed.length}
          </span>
        </>
      ),
      note:
        timed.length - valid.length > 0
          ? `${timed.length - valid.length} deleted`
          : "none deleted",
      onOpen: () => setTab("laps"),
    },
    {
      label: "First lap",
      icon: Play,
      value: firstValid ? msToLapTime(firstValid["lap-time-in-ms"]) : "—",
      note: `to ${msToLapTime(summary.bestMs)} on lap ${summary.bestLapNumber}`,
    },
    previousPb
      ? {
          label: "Previous PB",
          icon: History,
          value: msToLapTime(previousPb),
          tone: isNewPb ? undefined : "best",
          note: isNewPb
            ? `beaten by ${((previousPb - summary.bestMs) / 1000).toFixed(3)} s`
            : `this session +${((summary.bestMs - previousPb) / 1000).toFixed(3)}`,
        }
      : {
          label: "Gained in the session",
          icon: TrendingDown,
          value: firstValid
            ? `${((firstValid["lap-time-in-ms"] - summary.bestMs) / 1000).toFixed(3)} s`
            : "—",
          note: "first valid lap to best",
        },
  ];

  return shell(
    <>
      {tab === "overview" && (
        <>
          <section className="rounded-2xl bg-tone-900 p-5 ring-1 ring-tone-800 sm:p-6">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-baseline sm:gap-5">
              <span className="font-mono text-6xl leading-none font-bold tracking-tight text-tone-50">
                {msToLapTime(summary.bestMs)}
              </span>
              <span className="text-sm leading-relaxed text-tone-400">
                {isNewPb && previousPb > 0 && (
                  <b className="font-semibold text-best">New PB</b>
                )}
                {/* The headline compares with earlier runs, so it waits for
                    them rather than calling these your first laps here. */}
                <span className="mt-0.5 block min-h-6 text-base font-medium text-tone-50">
                  {!pbsLoading && timeTrialHeadline(summary, pbs, timed.length)}
                </span>
              </span>
            </div>
            <LapChart
              className="mt-5"
              laps={Math.max(
                1,
                ...laps.map((lap, i) =>
                  hasCompleteLapTiming(lap) ? i + 1 : 0,
                ),
              )}
              panels={[
                {
                  kind: "time",
                  height: 170,
                  series: [
                    {
                      key: "you",
                      tone: "you",
                      lapsMs: series.lapsMs,
                      excluded: series.excluded,
                      notes: [
                        {
                          lap: summary.bestLapNumber,
                          text: isNewPb && previousPb ? "PB" : "best",
                        },
                      ],
                    },
                  ],
                },
              ]}
              stints={series.stints}
              tooltip={(lap) => {
                const ms = series.lapsMs[lap - 1];
                const reason = series.excluded.get(lap);
                return {
                  title: `Lap ${lap}`,
                  rows: ms
                    ? [
                        {
                          tone: "you",
                          value: msToLapTime(ms),
                          label: reason
                            ? `not counted: ${reason}`
                            : lap === summary.bestLapNumber
                              ? "best lap"
                              : "valid",
                        },
                      ]
                    : [],
                };
              }}
            />
            <p className="mt-2 text-xs text-tone-500">
              Faded dots are deleted laps.
            </p>
          </section>
          <StatDoors stats={stats} />
          <WorthList
            items={worth}
            onOpen={openTarget}
            expanded={expanded}
            onExpand={() => setExpanded(true)}
          />
        </>
      )}
      {tab === "laps" && (
        <Panel>
          <SectorComparison
            laps={laps}
            stints={driver["session-history"]["tyre-stints-history-data"] ?? []}
            perLapInfo={driver["per-lap-info"] ?? []}
            lapTraceHref={lapTraceHref}
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
              meta="This time trial"
            />
          </Panel>
        </div>
      )}
    </>,
  );
}
