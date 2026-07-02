import {
  ArrowLeft,
  Gauge,
  Target,
  Timer,
  TimerReset,
  Upload,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { ActionEmptyState } from "../components/ActionEmptyState";
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from "recharts";
import { accentCardClass, cardClass } from "../components/Card";
import { CarSetupCard } from "../components/CarSetupCard";
import { CompoundStatCard } from "../components/CompoundStatCard";
import { RaceSetupComparison } from "../components/RaceSetupComparison";
import { SessionRow } from "../components/SessionRow";
import { getSessionTypeMeta } from "../components/sessionTypeMeta";
import { PaceEvolutionChart } from "../components/track/PaceEvolutionChart";
import { TrackKeyInsights } from "../components/track/TrackKeyInsights";
import { TrackQualifyingInsights } from "../components/track/TrackQualifyingInsights";
import { TrackStrategySection } from "../components/track/TrackStrategySection";
import { TrackFlag } from "../components/TrackFlag";
import { Badge } from "../components/ui/Badge";
import { Button, buttonVariants } from "../components/ui/Button";
import { InsightDetail, InsightValue } from "../components/ui/InsightText";
import { InsightTile } from "../components/ui/InsightTile";
import { SectionHeader } from "../components/ui/SectionHeader";
import { SegmentedControl } from "../components/ui/SegmentedControl";
import { HStack, VStack } from "../components/ui/Stack";
import { useTelemetry } from "../context/TelemetryContext";
import { useSessionList } from "../hooks/useSessionList";
import {
  buildRaceAnalysisBuckets,
  buildRaceSetupCandidates,
  buildTrackAnalysisData,
  buildTrackSessionData,
  deduplicateTrackRuns,
  getDefaultRaceAnalysisBucket,
  getPreferredTrackTab,
  type TrackSessionData,
  type TrackSessionKind,
} from "../analysis/trackAnalysis";
import { buildTrackRivalBenchmark } from "../analysis/rivalStats";
import type { SessionSummary } from "../types/telemetry";
import { cn } from "../utils/cn";
import { CHART_THEME, SECTOR_COLORS, TOOLTIP_STYLE } from "../constants/colors";
import { getSessionFormulaScopeKey } from "../utils/formulaScope";
import {
  formatDate,
  formatSessionType,
  formatTime,
  getSessionIcon,
  msToLapTime,
  msToSectorTime,
} from "../utils/format";
import { isTrackSlugMatch } from "../utils/tracks";
import {
  dashboardPath,
  isTrackSessionTab,
  sessionSummaryPath,
  trackPath,
} from "../utils/routes";
import { TRACK_TAB_QUERY_PARAM } from "../constants/routes";
import {
  aggregateCompoundLife,
  aggregateFuelData,
} from "../utils/stats/trackAggregates";
import { buildPaceEvolution } from "../utils/stats/trackPaceEvolution";
import { buildTrackRaceRecommendation } from "../analysis/trackRaceRecommendation";
import { PUNCTURE_THRESHOLD } from "../utils/stats/tyres";

const TRACK_TAB_LABELS: Record<TrackSessionKind, string> = {
  qualifying: "Qualifying",
  race: "Race",
  "time-trial": "Time Trial",
};

const TRACK_TAB_MOBILE_LABELS: Record<TrackSessionKind, string> = {
  qualifying: "Quali",
  race: "Race",
  "time-trial": "TT",
};

// Map each tab to the canonical session-type label the shared `getSessionTypeMeta`
// helper understands. "Qualifying" pools Short Quali + One-Shot Quali, so we
// resolve via "Short Quali" (the Timer icon) — the timer reads as the more
// generic "this is a timed session" cue than the One-Shot's Target.
const TRACK_TAB_META_LABEL: Record<TrackSessionKind, string> = {
  qualifying: "Short Quali",
  race: "Race",
  "time-trial": "Time Trial",
};

export function TrackProgressPage() {
  const { trackId } = useParams<{ trackId: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const { sessions } = useSessionList();
  const {
    getSession,
    mode,
    setShowUploadModal,
    activeFormulaKey,
    activeFormula,
    formulaOptions,
  } = useTelemetry();
  const [data, setData] = useState<TrackSessionData[]>([]);
  const [loading, setLoading] = useState(true);
  const requestedTab = searchParams.get(TRACK_TAB_QUERY_PARAM);
  const [activeTab, setActiveTab] = useState<TrackSessionKind>(() =>
    isTrackSessionTab(requestedTab) ? requestedTab : "race",
  );
  const requestedRaceLaps = searchParams.get("raceLaps");

  useEffect(() => {
    if (isTrackSessionTab(requestedTab)) {
      setActiveTab(requestedTab);
    }
  }, [requestedTab]);

  // Route slugs are stable hyphenated ids (`abu-dhabi`), while telemetry keeps
  // display names (`Abu Dhabi`). Match through the shared slug helper so future
  // route-model changes only need to update one normalization function.
  const allTrackSessions = useMemo(
    () => sessions.filter((s) => isTrackSlugMatch(s.track, trackId)),
    [sessions, trackId],
  );

  const trackSessions = allTrackSessions.filter(
    (s) =>
      !activeFormulaKey || getSessionFormulaScopeKey(s) === activeFormulaKey,
  );
  const playerTrackSessions = trackSessions.filter(
    (s) => s.isSpectator !== true,
  );
  const spectatorTrackSessions = trackSessions.filter(
    (s) => s.isSpectator === true,
  );
  const playerTrackSessionKey = playerTrackSessions
    .map((s) => s.slug)
    .join("|");

  // Resolve the original (display) track name from session data
  const displayTrackName =
    allTrackSessions.length > 0 ? allTrackSessions[0].track : (trackId ?? "");
  const backToDashboardPath = dashboardPath(activeFormulaKey);

  useEffect(() => {
    if (!playerTrackSessions.length) {
      setData([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    let cancelled = false;
    Promise.all(
      playerTrackSessions.map(async (s) => {
        try {
          const sessionData = await getSession(s.slug);
          return buildTrackSessionData(s, sessionData);
        } catch {
          return null;
        }
      }),
    ).then((results) => {
      const valid = results.filter((r): r is TrackSessionData => r !== null);
      valid.sort(
        (a, b) =>
          new Date(a.summary.date).getTime() -
          new Date(b.summary.date).getTime(),
      );
      if (!cancelled) {
        setData(deduplicateTrackRuns(valid));
        setLoading(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [playerTrackSessionKey, getSession]);

  // Race analysis aggregations must stay before early returns so hook ordering
  // remains stable while async session details are still loading.
  const raceDataAll = useMemo(
    () => data.filter((d) => d.kind === "race"),
    [data],
  );
  const raceSessions = useMemo(
    () => raceDataAll.map((d) => d.session),
    [raceDataAll],
  );
  const compoundLifeStats = useMemo(
    () => aggregateCompoundLife(raceSessions),
    [raceSessions],
  );
  const allRaceSetupCandidates = useMemo(
    () => buildRaceSetupCandidates(raceDataAll),
    [raceDataAll],
  );
  const raceAnalysisBuckets = useMemo(
    () => buildRaceAnalysisBuckets(raceDataAll),
    [raceDataAll],
  );
  const defaultRaceAnalysisBucket = useMemo(
    () => getDefaultRaceAnalysisBucket(raceAnalysisBuckets),
    [raceAnalysisBuckets],
  );
  const selectedRaceAnalysisBucket = useMemo(() => {
    const requestedBucket = requestedRaceLaps
      ? raceAnalysisBuckets.find((bucket) => bucket.value === requestedRaceLaps)
      : undefined;
    return requestedBucket ?? defaultRaceAnalysisBucket;
  }, [defaultRaceAnalysisBucket, raceAnalysisBuckets, requestedRaceLaps]);
  const showRaceLengthSelector = raceAnalysisBuckets.length > 1;
  const selectedCompoundLifeStats = selectedRaceAnalysisBucket
    ? selectedRaceAnalysisBucket.compoundLifeStats
    : compoundLifeStats;
  // Race sessions in the selected length bucket, used by the Key Insights
  // recommendation and the bucket-scoped fuel stats. Use the bucket object even
  // when the selector is hidden so every Race-tab model shares one distance.
  const selectedRaceSessions = selectedRaceAnalysisBucket
    ? selectedRaceAnalysisBucket.sessions
    : raceSessions;
  const selectedTrackFuelStats = useMemo(
    () => aggregateFuelData(selectedRaceSessions),
    [selectedRaceSessions],
  );
  // Fastest online rival at this track — computed off raw session summaries
  // (not the race-length bucket) because pace comparisons stay valid across
  // short and long races, and at single-track scope we want all the evidence
  // we can get.
  const trackRivalBenchmark = useMemo(
    () =>
      buildTrackRivalBenchmark(
        sessions,
        activeFormulaKey,
        getSessionFormulaScopeKey,
        (s) => isTrackSlugMatch(s.track, trackId),
      ),
    [sessions, activeFormulaKey, trackId],
  );
  const selectedRaceSetupCandidates = selectedRaceAnalysisBucket
    ? selectedRaceAnalysisBucket.setupCandidates
    : allRaceSetupCandidates;
  const raceLengthOptions = raceAnalysisBuckets.map((bucket) => ({
    value: bucket.value,
    label: bucket.label,
  }));
  const selectedRaceLengthValue =
    selectedRaceAnalysisBucket?.value ?? raceLengthOptions[0]?.value ?? "";
  const selectedRaceLengthLabel =
    showRaceLengthSelector && selectedRaceAnalysisBucket
      ? `${selectedRaceAnalysisBucket.totalLaps}-lap`
      : undefined;
  const selectedTyreLifeRaceCount = selectedRaceAnalysisBucket
    ? selectedRaceAnalysisBucket.raceCount
    : raceDataAll.length;
  const selectedTyreLifeStintCount = selectedCompoundLifeStats.reduce(
    (sum, compound) => sum + compound.stintCount,
    0,
  );
  const spectatorHistory = [...spectatorTrackSessions].sort(
    (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime(),
  );
  const renderSpectatorSessionRow = (summary: SessionSummary) => {
    const metaParts = [
      `${formatDate(summary.date)} · ${formatTime(summary.date)}`,
      summary.weather,
      summary.isOnline
        ? "Online"
        : summary.aiDifficulty
          ? `AI ${summary.aiDifficulty}`
          : undefined,
      summary.classifiedDriverCount
        ? `${summary.classifiedDriverCount} drivers`
        : undefined,
    ].filter(Boolean);
    const trailingValue =
      summary.bestLapTime ?? `${summary.validLapCount} laps`;

    return (
      <SessionRow
        key={summary.relativePath}
        to={summary.isSynthetic ? null : sessionSummaryPath(summary)}
        leading={
          <>
            <span className="text-sm leading-none">
              {getSessionIcon(summary.sessionType)}
            </span>
            <span className="truncate text-sm font-medium text-zinc-100">
              {formatSessionType(summary.sessionType, summary.formula)}
            </span>
            <Badge tone="zinc">Spectator</Badge>
          </>
        }
        meta={metaParts.join(" · ")}
        trailing={
          <div className="inline-flex h-9 items-center justify-center rounded-lg bg-zinc-900/70 px-2.5 font-mono text-sm font-bold tabular-nums text-zinc-400 ring-1 ring-inset ring-white/[0.06]">
            {trailingValue}
          </div>
        }
      />
    );
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full text-zinc-500">
        Loading track data...
      </div>
    );
  }

  if (!data.length) {
    const isUploadWithNoData = mode === "upload" && sessions.length === 0;
    const hasOnlyOtherFormulaScopes =
      allTrackSessions.length > 0 && trackSessions.length === 0;
    const hasOnlySpectatorSessions =
      trackSessions.length > 0 &&
      playerTrackSessions.length === 0 &&
      spectatorTrackSessions.length > 0;
    const formulaLabel = activeFormula?.label ?? "selected formula";
    const otherTrackScopes = formulaOptions
      .map((option) => ({
        ...option,
        trackSessionCount: allTrackSessions.filter(
          (session) => getSessionFormulaScopeKey(session) === option.key,
        ).length,
      }))
      .filter(
        (option) =>
          option.key !== activeFormulaKey && option.trackSessionCount > 0,
      );

    if (hasOnlySpectatorSessions) {
      const oldest = spectatorHistory[spectatorHistory.length - 1];
      const newest = spectatorHistory[0];
      const spectatorDateRange =
        oldest && newest
          ? oldest.relativePath === newest.relativePath
            ? formatDate(newest.date)
            : `${formatDate(oldest.date)} — ${formatDate(newest.date)}`
          : "";

      return (
        <div className="p-6 max-w-5xl mx-auto space-y-6">
          <div>
            <h2 className="text-xl font-bold mb-1">
              <TrackFlag track={displayTrackName} className="mr-2" />
              {displayTrackName}
            </h2>
            <p className="text-sm text-zinc-500">
              {activeFormula?.showLabel ? `${activeFormula.label} · ` : ""}
              {spectatorTrackSessions.length} spectator session
              {spectatorTrackSessions.length !== 1 ? "s" : ""}
              {spectatorDateRange ? ` · ${spectatorDateRange}` : ""}
            </p>
          </div>

          <section className={cardClass}>
            <Badge tone="zinc">Spectator</Badge>
            <h3 className="mt-3 text-base font-semibold text-zinc-100">
              Spectator sessions only
            </h3>
            <p className="mt-1 max-w-2xl text-sm text-zinc-500">
              These saves do not mark any driver as the player, so they are kept
              out of PBs, tyre life, fuel, setup, and race-result calculations.
              You can still open each session to inspect the focused driver from
              the recording.
            </p>
          </section>

          <div>
            <div className="mb-3">
              <SectionHeader title="Session History" />
            </div>
            <div className="space-y-1.5">
              {spectatorHistory.map(renderSpectatorSessionRow)}
            </div>
          </div>
        </div>
      );
    }

    return (
      <div className="flex items-center justify-center h-full">
        <ActionEmptyState
          icon={isUploadWithNoData ? Upload : ArrowLeft}
          className="max-w-md"
          title={
            isUploadWithNoData
              ? "Track data not available"
              : hasOnlyOtherFormulaScopes
                ? `No ${formulaLabel} data for ${displayTrackName}`
                : "No sessions found"
          }
          message={
            isUploadWithNoData
              ? "Uploaded telemetry is stored in memory and lost when the browser is closed. Re-upload your .zip to continue."
              : hasOnlyOtherFormulaScopes
                ? `${displayTrackName} exists in another game scope. Scoped track pages stay strict so tyre life, PBs, setups, and history never mix incompatible data.`
                : `No sessions found for ${displayTrackName}.`
          }
          actions={
            isUploadWithNoData ? (
              <Button
                variant="primary"
                onClick={() => setShowUploadModal(true)}
              >
                Upload telemetry
              </Button>
            ) : hasOnlyOtherFormulaScopes ? (
              <HStack wrap justify="center" className="gap-2">
                {otherTrackScopes.map((option) => (
                  <Link
                    key={option.key}
                    to={trackPath(option.key, displayTrackName)}
                    className={buttonVariants({ variant: "secondary" })}
                  >
                    View {option.label} ({option.trackSessionCount})
                  </Link>
                ))}
                <Link
                  to={backToDashboardPath}
                  className={buttonVariants({ variant: "subtle" })}
                >
                  Back to dashboard
                </Link>
              </HStack>
            ) : (
              <Link
                to={backToDashboardPath}
                className={buttonVariants({ variant: "secondary" })}
              >
                Back to dashboard
              </Link>
            )
          }
        />
      </div>
    );
  }

  const trackAnalysis = buildTrackAnalysisData(data);
  const qualiData = trackAnalysis.qualifying.sessions;
  const raceData = trackAnalysis.raceData;
  const timeTrialData = trackAnalysis.timeTrial.sessions;
  const theoreticalBestS1 = trackAnalysis.qualifying.theoreticalS1;
  const theoreticalBestMs = trackAnalysis.qualifying.theoreticalBestMs;
  const actualBestQualiMs = trackAnalysis.qualifying.bestLapMs;
  const latestQuali = trackAnalysis.qualifying.latest;
  const qualifyingInsights = trackAnalysis.qualifyingInsights;
  const bestRaceLapMs = trackAnalysis.bestRaceLapMs;
  const bestQualiSession = trackAnalysis.qualifying.bestSession;
  const bestQualiSetup = trackAnalysis.qualifying.bestSetup;
  const theoreticalTimeTrialS1 = trackAnalysis.timeTrial.theoreticalS1;
  const theoreticalTimeTrialMs = trackAnalysis.timeTrial.theoreticalBestMs;
  const bestTimeTrialMs = trackAnalysis.timeTrial.bestLapMs;
  const timeTrialGapMs = trackAnalysis.timeTrial.gapToTheoreticalMs;
  const latestTimeTrial = trackAnalysis.timeTrial.latest;
  const bestTimeTrialSession = trackAnalysis.timeTrial.bestSession;
  const bestTimeTrialSetup = trackAnalysis.timeTrial.bestSetup;
  const lapTrend = trackAnalysis.qualifying.lapTrend;
  const sectorTrend = trackAnalysis.qualifying.sectorTrend;
  const consistencyTrend = trackAnalysis.qualifying.consistencyTrend;
  const timeTrialLapTrend = trackAnalysis.timeTrial.lapTrend;
  const timeTrialSectorTrend = trackAnalysis.timeTrial.sectorTrend;
  const timeTrialConsistencyTrend = trackAnalysis.timeTrial.consistencyTrend;
  const sectorCards = trackAnalysis.qualifying.sectorCards;
  const timeTrialSectorCards = trackAnalysis.timeTrial.sectorCards;
  const qualifyingScatter = trackAnalysis.qualifying.scatter;
  const timeTrialScatter = trackAnalysis.timeTrial.scatter;

  // Race-on-race representative pace per compound — feeds the Pace Evolution
  // chart. Uses bucket-scoped sessions so a 5-lap repro doesn't get plotted
  // against a 30-lap race in the same line. The set identity match is by
  // TelemetrySession reference, which is stable across renders here.
  const selectedRaceSessionSet = new Set(selectedRaceSessions);
  const paceEvolutionData = buildPaceEvolution(
    raceData
      .filter((d) => selectedRaceSessionSet.has(d.session))
      .map((d) => ({ session: d.session, date: d.summary.date })),
  );

  const tooltipStyle = TOOLTIP_STYLE;

  const sessionHistory = trackAnalysis.sessionHistory;
  const availableTabs = trackAnalysis.availableTabs;
  const selectedTab = availableTabs.includes(activeTab)
    ? activeTab
    : getPreferredTrackTab(availableTabs);
  const tabOptions = availableTabs.map((value) => ({
    value,
    label: TRACK_TAB_LABELS[value],
    mobileLabel: TRACK_TAB_MOBILE_LABELS[value],
    icon: getSessionTypeMeta(TRACK_TAB_META_LABEL[value]).icon,
  }));
  const handleRaceLengthChange = (raceLaps: string) => {
    const nextParams = new URLSearchParams(searchParams);
    nextParams.set("raceLaps", raceLaps);
    setSearchParams(nextParams);
  };
  const handleTabChange = (tab: TrackSessionKind) => {
    setActiveTab(tab);
    const nextParams = new URLSearchParams(searchParams);
    nextParams.set(TRACK_TAB_QUERY_PARAM, tab);
    setSearchParams(nextParams);
  };

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-8">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h2 className="text-xl font-bold mb-1">
            <TrackFlag
              track={displayTrackName}
              size="medium"
              className="mr-2 -translate-y-px"
            />
            {displayTrackName}
          </h2>
          <p className="text-sm text-zinc-500">
            {activeFormula?.showLabel ? `${activeFormula.label} · ` : ""}
            {data.length} session{data.length !== 1 ? "s" : ""}
            {bestTimeTrialSession && bestTimeTrialMs > 0 && (
              <>
                {" · "}
                <Link
                  to={sessionSummaryPath(bestTimeTrialSession.summary)}
                  className="inline-flex items-center gap-1 whitespace-nowrap text-zinc-400 transition-colors hover:text-cyan-200"
                >
                  <Gauge className="size-3 text-cyan-300" />
                  <span className="text-cyan-300/80">Best TT</span>
                  <span className="whitespace-nowrap font-mono text-zinc-300">
                    {msToLapTime(bestTimeTrialMs)}
                  </span>
                </Link>
              </>
            )}
          </p>
        </div>

        <VStack align="start" className="gap-2 sm:shrink-0 sm:items-end">
          {/* Tab switcher: interactive when multiple analysis buckets exist, static otherwise. */}
          {tabOptions.length > 1 && (
            <SegmentedControl<TrackSessionKind>
              ariaLabel="Session type"
              options={tabOptions}
              value={selectedTab}
              onChange={handleTabChange}
            />
          )}
          {tabOptions.length === 1 && (
            <SegmentedControl<TrackSessionKind>
              ariaLabel="Session type"
              options={tabOptions}
              value={tabOptions[0].value}
              onChange={() => {}}
            />
          )}
        </VStack>
      </div>

      {/* ── Qualifying Section ── */}
      {qualiData.length > 0 && selectedTab === "qualifying" && (
        <>
          {qualifyingInsights && (
            <TrackQualifyingInsights insights={qualifyingInsights} />
          )}

          {/* Best lap over time */}
          {lapTrend.length > 1 && (
            <section className={cardClass}>
              <SectionHeader title="Best Lap Over Time" />
              <ResponsiveContainer width="100%" height={240}>
                <LineChart
                  data={lapTrend}
                  margin={{ top: 5, right: 20, bottom: 5, left: 0 }}
                >
                  <CartesianGrid
                    strokeDasharray="3 3"
                    stroke={CHART_THEME.grid}
                  />
                  <XAxis
                    dataKey="day"
                    stroke={CHART_THEME.axis}
                    fontSize={11}
                  />
                  <YAxis
                    stroke={CHART_THEME.axis}
                    fontSize={11}
                    tickFormatter={(v) => msToLapTime(v * 1000)}
                    domain={["auto", "auto"]}
                  />
                  <Tooltip
                    {...tooltipStyle}
                    formatter={(value: number | undefined) => [
                      value ? msToLapTime(value * 1000) : "–",
                      "Best Lap",
                    ]}
                    labelFormatter={(v) => {
                      const entry = lapTrend.find((d) => d.day === v);
                      return entry?.fullDate ?? String(v);
                    }}
                  />
                  {theoreticalBestMs > 0 && (
                    <ReferenceLine
                      y={theoreticalBestMs / 1000}
                      stroke={CHART_THEME.ahead}
                      strokeDasharray="6 4"
                      strokeWidth={1.5}
                      label={{
                        value: "Theoretical",
                        fill: CHART_THEME.ahead,
                        fontSize: 10,
                        position: "right",
                      }}
                    />
                  )}
                  <Line
                    type="monotone"
                    dataKey="bestLap"
                    stroke={CHART_THEME.best}
                    strokeWidth={2}
                    dot={{ fill: CHART_THEME.best, r: 4 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </section>
          )}

          {/* Sector Gap Cards */}
          {latestQuali && theoreticalBestS1 > 0 && (
            <div className="grid grid-cols-3 gap-3">
              {sectorCards.map((s) => (
                <SectorBestTile
                  key={s.label}
                  label={`${s.label} — All-Time Best`}
                  bestMs={s.bestMs}
                  latestMs={s.latestMs}
                />
              ))}
            </div>
          )}

          {/* Sector improvement */}
          {sectorTrend.length > 1 && (
            <section className={cardClass}>
              <SectionHeader title="Sector Improvement" />
              <ResponsiveContainer width="100%" height={240}>
                <LineChart
                  data={sectorTrend}
                  margin={{ top: 5, right: 20, bottom: 5, left: 0 }}
                >
                  <CartesianGrid
                    strokeDasharray="3 3"
                    stroke={CHART_THEME.grid}
                  />
                  <XAxis
                    dataKey="idx"
                    stroke={CHART_THEME.axis}
                    fontSize={11}
                  />
                  <YAxis
                    stroke={CHART_THEME.axis}
                    fontSize={11}
                    tickFormatter={(v) => `${v.toFixed(1)}s`}
                    domain={["auto", "auto"]}
                  />
                  <Tooltip
                    {...tooltipStyle}
                    formatter={(
                      value: number | undefined,
                      name: string | undefined,
                    ) => [`${value?.toFixed(3) ?? "–"}s`, name ?? ""]}
                    labelFormatter={(v) => `Session ${v}`}
                  />
                  <Line
                    type="monotone"
                    dataKey="S1"
                    stroke={SECTOR_COLORS.S1}
                    strokeWidth={2}
                    dot={{ fill: SECTOR_COLORS.S1, r: 3 }}
                  />
                  <Line
                    type="monotone"
                    dataKey="S2"
                    stroke={SECTOR_COLORS.S2}
                    strokeWidth={2}
                    dot={{ fill: SECTOR_COLORS.S2, r: 3 }}
                  />
                  <Line
                    type="monotone"
                    dataKey="S3"
                    stroke={SECTOR_COLORS.S3}
                    strokeWidth={2}
                    dot={{ fill: SECTOR_COLORS.S3, r: 3 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </section>
          )}

          {/* All qualifying lap times scatter */}
          {qualifyingScatter.allPoints.length >= 2 && (
            <section className={cardClass}>
              <SectionHeader title="All Qualifying Lap Times" />
              <ResponsiveContainer width="100%" height={260}>
                <ScatterChart
                  margin={{ top: 5, right: 20, bottom: 5, left: 0 }}
                >
                  <CartesianGrid
                    strokeDasharray="3 3"
                    stroke={CHART_THEME.grid}
                  />
                  <XAxis
                    dataKey="idx"
                    type="number"
                    stroke={CHART_THEME.axis}
                    fontSize={11}
                    domain={[0.5, qualiData.length + 0.5]}
                    ticks={Array.from(
                      { length: qualiData.length },
                      (_, i) => i + 1,
                    )}
                    label={{
                      value: "Session",
                      position: "insideBottom",
                      offset: -2,
                      fill: CHART_THEME.axis,
                      fontSize: 11,
                    }}
                  />
                  <YAxis
                    dataKey="timeSec"
                    type="number"
                    stroke={CHART_THEME.axis}
                    fontSize={11}
                    tickFormatter={(v) => msToLapTime(v * 1000)}
                    domain={["auto", "auto"]}
                  />
                  <ZAxis range={[60, 60]} />
                  <Tooltip
                    {...tooltipStyle}
                    content={({ active, payload }) => {
                      if (!active || !payload?.length) return null;
                      const point = payload[0]?.payload as
                        | { timeSec: number; label: string }
                        | undefined;
                      if (!point) return null;
                      return (
                        <div
                          style={{
                            ...tooltipStyle.contentStyle,
                            padding: "8px 12px",
                            color: "#e4e4e7",
                          }}
                        >
                          <div
                            style={{
                              color: "#a1a1aa",
                              marginBottom: 4,
                              fontSize: 11,
                            }}
                          >
                            {point.label}
                          </div>
                          <div style={{ fontFamily: "monospace" }}>
                            {msToLapTime(point.timeSec * 1000)}
                          </div>
                        </div>
                      );
                    }}
                  />
                  <Scatter
                    data={qualifyingScatter.invalidPoints}
                    fill={CHART_THEME.behind}
                    fillOpacity={0.4}
                    shape="circle"
                  />
                  <Scatter
                    data={qualifyingScatter.validPoints}
                    fill={CHART_THEME.player}
                    fillOpacity={0.6}
                    shape="circle"
                  />
                  <Scatter
                    data={qualifyingScatter.bestPoints}
                    fill={CHART_THEME.best}
                    fillOpacity={1}
                    shape="circle"
                  />
                </ScatterChart>
              </ResponsiveContainer>
              <div className="flex gap-4 mt-2 text-xs text-zinc-500">
                <span className="flex items-center gap-1.5">
                  <span className="inline-block w-2.5 h-2.5 rounded-full bg-cyan-400" />
                  Valid lap
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="inline-block w-2.5 h-2.5 rounded-full bg-red-500/50" />
                  Invalid lap
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="inline-block w-3 h-3 rounded-full bg-purple-400" />
                  Best per session
                </span>
              </div>
            </section>
          )}

          {/* Consistency trend */}
          {consistencyTrend.length > 1 && (
            <section className={cardClass}>
              <SectionHeader title="Consistency Trend" />
              <ResponsiveContainer width="100%" height={180}>
                <LineChart
                  data={consistencyTrend}
                  margin={{ top: 5, right: 20, bottom: 5, left: 0 }}
                >
                  <CartesianGrid
                    strokeDasharray="3 3"
                    stroke={CHART_THEME.grid}
                  />
                  <XAxis
                    dataKey="idx"
                    stroke={CHART_THEME.axis}
                    fontSize={11}
                  />
                  <YAxis
                    stroke={CHART_THEME.axis}
                    fontSize={11}
                    tickFormatter={(v) => `${v.toFixed(1)}s`}
                  />
                  <Tooltip
                    {...tooltipStyle}
                    formatter={(value: number | undefined) => [
                      `${value?.toFixed(3) ?? "–"}s`,
                      "Std Dev",
                    ]}
                    labelFormatter={(v) => {
                      const entry = consistencyTrend.find((d) => d.idx === v);
                      return entry?.label ?? `Session ${v}`;
                    }}
                  />
                  <Line
                    type="monotone"
                    dataKey="stdDev"
                    stroke="#a78bfa"
                    strokeWidth={2}
                    dot={{ fill: "#a78bfa", r: 4 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </section>
          )}

          {/* Best qualifying setup */}
          {bestQualiSetup && bestQualiSession && (
            <section className={cardClass}>
              <SectionHeader
                title="Your Best Qualifying Setup"
                hint={
                  <>
                    From{" "}
                    <Link
                      to={sessionSummaryPath(bestQualiSession.summary)}
                      className="text-zinc-400 hover:text-zinc-200 transition-colors"
                    >
                      {formatSessionType(
                        bestQualiSession.summary.sessionType,
                        bestQualiSession.summary.formula,
                      )}{" "}
                      · {formatDate(bestQualiSession.summary.date)} ·{" "}
                      {msToLapTime(bestQualiSession.bestLapMs)}
                    </Link>
                  </>
                }
              />
              <CarSetupCard setup={bestQualiSetup} />
            </section>
          )}
        </>
      )}

      {/* ── Time Trial Section ── */}
      {timeTrialData.length > 0 && selectedTab === "time-trial" && (
        <>
          <SectionHeader
            title="Key Insights"
            hint={`${timeTrialData.length} attempt${timeTrialData.length === 1 ? "" : "s"}`}
          />

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <InsightTile title="Best TT Lap" icon={Timer} accent="purple">
              <InsightValue tone="text-best">
                {bestTimeTrialMs > 0 ? msToLapTime(bestTimeTrialMs) : "–"}
              </InsightValue>
            </InsightTile>
            <InsightTile
              title="Theoretical Best"
              icon={Target}
              accent="emerald"
            >
              <InsightValue tone="text-ahead">
                {theoreticalTimeTrialMs > 0
                  ? msToLapTime(theoreticalTimeTrialMs)
                  : "–"}
              </InsightValue>
            </InsightTile>
            <InsightTile
              title="Gap to Theoretical"
              icon={TimerReset}
              accent="amber"
            >
              <InsightValue tone="text-warning">
                {timeTrialGapMs > 0
                  ? `+${(timeTrialGapMs / 1000).toFixed(3)}s`
                  : "–"}
              </InsightValue>
            </InsightTile>
          </div>

          {timeTrialLapTrend.length > 1 && (
            <section className={cardClass}>
              <SectionHeader title="Best TT Lap Over Time" />
              <ResponsiveContainer width="100%" height={240}>
                <LineChart
                  data={timeTrialLapTrend}
                  margin={{ top: 5, right: 20, bottom: 5, left: 0 }}
                >
                  <CartesianGrid
                    strokeDasharray="3 3"
                    stroke={CHART_THEME.grid}
                  />
                  <XAxis
                    dataKey="day"
                    stroke={CHART_THEME.axis}
                    fontSize={11}
                  />
                  <YAxis
                    stroke={CHART_THEME.axis}
                    fontSize={11}
                    tickFormatter={(v) => msToLapTime(v * 1000)}
                    domain={["auto", "auto"]}
                  />
                  <Tooltip
                    {...tooltipStyle}
                    formatter={(value: number | undefined) => [
                      value ? msToLapTime(value * 1000) : "–",
                      "Best Lap",
                    ]}
                    labelFormatter={(v) => {
                      const entry = timeTrialLapTrend.find((d) => d.day === v);
                      return entry?.fullDate ?? String(v);
                    }}
                  />
                  {theoreticalTimeTrialMs > 0 && (
                    <ReferenceLine
                      y={theoreticalTimeTrialMs / 1000}
                      stroke={CHART_THEME.ahead}
                      strokeDasharray="6 4"
                      strokeWidth={1.5}
                      label={{
                        value: "Theoretical",
                        fill: CHART_THEME.ahead,
                        fontSize: 10,
                        position: "right",
                      }}
                    />
                  )}
                  <Line
                    type="monotone"
                    dataKey="bestLap"
                    stroke={CHART_THEME.best}
                    strokeWidth={2}
                    dot={{ fill: CHART_THEME.best, r: 4 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </section>
          )}

          {latestTimeTrial && theoreticalTimeTrialS1 > 0 && (
            <div className="grid grid-cols-3 gap-3">
              {timeTrialSectorCards.map((s) => (
                <SectorBestTile
                  key={s.label}
                  label={`${s.label} — TT Best`}
                  bestMs={s.bestMs}
                  latestMs={s.latestMs}
                />
              ))}
            </div>
          )}

          {timeTrialSectorTrend.length > 1 && (
            <section className={cardClass}>
              <SectionHeader title="TT Sector Improvement" />
              <ResponsiveContainer width="100%" height={240}>
                <LineChart
                  data={timeTrialSectorTrend}
                  margin={{ top: 5, right: 20, bottom: 5, left: 0 }}
                >
                  <CartesianGrid
                    strokeDasharray="3 3"
                    stroke={CHART_THEME.grid}
                  />
                  <XAxis
                    dataKey="idx"
                    stroke={CHART_THEME.axis}
                    fontSize={11}
                  />
                  <YAxis
                    stroke={CHART_THEME.axis}
                    fontSize={11}
                    tickFormatter={(v) => `${v.toFixed(1)}s`}
                    domain={["auto", "auto"]}
                  />
                  <Tooltip
                    {...tooltipStyle}
                    formatter={(
                      value: number | undefined,
                      name: string | undefined,
                    ) => [`${value?.toFixed(3) ?? "–"}s`, name ?? ""]}
                    labelFormatter={(v) => `Attempt ${v}`}
                  />
                  <Line
                    type="monotone"
                    dataKey="S1"
                    stroke={SECTOR_COLORS.S1}
                    strokeWidth={2}
                    dot={{ fill: SECTOR_COLORS.S1, r: 3 }}
                  />
                  <Line
                    type="monotone"
                    dataKey="S2"
                    stroke={SECTOR_COLORS.S2}
                    strokeWidth={2}
                    dot={{ fill: SECTOR_COLORS.S2, r: 3 }}
                  />
                  <Line
                    type="monotone"
                    dataKey="S3"
                    stroke={SECTOR_COLORS.S3}
                    strokeWidth={2}
                    dot={{ fill: SECTOR_COLORS.S3, r: 3 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </section>
          )}

          {timeTrialScatter.allPoints.length >= 2 && (
            <section className={cardClass}>
              <SectionHeader title="All Time Trial Lap Times" />
              <ResponsiveContainer width="100%" height={260}>
                <ScatterChart
                  margin={{ top: 5, right: 20, bottom: 5, left: 0 }}
                >
                  <CartesianGrid
                    strokeDasharray="3 3"
                    stroke={CHART_THEME.grid}
                  />
                  <XAxis
                    dataKey="idx"
                    type="number"
                    stroke={CHART_THEME.axis}
                    fontSize={11}
                    domain={[0.5, timeTrialData.length + 0.5]}
                    ticks={Array.from(
                      { length: timeTrialData.length },
                      (_, i) => i + 1,
                    )}
                    label={{
                      value: "Attempt",
                      position: "insideBottom",
                      offset: -2,
                      fill: CHART_THEME.axis,
                      fontSize: 11,
                    }}
                  />
                  <YAxis
                    dataKey="timeSec"
                    type="number"
                    stroke={CHART_THEME.axis}
                    fontSize={11}
                    tickFormatter={(v) => msToLapTime(v * 1000)}
                    domain={["auto", "auto"]}
                  />
                  <ZAxis range={[60, 60]} />
                  <Tooltip
                    {...tooltipStyle}
                    content={({ active, payload }) => {
                      if (!active || !payload?.length) return null;
                      const point = payload[0]?.payload as
                        | { timeSec: number; label: string }
                        | undefined;
                      if (!point) return null;
                      return (
                        <div
                          style={{
                            ...tooltipStyle.contentStyle,
                            padding: "8px 12px",
                            color: "#e4e4e7",
                          }}
                        >
                          <div
                            style={{
                              color: "#a1a1aa",
                              marginBottom: 4,
                              fontSize: 11,
                            }}
                          >
                            {point.label}
                          </div>
                          <div style={{ fontFamily: "monospace" }}>
                            {msToLapTime(point.timeSec * 1000)}
                          </div>
                        </div>
                      );
                    }}
                  />
                  <Scatter
                    data={timeTrialScatter.invalidPoints}
                    fill={CHART_THEME.behind}
                    fillOpacity={0.4}
                    shape="circle"
                  />
                  <Scatter
                    data={timeTrialScatter.validPoints}
                    fill={CHART_THEME.player}
                    fillOpacity={0.6}
                    shape="circle"
                  />
                  <Scatter
                    data={timeTrialScatter.bestPoints}
                    fill={CHART_THEME.best}
                    fillOpacity={1}
                    shape="circle"
                  />
                </ScatterChart>
              </ResponsiveContainer>
              <div className="flex gap-4 mt-2 text-xs text-zinc-500">
                <span className="flex items-center gap-1.5">
                  <span className="inline-block w-2.5 h-2.5 rounded-full bg-cyan-400" />
                  Valid lap
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="inline-block w-2.5 h-2.5 rounded-full bg-red-500/50" />
                  Invalid lap
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="inline-block w-3 h-3 rounded-full bg-purple-400" />
                  Best per attempt
                </span>
              </div>
            </section>
          )}

          {timeTrialConsistencyTrend.length > 1 && (
            <section className={cardClass}>
              <SectionHeader title="TT Consistency Trend" />
              <ResponsiveContainer width="100%" height={180}>
                <LineChart
                  data={timeTrialConsistencyTrend}
                  margin={{ top: 5, right: 20, bottom: 5, left: 0 }}
                >
                  <CartesianGrid
                    strokeDasharray="3 3"
                    stroke={CHART_THEME.grid}
                  />
                  <XAxis
                    dataKey="idx"
                    stroke={CHART_THEME.axis}
                    fontSize={11}
                  />
                  <YAxis
                    stroke={CHART_THEME.axis}
                    fontSize={11}
                    tickFormatter={(v) => `${v.toFixed(1)}s`}
                  />
                  <Tooltip
                    {...tooltipStyle}
                    formatter={(value: number | undefined) => [
                      `${value?.toFixed(3) ?? "–"}s`,
                      "Std Dev",
                    ]}
                    labelFormatter={(v) => {
                      const entry = timeTrialConsistencyTrend.find(
                        (d) => d.idx === v,
                      );
                      return entry?.label ?? `Attempt ${v}`;
                    }}
                  />
                  <Line
                    type="monotone"
                    dataKey="stdDev"
                    stroke="#a78bfa"
                    strokeWidth={2}
                    dot={{ fill: "#a78bfa", r: 4 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </section>
          )}

          {bestTimeTrialSetup && bestTimeTrialSession && (
            <section className={cardClass}>
              <SectionHeader
                title="Your Best Time Trial Setup"
                hint={
                  <>
                    From{" "}
                    <Link
                      to={sessionSummaryPath(bestTimeTrialSession.summary)}
                      className="text-zinc-400 hover:text-zinc-200 transition-colors"
                    >
                      {formatSessionType(
                        bestTimeTrialSession.summary.sessionType,
                        bestTimeTrialSession.summary.formula,
                      )}{" "}
                      · {formatDate(bestTimeTrialSession.summary.date)} ·{" "}
                      {msToLapTime(bestTimeTrialSession.bestLapMs)}
                    </Link>
                  </>
                }
              />
              <CarSetupCard setup={bestTimeTrialSetup} />
            </section>
          )}
        </>
      )}

      {/* ── Race Section ── */}
      {raceData.length > 0 &&
        selectedTab === "race" &&
        (() => {
          // Shared recommendation drives Key Insights AND the Strategy section
          // below Compound Tyre Life. Both reuse the same wear/pace synthesis so
          // there's a single source of truth per race-length bucket.
          const recommendation = buildTrackRaceRecommendation(
            selectedRaceSessions,
            selectedCompoundLifeStats,
            selectedTrackFuelStats,
            {
              bestQualiLapMs: actualBestQualiMs,
              pitLossRaceSessions: raceSessions,
            },
          );
          const strategyTotalLaps =
            recommendation?.recommended?.stintLaps.reduce(
              (sum, n) => sum + n,
              0,
            ) ?? 0;
          return (
            <>
              {/* Key Insights — synthesizes the rest of the tab into "what should
                I actually do here?". Reacts to the same race-length selector that
                drives the Compound Tyre Life cards below. */}
              {recommendation && (
                <TrackKeyInsights
                  recommendation={recommendation}
                  raceLengthLabel={selectedRaceLengthLabel}
                  rivalBenchmark={trackRivalBenchmark}
                />
              )}

              {/* Compound tyre life cards */}
              {selectedCompoundLifeStats.length > 0 && (
                <div>
                  <SectionHeader
                    title="Compound Tyre Life"
                    action={
                      showRaceLengthSelector && selectedRaceAnalysisBucket ? (
                        <div className="flex max-w-full items-center gap-2">
                          <span className="shrink-0 font-mono text-xs font-medium uppercase tracking-wider text-zinc-600">
                            Race length
                          </span>
                          <SegmentedControl
                            ariaLabel="Race length"
                            options={raceLengthOptions}
                            value={selectedRaceLengthValue}
                            onChange={handleRaceLengthChange}
                            size="sm"
                            scrollable
                          />
                        </div>
                      ) : undefined
                    }
                  />
                  <div
                    className="grid gap-2"
                    style={{
                      gridTemplateColumns: `repeat(${Math.min(selectedCompoundLifeStats.length, 4)}, minmax(0, 1fr))`,
                    }}
                  >
                    {selectedCompoundLifeStats.map((cs) => (
                      <CompoundStatCard
                        key={cs.compound}
                        compound={cs.compound}
                        hero={{
                          value: `~${cs.estMaxLife}`,
                          label: "pit by lap",
                        }}
                        rows={[
                          ...(cs.bestLapMs > 0
                            ? [
                                {
                                  label: "Best lap",
                                  value: msToLapTime(cs.bestLapMs),
                                  className: "font-mono text-best",
                                },
                              ]
                            : []),
                          {
                            label: "Avg worst/lap",
                            value: `${cs.avgWearRatePerLap.toFixed(1)}%/lap`,
                            divider: cs.bestLapMs > 0,
                          },
                          {
                            label: "Stints",
                            value: `${cs.avgStintLength}–${cs.longestStint} laps`,
                          },
                        ]}
                      />
                    ))}
                  </div>
                  <p className="text-xs text-zinc-600 mt-1.5">
                    Pit lap estimated at {PUNCTURE_THRESHOLD}% worst-wheel wear
                    (puncture risk threshold), based on{" "}
                    {selectedTyreLifeStintCount} stint
                    {selectedTyreLifeStintCount !== 1 ? "s" : ""} across{" "}
                    {selectedTyreLifeRaceCount}{" "}
                    {selectedRaceLengthLabel
                      ? `${selectedRaceLengthLabel} `
                      : ""}
                    race{selectedTyreLifeRaceCount !== 1 ? "s" : ""}.
                  </p>
                </div>
              )}

              {/* Strategy — ranks feasible wear-gated shapes by bucket-scoped
                tyre pace/wear plus same-track or default pit-loss time. */}
              {recommendation?.recommended && strategyTotalLaps > 0 && (
                <TrackStrategySection
                  recommended={recommendation.recommended}
                  alternative={recommendation.alternative}
                  totalLaps={strategyTotalLaps}
                  raceLengthLabel={selectedRaceLengthLabel}
                />
              )}

              {/* Pace evolution (race-on-race race-pace window per compound) */}
              {paceEvolutionData.length > 1 && (
                <PaceEvolutionChart data={paceEvolutionData} />
              )}

              {/* Race setup comparison */}
              {selectedRaceSetupCandidates.length > 0 && (
                <RaceSetupComparison
                  candidates={selectedRaceSetupCandidates}
                  raceLengthLabel={selectedRaceLengthLabel}
                />
              )}
            </>
          );
        })()}

      {/* ── Session History ── */}
      <div>
        <div className="mb-3">
          <SectionHeader title="Session History" />
        </div>
        <div className="space-y-1.5">
          {sessionHistory.map((d) => {
            const metaParts: string[] = [
              `${formatDate(d.summary.date)} · ${formatTime(d.summary.date)}`,
            ];
            if (d.weather) metaParts.push(d.weather);
            if (d.trackTemp > 0)
              metaParts.push(`T:${d.trackTemp}° A:${d.airTemp}°`);
            if (d.aiDifficulty > 0) metaParts.push(`AI ${d.aiDifficulty}`);
            if (d.topSpeed > 0) metaParts.push(`${d.topSpeed} km/h`);
            if (d.wearRate > 0)
              metaParts.push(`${d.wearRate.toFixed(1)}%/lap wear`);

            // Purple = all-time best at this track for the row's session category
            // (pole for qualifying, fastest race lap for races). Matches the
            // "session best" purple convention used elsewhere (LapTimeChart, etc.).
            const isAllTimeBest =
              d.bestLapMs > 0 &&
              (d.isRace
                ? d.bestLapMs === bestRaceLapMs
                : d.kind === "time-trial"
                  ? d.bestLapMs === bestTimeTrialMs
                  : d.bestLapMs === actualBestQualiMs);

            return (
              <SessionRow
                key={d.summary.relativePath}
                to={sessionSummaryPath(d.summary)}
                leading={
                  <>
                    <span className="text-sm leading-none">
                      {getSessionIcon(d.summary.sessionType)}
                    </span>
                    <span className="truncate text-sm font-medium text-zinc-100">
                      {formatSessionType(
                        d.summary.sessionType,
                        d.summary.formula,
                      )}
                    </span>
                    {d.attemptCount > 1 && (
                      <Badge tone="amber">×{d.attemptCount}</Badge>
                    )}
                  </>
                }
                meta={metaParts.join(" · ")}
                trailing={
                  <div
                    className={cn(
                      "inline-flex h-9 items-center justify-center rounded-lg px-2.5 font-mono text-sm font-bold tabular-nums",
                      d.bestLapMs <= 0
                        ? "ring-1 ring-inset ring-white/[0.06] bg-zinc-900/70 text-zinc-500"
                        : isAllTimeBest
                          ? cn(accentCardClass("purple"), "text-best")
                          : cn(accentCardClass("cyan"), "text-cyan-300"),
                    )}
                  >
                    {d.bestLapMs > 0 ? msToLapTime(d.bestLapMs) : "—"}
                  </div>
                }
              />
            );
          })}
          {spectatorHistory.length > 0 && (
            <>
              <div className="px-3 pb-1 pt-4 text-xs text-zinc-600">
                Spectator saves are shown for inspection only and do not affect
                player PBs, setup picks, tyre life, fuel, or race-result
                calculations.
              </div>
              {spectatorHistory.map(renderSpectatorSessionRow)}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * "All-Time Best Sector" / "TT Best Sector" tile. Uses the shared `InsightTile`
 * shell so these cards live in the same visual family as the dashboard and
 * Race-tab key-insight grids — accent-tinted surface, mono uppercase eyebrow,
 * and an accent-colored hero number. Per the design rule, only the number
 * itself is tinted; the "Latest" line and delta stay neutral/semantic.
 */
function SectorBestTile({
  label,
  bestMs,
  latestMs,
}: {
  label: string;
  bestMs: number;
  latestMs: number;
}) {
  const deltaMs = latestMs > 0 && bestMs > 0 ? latestMs - bestMs : 0;
  return (
    <InsightTile title={label} icon={Timer} accent="purple">
      <InsightValue size="md" tone="text-best">
        {bestMs > 0 ? msToSectorTime(bestMs) : "–"}
      </InsightValue>
      {latestMs > 0 && (
        <InsightDetail size="sm" tone="text-zinc-500" className="mt-1">
          <span className="text-zinc-500">Latest: </span>
          <span className="font-mono text-zinc-300">
            {msToSectorTime(latestMs)}
          </span>
          {deltaMs > 0 && (
            <span className="font-mono text-warning ml-1">
              +{(deltaMs / 1000).toFixed(3)}
            </span>
          )}
          {deltaMs === 0 && bestMs > 0 && (
            <span className="font-mono text-ahead ml-1">PB</span>
          )}
        </InsightDetail>
      )}
    </InsightTile>
  );
}
