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
import { PaceEvolutionChart } from "../components/track/PaceEvolutionChart";
import { TrackKeyInsights } from "../components/track/TrackKeyInsights";
import { TrackQualifyingInsights } from "../components/track/TrackQualifyingInsights";
import { TrackStrategySection } from "../components/track/TrackStrategySection";
import { buildTrackQualifyingInsights } from "../utils/qualifyingInsights";
import { TrackFlag } from "../components/TrackFlag";
import { Badge } from "../components/ui/Badge";
import { InsightTile } from "../components/ui/InsightTile";
import { SectionHeader } from "../components/ui/SectionHeader";
import { SegmentedControl } from "../components/ui/SegmentedControl";
import { getSessionTypeMeta } from "../components/sessionTypeMeta";
import { HStack, VStack } from "../components/ui/Stack";
import { useTelemetry } from "../context/TelemetryContext";
import { useSessionList } from "../hooks/useSessionList";
import type { SessionSummary, TelemetrySession } from "../types/telemetry";
import { CHART_THEME, SECTOR_COLORS, TOOLTIP_STYLE } from "../utils/colors";
import { getSessionFormulaScopeKey } from "../utils/dashboardStats";
import {
  bestSectorTimeMs,
  formatDate,
  formatSessionType,
  formatTime,
  getSessionIcon,
  isLapValid,
  isTrackSlugMatch,
  msToLapTime,
  msToSectorTime,
} from "../utils/format";
import { cn } from "../utils/cn";
import { buildTrackRivalBenchmark } from "../utils/rivalStats";
import { dashboardPath, sessionSummaryPath, trackPath } from "../utils/routes";
import type {
  RaceSetupCandidate,
  RaceSetupRunInput,
} from "../utils/setupComparison";
import { buildRaceSetupComparison } from "../utils/setupComparison";
import type { CompoundLifeStats } from "../utils/stats";
import {
  aggregateCompoundLife,
  aggregateFuelData,
  avgWearRate,
  buildPaceEvolution,
  buildTrackRaceRecommendation,
  findPlayer,
  getBestLapTime,
  getValidLaps,
  isRaceSession,
  lapTimeStdDev,
  PUNCTURE_THRESHOLD,
} from "../utils/stats";

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

// Map each tab to the canonical session-type label the shared `getSessionTypeMeta`
// helper understands. "Qualifying" pools Short Quali + One-Shot Quali, so we
// resolve via "Short Quali" (the Timer icon) — the timer reads as the more
// generic "this is a timed session" cue than the One-Shot's Target.
const TRACK_TAB_META_LABEL: Record<TrackSessionKind, string> = {
  qualifying: "Short Quali",
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

function getPreferredTrackTab(
  availableTabs: TrackSessionKind[],
): TrackSessionKind {
  // Race is the deepest analysis on this page, so keep it as the default when
  // available. Otherwise fall back to the first scoped data bucket that exists.
  return availableTabs.includes("race")
    ? "race"
    : (availableTabs[0] ?? "qualifying");
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

  const isFromSameRun = (
    earlier: TrackSessionData,
    later: TrackSessionData,
  ): boolean => {
    // Only deduplicate qualifying attempts. Time Trial sessions are continuous
    // lap programmes rather than mid-session qualifying snapshots, so merging
    // them would hide useful practice volume.
    if (earlier.kind !== "qualifying" || later.kind !== "qualifying")
      return false;

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
    const best =
      withValidLaps.length > 0
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

function buildRaceAnalysisBuckets(
  races: TrackSessionData[],
): RaceAnalysisBucket[] {
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
      const setupCandidates = buildRaceSetupComparison(
        toRaceSetupRuns(raceData),
      );
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
      (bucket) => bucket.tyreEvidenceCount > 0 || bucket.setupSampleCount > 0,
    )
    .sort((a, b) => a.totalLaps - b.totalLaps);
}

function getDefaultRaceAnalysisBucket(
  buckets: RaceAnalysisBucket[],
): RaceAnalysisBucket | null {
  return (
    [...buckets].sort((a, b) => {
      if (a.tyreEvidenceCount !== b.tyreEvidenceCount) {
        return b.tyreEvidenceCount - a.tyreEvidenceCount;
      }
      if (a.setupSampleCount !== b.setupSampleCount) {
        return b.setupSampleCount - a.setupSampleCount;
      }
      if (a.raceCount !== b.raceCount) return b.raceCount - a.raceCount;
      return b.totalLaps - a.totalLaps;
    })[0] ?? null
  );
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
          new Date(a.summary.date).getTime() -
          new Date(b.summary.date).getTime(),
      );
      if (!cancelled) {
        setData(deduplicateRuns(valid));
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
  // Race sessions in the selected length bucket, used by the Key Insights
  // recommendation and the bucket-scoped fuel stats. Falls back to all race
  // sessions when there's only a single race-length bucket (no selector).
  const selectedRaceSessions =
    showRaceLengthSelector && selectedRaceAnalysisBucket
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
        <VStack align="center" className="max-w-md text-center">
          <HStack
            justify="center"
            className="h-12 w-12 rounded-full bg-zinc-900"
          >
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
    ? Math.min(
        ...qualiData.filter((d) => d.bestLapMs > 0).map((d) => d.bestLapMs),
      )
    : 0;

  // Latest qualifying session for sector gap cards
  const latestQuali = qualiData.length ? qualiData[qualiData.length - 1] : null;

  // Headline tiles for the Qualifying tab — same family of "Key Insights"
  // synthesis the Race tab uses, just scoped to quali. The scalar values above
  // still feed the charts/reference lines below, so this only produces the
  // tile-strip model.
  const qualifyingInsights = buildTrackQualifyingInsights(
    qualiData.map((d) => ({
      bestLapMs: d.bestLapMs,
      bestS1: d.bestS1,
      bestS2: d.bestS2,
      bestS3: d.bestS3,
      date: d.summary.date,
      isOnline: d.summary.isOnline,
      poleLapTimeMs: d.summary.poleLapTimeMs,
      qualifyingPosition: d.summary.qualifyingPosition,
    })),
  );

  // Race stats
  const bestRaceLapMs = raceData.some((d) => d.bestLapMs > 0)
    ? Math.min(
        ...raceData.filter((d) => d.bestLapMs > 0).map((d) => d.bestLapMs),
      )
    : 0;

  // Find the session behind the all-time best qualifying lap (for setup display)
  const bestQualiSession =
    qualiData.find(
      (d) => d.bestLapMs > 0 && d.bestLapMs === actualBestQualiMs,
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
  const allTimeTrialBestS1 = timeTrialData
    .filter((d) => d.bestS1 > 0)
    .map((d) => d.bestS1);
  const allTimeTrialBestS2 = timeTrialData
    .filter((d) => d.bestS2 > 0)
    .map((d) => d.bestS2);
  const allTimeTrialBestS3 = timeTrialData
    .filter((d) => d.bestS3 > 0)
    .map((d) => d.bestS3);
  const theoreticalTimeTrialS1 = allTimeTrialBestS1.length
    ? Math.min(...allTimeTrialBestS1)
    : 0;
  const theoreticalTimeTrialS2 = allTimeTrialBestS2.length
    ? Math.min(...allTimeTrialBestS2)
    : 0;
  const theoreticalTimeTrialS3 = allTimeTrialBestS3.length
    ? Math.min(...allTimeTrialBestS3)
    : 0;
  const theoreticalTimeTrialMs =
    theoreticalTimeTrialS1 > 0 &&
    theoreticalTimeTrialS2 > 0 &&
    theoreticalTimeTrialS3 > 0
      ? theoreticalTimeTrialS1 + theoreticalTimeTrialS2 + theoreticalTimeTrialS3
      : 0;

  const bestTimeTrialMs = timeTrialData.some((d) => d.bestLapMs > 0)
    ? Math.min(
        ...timeTrialData.filter((d) => d.bestLapMs > 0).map((d) => d.bestLapMs),
      )
    : 0;
  const timeTrialGapMs =
    bestTimeTrialMs > 0 && theoreticalTimeTrialMs > 0
      ? bestTimeTrialMs - theoreticalTimeTrialMs
      : 0;
  const latestTimeTrial = timeTrialData.length
    ? timeTrialData[timeTrialData.length - 1]
    : null;
  const bestTimeTrialSession =
    timeTrialData.find(
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
        day: new Date(dayKey).toLocaleDateString("en-GB", {
          day: "numeric",
          month: "short",
        }),
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
        day: new Date(dayKey).toLocaleDateString("en-GB", {
          day: "numeric",
          month: "short",
        }),
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

  // Race-on-race median clean lap per compound — feeds the Pace Evolution
  // chart. Uses bucket-scoped sessions so a 5-lap repro doesn't get plotted
  // against a 30-lap stint median in the same line. The set identity match
  // is by TelemetrySession reference, which is stable across renders here.
  const selectedRaceSessionSet = new Set(selectedRaceSessions);
  const paceEvolutionData = buildPaceEvolution(
    raceData
      .filter((d) => selectedRaceSessionSet.has(d.session))
      .map((d) => ({ session: d.session, date: d.summary.date })),
  );

  const tooltipStyle = TOOLTIP_STYLE;

  // All three tiles use purple: each is the fastest the player has ever gone
  // in that sector, and purple is the broadcast convention for "session/track
  // best" (matches BestRaceLapTile + the LapTimeChart PB tint). Sector-identity
  // blue/violet/pink would have been decorative here — no nearby legend keys
  // it — and reads as "these mean different things" when they don't.
  const sectorCards: { label: string; bestMs: number; latestMs: number }[] = [
    { label: "S1", bestMs: theoreticalBestS1, latestMs: latestQuali?.bestS1 ?? 0 },
    { label: "S2", bestMs: theoreticalBestS2, latestMs: latestQuali?.bestS2 ?? 0 },
    { label: "S3", bestMs: theoreticalBestS3, latestMs: latestQuali?.bestS3 ?? 0 },
  ];
  const timeTrialSectorCards: { label: string; bestMs: number; latestMs: number }[] = [
    { label: "S1", bestMs: theoreticalTimeTrialS1, latestMs: latestTimeTrial?.bestS1 ?? 0 },
    { label: "S2", bestMs: theoreticalTimeTrialS2, latestMs: latestTimeTrial?.bestS2 ?? 0 },
    { label: "S3", bestMs: theoreticalTimeTrialS3, latestMs: latestTimeTrial?.bestS3 ?? 0 },
  ];

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
    icon: getSessionTypeMeta(TRACK_TAB_META_LABEL[value]).icon,
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
                  className="inline-flex items-center gap-1 text-zinc-400 transition-colors hover:text-cyan-200"
                >
                  <Gauge className="size-3 text-cyan-300" />
                  <span className="text-cyan-300/80">Best TT</span>
                  <span className="font-mono text-zinc-300">
                    {msToLapTime(bestTimeTrialMs)}
                  </span>
                </Link>
              </>
            )}
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
          {(() => {
            const validPoints: {
              idx: number;
              timeSec: number;
              label: string;
            }[] = [];
            const invalidPoints: {
              idx: number;
              timeSec: number;
              label: string;
            }[] = [];
            const bestPoints: {
              idx: number;
              timeSec: number;
              label: string;
            }[] = [];

            qualiData.forEach((d, i) => {
              const sessionIdx = i + 1;
              const sessionLabel = `${formatSessionType(d.summary.sessionType, d.summary.formula)} · ${formatTime(d.summary.date)}`;
              const bestSec = d.bestLapMs > 0 ? d.bestLapMs / 1000 : null;

              for (const lap of d.allLaps) {
                const point = {
                  idx: sessionIdx,
                  timeSec: lap.timeSec,
                  label: `${sessionLabel} Lap ${lap.lapNum}`,
                };
                if (lap.valid) {
                  validPoints.push(point);
                  if (
                    bestSec !== null &&
                    Math.abs(lap.timeSec - bestSec) < 0.001
                  ) {
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
                <SectionHeader
                  title="All Qualifying Lap Times"
                  hint="Every lap across sessions"
                />
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
                      data={invalidPoints}
                      fill={CHART_THEME.behind}
                      fillOpacity={0.4}
                      shape="circle"
                    />
                    <Scatter
                      data={validPoints}
                      fill={CHART_THEME.player}
                      fillOpacity={0.6}
                      shape="circle"
                    />
                    <Scatter
                      data={bestPoints}
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
            );
          })()}

          {/* Consistency trend */}
          {consistencyTrend.length > 1 && (
            <section className={cardClass}>
              <SectionHeader
                title="Consistency Trend"
                hint="Lower = more consistent lap times"
              />
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
              <div className="font-mono text-xl font-semibold text-purple-300">
                {bestTimeTrialMs > 0 ? msToLapTime(bestTimeTrialMs) : "–"}
              </div>
            </InsightTile>
            <InsightTile
              title="Theoretical Best"
              icon={Target}
              accent="emerald"
            >
              <div className="font-mono text-xl text-ahead">
                {theoreticalTimeTrialMs > 0
                  ? msToLapTime(theoreticalTimeTrialMs)
                  : "–"}
              </div>
            </InsightTile>
            <InsightTile
              title="Gap to Theoretical"
              icon={TimerReset}
              accent="amber"
            >
              <div className="font-mono text-xl text-warning">
                {timeTrialGapMs > 0
                  ? `+${(timeTrialGapMs / 1000).toFixed(3)}s`
                  : "–"}
              </div>
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

          {(() => {
            const validPoints: {
              idx: number;
              timeSec: number;
              label: string;
            }[] = [];
            const invalidPoints: {
              idx: number;
              timeSec: number;
              label: string;
            }[] = [];
            const bestPoints: {
              idx: number;
              timeSec: number;
              label: string;
            }[] = [];

            timeTrialData.forEach((d, i) => {
              const sessionIdx = i + 1;
              const sessionLabel = `${formatSessionType(d.summary.sessionType, d.summary.formula)} · ${formatTime(d.summary.date)}`;
              const bestSec = d.bestLapMs > 0 ? d.bestLapMs / 1000 : null;

              for (const lap of d.allLaps) {
                const point = {
                  idx: sessionIdx,
                  timeSec: lap.timeSec,
                  label: `${sessionLabel} Lap ${lap.lapNum}`,
                };
                if (lap.valid) {
                  validPoints.push(point);
                  if (
                    bestSec !== null &&
                    Math.abs(lap.timeSec - bestSec) < 0.001
                  ) {
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
                <SectionHeader
                  title="All Time Trial Lap Times"
                  hint="Every hotlap across attempts"
                />
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
                      data={invalidPoints}
                      fill={CHART_THEME.behind}
                      fillOpacity={0.4}
                      shape="circle"
                    />
                    <Scatter
                      data={validPoints}
                      fill={CHART_THEME.player}
                      fillOpacity={0.6}
                      shape="circle"
                    />
                    <Scatter
                      data={bestPoints}
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
            );
          })()}

          {timeTrialConsistencyTrend.length > 1 && (
            <section className={cardClass}>
              <SectionHeader
                title="TT Consistency Trend"
                hint="Lower = more repeatable hotlaps"
              />
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
            { bestQualiLapMs: actualBestQualiMs },
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
                          <span className="shrink-0 text-xs font-medium uppercase tracking-wider text-zinc-600">
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
                            label: "Avg wear",
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

              {/* Strategy — wear-balanced one-stop with optional mirror alternative.
                Only renders when we have enough data to back the recommended
                shape; the synthesis itself enforces the puncture-risk cap. */}
              {recommendation?.recommended && strategyTotalLaps > 0 && (
                <TrackStrategySection
                  recommended={recommendation.recommended}
                  alternative={recommendation.alternative}
                  totalLaps={strategyTotalLaps}
                  raceLengthLabel={selectedRaceLengthLabel}
                />
              )}

              {/* Pace evolution (race-on-race median clean lap per compound) */}
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
                          ? cn(accentCardClass("purple"), "text-purple-300")
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
      <div className="font-mono text-lg text-purple-300">
        {bestMs > 0 ? msToSectorTime(bestMs) : "–"}
      </div>
      {latestMs > 0 && (
        <div className="text-xs mt-1">
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
        </div>
      )}
    </InsightTile>
  );
}
