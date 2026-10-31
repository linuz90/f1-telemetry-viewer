import { useMemo, useState, type ReactNode } from "react";
import type { TelemetrySession } from "../../types/telemetry";
import { useScopedSessions } from "../../hooks/useSessionLog";
import { useStintComparison } from "../../hooks/useStintComparison";
import {
  lapTelemetryHref,
  useRecordedLapFinder,
} from "../../hooks/useLapRecordings";
import {
  buildLongRunWorthALook,
  type WorthTarget,
} from "../../analysis/worthALook";
import {
  placeComparisonOnLaps,
  progressionHeadline,
  stintCompareDetail,
  stintDeltaClaim,
  stintHistory,
} from "../../analysis/stintCompare";
import {
  buildDriverLapSeries,
  buildSafetyCarBands,
} from "../../analysis/lapChartModel";
import {
  driverBestLapTimeMs,
  findFocusedDriver,
} from "../../utils/stats/drivers";
import { getTrackDisplayName } from "../../utils/tracks";
import { msToLapTime } from "../../utils/format";
import { sessionSaveSlugs } from "../../utils/deduplicateSessions";
import { LapChart, type LapChartPanel } from "../../components/charts/LapChart";
import {
  PROGRESSION_TILES,
  StintCompareLine,
  StintComparePicker,
  StintProgression,
  stintCompareTooltipRows,
} from "../../components/session/StintCompare";
import {
  SessionShell,
  useSessionTab,
} from "../../components/session/SessionShell";
import { WorthList } from "../../components/session/SessionParts";
import { Panel } from "../../components/ui/Panel";
import { heroCardClass } from "../../components/ui/surfaces";
import { LapTelemetrySection } from "../../components/lap-telemetry/LapTelemetrySection";
import { DuplicateNotice } from "../../components/DuplicateNotice";
import { LapTable } from "./LapTable";
import { SessionSetup } from "./SessionSetup";

const TABS = [
  { key: "overview", label: "Overview" },
  { key: "laps", label: "Laps" },
  { key: "tyres", label: "Tyres" },
  { key: "lap-telemetry", label: "Lap telemetry" },
  { key: "setup", label: "Setup" },
] as const;

/**
 * A long run: an offline race saved before the flag. It has no result to
 * show, so it answers practice questions: pace and wear on each tyre, and
 * whether it beat the earlier runs here at the same race length
 * (`src/analysis/stintCompare.ts`).
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

  const model = useStintComparison(session, slug, driver);
  const { stints, comparison, compare, label } = model;
  const series = useMemo(
    () => (driver ? buildDriverLapSeries(driver, session) : null),
    [driver, session],
  );
  const laps = series?.lapsMs.length ?? 0;
  const placed = useMemo(
    () => (comparison ? placeComparisonOnLaps(comparison, laps) : null),
    [comparison, laps],
  );
  const compareLabel = compare ? label(compare) : "";

  // Each stint against the latest earlier run on its tyre; the biggest
  // change is the headline, the rest are Worth a look.
  const labelled = useMemo(
    () => model.defaults.map((c) => ({ comparison: c, label: label(c.b) })),
    [model.defaults, label],
  );
  const headlineComparison =
    [...model.defaults]
      .filter((c) => c.deltaMs != null)
      .sort((x, y) => Math.abs(y.deltaMs!) - Math.abs(x.deltaMs!))[0] ?? null;
  const worth = useMemo(
    () =>
      buildLongRunWorthALook({
        stints,
        comparisons: labelled,
        headline: headlineComparison,
      }),
    [stints, labelled, headlineComparison],
  );

  // Lap telemetry for a paired lap: this run's lap beside the other's.
  const ownSaves = useMemo(
    () => (meta ? sessionSaveSlugs(meta) : [slug]),
    [meta, slug],
  );
  const compareMeta = compare
    ? scoped.find((s) => s.slug === compare.slug)
    : undefined;
  const compareSaves = useMemo(
    () =>
      compareMeta
        ? sessionSaveSlugs(compareMeta)
        : compare
          ? [compare.slug]
          : [],
    [compareMeta, compare],
  );
  const findOwnLap = useRecordedLapFinder(ownSaves, driver?.index);
  const findCompareLap = useRecordedLapFinder(
    compareSaves,
    compare?.slug === slug ? driver?.index : "player",
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

  const bands = buildSafetyCarBands(driver);
  const thin = stints.filter((s) => s.cleanLaps > 0 && s.cleanLaps < 3);
  const headlineHistory = headlineComparison
    ? stintHistory(headlineComparison.a, model.pool)
    : [];
  const headline =
    (headlineComparison &&
      (progressionHeadline(
        headlineComparison.a,
        headlineHistory
          .slice(-PROGRESSION_TILES)
          .map((stint) => ({ stint, label: label(stint) })),
        headlineHistory.length,
      ) ??
        stintDeltaClaim(headlineComparison, label(headlineComparison.b)))) ||
    stints
      .filter((s) => s.averageMs != null)
      .map((s) => `${s.compound} ${msToLapTime(s.averageMs!)}`)
      .join(" · ") ||
    "Not enough clean laps for a pace number.";
  const headlineDetail = headlineComparison
    ? stintCompareDetail(headlineComparison)
    : "";
  const trackName = getTrackDisplayName(
    meta?.track ?? String(session["session-info"]["track-id"]),
  );
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
      rows: [
        ...(ms
          ? [
              {
                tone: "you" as const,
                value: msToLapTime(ms),
                label: `${series.compoundByLap.get(lap) ?? ""}${reason ? ` · not counted: ${reason}` : ""}`,
              },
            ]
          : []),
        ...(placed ? stintCompareTooltipRows(placed, lap, compareLabel) : []),
      ],
    };
  };
  // Your laps, with the compared stint on the same tyre age and the running
  // gap to it underneath.
  const lapPanels = (height: number): LapChartPanel[] => [
    {
      kind: "time",
      height,
      series: [
        ...(placed && comparison
          ? [
              {
                key: "compare",
                tone: "compare" as const,
                lapsMs: placed.lapsMs,
                excluded: placed.excluded,
                averages:
                  comparison.b.averageMs != null
                    ? [
                        {
                          from: comparison.a.startLap,
                          to: Math.min(
                            laps,
                            comparison.a.startLap +
                              (comparison.b.endLap - comparison.b.startLap),
                          ),
                          ms: comparison.b.averageMs,
                        },
                      ]
                    : [],
              },
            ]
          : []),
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
    },
    ...(placed && comparison && comparison.pairs.length > 0
      ? [
          {
            kind: "gap" as const,
            height: Math.round(height * 0.45),
            label: `Gap to ${compareLabel}`,
            gapMs: placed.gapMs,
          },
        ]
      : []),
  ];
  const telemetryHref =
    placed && findOwnLap && findCompareLap
      ? (lap: number) => {
          const own = series.lapsMs[lap - 1];
          const other = placed.lapsMs[lap - 1];
          const refA = own != null ? findOwnLap(own) : undefined;
          const refB = other != null ? findCompareLap(other) : undefined;
          return refA && refB ? lapTelemetryHref([refA, refB]) : undefined;
        }
      : undefined;
  const compareControls = (model.pool.length > 0 || stints.length > 1) && (
    <StintComparePicker model={model} />
  );

  return shell(
    <>
      {tab === "overview" && (
        <>
          <section className={heroCardClass}>
            <p className="max-w-3xl text-lg leading-snug font-medium text-tone-50">
              {headline}
            </p>
            {headlineDetail && (
              <p className="mt-1 max-w-3xl text-sm text-tone-400">
                {headlineDetail}
              </p>
            )}
            <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {stints.map((stint) => (
                <StintProgression
                  key={stint.id}
                  model={model}
                  stint={stint}
                  trackName={trackName}
                />
              ))}
            </div>
            {compareControls && (
              <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
                <StintCompareLine model={model} />
                {compareControls}
              </div>
            )}
            <LapChart
              className="mt-4"
              laps={laps}
              panels={lapPanels(170)}
              bands={bands}
              pits={series.pitInLaps}
              stints={chartStints}
              tooltip={tooltip}
            />
            <p className="mt-2 text-xs text-tone-500">
              Faded dots are left out of the averages: the start, in-laps and
              pit laps.
              {placed &&
                " The gap adds up lap-for-lap differences on the same tyre age; below the line is time gained."}
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
            action={compareControls}
          >
            <StintCompareLine model={model} className="mb-3" />
            <LapChart
              laps={laps}
              panels={lapPanels(200)}
              bands={bands}
              pits={series.pitInLaps}
              stints={chartStints}
              tooltip={tooltip}
            />
          </Panel>
          <Panel title="Every lap">
            <LapTable
              driver={driver}
              series={series}
              compare={
                placed
                  ? { label: compareLabel, laps: placed, telemetryHref }
                  : undefined
              }
            />
          </Panel>
        </>
      )}
      {tab === "tyres" && (
        <Panel
          title="Tyre wear"
          hint="Worst wheel, lap by lap"
          action={compareControls}
        >
          <StintCompareLine model={model} className="mb-3" />
          <LapChart
            laps={laps}
            panels={[
              {
                kind: "wear",
                height: 170,
                wear: series.wear,
                compare: placed?.wear,
              },
            ]}
            pits={series.pitInLaps}
            stints={chartStints}
            tooltip={(lap) => {
              const own = series.wear[lap - 1];
              const other = placed?.wear[lap - 1];
              return {
                title: `Lap ${lap}`,
                rows: [
                  ...(own != null
                    ? [
                        {
                          tone: "you" as const,
                          value: `${Math.round(own)}%`,
                          label: `worst wheel · ${series.compoundByLap.get(lap) ?? ""}`,
                        },
                      ]
                    : []),
                  ...(other != null
                    ? [
                        {
                          tone: "compare" as const,
                          value: `${Math.round(other)}%`,
                          label: `${compareLabel}, lap ${placed!.lapB[lap - 1]}`,
                        },
                      ]
                    : []),
                ],
              };
            }}
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
      {tab === "setup" && (
        <SessionSetup
          kind="long-run"
          driver={driver}
          bestLapMs={driverBestLapTimeMs(driver)}
          trackName={meta?.track ?? String(session["session-info"]["track-id"])}
        />
      )}
    </>,
  );
}
