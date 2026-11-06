import { useEffect, useMemo, useState } from "react";
import { Activity, ListOrdered, Repeat, Trophy, Zap } from "lucide-react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import type { DriverData, TelemetrySession } from "../../types/telemetry";
import { useTelemetry } from "../../context/TelemetryContext";
import { useScopedSessions } from "../../hooks/useSessionLog";
import { useTrackHistory } from "../../hooks/useTrackHistory";
import { useStintComparison } from "../../hooks/useStintComparison";
import { buildRaceStory, buildRaceHeadline } from "../../analysis/raceStory";
import {
  buildRacePaceRank,
  buildRaceWorthALook,
  type WorthTarget,
} from "../../analysis/worthALook";
import {
  buildDriverEvents,
  buildDriverLapSeries,
  buildSafetyCarBands,
} from "../../analysis/lapChartModel";
import { buildRaceDriverStats } from "../../analysis/resultsAnalysis";
import {
  buildStartReactionModel,
  type StartReactionRating,
} from "../../analysis/startReactionAnalysis";
import { buildSessionSpeedAnalysis } from "../../analysis/speedAnalysis";
import { placeComparisonOnLaps } from "../../analysis/stintCompare";
import { summaryKind } from "../../analysis/sessionKind";
import { sessionDayKey } from "../../analysis/sessionLog";
import { getRaceControlEvents } from "../../utils/raceControl";
import {
  driverBestLapTimeMs,
  findFocusedDriver,
  findRaceWinner,
  driverNameKey,
} from "../../utils/stats/drivers";
import { ordinal } from "../../utils/stats/core";
import {
  getCompletedStints,
  getDriverStints,
  getNeutralisedLaps,
  PUNCTURE_THRESHOLD,
  stintGreenLife,
} from "../../utils/stats/tyres";
import { getTrackDisplayName, getTrackId } from "../../utils/tracks";
import { msToLapTime } from "../../utils/format";
import { getCompoundColor } from "../../utils/colors";
import { sessionSummaryPath, trackPath } from "../../utils/routes";
import { cn } from "../../utils/cn";
import {
  LapChart,
  LapChartLegend,
  type LapChartTooltipRow,
} from "../../components/charts/LapChart";
import { TrackOutline } from "../../components/TrackOutline";
import { SESSION_KIND_ICON } from "../../components/sessionTypeMeta";
import {
  SessionShell,
  useSessionTab,
} from "../../components/session/SessionShell";
import {
  StatDoors,
  WorthList,
  type StatDoor,
} from "../../components/session/SessionParts";
import { Panel } from "../../components/ui/Panel";
import { SectionHeader } from "../../components/ui/SectionHeader";
import {
  cardClass,
  cardSurface,
  heroCardClass,
  insetTileClass,
} from "../../components/ui/surfaces";
import {
  tableCellClass,
  tableClass,
  tableHeadCellClass,
  tableHeadClass,
  tableRowClass,
} from "../../components/ui/table";
import {
  paceTone,
  signedPercent,
  signedSeconds,
  StintCompareLine,
  StintComparePicker,
  stintCompareTooltipRows,
  wearTone,
} from "../../components/session/StintCompare";
import { RaceResultsTable } from "../../components/RaceResultsTable";
import { RaceControlTimeline } from "../../components/RaceControlTimeline";
import { StintComparisonTable } from "../../components/StintComparisonTable";
import { DamageTimeline } from "../../components/DamageTimeline";
import { DriverComparisonPicker } from "../../components/DriverComparisonPicker";
import { SessionDriverSelect } from "../../components/SessionDriverSelect";
import { LapTelemetrySection } from "../../components/lap-telemetry/LapTelemetrySection";
import { DuplicateNotice } from "../../components/DuplicateNotice";
import { LapTable } from "./LapTable";
import { DriverPanel } from "./DriverPanel";
import { SessionSetup } from "./SessionSetup";

const TABS = [
  { key: "overview", label: "Overview" },
  { key: "laps", label: "Laps" },
  { key: "tyres", label: "Tyres" },
  { key: "lap-telemetry", label: "Lap telemetry" },
  { key: "results", label: "Results" },
  { key: "setup", label: "Setup" },
] as const;

/** Reaction text tone: AGENTS.md reads a start over 0.5 s as severe. */
const REACTION_TONE: Partial<Record<StartReactionRating, string>> = {
  exceptional: "text-ahead",
  optimal: "text-ahead",
  bad: "text-warning",
  terrible: "text-behind",
};

function defaultCompare(
  session: TelemetrySession,
  focused: DriverData | undefined,
) {
  const winner = findRaceWinner(session);
  if (winner && winner.index !== focused?.index) return winner.index;
  const second = session["classification-data"].find(
    (d) => d["final-classification"]?.position === 2,
  );
  return second && second.index !== focused?.index ? second.index : null;
}

export function RaceView({
  session,
  slug,
}: {
  session: TelemetrySession;
  slug: string;
}) {
  const [tab, setTab] = useSessionTab(TABS);
  const [params, setParams] = useSearchParams();
  const { activeFormulaKey } = useTelemetry();
  const scoped = useScopedSessions();
  const summary = scoped.find((s) => s.slug === slug);
  const drivers = session["classification-data"] ?? [];
  const isSpectator =
    drivers.length > 0 && !drivers.some((d) => d["is-player"]);
  const [focusedIndex, setFocusedIndex] = useState(
    () => findFocusedDriver(session)?.index ?? 0,
  );
  useEffect(
    () => setFocusedIndex(findFocusedDriver(session)?.index ?? 0),
    [session],
  );
  const focused = drivers.find((d) => d.index === focusedIndex);
  const [compareIndex, setCompareIndex] = useState<number | null>(() =>
    defaultCompare(session, focused),
  );
  useEffect(
    () => setCompareIndex(defaultCompare(session, focused)),
    [session, focused],
  );
  const compare = drivers.find((d) => d.index === compareIndex);
  const [expandedWorth, setExpandedWorth] = useState(false);

  const info = session["session-info"];
  const trackName = summary?.track ?? String(info["track-id"]);
  const { pbs } = useTrackHistory(
    trackName,
    slug,
    info.formula,
    session["game-year"],
    info["total-laps"] > 0 ? info["total-laps"] : undefined,
  );

  const model = useMemo(() => {
    if (!focused) return null;
    const story = buildRaceStory(session, focused);
    const pace = buildRacePaceRank(session, focused);
    const headline = story
      ? buildRaceHeadline(session, focused, story, pace)
      : null;
    const series = buildDriverLapSeries(focused, session);
    return {
      story,
      pace,
      headline,
      series,
      bands: buildSafetyCarBands(focused),
      events: buildDriverEvents(session, focused),
      start: buildStartReactionModel(session, focused),
    };
  }, [session, focused]);
  // The player's stints against their earlier ones here at this race length:
  // did practice pace hold up, did this race beat the last?
  const stintModel = useStintComparison(session, slug, focused);
  const stintHistory = useMemo(
    () =>
      stintModel.defaults.map((comparison) => ({
        comparison,
        label: stintModel.label(comparison.b),
      })),
    [stintModel.defaults, stintModel.label],
  );
  const worth = useMemo(
    () =>
      model?.story && model.headline && focused
        ? buildRaceWorthALook({
            session,
            driver: focused,
            story: model.story,
            headline: model.headline,
            pace: model.pace,
            pbs,
            stintHistory,
          })
        : [],
    [model, session, focused, pbs, stintHistory],
  );
  const compareSeries = useMemo(
    () => (compare ? buildDriverLapSeries(compare, session) : null),
    [compare, session],
  );
  const speedAnalysis = useMemo(
    () => buildSessionSpeedAnalysis(session),
    [session],
  );
  const driverStats = useMemo(
    () => buildRaceDriverStats(session, speedAnalysis),
    [session, speedAnalysis],
  );
  const raceControl = useMemo(() => getRaceControlEvents(session), [session]);

  // A driver panel opened from Results or a ⌘K driver search (?driver=).
  // Normalised again so links built from older summaries still match.
  const panelParam = params.get("driver");
  const panelKey = panelParam ? driverNameKey(panelParam) : null;
  const panelDriver = panelKey
    ? drivers.find((d) => driverNameKey(d["driver-name"]) === panelKey)
    : undefined;
  const openDriver = (name: string | null) => {
    const next = new URLSearchParams(params);
    if (name) next.set("driver", driverNameKey(name));
    else next.delete("driver");
    setParams(next, { replace: true });
  };

  const quali = summary
    ? scoped.find(
        (s) =>
          summaryKind(s) === "qualifying" &&
          s.isOnline === summary.isOnline &&
          summary.isOnline &&
          sessionDayKey(s) === sessionDayKey(summary) &&
          getTrackId(s.track) === getTrackId(summary.track) &&
          s.date < summary.date,
      )
    : undefined;

  const navigate = useNavigate();
  const openTarget = (target: WorthTarget) => {
    if (target === "track") {
      if (activeFormulaKey)
        navigate(trackPath(activeFormulaKey, getTrackId(trackName)));
      return;
    }
    if (TABS.some((t) => t.key === target))
      setTab(target as (typeof TABS)[number]["key"]);
  };

  if (!focused || !model) {
    return (
      <SessionShell
        session={session}
        slug={slug}
        kind="race"
        tabs={TABS}
        activeTab={tab}
        onTabChange={setTab}
      >
        <p className="text-sm text-tone-500">No driver data in this save.</p>
      </SessionShell>
    );
  }

  const { story, pace, headline, series, bands, events, start } = model;
  const reaction = start && (
    <span
      title={`${start.label}: ${start.detail}`}
      className={REACTION_TONE[start.rating] ?? "text-tone-500"}
    >
      {" "}
      · {start.formatted} reaction
      {start.rating === "bad" || start.rating === "terrible"
        ? `, ${start.label.toLowerCase()}`
        : ""}
    </span>
  );
  const totalLaps = Math.max(story?.lastLap ?? 0, series.lapsMs.length, 1);
  const maxPosition = Math.max(9, ...(story?.trace ?? [1]));
  const ownBestMs = driverBestLapTimeMs(focused) || undefined;
  const fastestOverall = Math.min(
    ...[...driverStats.values()].map((s) => s.bestLap).filter((ms) => ms > 0),
  );
  const result = focused["final-classification"];
  const stints = series.stints.map((s) => ({
    from: s.from,
    to: s.to,
    compound: s.compound,
  }));

  // One stint against an earlier one, charted over that stint's laps.
  const stintComparison = stintModel.comparison;
  const stintPlaced = stintComparison
    ? placeComparisonOnLaps(stintComparison, totalLaps)
    : null;
  const stintCompareLabel = stintModel.compare
    ? stintModel.label(stintModel.compare)
    : "";
  const activeStint = stintModel.active;
  const showStintCompare =
    !!activeStint &&
    (stintModel.pool.length > 0 || stintModel.stints.length > 1);

  const tooltip = (lap: number) => {
    const rows: LapChartTooltipRow[] = [];
    if (story?.trace[lap])
      rows.push({
        tone: "you",
        value: `P${story.trace[lap]}`,
        label: "position",
      });
    const ms = series.lapsMs[lap - 1];
    if (ms) {
      const reason = series.excluded.get(lap);
      rows.push({
        tone: "you",
        value: msToLapTime(ms),
        label: `you · ${series.compoundByLap.get(lap) ?? ""}${reason ? ` · not counted: ${reason}` : ""}`,
      });
    }
    const cms = compareSeries?.lapsMs[lap - 1];
    if (cms && compare)
      rows.push({
        tone: "compare",
        value: msToLapTime(cms),
        label: compare["driver-name"],
      });
    for (const event of events.filter((e) => e.lap === lap))
      rows.push({ tone: "event", value: "•", label: event.text });
    const band = bands.find((b) => lap >= b.from && lap <= b.to);
    return { title: `Lap ${lap}${band ? ` · ${band.label}` : ""}`, rows };
  };

  const positionPanel = (height: number, withNotes: boolean) => ({
    kind: "position" as const,
    height,
    trace: story?.trace ?? [],
    maxPosition,
    endLabel: !story
      ? undefined
      : story.outcome === "retired"
        ? `Retired on lap ${story.endLap}`
        : story.outcome === "finished" &&
            story.trace[story.lastLap] !== story.classified
          ? `P${story.trace[story.lastLap]} on the road, classified P${story.classified}`
          : undefined,
    notes:
      withNotes && story && Math.abs(story.chips[0]?.places ?? 0) >= 2
        ? [
            {
              lap: 1,
              position: story.trace[1],
              text: `${story.chips[0].places > 0 ? "+" : "−"}${Math.abs(story.chips[0].places)} at the start`,
            },
          ]
        : [],
  });

  const stats: StatDoor[] = [
    {
      label: "Race pace",
      icon: Activity,
      value: pace ? (
        <>
          {ordinal(pace.rank)}{" "}
          <span className="text-sm font-medium text-tone-500">
            of {pace.field}
          </span>
        </>
      ) : (
        "—"
      ),
      note: pace
        ? pace.rank === 1
          ? `${msToLapTime(pace.paceMs)} a lap`
          : `+${(pace.gapToBestMs / 1000).toFixed(3)} s/lap to the fastest`
        : "Not enough clean laps",
      onOpen: () => setTab("laps"),
    },
    story?.topN
      ? {
          label: `In the top ${story.topN.position}`,
          icon: Trophy,
          value: (
            <>
              {story.topN.laps}{" "}
              <span className="text-sm font-medium text-tone-500">
                of {story.lastLap} laps
              </span>
            </>
          ),
          note: `P${story.topN.best} on ${story.topN.atBest} of them`,
          onOpen: () => setTab("laps"),
        }
      : { label: "Laps", icon: Repeat, value: String(story?.lastLap ?? 0) },
    {
      label: "Best lap",
      // Race control's fastest-lap glyph; Timer belongs to qualifying.
      icon: Zap,
      value: ownBestMs ? msToLapTime(ownBestMs) : "—",
      tone: ownBestMs && ownBestMs === fastestOverall ? "best" : undefined,
      note:
        ownBestMs && Number.isFinite(fastestOverall)
          ? ownBestMs === fastestOverall
            ? "Fastest lap of the race"
            : `+${((ownBestMs - fastestOverall) / 1000).toFixed(3)} to the fastest`
          : undefined,
      onOpen: () => setTab("lap-telemetry"),
    },
    quali?.qualifyingPosition
      ? {
          label: "Quali",
          icon: SESSION_KIND_ICON.qualifying,
          value: `P${quali.qualifyingPosition}`,
          note: quali.bestLapTimeMs
            ? msToLapTime(quali.bestLapTimeMs)
            : undefined,
          to: sessionSummaryPath(quali),
        }
      : {
          label: "Grid",
          icon: ListOrdered,
          value: result?.["grid-position"]
            ? `P${result["grid-position"]}`
            : "—",
        },
  ];

  // Green-flag wear and the track page's projection, so a stint's life here
  // matches its Tyre Life card.
  const neutralisedLaps = getNeutralisedLaps(focused["per-lap-info"]);
  const lifeByCompound = new Map<string, number[]>();
  for (const stint of getCompletedStints(getDriverStints(focused))) {
    const life = stintGreenLife(stint, neutralisedLaps);
    if (life.greenLaps < 3 || life.lifeLaps <= 0) continue;
    const compound = stint["tyre-set-data"]["visual-tyre-compound"];
    lifeByCompound.set(compound, [
      ...(lifeByCompound.get(compound) ?? []),
      life.lifeLaps,
    ]);
  }

  const lastFuel = [...(focused["per-lap-info"] ?? [])]
    .reverse()
    .find((l) => l["car-status-data"]?.["fuel-remaining-laps"] != null);
  const fuelLaps = lastFuel?.["car-status-data"]?.["fuel-remaining-laps"];

  return (
    <SessionShell
      session={session}
      slug={slug}
      kind="race"
      tabs={TABS}
      activeTab={tab}
      onTabChange={setTab}
      actions={
        isSpectator ? (
          <SessionDriverSelect
            session={session}
            focusedDriverIndex={focusedIndex}
            onFocusedDriverChange={setFocusedIndex}
            size="sm"
            width="compact"
          />
        ) : undefined
      }
    >
      {tab === "overview" && (
        <>
          <section className={cn(heroCardClass, "overflow-hidden")}>
            <TrackOutline
              track={trackName}
              glow
              className="pointer-events-none absolute top-5 right-6 hidden h-28 w-44 sm:block"
            />
            <div className="relative flex flex-col gap-2 sm:flex-row sm:items-baseline sm:gap-5">
              <span className="text-7xl leading-none font-bold tracking-tighter text-tone-50">
                {story?.outcome === "retired"
                  ? /DISQUALIFIED|DSQ/i.test(result?.["result-status"] ?? "")
                    ? "DSQ"
                    : "DNF"
                  : story?.classified || result?.position
                    ? `P${story?.classified || result?.position}`
                    : "—"}
              </span>
              <span className="text-sm leading-relaxed text-tone-400 sm:max-w-xl">
                {story?.grid || result?.["grid-position"] ? (
                  <>
                    from{" "}
                    <b className="font-semibold text-tone-100">
                      P{story?.grid || result?.["grid-position"]}
                    </b>{" "}
                    on the grid
                  </>
                ) : null}
                {result?.points ? (
                  <>
                    {" "}
                    ·{" "}
                    <b className="font-semibold text-tone-100">
                      {result.points} pts
                    </b>
                  </>
                ) : null}
                {headline && (
                  <span className="mt-0.5 block text-base font-medium text-tone-50">
                    {headline.text}
                  </span>
                )}
              </span>
            </div>
            {/* A race without position history still shows its reaction. */}
            {!story && reaction && (
              <div className="relative mt-4 flex flex-wrap gap-1.5">
                <span
                  className={cn(
                    insetTileClass,
                    "rounded-full px-3 py-1 text-xs text-tone-400",
                  )}
                >
                  Start{reaction}
                </span>
              </div>
            )}
            {story && (
              <div className="relative mt-4 flex flex-wrap gap-1.5">
                {story.chips.map((chip) => (
                  <span
                    key={chip.key}
                    className={cn(
                      insetTileClass,
                      "rounded-full px-3 py-1 text-xs text-tone-400",
                    )}
                  >
                    {chip.label}{" "}
                    <b
                      className={cn(
                        "font-semibold",
                        chip.places > 0
                          ? "text-ahead"
                          : chip.places < 0
                            ? "text-behind"
                            : "text-tone-300",
                      )}
                    >
                      {chip.places > 0
                        ? `+${chip.places}`
                        : chip.places < 0
                          ? `−${-chip.places}`
                          : "0"}
                    </b>
                    {chip.key === "start" && reaction}
                  </span>
                ))}
              </div>
            )}
            {story && (
              <LapChart
                className="mt-4"
                laps={totalLaps}
                panels={[positionPanel(130, true)]}
                bands={bands}
                pits={series.pitInLaps}
                stints={stints}
                events={events}
                tooltip={tooltip}
              />
            )}
          </section>
          <StatDoors stats={stats} />
          <div className="grid gap-5 lg:grid-cols-[3fr_2fr]">
            <WorthList
              items={worth}
              onOpen={openTarget}
              expanded={expandedWorth}
              onExpand={() => setExpandedWorth(true)}
            />
            <section>
              <SectionHeader
                title={`Next time at ${getTrackDisplayName(trackName)}`}
              />
              <div className={cardClass}>
                {lifeByCompound.size > 0 && (
                  <>
                    <div className="text-xs text-tone-500">
                      Tyre life in this race, to {PUNCTURE_THRESHOLD}% wear
                    </div>
                    <div className="mt-2 flex flex-wrap gap-x-5 gap-y-2 text-sm">
                      {[...lifeByCompound].map(([compound, lives]) => (
                        <span
                          key={compound}
                          className="inline-flex items-center gap-2 text-tone-200"
                        >
                          <span
                            className="size-2.5 rounded-full"
                            style={{
                              backgroundColor: getCompoundColor(compound),
                            }}
                          />
                          {compound}{" "}
                          <b className="font-semibold text-tone-50">
                            ~
                            {Math.round(
                              lives.reduce((a, b) => a + b, 0) / lives.length,
                            )}{" "}
                            laps
                          </b>
                        </span>
                      ))}
                    </div>
                  </>
                )}
                {activeFormulaKey && (
                  <div className="mt-4 flex flex-col gap-1.5 text-sm">
                    <Link
                      to={trackPath(
                        activeFormulaKey,
                        getTrackId(trackName),
                        "overview",
                      )}
                      className="text-tone-300 hover:text-tone-50"
                    >
                      Race plan, fuel and setup for{" "}
                      {getTrackDisplayName(trackName)} →
                    </Link>
                    <Link
                      to={trackPath(
                        activeFormulaKey,
                        getTrackId(trackName),
                        "setups",
                      )}
                      className="text-tone-500 hover:text-tone-100"
                    >
                      Your {getTrackDisplayName(trackName)} setups →
                    </Link>
                  </div>
                )}
              </div>
            </section>
          </div>
        </>
      )}

      {tab === "laps" && (
        <>
          <Panel
            title="Position and lap times"
            hint="Hover any lap. Faded dots are left out of Race Pace; flat lines are each stint's average."
            action={
              <div className="flex flex-wrap items-center gap-3">
                <LapChartLegend
                  items={[
                    { tone: "you", label: "You" },
                    ...(compare
                      ? [
                          {
                            tone: "compare" as const,
                            label: compare["driver-name"],
                          },
                        ]
                      : []),
                  ]}
                />
                <DriverComparisonPicker
                  session={session}
                  selectedIndex={compareIndex}
                  onSelect={setCompareIndex}
                  focusedDriverIndex={focusedIndex}
                  size="sm"
                  width="session"
                />
              </div>
            }
          >
            <LapChart
              laps={totalLaps}
              panels={[
                positionPanel(96, false),
                {
                  kind: "time",
                  height: 200,
                  series: [
                    ...(compareSeries
                      ? [
                          {
                            key: "compare",
                            tone: "compare" as const,
                            lapsMs: compareSeries.lapsMs,
                            excluded: compareSeries.excluded,
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
                        .map((s) => ({
                          from: s.from,
                          to: s.to,
                          ms: s.averageMs!,
                        })),
                    },
                  ],
                },
              ]}
              bands={bands}
              pits={series.pitInLaps}
              stints={stints}
              events={events}
              tooltip={tooltip}
            />
            <p className="mt-3 text-xs text-tone-500">
              ✕ contact · ! warning, your own only.
            </p>
          </Panel>
          <DamageTimeline perLapInfo={focused["per-lap-info"] ?? []} />
          <Panel title="Every lap">
            <LapTable
              driver={focused}
              series={series}
              trace={story?.trace}
              events={events}
              bestMs={ownBestMs}
            />
          </Panel>
          {raceControl.length > 0 && (
            <details className={cn(cardSurface, "group")}>
              <summary className="cursor-pointer list-none px-5 py-4 text-sm font-medium text-tone-200 hover:text-tone-50">
                All race control events, every driver
                <span className="ml-2 text-xs font-normal text-tone-500">
                  {raceControl.length} events
                </span>
              </summary>
              <div className="border-t border-tone-800 p-5">
                <RaceControlTimeline
                  events={raceControl}
                  focusedDriver={focused}
                />
              </div>
            </details>
          )}
        </>
      )}

      {tab === "tyres" && (
        <>
          <Panel
            title="Tyre wear"
            hint="Worst wheel, lap by lap · hover any lap"
          >
            <LapChart
              laps={totalLaps}
              panels={[{ kind: "wear", height: 170, wear: series.wear }]}
              bands={bands}
              pits={series.pitInLaps}
              stints={stints}
              tooltip={(lap) => ({
                title: `Lap ${lap}`,
                rows: [
                  ...(series.wear[lap - 1] != null
                    ? [
                        {
                          tone: "you" as const,
                          value: `${Math.round(series.wear[lap - 1]!)}%`,
                          label: `worst wheel · ${series.compoundByLap.get(lap) ?? ""}`,
                        },
                      ]
                    : []),
                  ...(series.lapsMs[lap - 1]
                    ? [
                        {
                          tone: "you" as const,
                          value: msToLapTime(series.lapsMs[lap - 1]!),
                          label: "lap time",
                        },
                      ]
                    : []),
                ],
              })}
            />
          </Panel>
          <Panel title="Stints" className="overflow-x-auto">
            <table className={tableClass}>
              <thead className={tableHeadClass}>
                <tr>
                  <th className={tableHeadCellClass({ layout: "flush" })}>
                    Stint
                  </th>
                  <th
                    className={tableHeadCellClass({
                      align: "right",
                      layout: "flush",
                    })}
                  >
                    Laps
                  </th>
                  <th
                    className={tableHeadCellClass({
                      align: "right",
                      layout: "flush",
                    })}
                  >
                    Race pace
                  </th>
                  <th
                    className={tableHeadCellClass({
                      align: "right",
                      layout: "flush",
                    })}
                  >
                    Wear a lap
                  </th>
                  <th
                    className={tableHeadCellClass({
                      align: "right",
                      layout: "flush",
                    })}
                  >
                    Peak
                  </th>
                  <th
                    className={tableHeadCellClass({
                      align: "right",
                      layout: "flush",
                    })}
                  >
                    Life to {PUNCTURE_THRESHOLD}%
                  </th>
                  {stintModel.defaults.length > 0 && (
                    <th className={tableHeadCellClass({ layout: "flush" })}>
                      Last time here
                    </th>
                  )}
                </tr>
              </thead>
              <tbody className="tabular-nums">
                {getCompletedStints(getDriverStints(focused)).map(
                  (stint, i) => {
                    const chart = series.stints[i];
                    const life = stintGreenLife(stint, neutralisedLaps);
                    const rate = life.wearPerLap;
                    const peak = Math.max(
                      0,
                      ...series.wear
                        .slice(stint["start-lap"] - 1, stint["end-lap"])
                        .map((w) => w ?? 0),
                    );
                    const compound =
                      stint["tyre-set-data"]["visual-tyre-compound"];
                    const before = stintModel.defaults.find(
                      (c) => c.a.startLap === stint["start-lap"],
                    );
                    return (
                      <tr key={stint["start-lap"]} className={tableRowClass}>
                        <td
                          className={tableCellClass({
                            layout: "flush",
                            className: "text-tone-100",
                          })}
                        >
                          <span className="inline-flex items-center gap-2">
                            <span
                              className="size-2.5 rounded-full"
                              style={{
                                backgroundColor: getCompoundColor(compound),
                              }}
                            />
                            {compound} · L{stint["start-lap"]}–
                            {stint["end-lap"]}
                          </span>
                        </td>
                        <td
                          className={tableCellClass({
                            align: "right",
                            layout: "flush",
                            className: "text-tone-300",
                          })}
                        >
                          {stint["stint-length"]}
                        </td>
                        <td
                          className={tableCellClass({
                            align: "right",
                            mono: true,
                            layout: "flush",
                            className: "text-tone-100",
                          })}
                        >
                          {chart?.averageMs
                            ? msToLapTime(chart.averageMs)
                            : "–"}
                        </td>
                        <td
                          className={tableCellClass({
                            align: "right",
                            layout: "flush",
                            className: "whitespace-nowrap text-tone-300",
                          })}
                        >
                          {rate > 0 ? `${rate.toFixed(1)}%` : "–"}
                          {before?.wearPerLapDelta != null && (
                            <span
                              className={cn(
                                "ml-1.5 text-[11px]",
                                wearTone(before.wearPerLapDelta),
                              )}
                              title={`Against your ${stintModel.label(before.b)}`}
                            >
                              {signedPercent(before.wearPerLapDelta)}
                            </span>
                          )}
                        </td>
                        <td
                          className={tableCellClass({
                            align: "right",
                            layout: "flush",
                            className: "text-tone-300",
                          })}
                        >
                          {peak > 0 ? `${Math.round(peak)}%` : "–"}
                        </td>
                        <td
                          className={tableCellClass({
                            align: "right",
                            layout: "flush",
                            className: "text-tone-100",
                          })}
                        >
                          {life.lifeLaps > 0 ? `~${life.lifeLaps} laps` : "–"}
                        </td>
                        {stintModel.defaults.length > 0 && (
                          <td
                            className={tableCellClass({
                              layout: "flush",
                              className: "whitespace-nowrap text-tone-500",
                            })}
                          >
                            {before?.deltaMs != null ? (
                              <button
                                type="button"
                                className="hover:text-tone-200"
                                onClick={() =>
                                  stintModel.select(before.a.id, before.b.id)
                                }
                              >
                                <span
                                  className={cn(
                                    "font-mono",
                                    paceTone(before.deltaMs),
                                  )}
                                >
                                  {signedSeconds(before.deltaMs)}
                                </span>{" "}
                                s a lap vs {stintModel.label(before.b)}
                              </button>
                            ) : (
                              "–"
                            )}
                          </td>
                        )}
                      </tr>
                    );
                  },
                )}
              </tbody>
            </table>
            {fuelLaps != null && (
              <p className="mt-3 text-xs text-tone-500">
                Fuel at the flag: {fuelLaps >= 0 ? "+" : ""}
                {fuelLaps.toFixed(1)} laps, the game's own estimate. What to
                load next time lives in the {getTrackDisplayName(trackName)}{" "}
                race plan.
              </p>
            )}
          </Panel>
          {showStintCompare && activeStint && (
            <Panel
              title="Against your earlier stints"
              hint={`${getTrackDisplayName(trackName)}, ${activeStint.raceLaps}-lap races · laps paired by tyre age`}
              action={<StintComparePicker model={stintModel} />}
            >
              <StintCompareLine model={stintModel} className="mb-3" />
              <LapChart
                firstLap={activeStint.startLap}
                laps={Math.min(activeStint.endLap, totalLaps)}
                panels={[
                  {
                    kind: "time",
                    height: 170,
                    series: [
                      ...(stintPlaced
                        ? [
                            {
                              key: "compare",
                              tone: "compare" as const,
                              lapsMs: stintPlaced.lapsMs,
                              excluded: stintPlaced.excluded,
                            },
                          ]
                        : []),
                      {
                        key: "you",
                        tone: "you" as const,
                        lapsMs: series.lapsMs,
                        excluded: series.excluded,
                        averages:
                          activeStint.averageMs != null
                            ? [
                                {
                                  from: activeStint.startLap,
                                  to: activeStint.endLap,
                                  ms: activeStint.averageMs,
                                },
                              ]
                            : [],
                      },
                    ],
                  },
                  ...(stintPlaced && stintComparison!.pairs.length > 0
                    ? [
                        {
                          kind: "gap" as const,
                          height: 80,
                          label: `Gap to ${stintCompareLabel}`,
                          gapMs: stintPlaced.gapMs,
                        },
                      ]
                    : []),
                  {
                    kind: "wear",
                    height: 110,
                    wear: series.wear,
                    compare: stintPlaced?.wear,
                  },
                ]}
                bands={bands}
                pits={series.pitInLaps}
                stints={stints}
                tooltip={(lap) => {
                  const ms = series.lapsMs[lap - 1];
                  const wear = series.wear[lap - 1];
                  const reason = series.excluded.get(lap);
                  return {
                    title: `Lap ${lap}`,
                    rows: [
                      ...(ms
                        ? [
                            {
                              tone: "you" as const,
                              value: msToLapTime(ms),
                              label: reason
                                ? `not counted: ${reason}`
                                : "lap time",
                            },
                          ]
                        : []),
                      ...(wear != null
                        ? [
                            {
                              tone: "you" as const,
                              value: `${Math.round(wear)}%`,
                              label: "worst wheel",
                            },
                          ]
                        : []),
                      ...(stintPlaced
                        ? stintCompareTooltipRows(
                            stintPlaced,
                            lap,
                            stintCompareLabel,
                          )
                        : []),
                    ],
                  };
                }}
              />
            </Panel>
          )}
          <Panel
            title="Against the field"
            hint="Each stint against the best on the same compound"
          >
            <StintComparisonTable player={focused} allDrivers={drivers} />
          </Panel>
        </>
      )}

      {tab === "lap-telemetry" && (
        <LapTelemetrySection
          scope={{
            kind: "session",
            sessionSlug: slug,
            duplicateSlugs: summary?.duplicateSlugs,
            focusedDriverIndex: focusedIndex,
            rivalDriverIndex: compareIndex,
          }}
        />
      )}

      {tab === "results" && (
        <div
          className={cn(
            "grid gap-5",
            panelDriver && "lg:grid-cols-[1fr_20rem]",
          )}
        >
          <Panel className="min-w-0">
            <RaceResultsTable
              session={session}
              speedAnalysis={speedAnalysis}
              focusedDriverIndex={focusedIndex}
              raceControlEvents={raceControl}
              onDriverSelect={(name) => openDriver(name)}
              selectedDriverName={panelDriver?.["driver-name"]}
            />
          </Panel>
          {panelDriver && (
            <DriverPanel
              driver={panelDriver}
              you={focused}
              stats={driverStats}
              onClose={() => openDriver(null)}
              onCompare={() => {
                setCompareIndex(panelDriver.index);
                setTab("lap-telemetry");
              }}
            />
          )}
        </div>
      )}

      {tab === "setup" && (
        <SessionSetup
          kind="race"
          driver={focused}
          bestLapMs={ownBestMs ?? 0}
          trackName={trackName}
        />
      )}

      <DuplicateNotice
        count={summary?.duplicateCount ?? 0}
        isAutoSave={summary?.isAutoSave}
      />
    </SessionShell>
  );
}
