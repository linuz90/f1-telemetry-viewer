import {
  ArrowLeft,
  Gauge,
  Target,
  Timer,
  TimerReset,
  Upload,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  Link,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router-dom";
import { ActionEmptyState } from "../components/ActionEmptyState";
import { cardClass } from "../components/Card";
import { CarSetupCard } from "../components/CarSetupCard";
import { CompoundStatCard } from "../components/CompoundStatCard";
import { EventLocationPieChart } from "../components/EventLocationPieChart";
import { RaceSetupComparison } from "../components/RaceSetupComparison";
import { TRACK_KIND_META } from "../components/sessionTypeMeta";
import { PaceEvolutionChart } from "../components/track/PaceEvolutionChart";
import { TyreLifeEvidenceBar } from "../components/track/TyreLifeEvidenceBar";
import { TrackKeyInsights } from "../components/track/TrackKeyInsights";
import { TrackPaceTrends } from "../components/track/TrackPaceTrends";
import { TrackQualifyingInsights } from "../components/track/TrackQualifyingInsights";
import { TrackSessionHistory } from "../components/track/TrackSessionHistory";
import { TrackStrategySection } from "../components/track/TrackStrategySection";
import { LapTelemetrySection } from "../components/lap-telemetry/LapTelemetrySection";
import {
  LAPS_QUERY_PARAM,
  recordingFormulaKey,
} from "../analysis/lapTelemetrySelection";
import { TrackFlag } from "../components/TrackFlag";
import { Badge } from "../components/ui/Badge";
import { Button, buttonVariants } from "../components/ui/Button";
import { InsightValue } from "../components/ui/InsightText";
import { InsightTile } from "../components/ui/InsightTile";
import { SectionHeader } from "../components/ui/SectionHeader";
import { SegmentedControl } from "../components/ui/SegmentedControl";
import { HStack, VStack } from "../components/ui/Stack";
import { useTelemetry } from "../context/TelemetryContext";
import { useLapRecordingList } from "../hooks/useLapRecordings";
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
import {
  buildTrackLocationBreakdowns,
  hasLocationBreakdownEvents,
} from "../analysis/eventLocationBreakdown";
import { buildTrackRivalBenchmark } from "../analysis/rivalStats";
import { getSessionFormulaScopeKey } from "../utils/formulaScope";
import { formatDate, formatSessionType, msToLapTime } from "../utils/format";
import { getRaceControlEvents } from "../utils/raceControl";
import {
  getTrackDisplayName,
  getTrackId,
  isTrackSlugMatch,
} from "../utils/tracks";
import {
  dashboardPath,
  isTrackSessionTab,
  sessionSummaryPath,
  trackPath,
  trackTabForSessionType,
} from "../utils/routes";
import { TRACK_TAB_QUERY_PARAM } from "../constants/routes";
import { aggregateCompoundLife } from "../utils/stats/trackAggregates";
import {
  PEAK_PACE_LABEL,
  PEAK_PACE_TOOLTIP,
  PEAK_PACE_WINDOW,
} from "../utils/stats/peakPace";
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

export function TrackProgressPage() {
  const { trackId } = useParams<{ trackId: string }>();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { sessions } = useSessionList();
  const { recordings: lapRecordings } = useLapRecordingList();
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
  const canonicalTrackId = trackId ? getTrackId(trackId) : "";
  const search = searchParams.toString();

  useEffect(() => {
    if (
      !activeFormulaKey ||
      !trackId ||
      !canonicalTrackId ||
      trackId === canonicalTrackId
    ) {
      return;
    }

    // Old exporter-derived routes remain valid, then settle on the canonical
    // circuit id so NavLink state and copied URLs stay consistent.
    navigate(
      {
        pathname: trackPath(activeFormulaKey, canonicalTrackId),
        search: search ? `?${search}` : "",
      },
      { replace: true },
    );
  }, [activeFormulaKey, canonicalTrackId, navigate, search, trackId]);

  useEffect(() => {
    if (isTrackSessionTab(requestedTab)) {
      setActiveTab(requestedTab);
    }
  }, [requestedTab]);

  // Route slugs are canonical circuit ids (`yas-marina`), while telemetry may
  // use country, city, or circuit names. Match through the shared resolver so
  // exporter vocabulary changes cannot split one circuit's history.
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

  // A friend's imported laps can be all that is recorded at a circuit.
  const recordedLapTabs = useMemo(
    () => [
      ...new Set(
        lapRecordings
          .filter(
            // The section opens on eligible bests only.
            (recording) =>
              recording.drivers.some((driver) => driver.best) &&
              isTrackSlugMatch(recording.track, trackId) &&
              recordingFormulaKey(recording) === activeFormulaKey,
          )
          .map((recording) => trackTabForSessionType(recording.sessionType)),
      ),
    ],
    [activeFormulaKey, lapRecordings, trackId],
  );

  // Keep the exporter value for metadata lookup; presentation uses the curated name.
  const trackSourceName =
    allTrackSessions.length > 0 ? allTrackSessions[0].track : (trackId ?? "");
  const displayTrackName = getTrackDisplayName(trackSourceName);
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
  // Overtake/collision locations aggregated across every race at this track.
  // Location distribution isn't race-length dependent, so we pool all races
  // (not the length bucket) for the strongest sample. Races without located
  // incidents are excluded from the pies (see helper) and reported via
  // excludedRaceCount so we can note the coverage.
  const raceEventLists = useMemo(
    () => raceSessions.map((session) => getRaceControlEvents(session)),
    [raceSessions],
  );
  const {
    overtakes: overtakeLocations,
    collisions: collisionLocations,
    events: locationEvents,
    locatedRaceCount,
    excludedRaceCount,
  } = useMemo(
    () => buildTrackLocationBreakdowns(raceEventLists),
    [raceEventLists],
  );
  const hasLocationEvents = useMemo(
    () => hasLocationBreakdownEvents(locationEvents),
    [locationEvents],
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
  // Race sessions in the selected length bucket, used by Key Insights and
  // strategy. Fuel stays null without an eligible bucket so sparse evidence
  // from incompatible race distances can never be pooled as a fallback.
  const selectedRaceSessions = selectedRaceAnalysisBucket
    ? selectedRaceAnalysisBucket.sessions
    : raceSessions;
  const selectedTrackFuelStats = selectedRaceAnalysisBucket?.fuelStats ?? null;
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
              <TrackFlag track={trackSourceName} className="mr-2" />
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

          <TrackSessionHistory
            activeKind={activeTab}
            spectatorSessions={spectatorHistory}
          />
        </div>
      );
    }

    if (activeFormulaKey && recordedLapTabs.length > 0) {
      const lapTab = recordedLapTabs.includes(activeTab)
        ? activeTab
        : recordedLapTabs[0];
      return (
        <div className="p-6 max-w-5xl mx-auto space-y-6">
          <div>
            <h2 className="text-xl font-bold mb-1">
              <TrackFlag track={trackSourceName} className="mr-2" />
              {displayTrackName}
            </h2>
            <p className="text-sm text-zinc-500">
              {activeFormula?.showLabel ? `${activeFormula.label} · ` : ""}
              No sessions of yours here yet, only recorded laps
            </p>
          </div>
          <LapTelemetrySection
            key={lapTab}
            scope={{
              kind: "track",
              track: trackSourceName,
              formulaKey: activeFormulaKey,
              sessionKind: lapTab,
            }}
          />
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
                    to={trackPath(option.key, trackSourceName)}
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
  const actualBestQualiMs = trackAnalysis.qualifying.bestLapMs;
  const qualifyingInsights = trackAnalysis.qualifyingInsights;
  const bestQualiSession = trackAnalysis.qualifying.bestSession;
  const bestQualiSetup = trackAnalysis.qualifying.bestSetup;
  const theoreticalTimeTrialMs = trackAnalysis.timeTrial.theoreticalBestMs;
  const bestTimeTrialMs = trackAnalysis.timeTrial.bestLapMs;
  const timeTrialGapMs = trackAnalysis.timeTrial.gapToTheoreticalMs;
  const bestTimeTrialSession = trackAnalysis.timeTrial.bestSession;
  const bestTimeTrialSetup = trackAnalysis.timeTrial.bestSetup;

  // Race-on-race peak pace per compound — feeds Peak Pace Evolution
  // chart. Uses bucket-scoped sessions so a 5-lap repro doesn't get plotted
  // against a 30-lap race in the same line. The set identity match is by
  // TelemetrySession reference, which is stable across renders here.
  const selectedRaceSessionSet = new Set(selectedRaceSessions);
  const paceEvolutionData = buildPaceEvolution(
    raceData
      .filter((d) => selectedRaceSessionSet.has(d.session))
      .map((d) => ({ session: d.session, date: d.summary.date })),
  );

  const availableTabs = trackAnalysis.availableTabs;
  const selectedTab = availableTabs.includes(activeTab)
    ? activeTab
    : getPreferredTrackTab(availableTabs);
  const tabOptions = availableTabs.map((value) => ({
    value,
    label: TRACK_TAB_LABELS[value],
    mobileLabel: TRACK_TAB_MOBILE_LABELS[value],
    icon: TRACK_KIND_META[value].icon,
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
    // A lap selection belongs to one tab's session kind.
    nextParams.delete(LAPS_QUERY_PARAM);
    setSearchParams(nextParams);
  };

  // Qualifying and Time Trial put it right under Key Insights: the tiles say
  // how far off a lap is, the recorded laps say where. Race places it after
  // Strategy. Renders nothing without recordings.
  const lapTelemetry = activeFormulaKey ? (
    <LapTelemetrySection
      key={selectedTab}
      scope={{
        kind: "track",
        track: trackSourceName,
        formulaKey: activeFormulaKey,
        sessionKind: selectedTab,
      }}
    />
  ) : null;

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-8">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h2 className="text-xl font-bold mb-1">
            <TrackFlag
              track={trackSourceName}
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

          {lapTelemetry}

          <TrackPaceTrends
            pace={trackAnalysis.qualifying}
            sectorTitle="All-Time Best"
          />

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

          {lapTelemetry}

          <TrackPaceTrends
            pace={trackAnalysis.timeTrial}
            sectorTitle="TT Best"
          />

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
          // below Tyre Life. Both reuse the same wear/pace synthesis so
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
          return (
            <>
              {showRaceLengthSelector && selectedRaceAnalysisBucket && (
                <div className="flex max-w-full flex-wrap items-center justify-end gap-2">
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
              )}

              {/* Key Insights — synthesizes the rest of the tab into "what should
                I actually do here?". Reacts to the same race-length selector that
                drives the Tyre Life cards below. */}
              {recommendation && (
                <TrackKeyInsights
                  recommendation={recommendation}
                  raceLengthLabel={selectedRaceLengthLabel}
                  rivalBenchmark={trackRivalBenchmark}
                />
              )}

              {/* Tyre life cards. The hero is a stint length (laps to the
                puncture threshold), not a race lap: the Strategy section owns
                pit laps. Practice races are mostly partial, so the bar shows
                how far real driving went before the projection takes over. */}
              {selectedCompoundLifeStats.length > 0 && (
                <div>
                  <SectionHeader
                    title="Tyre Life"
                    hint={`${
                      selectedRaceAnalysisBucket
                        ? `${selectedRaceAnalysisBucket.totalLaps}-lap races · `
                        : ""
                    }${selectedTyreLifeStintCount} stint${
                      selectedTyreLifeStintCount !== 1 ? "s" : ""
                    } across ${selectedTyreLifeRaceCount} race${
                      selectedTyreLifeRaceCount !== 1 ? "s" : ""
                    }`}
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
                        subtitle={`${cs.stintCount} stint${cs.stintCount !== 1 ? "s" : ""}`}
                        hero={{
                          value: `~${cs.estMaxLife} laps`,
                          label: `to ${PUNCTURE_THRESHOLD}% wear`,
                        }}
                        belowHero={
                          <TyreLifeEvidenceBar
                            compound={cs.compound}
                            seenLaps={cs.longestGreenRun}
                            seenWear={cs.longestGreenRunWear}
                            estLife={cs.estMaxLife}
                          />
                        }
                        rows={[
                          ...(cs.bestLapMs > 0
                            ? [
                                {
                                  label: "Best lap",
                                  value: msToLapTime(cs.bestLapMs),
                                  className: "font-mono text-best",
                                  divider: true,
                                },
                              ]
                            : []),
                          ...(cs.peakPaceMs > 0
                            ? [
                                {
                                  label: PEAK_PACE_LABEL,
                                  note: `${cs.peakPaceLapCount} laps`,
                                  tooltip: PEAK_PACE_TOOLTIP,
                                  value: msToLapTime(cs.peakPaceMs),
                                  divider: cs.bestLapMs <= 0,
                                },
                              ]
                            : []),
                          {
                            label: "Wear",
                            value: `${cs.avgWearRatePerLap.toFixed(1)}%/lap`,
                            divider: true,
                          },
                          {
                            label: "Avg stint",
                            value: `${cs.avgStintLength} laps`,
                          },
                        ]}
                      />
                    ))}
                  </div>
                  <p className="text-xs text-zinc-600 mt-1.5">
                    Solid = longest green-flag run on that compound and the
                    worst-wheel wear it added; stripes = projection to the{" "}
                    {PUNCTURE_THRESHOLD}% puncture risk threshold along your
                    stints&apos; wear curves. {PEAK_PACE_LABEL} is the mean of
                    your fastest {PEAK_PACE_WINDOW} clean laps.
                  </p>
                </div>
              )}

              {/* Strategy — ranks feasible wear-gated shapes by bucket-scoped
                tyre pace/wear plus same-track or default pit-loss time, with
                separate wet plans when Inters/Full Wet stints exist. */}
              {recommendation?.hasEvidence && (
                <TrackStrategySection
                  recommended={recommendation.recommended}
                  alternative={recommendation.alternative}
                  wetStrategies={recommendation.wetStrategies}
                  totalLaps={recommendation.totalLaps}
                  raceLengthLabel={selectedRaceLengthLabel}
                />
              )}

              {/* The race plan above is what this tab is opened for, so the
                recorded laps follow it instead of splitting it up. */}
              {lapTelemetry}

              {/* Peak three-lap pace evolution, race-on-race by compound. */}
              {paceEvolutionData.length > 1 && (
                <PaceEvolutionChart data={paceEvolutionData} />
              )}

              {/* Where overtakes and collisions happen at this track,
                  aggregated across the races that carry location data. Gated on
                  total (not located) events so tracks whose races lack location
                  fields still render the cards with an explanation instead of
                  silently disappearing. */}
              {hasLocationEvents && (
                <div>
                  <div className="grid gap-6 md:grid-cols-2">
                    <section className={cardClass}>
                      <EventLocationPieChart
                        title="Overtake Locations"
                        unit="overtake"
                        breakdown={overtakeLocations}
                        emptyMessage="No overtakes were recorded at this track."
                        source={{
                          events: locationEvents,
                          messageType: "OVERTAKE",
                        }}
                        pitLaneToggle
                      />
                    </section>
                    <section className={cardClass}>
                      <EventLocationPieChart
                        title="Collision Locations"
                        unit="collision"
                        breakdown={collisionLocations}
                        emptyMessage="No collisions were recorded at this track."
                      />
                    </section>
                  </div>
                  {locatedRaceCount > 0 && excludedRaceCount > 0 && (
                    <p className="mt-2 text-xs text-zinc-600">
                      Based on {locatedRaceCount} race
                      {locatedRaceCount === 1 ? "" : "s"} with track-location
                      data. {excludedRaceCount} race
                      {excludedRaceCount === 1 ? "" : "s"} without
                      track-location data{" "}
                      {excludedRaceCount === 1 ? "is" : "are"} excluded.
                    </p>
                  )}
                </div>
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

      <TrackSessionHistory
        activeKind={selectedTab}
        sessions={trackAnalysis.sessionHistory}
        spectatorSessions={spectatorHistory}
      />
    </div>
  );
}
