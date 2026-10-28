import {
  ArrowLeft,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
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
import { CompoundStatCard } from "../components/CompoundStatCard";
import { PaceEvolutionChart } from "../components/track/PaceEvolutionChart";
import { TyreLifeEvidenceBar } from "../components/track/TyreLifeEvidenceBar";
import { TrackPaceTrends } from "../components/track/TrackPaceTrends";
import { TrackStrategySection } from "../components/track/TrackStrategySection";
import { TrackOutline } from "../components/TrackOutline";
import { TrendChart, type TrendPoint } from "../components/charts/TrendChart";
import {
  Panel,
  SetupSheet,
  WorthList,
} from "../components/session/SessionParts";
import { SessionLog } from "../components/sessions/SessionLog";
import { LapTelemetrySection } from "../components/lap-telemetry/LapTelemetrySection";
import {
  LAPS_QUERY_PARAM,
  recordingFormulaKey,
} from "../analysis/lapTelemetrySelection";
import { TrackFlag } from "../components/TrackFlag";
import { Badge } from "../components/ui/Badge";
import { Button, buttonVariants } from "../components/ui/Button";
import { SectionHeader } from "../components/ui/SectionHeader";
import { SegmentedControl } from "../components/ui/SegmentedControl";
import { HStack } from "../components/ui/Stack";
import { useTelemetry } from "../context/TelemetryContext";
import { useLapRecordingList } from "../hooks/useLapRecordings";
import { useSessionList } from "../hooks/useSessionList";
import {
  buildRaceAnalysisBuckets,
  buildTrackAnalysisData,
  buildTrackSessionData,
  deduplicateTrackRuns,
  getDefaultRaceAnalysisBucket,
  getPreferredTrackTab,
  type TrackSessionData,
  type TrackSessionKind,
} from "../analysis/trackAnalysis";
import {
  buildTrackBriefing,
  type TrackBriefingItem,
} from "../analysis/trackBriefing";
import { buildTrackSetups, type TrackSetups } from "../analysis/trackSetups";
import { buildSessionLog, sessionBestLapMs } from "../analysis/sessionLog";
import { sessionKindLabel, summaryKind } from "../analysis/sessionKind";
import type { TrackIndexEntry } from "../analysis/trackIndex";
import type {
  TrackRaceRecommendation,
  TrackStrategySuggestion,
} from "../analysis/trackStrategyTypes";
import { formatSetupText } from "../analysis/shareText";
import { useTrackIndex } from "../hooks/useSessionLog";
import type { SessionSummary } from "../types/telemetry";
import type { CompoundLifeStats } from "../utils/stats/trackAggregates";
import { getCompoundColor } from "../utils/colors";
import { cn } from "../utils/cn";
import { getSessionFormulaScopeKey } from "../utils/formulaScope";
import { formatDate, msToLapTime } from "../utils/format";
import {
  getTrackCountryName,
  getTrackDisplayName,
  getTrackId,
  isTrackSlugMatch,
} from "../utils/tracks";
import {
  dashboardPath,
  isTrackPageTab,
  isTrackSessionTab,
  sessionSummaryPath,
  trackPath,
  trackTabForSessionType,
  tracksPath,
} from "../utils/routes";
import {
  TRACK_PAGE_TABS,
  TRACK_TAB_QUERY_PARAM,
  type TrackPageTab,
} from "../constants/routes";
import { aggregateCompoundLife } from "../utils/stats/trackAggregates";
import {
  PEAK_PACE_LABEL,
  PEAK_PACE_TOOLTIP,
  PEAK_PACE_WINDOW,
} from "../utils/stats/peakPace";
import { buildPaceEvolution } from "../utils/stats/trackPaceEvolution";
import { buildTrackRaceRecommendation } from "../analysis/trackRaceRecommendation";
import { PUNCTURE_THRESHOLD } from "../utils/stats/tyres";

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
  const [pageTab, setPageTab] = useState<TrackPageTab>(() =>
    isTrackPageTab(requestedTab) ? requestedTab : "overview",
  );
  // The kind whose laps the Lap telemetry tab shows; spectator and
  // recorded-laps-only states reuse it for their single list.
  const [lapKindChoice, setLapKindChoice] = useState<TrackSessionKind | null>(
    () => (isTrackSessionTab(requestedTab) ? requestedTab : null),
  );
  const activeTab: TrackSessionKind = isTrackSessionTab(pageTab)
    ? pageTab
    : (lapKindChoice ?? "race");
  const trackIndex = useTrackIndex();
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
    if (isTrackPageTab(requestedTab)) setPageTab(requestedTab);
    else if (!requestedTab) setPageTab("overview");
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
      <div className="flex items-center justify-center h-full text-tone-500">
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
            <p className="text-sm text-tone-500">
              {activeFormula?.showLabel ? `${activeFormula.label} · ` : ""}
              {spectatorTrackSessions.length} spectator session
              {spectatorTrackSessions.length !== 1 ? "s" : ""}
              {spectatorDateRange ? ` · ${spectatorDateRange}` : ""}
            </p>
          </div>

          <section className={cardClass}>
            <Badge tone="zinc">Spectator</Badge>
            <h3 className="mt-3 text-base font-semibold text-tone-100">
              Spectator sessions only
            </h3>
            <p className="mt-1 max-w-2xl text-sm text-tone-500">
              These saves do not mark any driver as the player, so they are kept
              out of PBs, tyre life, fuel, setup, and race-result calculations.
              You can still open each session to inspect the focused driver from
              the recording.
            </p>
          </section>

          <SessionLog
            days={buildSessionLog(spectatorHistory)}
            isPb={() => false}
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
            <p className="text-sm text-tone-500">
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
  const bestTimeTrialMs = trackAnalysis.timeTrial.bestLapMs;
  const availableKinds = trackAnalysis.availableTabs;

  // Race-on-race peak pace per compound for the selected race length.
  const selectedRaceSessionSet = new Set(selectedRaceSessions);
  const paceEvolutionData = buildPaceEvolution(
    raceData
      .filter((d) => selectedRaceSessionSet.has(d.session))
      .map((d) => ({ session: d.session, date: d.summary.date })),
  );
  // Shared by the Overview race plan and the Race tab's strategy section.
  const recommendation = buildTrackRaceRecommendation(
    selectedRaceSessions,
    selectedCompoundLifeStats,
    selectedTrackFuelStats,
    { bestQualiLapMs: actualBestQualiMs, pitLossRaceSessions: raceSessions },
  );
  const briefing = buildTrackBriefing({
    data,
    recommendation,
    compoundLife: selectedCompoundLifeStats,
  });
  const setups = buildTrackSetups(data);

  const tabs = TRACK_PAGE_TABS.filter((tab) => {
    if (tab === "qualifying") return qualiData.length > 0;
    if (tab === "race") return raceData.length > 0;
    if (tab === "time-trial") return timeTrialData.length > 0;
    return true;
  });
  const selectedTab = tabs.includes(pageTab) ? pageTab : "overview";
  const lapKind: TrackSessionKind = isTrackSessionTab(lapKindChoice)
    ? lapKindChoice
    : getPreferredTrackTab(availableKinds);

  const setTab = (tab: TrackPageTab) => {
    setPageTab(tab);
    const nextParams = new URLSearchParams(searchParams);
    if (tab === "overview") nextParams.delete(TRACK_TAB_QUERY_PARAM);
    else nextParams.set(TRACK_TAB_QUERY_PARAM, tab);
    nextParams.delete(LAPS_QUERY_PARAM);
    setSearchParams(nextParams, { replace: true });
  };
  const handleRaceLengthChange = (raceLaps: string) => {
    const nextParams = new URLSearchParams(searchParams);
    nextParams.set("raceLaps", raceLaps);
    setSearchParams(nextParams, { replace: true });
  };

  // ‹ › walk the calendar among tracks driven in this scope, keeping the tab.
  const calendarIndex = trackIndex.entries.findIndex(
    (entry) => entry.trackId === canonicalTrackId,
  );
  const previousTrack =
    calendarIndex > 0 ? trackIndex.entries[calendarIndex - 1] : undefined;
  const nextTrack =
    calendarIndex >= 0 ? trackIndex.entries[calendarIndex + 1] : undefined;
  const trackLink = (trackKey: string) =>
    activeFormulaKey
      ? trackPath(
          activeFormulaKey,
          trackKey,
          selectedTab === "overview" ? undefined : selectedTab,
        )
      : "#";

  const onlineQualiBest = qualiData
    .filter((d) => d.summary.isOnline && d.bestLapMs > 0)
    .sort((a, b) => a.bestLapMs - b.bestLapMs)[0];
  const bestRaceLap = raceData
    .filter((d) => d.bestLapMs > 0)
    .sort((a, b) => a.bestLapMs - b.bestLapMs)[0];
  const bestTimeTrialSession = trackAnalysis.timeTrial.bestSession;
  const pbItems: {
    label: string;
    ms: number;
    note: string;
    to?: string;
    best?: boolean;
  }[] = [];
  if (actualBestQualiMs > 0 && trackAnalysis.qualifying.bestSession) {
    pbItems.push({
      label: "Quali PB",
      ms: actualBestQualiMs,
      note: formatShortDate(trackAnalysis.qualifying.bestSession.summary.date),
      to: sessionSummaryPath(trackAnalysis.qualifying.bestSession.summary),
      best: true,
    });
  }
  if (onlineQualiBest && onlineQualiBest.bestLapMs !== actualBestQualiMs) {
    pbItems.push({
      label: "Online quali",
      ms: onlineQualiBest.bestLapMs,
      note: `${formatShortDate(onlineQualiBest.summary.date)}${onlineQualiBest.summary.qualifyingPosition ? ` · P${onlineQualiBest.summary.qualifyingPosition}` : ""}`,
      to: sessionSummaryPath(onlineQualiBest.summary),
    });
  }
  if (bestRaceLap) {
    pbItems.push({
      label: "Race best lap",
      ms: bestRaceLap.bestLapMs,
      note: formatShortDate(bestRaceLap.summary.date),
      to: sessionSummaryPath(bestRaceLap.summary),
    });
  }
  if (bestTimeTrialSession && bestTimeTrialMs > 0) {
    pbItems.push({
      label: "Time trial",
      ms: bestTimeTrialMs,
      note: formatShortDate(bestTimeTrialSession.summary.date),
      to: sessionSummaryPath(bestTimeTrialSession.summary),
    });
  }

  const qualiTrend: TrendPoint[] = (() => {
    const byDay = new Map<string, number>();
    for (const d of qualiData) {
      if (d.bestLapMs <= 0) continue;
      const day = d.summary.date.split("T")[0];
      byDay.set(day, Math.min(byDay.get(day) ?? Infinity, d.bestLapMs));
    }
    const points = [...byDay].sort(([a], [b]) => a.localeCompare(b));
    const best = Math.min(...points.map(([, ms]) => ms));
    return points.map(([day, ms]) => ({
      key: day,
      label: formatShortDate(day),
      ms,
      pb: ms === best,
    }));
  })();
  const trendGain =
    qualiTrend.length > 1
      ? qualiTrend[0].ms - Math.min(...qualiTrend.map((p) => p.ms))
      : 0;

  const trackSessionLog = buildSessionLog(
    trackSessions.filter((s) => s.isSpectator !== true),
  );
  const pbByTrack = actualBestQualiMs;
  const isPbSession = (s: SessionSummary) =>
    summaryKind(s) === "qualifying" && sessionBestLapMs(s) === pbByTrack;

  const openBriefing = (item: TrackBriefingItem) => {
    if (item.sessionSlug) {
      const session = sessions.find((s) => s.slug === item.sessionSlug);
      if (session) navigate(sessionSummaryPath(session));
      return;
    }
    if (tabs.includes(item.target as TrackPageTab))
      setTab(item.target as TrackPageTab);
  };

  const raceLengthSelector =
    showRaceLengthSelector && selectedRaceAnalysisBucket ? (
      <SegmentedControl
        ariaLabel="Race length"
        options={raceLengthOptions}
        value={selectedRaceLengthValue}
        onChange={handleRaceLengthChange}
        size="sm"
        scrollable
      />
    ) : null;

  const plan = recommendation?.recommended;
  // Sector splits for the map, from the newest session that reports them
  // (older exports write 0).
  const sectorStarts = (() => {
    for (let i = data.length - 1; i >= 0; i--) {
      const info = data[i].session["session-info"] as unknown as Record<
        string,
        unknown
      >;
      const length = Number(info["track-length"]);
      const s2 = Number(info["sector-2-lap-distance-start"]);
      const s3 = Number(info["sector-3-lap-distance-start"]);
      if (length > 0 && s2 > 0 && s3 > s2 && s3 < length) {
        return [s2 / length, s3 / length] as const;
      }
    }
    return null;
  })();

  return (
    <div className="mx-auto max-w-6xl px-4 pt-5 pb-16 sm:px-6">
      <section className="relative overflow-hidden rounded-2xl bg-tone-900 p-5 ring-1 ring-tone-800 sm:p-7">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(120%_140%_at_85%_30%,color-mix(in_oklab,var(--color-brand)_8%,transparent)_0%,transparent_55%)]"
        />
        <div className="pointer-events-none absolute inset-y-6 right-7 hidden w-[44%] md:block">
          <TrackOutline
            track={trackSourceName}
            glow
            detail={{ level: "full", sectorStarts }}
            className="h-full w-full"
          />
        </div>
        <div className="relative max-w-xl">
          <div className="text-xs text-tone-500">
            <Link
              to={activeFormulaKey ? tracksPath(activeFormulaKey) : "/"}
              className="hover:text-tone-200"
            >
              Tracks
            </Link>{" "}
            ›{" "}
            <TrackFlag
              track={trackSourceName}
              className="mx-0.5 -translate-y-px"
            />{" "}
            {getTrackCountryName(trackSourceName) ?? displayTrackName}
          </div>
          <div className="mt-1 flex items-center gap-2">
            <h1 className="text-5xl font-bold tracking-tighter text-tone-50 sm:text-6xl">
              {displayTrackName}
            </h1>
            <TrackSwitcher
              current={canonicalTrackId}
              entries={trackIndex.entries}
              linkFor={trackLink}
            />
            <div className="ml-1 flex gap-1.5 self-center">
              {[previousTrack, nextTrack].map((entry, i) => (
                <Link
                  key={i}
                  to={entry ? trackLink(entry.trackId) : "#"}
                  aria-disabled={!entry}
                  title={entry ? getTrackDisplayName(entry.track) : undefined}
                  className={cn(
                    "grid size-8 place-items-center rounded-lg text-tone-200 ring-1 ring-tone-800 hover:bg-tone-800",
                    !entry && "pointer-events-none opacity-35",
                  )}
                >
                  {i === 0 ? (
                    <ChevronLeft className="size-4" />
                  ) : (
                    <ChevronRight className="size-4" />
                  )}
                </Link>
              ))}
            </div>
          </div>
          <p className="mt-1 text-sm text-tone-500">
            {activeFormula?.showLabel ? `${activeFormula.label} · ` : ""}
            {playerTrackSessions.length} session
            {playerTrackSessions.length !== 1 ? "s" : ""}
            {data.length > 0 &&
              ` · last driven ${formatShortDate(data[data.length - 1].summary.date)}`}
          </p>
          {pbItems.length > 0 && (
            <div className="mt-6 grid grid-cols-2 gap-x-8 gap-y-4 sm:flex sm:flex-wrap">
              {pbItems.map((item) => (
                <Link key={item.label} to={item.to ?? "#"} className="group">
                  <div className="text-xs text-tone-500">{item.label}</div>
                  <div
                    className={cn(
                      "mt-0.5 font-mono text-xl font-semibold tracking-tight",
                      item.best ? "text-best" : "text-tone-50",
                    )}
                  >
                    {msToLapTime(item.ms)}
                  </div>
                  <div className="text-xs text-tone-500 group-hover:text-tone-300">
                    {item.note}
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>
      </section>

      <div
        role="tablist"
        className="mt-5 flex gap-5 overflow-x-auto border-b border-tone-800 text-sm"
      >
        {tabs.map((tab) => (
          <button
            key={tab}
            type="button"
            role="tab"
            aria-selected={tab === selectedTab}
            onClick={() => setTab(tab)}
            className={cn(
              "-mb-px border-b-2 pb-2.5 whitespace-nowrap transition-colors",
              tab === selectedTab
                ? "border-tone-50 font-medium text-tone-50"
                : "border-transparent text-tone-400 hover:text-tone-100",
            )}
          >
            {TRACK_PAGE_TAB_LABELS[tab]}
            {tab === "sessions" && (
              <span className="ml-1 text-tone-500">
                {playerTrackSessions.length}
              </span>
            )}
          </button>
        ))}
      </div>

      <div className="mt-5 space-y-5">
        {selectedTab === "overview" && (
          <>
            <div className="grid gap-5 lg:grid-cols-2">
              {qualiTrend.length > 1 ? (
                <Panel
                  title="Qualifying progress"
                  hint="Best lap per day"
                  action={
                    trendGain > 0 ? (
                      <span className="text-sm text-ahead">
                        −{(trendGain / 1000).toFixed(3)} s since{" "}
                        {qualiTrend[0].label}
                      </span>
                    ) : undefined
                  }
                >
                  <TrendChart points={qualiTrend} height={240} />
                </Panel>
              ) : (
                <Panel title="Qualifying progress">
                  <p className="text-sm text-tone-500">
                    One qualifying day here so far.
                  </p>
                </Panel>
              )}
              <Panel
                title="Race plan"
                hint={
                  recommendation
                    ? `From your ${recommendation.totalLaps}-lap races here`
                    : "Race here to build a plan"
                }
                action={raceLengthSelector}
              >
                {plan ? (
                  <RacePlanSummary
                    plan={plan}
                    alternative={recommendation?.alternative ?? null}
                    totalLaps={recommendation!.totalLaps}
                    fuel={recommendation?.fuelTarget ?? null}
                    life={selectedCompoundLifeStats}
                    setup={setups.race}
                    onOpenRace={() => setTab("race")}
                    onOpenSetups={() => setTab("setups")}
                  />
                ) : (
                  <p className="text-sm text-tone-500">
                    No race with tyre data at this length yet. A long run is
                    enough to start one.
                  </p>
                )}
              </Panel>
            </div>
            <WorthList
              title="Before you race here"
              items={briefing}
              onOpen={(target) => {
                const item = briefing.find((b) => b.target === target);
                if (item) openBriefing(item);
              }}
            />
          </>
        )}

        {selectedTab === "qualifying" && qualiData.length > 0 && (
          <TrackPaceTrends pace={trackAnalysis.qualifying} sectorTitle="best" />
        )}

        {selectedTab === "time-trial" && timeTrialData.length > 0 && (
          <TrackPaceTrends
            pace={trackAnalysis.timeTrial}
            sectorTitle="best in time trial"
          />
        )}

        {selectedTab === "race" && raceData.length > 0 && (
          <>
            {raceLengthSelector && (
              <div className="flex flex-wrap items-center justify-end gap-2">
                <span className="text-xs text-tone-500">Race length</span>
                {raceLengthSelector}
              </div>
            )}
            {selectedCompoundLifeStats.length > 0 && (
              <div>
                <SectionHeader
                  title="Tyre life"
                  hint={`${selectedRaceAnalysisBucket ? `${selectedRaceAnalysisBucket.totalLaps}-lap races · ` : ""}${selectedTyreLifeStintCount} stint${selectedTyreLifeStintCount !== 1 ? "s" : ""} across ${selectedTyreLifeRaceCount} race${selectedTyreLifeRaceCount !== 1 ? "s" : ""}`}
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
                <p className="mt-1.5 text-xs text-tone-500">
                  Solid = longest green-flag run on that compound and the
                  worst-wheel wear it added; stripes = projection to the{" "}
                  {PUNCTURE_THRESHOLD}% puncture risk threshold along your
                  stints&apos; wear curves. {PEAK_PACE_LABEL} is the mean of
                  your fastest {PEAK_PACE_WINDOW} clean laps.
                </p>
              </div>
            )}
            {recommendation?.hasEvidence && (
              <TrackStrategySection
                recommended={recommendation.recommended}
                alternative={recommendation.alternative}
                wetStrategies={recommendation.wetStrategies}
                totalLaps={recommendation.totalLaps}
                raceLengthLabel={selectedRaceLengthLabel}
              />
            )}
            {paceEvolutionData.length > 1 && (
              <PaceEvolutionChart data={paceEvolutionData} />
            )}
          </>
        )}

        {selectedTab === "lap-telemetry" && activeFormulaKey && (
          <>
            {availableKinds.length > 1 && (
              <SegmentedControl<TrackSessionKind>
                ariaLabel="Laps from"
                options={availableKinds.map((value) => ({
                  value,
                  label: TRACK_KIND_LABELS[value],
                }))}
                value={lapKind}
                onChange={(value) => {
                  setLapKindChoice(value);
                  const nextParams = new URLSearchParams(searchParams);
                  nextParams.delete(LAPS_QUERY_PARAM);
                  setSearchParams(nextParams, { replace: true });
                }}
              />
            )}
            <LapTelemetrySection
              key={lapKind}
              scope={{
                kind: "track",
                track: trackSourceName,
                formulaKey: activeFormulaKey,
                sessionKind: lapKind,
              }}
            />
          </>
        )}

        {selectedTab === "setups" && <TrackSetupsTab setups={setups} />}

        {selectedTab === "sessions" && (
          <SessionLog days={trackSessionLog} isPb={isPbSession} />
        )}
      </div>
    </div>
  );
}

const TRACK_PAGE_TAB_LABELS: Record<TrackPageTab, string> = {
  overview: "Overview",
  qualifying: "Qualifying",
  race: "Race",
  "time-trial": "Time trial",
  "lap-telemetry": "Lap telemetry",
  setups: "Setups",
  sessions: "Sessions",
};

const TRACK_KIND_LABELS: Record<TrackSessionKind, string> = {
  qualifying: "Qualifying",
  race: "Race",
  "time-trial": "Time trial",
};

function formatShortDate(date: string): string {
  return new Date(
    date.length <= 10 ? `${date}T12:00:00` : date,
  ).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
  });
}

function TrackSwitcher({
  current,
  entries,
  linkFor,
}: {
  current: string;
  entries: TrackIndexEntry[];
  linkFor: (trackId: string) => string;
}) {
  const [open, setOpen] = useState(false);
  if (entries.length < 2) return null;
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label="Switch track"
        className="grid size-8 place-items-center rounded-lg text-tone-500 hover:bg-tone-800 hover:text-tone-100"
      >
        <ChevronDown className="size-5" />
      </button>
      {open && (
        <div className="absolute top-full left-0 z-40 mt-1.5 max-h-96 w-80 overflow-y-auto rounded-xl bg-tone-900 p-1.5 shadow-2xl shadow-tone-1000/40 ring-1 ring-tone-800">
          <div className="px-2.5 pt-1.5 pb-1 text-xs text-tone-500">
            Calendar order · switching keeps your tab
          </div>
          {entries.map((entry) => (
            <Link
              key={entry.trackId}
              to={linkFor(entry.trackId)}
              onClick={() => setOpen(false)}
              className={cn(
                "flex items-center justify-between gap-4 rounded-lg px-2.5 py-1.5 text-sm",
                entry.trackId === current
                  ? "bg-active/10 text-tone-50"
                  : "text-tone-200 hover:bg-tone-800",
              )}
            >
              <span className="flex items-center gap-2">
                <TrackFlag track={entry.track} />
                {getTrackDisplayName(entry.track)}
              </span>
              <span className="font-mono text-xs text-tone-400">
                {entry.qualiPbMs ? msToLapTime(entry.qualiPbMs) : "—"} ·{" "}
                {entry.sessionCount}
              </span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

function StintBar({
  plan,
  thin = false,
}: {
  plan: TrackStrategySuggestion;
  thin?: boolean;
}) {
  const total = plan.stintLaps.reduce((a, b) => a + b, 0) || 1;
  return (
    <div className={cn("flex gap-0.5", thin ? "h-5" : "h-7")}>
      {plan.compounds.map((compound, i) => (
        <div
          key={i}
          className="grid place-items-center rounded-md text-xs font-semibold"
          style={{
            flex: plan.stintLaps[i] / total,
            backgroundColor: getCompoundColor(compound),
            color:
              compound === "Soft" || compound === "Wet" ? "#fff" : "#18181b",
          }}
        >
          {thin
            ? `${compound.charAt(0)} · ${plan.stintLaps[i]}`
            : `${compound} · ${plan.stintLaps[i]}`}
        </div>
      ))}
    </div>
  );
}

function RacePlanSummary({
  plan,
  alternative,
  totalLaps,
  fuel,
  life,
  setup,
  onOpenRace,
  onOpenSetups,
}: {
  plan: TrackStrategySuggestion;
  alternative: TrackStrategySuggestion | null;
  totalLaps: number;
  fuel: TrackRaceRecommendation["fuelTarget"];
  life: CompoundLifeStats[];
  setup: TrackSetups["race"];
  onOpenRace: () => void;
  onOpenSetups: () => void;
}) {
  const predicted = plan.timeEstimate?.predictedTotalRaceMs;
  return (
    <div>
      <div className="text-xs text-tone-500">
        Recommended{predicted ? ` · ~${formatRaceTime(predicted)}` : ""} ·{" "}
        {totalLaps} laps
      </div>
      <div className="mt-1.5">
        <StintBar plan={plan} />
      </div>
      {plan.pitWindows.length > 0 && (
        <p className="mt-1.5 text-xs text-tone-400">
          {plan.pitWindows
            .map(
              (w, i) =>
                `Pit ${plan.pitWindows.length > 1 ? `${i + 1} ` : ""}lap ${w.target} (${w.earliest}–${w.latest})`,
            )
            .join(" · ")}
        </p>
      )}
      {alternative && (
        <>
          <div className="mt-4 text-xs text-tone-500">
            Alternative
            {alternative.timeEstimate
              ? ` · +${(alternative.timeEstimate.deltaToFastestMs / 1000).toFixed(1)} s`
              : ""}
          </div>
          <div className="mt-1.5">
            <StintBar plan={alternative} thin />
          </div>
        </>
      )}
      <div className="mt-4 grid grid-cols-2 gap-4 border-t border-tone-800 pt-3 text-sm">
        {fuel && (
          <div>
            <div className="text-xs text-tone-500">Start fuel</div>
            <div className="font-semibold text-tone-50">
              {fuel.recommendedFuelKg.toFixed(1)} kg
            </div>
            <div className="text-xs text-tone-500">
              {fuel.recommendedDeltaLaps >= 0 ? "+" : ""}
              {fuel.recommendedDeltaLaps.toFixed(1)} laps · {fuel.confidence}{" "}
              confidence
            </div>
          </div>
        )}
        {life.length > 0 && (
          <div>
            <div className="text-xs text-tone-500">
              Tyre life to {PUNCTURE_THRESHOLD}%
            </div>
            <div className="font-semibold text-tone-50">
              {life
                .map((c) => `${c.compound.charAt(0)} ${c.estMaxLife}`)
                .join(" · ")}
            </div>
            <div className="text-xs text-tone-500">
              laps, projected from your stints
            </div>
          </div>
        )}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-tone-800 pt-3 text-sm">
        {setup && (
          <button
            type="button"
            onClick={onOpenSetups}
            className="text-left text-tone-400 hover:text-tone-100"
          >
            Setup{" "}
            <b className="font-mono font-semibold text-tone-100">
              {formatSetupText(setup.setup)
                .split("\n")[0]
                .replace("Aerodynamics: ", "")}
            </b>{" "}
            from {formatShortDate(setup.data.summary.date)} →
          </button>
        )}
        <button
          type="button"
          onClick={onOpenRace}
          className="ml-auto text-tone-500 hover:text-tone-100"
        >
          Full strategy →
        </button>
      </div>
    </div>
  );
}

function formatRaceTime(ms: number): string {
  const totalSeconds = Math.round(ms / 1000);
  return `${Math.floor(totalSeconds / 60)}:${String(totalSeconds % 60).padStart(2, "0")}`;
}

function TrackSetupsTab({ setups }: { setups: TrackSetups }) {
  const [qualiChoice, setQualiChoice] = useState<"fastest" | "latest">(
    "fastest",
  );
  const quali =
    qualiChoice === "fastest" ? setups.qualiFastest : setups.qualiLatest;
  const sessionLabel = (use: NonNullable<TrackSetups["race"]>) =>
    `${use.data.summary.isOnline ? "Online" : "Practice"} ${sessionKindLabel(use.kind).toLowerCase()} · ${formatShortDate(use.data.summary.date)}`;
  if (!setups.qualiFastest && !setups.race) {
    return (
      <p className="text-sm text-tone-500">
        No setups recorded here yet: the game exports your own setup with each
        save.
      </p>
    );
  }
  return (
    <>
      <div className="grid gap-5 lg:grid-cols-2">
        {quali && (
          <Panel>
            <div className="mb-3 flex items-center justify-between gap-3">
              <span className="text-xs text-tone-500">Qualifying setup</span>
              {setups.qualiLatest &&
                setups.qualiFastest &&
                setups.qualiLatest !== setups.qualiFastest && (
                  <div className="flex rounded-lg bg-tone-800/60 p-0.5 text-xs">
                    {(["fastest", "latest"] as const).map((value) => (
                      <button
                        key={value}
                        type="button"
                        onClick={() => setQualiChoice(value)}
                        className={cn(
                          "rounded-md px-2.5 py-1",
                          qualiChoice === value
                            ? "bg-tone-900 text-tone-50 ring-1 ring-tone-700"
                            : "text-tone-400",
                        )}
                      >
                        {value === "fastest" ? "Fastest" : "Latest"}
                      </button>
                    ))}
                  </div>
                )}
            </div>
            <SetupSheet
              setup={quali.setup}
              title={
                <>
                  {qualiChoice === "fastest" ? "PB lap" : "Latest"}{" "}
                  <span
                    className={cn(
                      "font-mono",
                      qualiChoice === "fastest" && "text-best",
                    )}
                  >
                    {msToLapTime(quali.data.bestLapMs)}
                  </span>
                </>
              }
              meta={sessionLabel(quali)}
            />
          </Panel>
        )}
        {setups.race && (
          <Panel>
            <div className="mb-3 flex items-center justify-between gap-3">
              <span className="text-xs text-tone-500">Race setup</span>
              <span className="text-xs text-tone-500">
                {setups.raceIsFastest
                  ? "latest, and your fastest race lap here"
                  : "latest"}
              </span>
            </div>
            <SetupSheet
              setup={setups.race.setup}
              title={
                <>
                  Best lap{" "}
                  <span className="font-mono">
                    {msToLapTime(setups.race.data.bestLapMs)}
                  </span>
                </>
              }
              meta={sessionLabel(setups.race)}
            />
          </Panel>
        )}
      </div>
      <Panel
        title="Every setup you've run here"
        hint="Newest first. Brake bias changed from the wheel doesn't count as a new setup."
      >
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-tone-500">
                <th className="py-2 pr-4 font-normal">Last used</th>
                <th className="py-2 pr-4 font-normal">Used for</th>
                <th className="py-2 pr-4 font-normal">Aero</th>
                <th className="py-2 pr-4 font-normal">Diff</th>
                <th className="py-2 pr-4 font-normal">ARB</th>
                <th className="py-2 pr-4 text-right font-normal">Sessions</th>
                <th className="py-2 text-right font-normal">Best lap</th>
              </tr>
            </thead>
            <tbody>
              {setups.history.map((group) => {
                const lines = Object.fromEntries(
                  formatSetupText(group.setup)
                    .split("\n")
                    .map((line) => line.split(/:\s*/)),
                );
                const isPb =
                  setups.qualiFastest &&
                  group.bestLapMs === setups.qualiFastest.data.bestLapMs;
                return (
                  <tr key={group.key} className="border-t border-tone-800/70">
                    <td className="py-2 pr-4 text-tone-300">
                      {formatShortDate(group.lastDate)}
                    </td>
                    <td className="py-2 pr-4 text-tone-300">
                      {group.kinds.map((k) => sessionKindLabel(k)).join(", ")}
                    </td>
                    <td className="py-2 pr-4 font-mono text-tone-100">
                      {lines.Aerodynamics}
                    </td>
                    <td className="py-2 pr-4 font-mono text-tone-100">
                      {lines.Transmission}
                    </td>
                    <td className="py-2 pr-4 font-mono text-tone-100">
                      {lines.Suspension?.split(" ")[1]}
                    </td>
                    <td className="py-2 pr-4 text-right text-tone-400">
                      {group.sessionCount}
                    </td>
                    <td
                      className={cn(
                        "py-2 text-right font-mono",
                        isPb ? "text-best" : "text-tone-100",
                      )}
                    >
                      {msToLapTime(group.bestLapMs)}
                      <span className="ml-1.5 font-sans text-xs text-tone-500">
                        {sessionKindLabel(group.bestKind).toLowerCase()}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Panel>
    </>
  );
}
