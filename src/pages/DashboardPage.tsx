import { ChevronDown, ChevronUp, Timer } from "lucide-react";
import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { cardHighlight } from "../components/Card";
import { FormulaScopeTabs } from "../components/dashboard/FormulaScopeTabs";
import { InsightCard } from "../components/dashboard/InsightCard";
import { QualifyingPaceCard } from "../components/dashboard/QualifyingPaceCard";
import { RaceResultsHero } from "../components/dashboard/RaceResultsHero";
import { ResultRow } from "../components/dashboard/ResultRow";
import { RivalCard } from "../components/dashboard/RivalCard";
import { SectionHeader } from "../components/dashboard/SectionHeader";
import { TrackOverviewCard } from "../components/dashboard/TrackOverviewCard";
import {
  type SessionStats,
  buildQualifyingPaceData,
  buildTrackGroups,
} from "../components/dashboard/helpers";
import { useTelemetry } from "../context/TelemetryContext";
import { useSessionList } from "../hooks/useSessionList";
import {
  buildTrackInsights,
  getDashboardResultStats,
  getDefaultFormulaScopeKey,
  getFormulaScopeOptions,
  getSessionFormulaScopeKey,
} from "../utils/dashboardStats";
import { sortTracksByCalendar } from "../utils/format";
import { buildRivalStats } from "../utils/rivalStats";
import { isRaceSessionType } from "../utils/sessionTypes";

const RECENT_RESULTS_COLLAPSED = 3;

export function DashboardPage() {
  const { sessions, loading } = useSessionList();
  const { mode } = useTelemetry();
  const [searchParams, setSearchParams] = useSearchParams();
  const [showAllResults, setShowAllResults] = useState(false);
  const isDemoMode = mode === "demo";

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full text-zinc-500">
        Loading sessions...
      </div>
    );
  }

  const validSessions = sessions.filter((session) => session.validLapCount > 0);
  // Synthetic entries are demo-only summary stubs with no backing detail JSON.
  // They flow into every dashboard section (hero, recent results, insights,
  // rivals, tracks) so the prod no-data preview looks like a real dashboard.
  // List/card surfaces either render them as static demo rows or rely on the
  // SessionPage's friendly "demo preview" placeholder when a chart links to one.
  const formulaOptions = getFormulaScopeOptions(validSessions);
  const requestedFormulaKey = searchParams.get("formula");
  const defaultFormulaKey = getDefaultFormulaScopeKey(validSessions);
  const activeFormulaKey = formulaOptions.some(
    (option) => option.key === requestedFormulaKey,
  )
    ? (requestedFormulaKey ?? undefined)
    : defaultFormulaKey;
  const activeFormula = formulaOptions.find(
    (option) => option.key === activeFormulaKey,
  );
  const dashboardStats = getDashboardResultStats(
    validSessions,
    activeFormulaKey,
  );
  const scopedSessions = dashboardStats.scopedSessions;
  const scopedSessionStats: SessionStats[] = scopedSessions.map((session) => ({
    summary: session,
    isRace: isRaceSessionType(session.sessionType),
    bestLapMs: session.bestLapTimeMs ?? 0,
    validLapCount: session.validLapCount,
  }));

  const trackGroups = buildTrackGroups(scopedSessionStats);
  const sparklineGroups = Object.values(buildQualifyingPaceData(trackGroups))
    .sort((a, b) => {
      const [trackA] = sortTracksByCalendar(
        [a.track, b.track],
        activeFormulaKey,
      );
      if (a.track !== b.track) return trackA === a.track ? -1 : 1;
      return a.formulaLabel.localeCompare(b.formulaLabel);
    })
    .slice(0, 6);

  const insights = buildTrackInsights(dashboardStats);
  const rivalStats = buildRivalStats(
    validSessions,
    activeFormulaKey,
    getSessionFormulaScopeKey,
  );
  const resultPositions = dashboardStats.resultSessions
    .map((session) => session.playerRaceResult?.position)
    .filter((position): position is number => position != null);
  const bestResultPosition =
    resultPositions.length > 0 ? Math.min(...resultPositions) : undefined;
  const tracksWithResults = new Set(
    dashboardStats.resultSessions.map((session) => session.track),
  ).size;
  const uniqueTracks = sortTracksByCalendar(
    [...new Set(scopedSessions.map((session) => session.track))],
    activeFormulaKey,
  );
  const hasScopedData = scopedSessions.length > 0;
  // Aggregate stats (avg finish, DNF rate, podium counts) are noisy or misleading
  // with one or two races, and downright depressing when every race is a DNF
  // (P21 best, 0/0/0 podium, 100% DNF). Hide until there's a meaningful sample
  // AND at least one clean finish; Recent Results still surfaces whatever races
  // exist.
  const showHero =
    dashboardStats.starts >= 3 &&
    dashboardStats.cleanFinishSessions.length >= 1;
  const hasRecentResults = dashboardStats.recentResults.length > 0;
  const formulaLabelText = activeFormula?.label ?? "Telemetry";
  const subtitle = hasScopedData
    ? `${formulaLabelText} · ${scopedSessions.length} ${scopedSessions.length === 1 ? "session" : "sessions"} across ${uniqueTracks.length} ${uniqueTracks.length === 1 ? "track" : "tracks"}`
    : `${formulaLabelText} form across your saved sessions`;

  function selectFormula(nextKey: string) {
    const nextParams = new URLSearchParams(searchParams);
    nextParams.set("formula", nextKey);
    setSearchParams(nextParams);
  }

  return (
    <div className="mx-auto max-w-5xl space-y-8 p-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <h2 className="mb-1 text-xl font-bold">
            {isDemoMode ? "Demo" : "Dashboard"}
          </h2>
          <p className="text-sm text-zinc-500">{subtitle}</p>
        </div>
        <FormulaScopeTabs
          options={formulaOptions}
          activeKey={activeFormulaKey}
          onSelect={selectFormula}
        />
      </div>

      {!hasScopedData ? (
        <section className={`rounded-2xl bg-zinc-900/40 px-5 py-8 text-center ${cardHighlight}`}>
          <h3 className="text-sm font-semibold text-zinc-300">
            No sessions in this scope
          </h3>
          <p className="mt-1 text-sm text-zinc-500">
            Try a different formula or load more telemetry files.
          </p>
        </section>
      ) : (
        <>
          {showHero && (
            <RaceResultsHero
              stats={dashboardStats}
              bestPosition={bestResultPosition}
              trackCount={tracksWithResults}
            />
          )}

          {hasRecentResults && (
            <section>
              <SectionHeader
                title="Recent Results"
                hint={dashboardStats.modeLabel}
              />
              <div className="space-y-1.5">
                {(showAllResults
                  ? dashboardStats.recentResults
                  : dashboardStats.recentResults.slice(
                      0,
                      RECENT_RESULTS_COLLAPSED,
                    )
                ).map((session) => (
                  <ResultRow key={session.relativePath} session={session} />
                ))}
              </div>
              {dashboardStats.recentResults.length >
                RECENT_RESULTS_COLLAPSED && (
                <button
                  type="button"
                  onClick={() => setShowAllResults((value) => !value)}
                  className="mt-2 inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-zinc-500 transition-colors hover:text-zinc-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-zinc-600"
                >
                  {showAllResults ? (
                    <>
                      Show less <ChevronUp className="size-3" />
                    </>
                  ) : (
                    <>
                      Show{" "}
                      {dashboardStats.recentResults.length -
                        RECENT_RESULTS_COLLAPSED}{" "}
                      more <ChevronDown className="size-3" />
                    </>
                  )}
                </button>
              )}
            </section>
          )}

          {insights.length > 0 && (
            <section>
              <SectionHeader
                title="Insights"
                hint="Patterns across your sessions — race insights use online results when available"
              />
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {insights.map((insight) => (
                  <InsightCard
                    key={`${insight.kind}-${insight.track}`}
                    insight={insight}
                  />
                ))}
              </div>
            </section>
          )}

          {rivalStats.cards.length > 0 && (
            <section>
              <SectionHeader
                title="Rivals & Teammates"
                hint={`The drivers you race online — across ${rivalStats.raceCount} ${rivalStats.raceCount === 1 ? "race" : "races"}`}
              />
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {rivalStats.cards.map((card) => (
                  <RivalCard key={`${card.kind}-${card.driverName}`} card={card} />
                ))}
              </div>
            </section>
          )}

          {sparklineGroups.length > 0 && (
            <section>
              <SectionHeader
                title="Qualifying Pace"
                hint="Best lap per day"
                action={<Timer className="size-4 text-zinc-600" />}
              />
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {sparklineGroups.map((group) => (
                  <QualifyingPaceCard key={group.key} data={group} />
                ))}
              </div>
            </section>
          )}

          {uniqueTracks.length > 1 && (
            <section>
              <SectionHeader title="Tracks" />
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {uniqueTracks.map((track) => {
                  const trackSessions = scopedSessions.filter(
                    (session) => session.track === track,
                  );
                  const bestTime = trackSessions
                    .filter(
                      (session) =>
                        session.bestLapTimeMs &&
                        getSessionFormulaScopeKey(session) === activeFormulaKey,
                    )
                    .sort(
                      (a, b) =>
                        (a.bestLapTimeMs ?? Infinity) -
                        (b.bestLapTimeMs ?? Infinity),
                    )[0]?.bestLapTime;
                  return (
                    <TrackOverviewCard
                      key={track}
                      track={track}
                      sessions={trackSessions}
                      activeFormulaKey={activeFormulaKey}
                      bestTime={bestTime}
                    />
                  );
                })}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}
