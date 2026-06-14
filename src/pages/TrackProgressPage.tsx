import { useEffect, useState, useMemo } from "react";
import { useParams, Link, useSearchParams } from "react-router-dom";
import {
  LineChart,
  Line,
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ZAxis,
  ReferenceLine,
} from "recharts";
import { useSessionList } from "../hooks/useSessionList";
import { useTelemetry } from "../context/TelemetryContext";
import type { SessionSummary, TelemetrySession } from "../types/telemetry";
import { findPlayer, getBestLapTime, lapTimeStdDev, avgWearRate, getValidLaps, isRaceSession, aggregateCompoundLife, aggregateFuelData } from "../utils/stats";
import { msToLapTime, msToSectorTime, formatSessionType, formatTime, formatDate, isLapValid, getSessionIcon, bestSectorTimeMs, isTrackSlugMatch } from "../utils/format";
import { TrackFlag } from "../components/TrackFlag";
import { CompoundStatCard } from "../components/CompoundStatCard";
import { CHART_THEME, TOOLTIP_STYLE, SECTOR_COLORS } from "../utils/colors";
import { getSessionFormulaScopeKey } from "../utils/dashboardStats";
import { dashboardPath, sessionSummaryPath, trackPath } from "../utils/routes";
import { accentCardClass, cardClass, cardClassFeature } from "../components/Card";
import { Upload, ArrowLeft, Gauge } from "lucide-react";
import { CarSetupCard } from "../components/CarSetupCard";
import { RaceSetupComparison } from "../components/RaceSetupComparison";
import { SessionRow } from "../components/SessionRow";
import { SegmentedControl } from "../components/ui/SegmentedControl";
import { SectionHeader } from "../components/ui/SectionHeader";
import { Badge } from "../components/ui/Badge";
import { HStack, VStack } from "../components/ui/Stack";
import { buildRaceSetupComparison } from "../utils/setupComparison";
import type { CompoundLifeStats } from "../utils/stats";
import type { RaceSetupCandidate, RaceSetupRunInput } from "../utils/setupComparison";

interface LapPoint {
  timeSec: number;
  valid: boolean;
  lapNum: number;
}

type TrackSessionKind = "qualifying" | "race" | "time-trial";

const TRACK_TAB_LABELS: Record<TrackSessionKind, string> = {
  qualifying: "Qualifying",
  race: "Race",
  "time-trial": "Time Trial",
};

interface TrackSessionData {
  summary: SessionSummary;
  session: TelemetrySession;
  kind: TrackSessionKind;
  isRace: boolean;
  bestLapMs: number;
  bestS1: number;
  bestS2: number;
  bestS3: number;
  stdDevMs: number;
  wearRate: number;
  allLaps: LapPoint[];
  weather: string;
  trackTemp: number;
  airTemp: number;
  aiDifficulty: number;
  topSpeed: number;
  attemptCount: number;
}

interface RaceAnalysisBucket {
  totalLaps: number;
  value: string;
  label: string;
  raceData: TrackSessionData[];
  sessions: TelemetrySession[];
  compoundLifeStats: CompoundLifeStats[];
  setupCandidates: RaceSetupCandidate[];
  tyreEvidenceCount: number;
  setupSampleCount: number;
  raceCount: number;
}

function getTrackSessionKind(session: TelemetrySession): TrackSessionKind {
  if (isRaceSession(session)) return "race";
  if (session["session-info"]["session-type"] === "Time Trial") {
    return "time-trial";
  }
  return "qualifying";
}

function getPreferredTrackTab(availableTabs: TrackSessionKind[]): TrackSessionKind {
  // Race is the deepest analysis on this page, so keep it as the default when
  // available. Otherwise fall back to the first scoped data bucket that exists.
  return availableTabs.includes("race")
    ? "race"
    : availableTabs[0] ?? "qualifying";
}

/**
 * Detect consecutive qualifying sessions that share identical early laps
 * (from mid-session saves) and merge them, keeping the best-performing attempt.
 */
function deduplicateRuns(sessions: TrackSessionData[]): TrackSessionData[] {
  if (sessions.length === 0) return sessions;

  const getLapTimesMs = (d: TrackSessionData): number[] => {
    const player = findPlayer(d.session);
    if (!player) return [];
    return player["session-history"]["lap-history-data"]
      .map((l) => l["lap-time-in-ms"])
      .filter((ms) => ms > 0);
  };

  const isFromSameRun = (earlier: TrackSessionData, later: TrackSessionData): boolean => {
    // Only deduplicate qualifying attempts. Time Trial sessions are continuous
    // lap programmes rather than mid-session qualifying snapshots, so merging
    // them would hide useful practice volume.
    if (earlier.kind !== "qualifying" || later.kind !== "qualifying") return false;

    const lapsA = getLapTimesMs(earlier);
    const lapsB = getLapTimesMs(later);

    if (lapsA.length < 1 || lapsB.length < 1) return false;

    // The later session's early laps (all but last) must match the earlier session's corresponding laps
    const prefixB = lapsB.slice(0, -1);
    if (prefixB.length === 0) return false;
    if (prefixB.length > lapsA.length) return false;

    return prefixB.every((ms, i) => ms === lapsA[i]);
  };

  // Group consecutive sessions into runs
  const groups: TrackSessionData[][] = [[sessions[0]]];

  for (let i = 1; i < sessions.length; i++) {
    const currentGroup = groups[groups.length - 1];
    const prev = currentGroup[currentGroup.length - 1];

    if (isFromSameRun(prev, sessions[i])) {
      currentGroup.push(sessions[i]);
    } else {
      groups.push([sessions[i]]);
    }
  }

  // For each group, pick the session with the best lap time
  return groups.map((group) => {
    if (group.length === 1) return group[0];

    const withValidLaps = group.filter((d) => d.bestLapMs > 0);
    const best = withValidLaps.length > 0
      ? withValidLaps.reduce((a, b) => (a.bestLapMs < b.bestLapMs ? a : b))
      : group[group.length - 1]; // fallback: latest session

    return { ...best, attemptCount: group.length };
  });
}

function getRaceTotalLaps(session: TelemetrySession): number | null {
  const totalLaps = session["session-info"]["total-laps"];
  if (!Number.isFinite(totalLaps) || totalLaps <= 0) return null;
  return Math.round(totalLaps);
}

function toRaceSetupRuns(races: TrackSessionData[]): RaceSetupRunInput[] {
  return races.map((race) => ({
    summary: race.summary,
    session: race.session,
  }));
}

function buildRaceAnalysisBuckets(races: TrackSessionData[]): RaceAnalysisBucket[] {
  const byTotalLaps = new Map<number, TrackSessionData[]>();

  for (const race of races) {
    const totalLaps = getRaceTotalLaps(race.session);
    if (totalLaps === null) continue;

    const bucket = byTotalLaps.get(totalLaps);
    if (bucket) {
      bucket.push(race);
    } else {
      byTotalLaps.set(totalLaps, [race]);
    }
  }

  return [...byTotalLaps.entries()]
    .map(([totalLaps, raceData]) => {
      const sessions = raceData.map((race) => race.session);
      const compoundLifeStats = aggregateCompoundLife(sessions);
      const setupCandidates = buildRaceSetupComparison(toRaceSetupRuns(raceData));
      const tyreEvidenceCount = compoundLifeStats.reduce(
        (sum, compound) => sum + compound.stintCount,
        0,
      );
      const setupSampleCount = setupCandidates.reduce(
        (sum, setup) => sum + setup.sampleCount,
        0,
      );

      return {
        totalLaps,
        value: String(totalLaps),
        label: `${totalLaps} laps`,
        raceData,
        sessions,
        compoundLifeStats,
        setupCandidates,
        tyreEvidenceCount,
        setupSampleCount,
        raceCount: raceData.length,
      } satisfies RaceAnalysisBucket;
    })
    .filter(
      (bucket) =>
        bucket.tyreEvidenceCount > 0 || bucket.setupSampleCount > 0,
    )
    .sort((a, b) => a.totalLaps - b.totalLaps);
}

function getDefaultRaceAnalysisBucket(
  buckets: RaceAnalysisBucket[],
): RaceAnalysisBucket | null {
  return [...buckets].sort((a, b) => {
    if (a.tyreEvidenceCount !== b.tyreEvidenceCount) {
      return b.tyreEvidenceCount - a.tyreEvidenceCount;
    }
    if (a.setupSampleCount !== b.setupSampleCount) {
      return b.setupSampleCount - a.setupSampleCount;
    }
    if (a.raceCount !== b.raceCount) return b.raceCount - a.raceCount;
    return b.totalLaps - a.totalLaps;
  })[0] ?? null;
}

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
  const [activeTab, setActiveTab] = useState<TrackSessionKind>("race");
  const requestedRaceLaps = searchParams.get("raceLaps");

  // Route slugs are stable hyphenated ids (`abu-dhabi`), while telemetry keeps
  // display names (`Abu Dhabi`). Match through the shared slug helper so future
  // route-model changes only need to update one normalization function.
  const allTrackSessions = useMemo(
    () => sessions.filter((s) => isTrackSlugMatch(s.track, trackId)),
    [sessions, trackId],
  );

  const trackSessions = allTrackSessions.filter(
    (s) => !activeFormulaKey || getSessionFormulaScopeKey(s) === activeFormulaKey,
  );
  const trackSessionKey = trackSessions.map((s) => s.slug).join("|");

  // Resolve the original (display) track name from session data
  const displayTrackName = allTrackSessions.length > 0 ? allTrackSessions[0].track : trackId ?? "";
  const backToDashboardPath = dashboardPath(activeFormulaKey);

  useEffect(() => {
    if (!trackSessions.length) {
      setData([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    let cancelled = false;
    Promise.all(
      trackSessions.map(async (s) => {
        try {
          const sessionData = await getSession(s.slug);
          const player = findPlayer(sessionData);
          if (!player) return null;

          const laps = player["session-history"]["lap-history-data"];
          const valid = getValidLaps(laps);

          // Best sector times from valid laps
          const bestS1 = bestSectorTimeMs(valid, 1);
          const bestS2 = bestSectorTimeMs(valid, 2);
          const bestS3 = bestSectorTimeMs(valid, 3);

          const allLaps: LapPoint[] = laps
            .filter((l) => l["lap-time-in-ms"] > 0)
            .map((l, li) => ({
              timeSec: l["lap-time-in-ms"] / 1000,
              valid: isLapValid(l["lap-valid-bit-flags"]),
              lapNum: li + 1,
            }));

          const info = sessionData["session-info"];
          const kind = getTrackSessionKind(sessionData);

          return {
            summary: s,
            session: sessionData,
            kind,
            isRace: kind === "race",
            bestLapMs: getBestLapTime(laps),
            bestS1,
            bestS2,
            bestS3,
            stdDevMs: lapTimeStdDev(laps),
            wearRate: avgWearRate(player),
            allLaps,
            weather: info.weather,
            trackTemp: info["track-temperature"],
            airTemp: info["air-temperature"],
            aiDifficulty: info["ai-difficulty"],
            topSpeed: player["top-speed-kmph"],
            attemptCount: 1,
          } satisfies TrackSessionData;
        } catch {
          return null;
        }
      }),
    ).then((results) => {
      const valid = results.filter((r): r is TrackSessionData => r !== null);
      valid.sort(
        (a, b) =>
          new Date(a.summary.date).getTime() - new Date(b.summary.date).getTime(),
      );
      if (!cancelled) {
        setData(deduplicateRuns(valid));
        setLoading(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [trackSessionKey, getSession]);

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
  const trackFuelStats = useMemo(
    () => aggregateFuelData(raceSessions),
    [raceSessions],
  );
  const allRaceSetupCandidates = useMemo(
    () => buildRaceSetupComparison(toRaceSetupRuns(raceDataAll)),
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
  const selectedCompoundLifeStats =
    showRaceLengthSelector && selectedRaceAnalysisBucket
      ? selectedRaceAnalysisBucket.compoundLifeStats
      : compoundLifeStats;
  const selectedRaceSetupCandidates =
    showRaceLengthSelector && selectedRaceAnalysisBucket
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
  const selectedTyreLifeRaceCount =
    showRaceLengthSelector && selectedRaceAnalysisBucket
      ? selectedRaceAnalysisBucket.raceCount
      : raceDataAll.length;
  const selectedTyreLifeStintCount = selectedCompoundLifeStats.reduce(
    (sum, compound) => sum + compound.stintCount,
    0,
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

    return (
      <div className="flex items-center justify-center h-full">
        <VStack align="center" className="max-w-md text-center">
          <HStack justify="center" className="h-12 w-12 rounded-full bg-zinc-900">
            {isUploadWithNoData ? (
              <Upload className="h-5 w-5 text-zinc-500" />
            ) : (
              <ArrowLeft className="h-5 w-5 text-zinc-500" />
            )}
          </HStack>
          <div>
            <h3 className="text-base font-medium text-zinc-200">
              {isUploadWithNoData
                ? "Track data not available"
                : hasOnlyOtherFormulaScopes
                  ? `No ${formulaLabel} data for ${displayTrackName}`
                  : "No sessions found"}
            </h3>
            <p className="mt-1 text-sm text-zinc-500">
              {isUploadWithNoData
                ? "Uploaded telemetry is stored in memory and lost when the browser is closed. Re-upload your .zip to continue."
                : hasOnlyOtherFormulaScopes
                  ? `${displayTrackName} exists in another game scope. Scoped track pages stay strict so tyre life, PBs, setups, and history never mix incompatible data.`
                : `No sessions found for ${displayTrackName}.`}
            </p>
          </div>
          {isUploadWithNoData ? (
            <button
              onClick={() => setShowUploadModal(true)}
              className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-500 transition-colors"
            >
              Upload telemetry
            </button>
          ) : hasOnlyOtherFormulaScopes ? (
            <HStack wrap justify="center" className="gap-2">
              {otherTrackScopes.map((option) => (
                <Link
                  key={option.key}
                  to={trackPath(option.key, displayTrackName)}
                  className="rounded-lg bg-zinc-800 px-4 py-2 text-sm font-medium text-zinc-200 hover:bg-zinc-700 transition-colors"
                >
                  View {option.label} ({option.trackSessionCount})
                </Link>
              ))}
              <Link
                to={backToDashboardPath}
                className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200 transition-colors"
              >
                Back to dashboard
              </Link>
            </HStack>
          ) : (
            <Link
              to={backToDashboardPath}
              className="rounded-lg bg-zinc-800 px-4 py-2 text-sm font-medium text-zinc-200 hover:bg-zinc-700 transition-colors"
            >
              Back to dashboard
            </Link>
          )}
        </VStack>
      </div>
    );
  }

  // Split into explicit analysis buckets. This is intentionally not
  // "race vs everything else": Time Trial is pure pace practice and should
  // never pollute qualifying history, theoretical sectors, or setup picks.
  const qualiData = data.filter((d) => d.kind === "qualifying");
  const raceData = raceDataAll;
  const timeTrialData = data.filter((d) => d.kind === "time-trial");

  // Theoretical best: best S1 + best S2 + best S3 across all qualifying sessions
  const allBestS1 = qualiData.filter((d) => d.bestS1 > 0).map((d) => d.bestS1);
  const allBestS2 = qualiData.filter((d) => d.bestS2 > 0).map((d) => d.bestS2);
  const allBestS3 = qualiData.filter((d) => d.bestS3 > 0).map((d) => d.bestS3);
  const theoreticalBestS1 = allBestS1.length ? Math.min(...allBestS1) : 0;
  const theoreticalBestS2 = allBestS2.length ? Math.min(...allBestS2) : 0;
  const theoreticalBestS3 = allBestS3.length ? Math.min(...allBestS3) : 0;
  const theoreticalBestMs =
    theoreticalBestS1 > 0 && theoreticalBestS2 > 0 && theoreticalBestS3 > 0
      ? theoreticalBestS1 + theoreticalBestS2 + theoreticalBestS3
      : 0;

  const actualBestQualiMs = qualiData.some((d) => d.bestLapMs > 0)
    ? Math.min(...qualiData.filter((d) => d.bestLapMs > 0).map((d) => d.bestLapMs))
    : 0;

  const gapMs = actualBestQualiMs > 0 && theoreticalBestMs > 0 ? actualBestQualiMs - theoreticalBestMs : 0;

  // Latest qualifying session for sector gap cards
  const latestQuali = qualiData.length ? qualiData[qualiData.length - 1] : null;

  // Race stats
  const bestRaceLapMs = raceData.some((d) => d.bestLapMs > 0)
    ? Math.min(...raceData.filter((d) => d.bestLapMs > 0).map((d) => d.bestLapMs))
    : 0;

  // Find the session behind the all-time best qualifying lap (for setup display)
  const bestQualiSession = qualiData.find(
    (d) => d.bestLapMs > 0 && d.bestLapMs === actualBestQualiMs
  ) ?? null;

  // Extract valid setup from the best qualifying session
  const bestQualiSetup = (() => {
    if (!bestQualiSession) return null;
    const player = findPlayer(bestQualiSession.session);
    const setup = player?.["car-setup"];
    return setup?.["is-valid"] ? setup : null;
  })();

  // Time Trial stats mirror qualifying pace metrics, but live in their own
  // bucket because TT exports are single-driver hotlap practice sessions.
  const allTimeTrialBestS1 = timeTrialData.filter((d) => d.bestS1 > 0).map((d) => d.bestS1);
  const allTimeTrialBestS2 = timeTrialData.filter((d) => d.bestS2 > 0).map((d) => d.bestS2);
  const allTimeTrialBestS3 = timeTrialData.filter((d) => d.bestS3 > 0).map((d) => d.bestS3);
  const theoreticalTimeTrialS1 = allTimeTrialBestS1.length ? Math.min(...allTimeTrialBestS1) : 0;
  const theoreticalTimeTrialS2 = allTimeTrialBestS2.length ? Math.min(...allTimeTrialBestS2) : 0;
  const theoreticalTimeTrialS3 = allTimeTrialBestS3.length ? Math.min(...allTimeTrialBestS3) : 0;
  const theoreticalTimeTrialMs =
    theoreticalTimeTrialS1 > 0 && theoreticalTimeTrialS2 > 0 && theoreticalTimeTrialS3 > 0
      ? theoreticalTimeTrialS1 + theoreticalTimeTrialS2 + theoreticalTimeTrialS3
      : 0;

  const bestTimeTrialMs = timeTrialData.some((d) => d.bestLapMs > 0)
    ? Math.min(...timeTrialData.filter((d) => d.bestLapMs > 0).map((d) => d.bestLapMs))
    : 0;
  const timeTrialGapMs =
    bestTimeTrialMs > 0 && theoreticalTimeTrialMs > 0
      ? bestTimeTrialMs - theoreticalTimeTrialMs
      : 0;
  const latestTimeTrial = timeTrialData.length ? timeTrialData[timeTrialData.length - 1] : null;
  const bestTimeTrialSession = timeTrialData.find(
    (d) => d.bestLapMs > 0 && d.bestLapMs === bestTimeTrialMs,
  ) ?? null;
  const bestTimeTrialSetup = (() => {
    if (!bestTimeTrialSession) return null;
    const player = findPlayer(bestTimeTrialSession.session);
    const setup = player?.["car-setup"];
    return setup?.["is-valid"] ? setup : null;
  })();

  // Qualifying chart data — group by day, keep best lap per day
  const lapTrend = (() => {
    const byDay: Record<string, { bestLapMs: number; date: string }> = {};
    for (const d of qualiData) {
      if (d.bestLapMs <= 0) continue;
      const dayKey = d.summary.date.split("T")[0];
      const prev = byDay[dayKey];
      if (!prev || d.bestLapMs < prev.bestLapMs) {
        byDay[dayKey] = { bestLapMs: d.bestLapMs, date: d.summary.date };
      }
    }
    return Object.entries(byDay)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([dayKey, { bestLapMs, date }]) => ({
        day: new Date(dayKey).toLocaleDateString("en-GB", { day: "numeric", month: "short" }),
        bestLap: bestLapMs / 1000,
        fullDate: formatDate(date),
      }));
  })();

  const sectorTrend = qualiData
    .filter((d) => d.bestS1 > 0)
    .map((d, i) => ({
      idx: i + 1,
      S1: d.bestS1 / 1000,
      S2: d.bestS2 / 1000,
      S3: d.bestS3 / 1000,
    }));

  const consistencyTrend = qualiData
    .filter((d) => d.stdDevMs > 0)
    .map((d, i) => ({
      idx: i + 1,
      stdDev: +(d.stdDevMs / 1000).toFixed(3),
      label: `${formatSessionType(d.summary.sessionType, d.summary.formula)} · ${formatTime(d.summary.date)}`,
    }));

  const timeTrialLapTrend = (() => {
    const byDay: Record<string, { bestLapMs: number; date: string }> = {};
    for (const d of timeTrialData) {
      if (d.bestLapMs <= 0) continue;
      const dayKey = d.summary.date.split("T")[0];
      const prev = byDay[dayKey];
      if (!prev || d.bestLapMs < prev.bestLapMs) {
        byDay[dayKey] = { bestLapMs: d.bestLapMs, date: d.summary.date };
      }
    }
    return Object.entries(byDay)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([dayKey, { bestLapMs, date }]) => ({
        day: new Date(dayKey).toLocaleDateString("en-GB", { day: "numeric", month: "short" }),
        bestLap: bestLapMs / 1000,
        fullDate: formatDate(date),
      }));
  })();

  const timeTrialSectorTrend = timeTrialData
    .filter((d) => d.bestS1 > 0)
    .map((d, i) => ({
      idx: i + 1,
      S1: d.bestS1 / 1000,
      S2: d.bestS2 / 1000,
      S3: d.bestS3 / 1000,
    }));

  const timeTrialConsistencyTrend = timeTrialData
    .filter((d) => d.stdDevMs > 0)
    .map((d, i) => ({
      idx: i + 1,
      stdDev: +(d.stdDevMs / 1000).toFixed(3),
      label: `${formatSessionType(d.summary.sessionType, d.summary.formula)} · ${formatTime(d.summary.date)}`,
    }));

  // Race chart data
  const raceWearTrend = raceData
    .filter((d) => d.wearRate > 0)
    .map((d, i) => ({
      idx: i + 1,
      rate: +d.wearRate.toFixed(1),
      label: `Race · ${formatTime(d.summary.date)}`,
    }));

  const raceSpeedTrend = raceData
    .filter((d) => d.topSpeed > 0)
    .map((d, i) => ({
      idx: i + 1,
      speed: d.topSpeed,
      label: `Race · ${formatTime(d.summary.date)}`,
    }));

  const tooltipStyle = TOOLTIP_STYLE;

  const sectorCards: { label: string; color: string; bestMs: number; latestMs: number }[] = [
    { label: "S1", color: SECTOR_COLORS.S1, bestMs: theoreticalBestS1, latestMs: latestQuali?.bestS1 ?? 0 },
    { label: "S2", color: SECTOR_COLORS.S2, bestMs: theoreticalBestS2, latestMs: latestQuali?.bestS2 ?? 0 },
    { label: "S3", color: SECTOR_COLORS.S3, bestMs: theoreticalBestS3, latestMs: latestQuali?.bestS3 ?? 0 },
  ];
  const timeTrialSectorCards: { label: string; color: string; bestMs: number; latestMs: number }[] = [
    { label: "S1", color: SECTOR_COLORS.S1, bestMs: theoreticalTimeTrialS1, latestMs: latestTimeTrial?.bestS1 ?? 0 },
    { label: "S2", color: SECTOR_COLORS.S2, bestMs: theoreticalTimeTrialS2, latestMs: latestTimeTrial?.bestS2 ?? 0 },
    { label: "S3", color: SECTOR_COLORS.S3, bestMs: theoreticalTimeTrialS3, latestMs: latestTimeTrial?.bestS3 ?? 0 },
  ];

  // Date range for subtitle
  const firstDate = formatDate(data[0].summary.date);
  const lastDate = formatDate(data[data.length - 1].summary.date);
  const dateRange = data.length > 1 ? `${firstDate} — ${lastDate}` : firstDate;

  // Session history sorted newest first
  const sessionHistory = [...data].reverse();

  const availableTabs: TrackSessionKind[] = [
    ...(qualiData.length > 0 ? (["qualifying"] as const) : []),
    ...(raceData.length > 0 ? (["race"] as const) : []),
    ...(timeTrialData.length > 0 ? (["time-trial"] as const) : []),
  ];
  const selectedTab = availableTabs.includes(activeTab)
    ? activeTab
    : getPreferredTrackTab(availableTabs);
  const tabOptions = availableTabs.map((value) => ({
    value,
    label: TRACK_TAB_LABELS[value],
  }));
  const handleRaceLengthChange = (raceLaps: string) => {
    const nextParams = new URLSearchParams(searchParams);
    nextParams.set("raceLaps", raceLaps);
    setSearchParams(nextParams);
  };

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-8">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold mb-1">
            <TrackFlag track={displayTrackName} className="mr-2" />
            {displayTrackName}
          </h2>
          <p className="text-sm text-zinc-500">
            {activeFormula?.showLabel ? `${activeFormula.label} · ` : ""}
            {data.length} session{data.length !== 1 ? "s" : ""}{(() => {
              const totalAttempts = data.reduce((sum, d) => sum + d.attemptCount, 0);
              return totalAttempts > data.length ? ` (${totalAttempts} total attempts)` : "";
            })()} · {dateRange}
          </p>
        </div>

        <VStack align="end" className="shrink-0 gap-2">
          {/* Tab switcher: interactive when multiple analysis buckets exist, static otherwise. */}
          {tabOptions.length > 1 && (
            <SegmentedControl<TrackSessionKind>
              ariaLabel="Session type"
              options={tabOptions}
              value={selectedTab}
              onChange={setActiveTab}
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

      {bestTimeTrialSession && (
        <Link
          to={sessionSummaryPath(bestTimeTrialSession.summary)}
          className="inline-flex max-w-full items-center gap-2 rounded-lg border border-cyan-400/20 bg-cyan-400/[0.06] px-3 py-2 text-sm text-zinc-300 transition-colors hover:border-cyan-300/30 hover:bg-cyan-400/[0.1]"
        >
          <Gauge className="size-4 shrink-0 text-cyan-300" />
          <span className="shrink-0 text-xs font-semibold uppercase tracking-wider text-cyan-300/80">
            Best TT
          </span>
          <span className="font-mono font-semibold text-cyan-100">
            {msToLapTime(bestTimeTrialMs)}
          </span>
          <span className="min-w-0 truncate text-xs text-zinc-500">
            {formatDate(bestTimeTrialSession.summary.date)} · {timeTrialData.length} attempt{timeTrialData.length !== 1 ? "s" : ""}
          </span>
        </Link>
      )}

      {/* ── Qualifying Section ── */}
      {qualiData.length > 0 && selectedTab === "qualifying" && (
        <>
          <SectionHeader>Qualifying Progress</SectionHeader>

          {/* Stat cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className={cardClassFeature}>
              <div className="text-xs uppercase tracking-wider text-zinc-500 mb-1.5">Best Lap</div>
              <div className="font-mono text-xl font-semibold bg-gradient-to-r from-cyan-300 to-cyan-500 bg-clip-text text-transparent">
                {actualBestQualiMs > 0 ? msToLapTime(actualBestQualiMs) : "–"}
              </div>
            </div>
            <div className={cardClass}>
              <div className="text-xs uppercase tracking-wider text-zinc-500 mb-1.5">Theoretical Best</div>
              <div className="font-mono text-xl text-ahead">
                {theoreticalBestMs > 0 ? msToLapTime(theoreticalBestMs) : "–"}
              </div>
            </div>
            <div className={cardClass}>
              <div className="text-xs uppercase tracking-wider text-zinc-500 mb-1.5">Gap to Theoretical</div>
              <div className="font-mono text-xl text-warning">
                {gapMs > 0 ? `+${(gapMs / 1000).toFixed(3)}s` : "–"}
              </div>
            </div>
            <div className={cardClass}>
              <div className="text-xs uppercase tracking-wider text-zinc-500 mb-1.5">Sessions</div>
              <div className="text-xl text-zinc-100 tabular-nums">
                {qualiData.length}
              </div>
            </div>
          </div>

          {/* Best lap over time */}
          {lapTrend.length > 1 && (
            <section className={cardClass}>
              <h3 className="text-sm font-semibold text-zinc-300 mb-2">
                Best Lap Over Time
              </h3>
              <ResponsiveContainer width="100%" height={240}>
                <LineChart data={lapTrend} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={CHART_THEME.grid} />
                  <XAxis dataKey="day" stroke={CHART_THEME.axis} fontSize={11} />
                  <YAxis stroke={CHART_THEME.axis} fontSize={11} tickFormatter={(v) => msToLapTime(v * 1000)} domain={["auto", "auto"]} />
                  <Tooltip
                    {...tooltipStyle}
                    formatter={(value: number | undefined) => [value ? msToLapTime(value * 1000) : "–", "Best Lap"]}
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
                      label={{ value: "Theoretical", fill: CHART_THEME.ahead, fontSize: 10, position: "right" }}
                    />
                  )}
                  <Line type="monotone" dataKey="bestLap" stroke={CHART_THEME.best} strokeWidth={2} dot={{ fill: CHART_THEME.best, r: 4 }} />
                </LineChart>
              </ResponsiveContainer>
            </section>
          )}

          {/* Sector Gap Cards */}
          {latestQuali && theoreticalBestS1 > 0 && (
            <div className="grid grid-cols-3 gap-3">
              {sectorCards.map((s) => {
                const deltaMs = s.latestMs > 0 && s.bestMs > 0 ? s.latestMs - s.bestMs : 0;
                return (
                  <div
                    key={s.label}
                    className={`${cardClass} border-t-2`}
                    style={{ borderColor: s.color }}
                  >
                    <div className="text-xs text-zinc-500 mb-1">{s.label} — All-Time Best</div>
                    <div className="font-mono text-lg" style={{ color: s.color }}>
                      {s.bestMs > 0 ? msToSectorTime(s.bestMs) : "–"}
                    </div>
                    {s.latestMs > 0 && (
                      <div className="text-xs mt-1">
                        <span className="text-zinc-500">Latest: </span>
                        <span className="font-mono text-zinc-300">{msToSectorTime(s.latestMs)}</span>
                        {deltaMs > 0 && (
                          <span className="font-mono text-warning ml-1">
                            +{(deltaMs / 1000).toFixed(3)}
                          </span>
                        )}
                        {deltaMs === 0 && s.latestMs > 0 && s.bestMs > 0 && (
                          <span className="font-mono text-ahead ml-1">PB</span>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* Sector improvement */}
          {sectorTrend.length > 1 && (
            <section className={cardClass}>
              <h3 className="text-sm font-semibold text-zinc-300 mb-2">
                Sector Improvement
              </h3>
              <ResponsiveContainer width="100%" height={240}>
                <LineChart data={sectorTrend} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={CHART_THEME.grid} />
                  <XAxis dataKey="idx" stroke={CHART_THEME.axis} fontSize={11} />
                  <YAxis stroke={CHART_THEME.axis} fontSize={11} tickFormatter={(v) => `${v.toFixed(1)}s`} domain={["auto", "auto"]} />
                  <Tooltip
                    {...tooltipStyle}
                    formatter={(value: number | undefined, name: string | undefined) => [
                      `${value?.toFixed(3) ?? "–"}s`,
                      name ?? "",
                    ]}
                    labelFormatter={(v) => `Session ${v}`}
                  />
                  <Line type="monotone" dataKey="S1" stroke={SECTOR_COLORS.S1} strokeWidth={2} dot={{ fill: SECTOR_COLORS.S1, r: 3 }} />
                  <Line type="monotone" dataKey="S2" stroke={SECTOR_COLORS.S2} strokeWidth={2} dot={{ fill: SECTOR_COLORS.S2, r: 3 }} />
                  <Line type="monotone" dataKey="S3" stroke={SECTOR_COLORS.S3} strokeWidth={2} dot={{ fill: SECTOR_COLORS.S3, r: 3 }} />
                </LineChart>
              </ResponsiveContainer>
            </section>
          )}

          {/* All qualifying lap times scatter */}
          {(() => {
            const validPoints: { idx: number; timeSec: number; label: string }[] = [];
            const invalidPoints: { idx: number; timeSec: number; label: string }[] = [];
            const bestPoints: { idx: number; timeSec: number; label: string }[] = [];

            qualiData.forEach((d, i) => {
              const sessionIdx = i + 1;
              const sessionLabel = `${formatSessionType(d.summary.sessionType, d.summary.formula)} · ${formatTime(d.summary.date)}`;
              const bestSec = d.bestLapMs > 0 ? d.bestLapMs / 1000 : null;

              for (const lap of d.allLaps) {
                const point = { idx: sessionIdx, timeSec: lap.timeSec, label: `${sessionLabel} Lap ${lap.lapNum}` };
                if (lap.valid) {
                  validPoints.push(point);
                  if (bestSec !== null && Math.abs(lap.timeSec - bestSec) < 0.001) {
                    bestPoints.push(point);
                  }
                } else {
                  invalidPoints.push(point);
                }
              }
            });

            const allPoints = [...validPoints, ...invalidPoints];
            if (allPoints.length < 2) return null;

            return (
              <section className={cardClass}>
                <h3 className="text-sm font-semibold text-zinc-300 mb-2">
                  All Qualifying Lap Times
                  <span className="font-normal text-zinc-500 ml-2">
                    Every lap across sessions
                  </span>
                </h3>
                <ResponsiveContainer width="100%" height={260}>
                  <ScatterChart margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke={CHART_THEME.grid} />
                    <XAxis
                      dataKey="idx"
                      type="number"
                      stroke={CHART_THEME.axis}
                      fontSize={11}
                      domain={[0.5, qualiData.length + 0.5]}
                      ticks={Array.from({ length: qualiData.length }, (_, i) => i + 1)}
                      label={{ value: "Session", position: "insideBottom", offset: -2, fill: CHART_THEME.axis, fontSize: 11 }}
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
                        const point = payload[0]?.payload as { timeSec: number; label: string } | undefined;
                        if (!point) return null;
                        return (
                          <div style={{ ...tooltipStyle.contentStyle, padding: "8px 12px", color: "#e4e4e7" }}>
                            <div style={{ color: "#a1a1aa", marginBottom: 4, fontSize: 11 }}>{point.label}</div>
                            <div style={{ fontFamily: "monospace" }}>{msToLapTime(point.timeSec * 1000)}</div>
                          </div>
                        );
                      }}
                    />
                    <Scatter data={invalidPoints} fill={CHART_THEME.behind} fillOpacity={0.4} shape="circle" />
                    <Scatter data={validPoints} fill={CHART_THEME.player} fillOpacity={0.6} shape="circle" />
                    <Scatter data={bestPoints} fill={CHART_THEME.best} fillOpacity={1} shape="circle" />
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
            );
          })()}

          {/* Consistency trend */}
          {consistencyTrend.length > 1 && (
            <section className={cardClass}>
              <h3 className="text-sm font-semibold text-zinc-300 mb-2">
                Consistency Trend
                <span className="font-normal text-zinc-500 ml-2">
                  Lower = more consistent lap times
                </span>
              </h3>
              <ResponsiveContainer width="100%" height={180}>
                <LineChart data={consistencyTrend} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={CHART_THEME.grid} />
                  <XAxis dataKey="idx" stroke={CHART_THEME.axis} fontSize={11} />
                  <YAxis stroke={CHART_THEME.axis} fontSize={11} tickFormatter={(v) => `${v.toFixed(1)}s`} />
                  <Tooltip
                    {...tooltipStyle}
                    formatter={(value: number | undefined) => [`${value?.toFixed(3) ?? "–"}s`, "Std Dev"]}
                    labelFormatter={(v) => {
                      const entry = consistencyTrend.find((d) => d.idx === v);
                      return entry?.label ?? `Session ${v}`;
                    }}
                  />
                  <Line type="monotone" dataKey="stdDev" stroke="#a78bfa" strokeWidth={2} dot={{ fill: "#a78bfa", r: 4 }} />
                </LineChart>
              </ResponsiveContainer>
            </section>
          )}

          {/* Best qualifying setup */}
          {bestQualiSetup && bestQualiSession && (
            <section className={cardClass}>
              <h3 className="text-sm font-semibold text-zinc-300 mb-1">Your Best Qualifying Setup</h3>
              <p className="text-xs text-zinc-500 mb-4">
                From{" "}
                <Link to={sessionSummaryPath(bestQualiSession.summary)} className="text-zinc-400 hover:text-zinc-200 transition-colors">
                  {formatSessionType(bestQualiSession.summary.sessionType, bestQualiSession.summary.formula)} · {formatDate(bestQualiSession.summary.date)} · {msToLapTime(bestQualiSession.bestLapMs)}
                </Link>
              </p>
              <CarSetupCard setup={bestQualiSetup} />
            </section>
          )}
        </>
      )}

      {/* ── Time Trial Section ── */}
      {timeTrialData.length > 0 && selectedTab === "time-trial" && (
        <>
          <SectionHeader>Time Trial Pace</SectionHeader>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className={cardClassFeature}>
              <div className="text-xs uppercase tracking-wider text-zinc-500 mb-1.5">Best TT Lap</div>
              <div className="font-mono text-xl font-semibold bg-gradient-to-r from-cyan-300 to-cyan-500 bg-clip-text text-transparent">
                {bestTimeTrialMs > 0 ? msToLapTime(bestTimeTrialMs) : "–"}
              </div>
            </div>
            <div className={cardClass}>
              <div className="text-xs uppercase tracking-wider text-zinc-500 mb-1.5">Theoretical Best</div>
              <div className="font-mono text-xl text-ahead">
                {theoreticalTimeTrialMs > 0 ? msToLapTime(theoreticalTimeTrialMs) : "–"}
              </div>
            </div>
            <div className={cardClass}>
              <div className="text-xs uppercase tracking-wider text-zinc-500 mb-1.5">Gap to Theoretical</div>
              <div className="font-mono text-xl text-warning">
                {timeTrialGapMs > 0 ? `+${(timeTrialGapMs / 1000).toFixed(3)}s` : "–"}
              </div>
            </div>
            <div className={cardClass}>
              <div className="text-xs uppercase tracking-wider text-zinc-500 mb-1.5">Attempts</div>
              <div className="text-xl text-zinc-100 tabular-nums">
                {timeTrialData.length}
              </div>
            </div>
          </div>

          {timeTrialLapTrend.length > 1 && (
            <section className={cardClass}>
              <h3 className="text-sm font-semibold text-zinc-300 mb-2">
                Best TT Lap Over Time
              </h3>
              <ResponsiveContainer width="100%" height={240}>
                <LineChart data={timeTrialLapTrend} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={CHART_THEME.grid} />
                  <XAxis dataKey="day" stroke={CHART_THEME.axis} fontSize={11} />
                  <YAxis stroke={CHART_THEME.axis} fontSize={11} tickFormatter={(v) => msToLapTime(v * 1000)} domain={["auto", "auto"]} />
                  <Tooltip
                    {...tooltipStyle}
                    formatter={(value: number | undefined) => [value ? msToLapTime(value * 1000) : "–", "Best Lap"]}
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
                      label={{ value: "Theoretical", fill: CHART_THEME.ahead, fontSize: 10, position: "right" }}
                    />
                  )}
                  <Line type="monotone" dataKey="bestLap" stroke={CHART_THEME.best} strokeWidth={2} dot={{ fill: CHART_THEME.best, r: 4 }} />
                </LineChart>
              </ResponsiveContainer>
            </section>
          )}

          {latestTimeTrial && theoreticalTimeTrialS1 > 0 && (
            <div className="grid grid-cols-3 gap-3">
              {timeTrialSectorCards.map((s) => {
                const deltaMs = s.latestMs > 0 && s.bestMs > 0 ? s.latestMs - s.bestMs : 0;
                return (
                  <div
                    key={s.label}
                    className={`${cardClass} border-t-2`}
                    style={{ borderColor: s.color }}
                  >
                    <div className="text-xs text-zinc-500 mb-1">{s.label} — TT Best</div>
                    <div className="font-mono text-lg" style={{ color: s.color }}>
                      {s.bestMs > 0 ? msToSectorTime(s.bestMs) : "–"}
                    </div>
                    {s.latestMs > 0 && (
                      <div className="text-xs mt-1">
                        <span className="text-zinc-500">Latest: </span>
                        <span className="font-mono text-zinc-300">{msToSectorTime(s.latestMs)}</span>
                        {deltaMs > 0 && (
                          <span className="font-mono text-warning ml-1">
                            +{(deltaMs / 1000).toFixed(3)}
                          </span>
                        )}
                        {deltaMs === 0 && s.latestMs > 0 && s.bestMs > 0 && (
                          <span className="font-mono text-ahead ml-1">PB</span>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {timeTrialSectorTrend.length > 1 && (
            <section className={cardClass}>
              <h3 className="text-sm font-semibold text-zinc-300 mb-2">
                TT Sector Improvement
              </h3>
              <ResponsiveContainer width="100%" height={240}>
                <LineChart data={timeTrialSectorTrend} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={CHART_THEME.grid} />
                  <XAxis dataKey="idx" stroke={CHART_THEME.axis} fontSize={11} />
                  <YAxis stroke={CHART_THEME.axis} fontSize={11} tickFormatter={(v) => `${v.toFixed(1)}s`} domain={["auto", "auto"]} />
                  <Tooltip
                    {...tooltipStyle}
                    formatter={(value: number | undefined, name: string | undefined) => [
                      `${value?.toFixed(3) ?? "–"}s`,
                      name ?? "",
                    ]}
                    labelFormatter={(v) => `Attempt ${v}`}
                  />
                  <Line type="monotone" dataKey="S1" stroke={SECTOR_COLORS.S1} strokeWidth={2} dot={{ fill: SECTOR_COLORS.S1, r: 3 }} />
                  <Line type="monotone" dataKey="S2" stroke={SECTOR_COLORS.S2} strokeWidth={2} dot={{ fill: SECTOR_COLORS.S2, r: 3 }} />
                  <Line type="monotone" dataKey="S3" stroke={SECTOR_COLORS.S3} strokeWidth={2} dot={{ fill: SECTOR_COLORS.S3, r: 3 }} />
                </LineChart>
              </ResponsiveContainer>
            </section>
          )}

          {(() => {
            const validPoints: { idx: number; timeSec: number; label: string }[] = [];
            const invalidPoints: { idx: number; timeSec: number; label: string }[] = [];
            const bestPoints: { idx: number; timeSec: number; label: string }[] = [];

            timeTrialData.forEach((d, i) => {
              const sessionIdx = i + 1;
              const sessionLabel = `${formatSessionType(d.summary.sessionType, d.summary.formula)} · ${formatTime(d.summary.date)}`;
              const bestSec = d.bestLapMs > 0 ? d.bestLapMs / 1000 : null;

              for (const lap of d.allLaps) {
                const point = { idx: sessionIdx, timeSec: lap.timeSec, label: `${sessionLabel} Lap ${lap.lapNum}` };
                if (lap.valid) {
                  validPoints.push(point);
                  if (bestSec !== null && Math.abs(lap.timeSec - bestSec) < 0.001) {
                    bestPoints.push(point);
                  }
                } else {
                  invalidPoints.push(point);
                }
              }
            });

            const allPoints = [...validPoints, ...invalidPoints];
            if (allPoints.length < 2) return null;

            return (
              <section className={cardClass}>
                <h3 className="text-sm font-semibold text-zinc-300 mb-2">
                  All Time Trial Lap Times
                  <span className="font-normal text-zinc-500 ml-2">
                    Every hotlap across attempts
                  </span>
                </h3>
                <ResponsiveContainer width="100%" height={260}>
                  <ScatterChart margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke={CHART_THEME.grid} />
                    <XAxis
                      dataKey="idx"
                      type="number"
                      stroke={CHART_THEME.axis}
                      fontSize={11}
                      domain={[0.5, timeTrialData.length + 0.5]}
                      ticks={Array.from({ length: timeTrialData.length }, (_, i) => i + 1)}
                      label={{ value: "Attempt", position: "insideBottom", offset: -2, fill: CHART_THEME.axis, fontSize: 11 }}
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
                        const point = payload[0]?.payload as { timeSec: number; label: string } | undefined;
                        if (!point) return null;
                        return (
                          <div style={{ ...tooltipStyle.contentStyle, padding: "8px 12px", color: "#e4e4e7" }}>
                            <div style={{ color: "#a1a1aa", marginBottom: 4, fontSize: 11 }}>{point.label}</div>
                            <div style={{ fontFamily: "monospace" }}>{msToLapTime(point.timeSec * 1000)}</div>
                          </div>
                        );
                      }}
                    />
                    <Scatter data={invalidPoints} fill={CHART_THEME.behind} fillOpacity={0.4} shape="circle" />
                    <Scatter data={validPoints} fill={CHART_THEME.player} fillOpacity={0.6} shape="circle" />
                    <Scatter data={bestPoints} fill={CHART_THEME.best} fillOpacity={1} shape="circle" />
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
            );
          })()}

          {timeTrialConsistencyTrend.length > 1 && (
            <section className={cardClass}>
              <h3 className="text-sm font-semibold text-zinc-300 mb-2">
                TT Consistency Trend
                <span className="font-normal text-zinc-500 ml-2">
                  Lower = more repeatable hotlaps
                </span>
              </h3>
              <ResponsiveContainer width="100%" height={180}>
                <LineChart data={timeTrialConsistencyTrend} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={CHART_THEME.grid} />
                  <XAxis dataKey="idx" stroke={CHART_THEME.axis} fontSize={11} />
                  <YAxis stroke={CHART_THEME.axis} fontSize={11} tickFormatter={(v) => `${v.toFixed(1)}s`} />
                  <Tooltip
                    {...tooltipStyle}
                    formatter={(value: number | undefined) => [`${value?.toFixed(3) ?? "–"}s`, "Std Dev"]}
                    labelFormatter={(v) => {
                      const entry = timeTrialConsistencyTrend.find((d) => d.idx === v);
                      return entry?.label ?? `Attempt ${v}`;
                    }}
                  />
                  <Line type="monotone" dataKey="stdDev" stroke="#a78bfa" strokeWidth={2} dot={{ fill: "#a78bfa", r: 4 }} />
                </LineChart>
              </ResponsiveContainer>
            </section>
          )}

          {bestTimeTrialSetup && bestTimeTrialSession && (
            <section className={cardClass}>
              <h3 className="text-sm font-semibold text-zinc-300 mb-1">Your Best Time Trial Setup</h3>
              <p className="text-xs text-zinc-500 mb-4">
                From{" "}
                <Link to={sessionSummaryPath(bestTimeTrialSession.summary)} className="text-zinc-400 hover:text-zinc-200 transition-colors">
                  {formatSessionType(bestTimeTrialSession.summary.sessionType, bestTimeTrialSession.summary.formula)} · {formatDate(bestTimeTrialSession.summary.date)} · {msToLapTime(bestTimeTrialSession.bestLapMs)}
                </Link>
              </p>
              <CarSetupCard setup={bestTimeTrialSetup} />
            </section>
          )}
        </>
      )}

      {/* ── Race Section ── */}
      {raceData.length > 0 && selectedTab === "race" && (
        <>
          <SectionHeader>Race Performance</SectionHeader>

          {/* Race stat cards */}
          <div className="grid grid-cols-2 gap-3">
            <div className={cardClassFeature}>
              <div className="text-xs uppercase tracking-wider text-zinc-500 mb-1.5">Best Race Lap</div>
              <div className="font-mono text-xl font-semibold bg-gradient-to-r from-cyan-300 to-cyan-500 bg-clip-text text-transparent">
                {bestRaceLapMs > 0 ? msToLapTime(bestRaceLapMs) : "–"}
              </div>
            </div>
            <div className={cardClass}>
              <div className="text-xs uppercase tracking-wider text-zinc-500 mb-1.5">Races</div>
              <div className="text-xl text-zinc-100 tabular-nums">
                {raceData.length}
              </div>
            </div>
          </div>

          {/* Compound tyre life cards */}
          {selectedCompoundLifeStats.length > 0 && (
            <div>
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <h4 className="text-sm font-semibold text-zinc-300">
                  Compound Tyre Life
                </h4>
                {showRaceLengthSelector && selectedRaceAnalysisBucket && (
                  <div className="flex max-w-full items-center gap-2">
                    <span className="shrink-0 text-[11px] font-medium uppercase tracking-wider text-zinc-600">
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
              </div>
              <div
                className="grid gap-2"
                style={{ gridTemplateColumns: `repeat(${Math.min(selectedCompoundLifeStats.length, 4)}, minmax(0, 1fr))` }}
              >
                {selectedCompoundLifeStats.map((cs) => (
                  <CompoundStatCard
                    key={cs.compound}
                    compound={cs.compound}
                    hero={{ value: `~${cs.estMaxLife}`, label: "pit by lap" }}
                    rows={[
                      ...(cs.bestLapMs > 0 ? [{ label: "Best lap", value: msToLapTime(cs.bestLapMs), className: "font-mono text-best" }] : []),
                      { label: "Avg wear", value: `${cs.avgWearRatePerLap.toFixed(1)}%/lap`, divider: cs.bestLapMs > 0 },
                      { label: "Stints", value: `${cs.avgStintLength}–${cs.longestStint} laps` },
                    ]}
                  />
                ))}
              </div>
              <p className="text-xs text-zinc-600 mt-1.5">
                Pit lap estimated at {75}% worst-wheel wear (puncture risk threshold), based on {selectedTyreLifeStintCount} stint{selectedTyreLifeStintCount !== 1 ? "s" : ""} across {selectedTyreLifeRaceCount} {selectedRaceLengthLabel ? `${selectedRaceLengthLabel} ` : ""}race{selectedTyreLifeRaceCount !== 1 ? "s" : ""}.
              </p>
            </div>
          )}

          {/* Fuel summary */}
          {trackFuelStats && (
            <div>
              <h4 className="text-sm font-semibold text-zinc-300 mb-2">Fuel Management</h4>
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                <div className={cardClass}>
                  <div className="text-xs text-zinc-500 mb-1">Avg Initial Fuel</div>
                  <div className={`font-mono text-lg ${
                    trackFuelStats.avgInitialFuelLaps >= 0
                      ? "text-ahead"
                      : Math.abs(trackFuelStats.avgInitialFuelLaps) <= 1
                        ? "text-warning"
                        : "text-behind"
                  }`}>
                    {trackFuelStats.avgInitialFuelLaps >= 0 ? "+" : ""}{trackFuelStats.avgInitialFuelLaps.toFixed(1)} laps
                  </div>
                  <div className="text-xs text-zinc-500 mt-0.5">
                    {Math.round(trackFuelStats.avgStartingFuelKg)} kg avg
                  </div>
                </div>
                <div className={cardClass}>
                  <div className="text-xs text-zinc-500 mb-1">Rec. Initial Fuel</div>
                  <div className={`font-mono text-lg ${
                    Math.abs(trackFuelStats.avgRecommendedFuelLaps) <= 0.3
                      ? "text-ahead"
                      : trackFuelStats.avgRecommendedFuelLaps < -1
                        ? "text-behind"
                        : "text-cyan-400"
                  }`}>
                    {trackFuelStats.avgRecommendedFuelLaps >= 0 ? "+" : ""}{trackFuelStats.avgRecommendedFuelLaps.toFixed(1)} laps
                  </div>
                </div>
                <div className={cardClass}>
                  <div className="text-xs text-zinc-500 mb-1">Avg Burn Rate</div>
                  <div className="font-mono text-lg text-warning">
                    {trackFuelStats.avgBurnRateKgPerLap.toFixed(2)} kg/lap
                  </div>
                </div>
                <div className={cardClass}>
                  <div className="text-xs text-zinc-500 mb-1">Avg Excess at Finish</div>
                  <div className={`font-mono text-lg ${
                    trackFuelStats.avgExcessAtFinishLaps > 1
                      ? "text-warning"
                      : trackFuelStats.avgExcessAtFinishLaps < 0
                        ? "text-behind"
                        : "text-ahead"
                  }`}>
                    {trackFuelStats.avgExcessAtFinishLaps.toFixed(1)} laps
                  </div>
                </div>
                <div className={cardClass}>
                  <div className="text-xs text-zinc-500 mb-1">Races</div>
                  <div className="text-lg text-zinc-200">
                    {trackFuelStats.raceCount}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Tyre management trend (race only) */}
          {raceWearTrend.length > 1 && (
            <section className={cardClass}>
              <h3 className="text-sm font-semibold text-zinc-300 mb-2">
                Tyre Management
                <span className="font-normal text-zinc-500 ml-2">
                  Lower = gentler on tyres
                </span>
              </h3>
              <ResponsiveContainer width="100%" height={180}>
                <LineChart data={raceWearTrend} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={CHART_THEME.grid} />
                  <XAxis dataKey="idx" stroke={CHART_THEME.axis} fontSize={11} />
                  <YAxis stroke={CHART_THEME.axis} fontSize={11} tickFormatter={(v) => `${v}%`} />
                  <Tooltip
                    {...tooltipStyle}
                    formatter={(value: number | undefined) => [`${value ?? "–"}%/lap`, "Wear Rate"]}
                    labelFormatter={(v) => {
                      const entry = raceWearTrend.find((d) => d.idx === v);
                      return entry?.label ?? `Race ${v}`;
                    }}
                  />
                  <Line type="monotone" dataKey="rate" stroke="#f59e0b" strokeWidth={2} dot={{ fill: "#f59e0b", r: 4 }} />
                </LineChart>
              </ResponsiveContainer>
            </section>
          )}

          {/* Top speed trend (race only) */}
          {raceSpeedTrend.length > 1 && (
            <section className={cardClass}>
              <h3 className="text-sm font-semibold text-zinc-300 mb-2">
                Top Speed Trend
                <span className="font-normal text-zinc-500 ml-2">
                  km/h per race
                </span>
              </h3>
              <ResponsiveContainer width="100%" height={180}>
                <LineChart data={raceSpeedTrend} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={CHART_THEME.grid} />
                  <XAxis dataKey="idx" stroke={CHART_THEME.axis} fontSize={11} />
                  <YAxis stroke={CHART_THEME.axis} fontSize={11} tickFormatter={(v) => `${v}`} domain={["auto", "auto"]} />
                  <Tooltip
                    {...tooltipStyle}
                    formatter={(value: number | undefined) => [`${value ?? "–"} km/h`, "Top Speed"]}
                    labelFormatter={(v) => {
                      const entry = raceSpeedTrend.find((d) => d.idx === v);
                      return entry?.label ?? `Race ${v}`;
                    }}
                  />
                  <Line type="monotone" dataKey="speed" stroke="#22c55e" strokeWidth={2} dot={{ fill: "#22c55e", r: 4 }} />
                </LineChart>
              </ResponsiveContainer>
            </section>
          )}

          {/* Race setup comparison */}
          {selectedRaceSetupCandidates.length > 0 && (
            <RaceSetupComparison
              candidates={selectedRaceSetupCandidates}
              raceLengthLabel={selectedRaceLengthLabel}
            />
          )}
        </>
      )}

      {/* ── Session History ── */}
      <div>
        <div className="mb-3">
          <SectionHeader>Session History</SectionHeader>
        </div>
        <div className="space-y-1.5">
          {sessionHistory.map((d) => {
            const metaParts: string[] = [
              `${formatDate(d.summary.date)} · ${formatTime(d.summary.date)}`,
            ];
            if (d.weather) metaParts.push(d.weather);
            if (d.trackTemp > 0) metaParts.push(`T:${d.trackTemp}° A:${d.airTemp}°`);
            if (d.aiDifficulty > 0) metaParts.push(`AI ${d.aiDifficulty}`);
            if (d.topSpeed > 0) metaParts.push(`${d.topSpeed} km/h`);
            if (d.wearRate > 0) metaParts.push(`${d.wearRate.toFixed(1)}%/lap wear`);

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
                      {formatSessionType(d.summary.sessionType, d.summary.formula)}
                    </span>
                    {d.attemptCount > 1 && <Badge tone="amber">×{d.attemptCount}</Badge>}
                  </>
                }
                meta={metaParts.join(" · ")}
                trailing={
                  <div
                    className={`inline-flex h-9 items-center justify-center rounded-lg px-2.5 font-mono text-sm font-bold tabular-nums ${
                      d.bestLapMs <= 0
                        ? "ring-1 ring-inset ring-white/[0.06] bg-zinc-900/70 text-zinc-500"
                        : isAllTimeBest
                          ? `${accentCardClass("purple")} text-purple-300`
                          : `${accentCardClass("cyan")} text-cyan-300`
                    }`}
                  >
                    {d.bestLapMs > 0 ? msToLapTime(d.bestLapMs) : "—"}
                  </div>
                }
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}
