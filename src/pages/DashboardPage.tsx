import { ChevronDown, ChevronUp, Timer } from "lucide-react";
import { useState } from "react";
import { cardHighlight } from "../components/Card";
import { ActivityRow } from "../components/dashboard/ActivityRow";
import { InsightCard } from "../components/dashboard/InsightCard";
import { QualifyingPaceCard } from "../components/dashboard/QualifyingPaceCard";
import { RaceResultsHero } from "../components/dashboard/RaceResultsHero";
import { RivalCard } from "../components/dashboard/RivalCard";
import { SectionHeader } from "../components/ui/SectionHeader";
import { TrackOverviewCard } from "../components/dashboard/TrackOverviewCard";
import {
  type SessionStats,
  buildQualifyingPaceData,
  buildTrackRecords,
  buildTrackGroups,
} from "../components/dashboard/helpers";
import { useTelemetry } from "../context/TelemetryContext";
import { useSessionList } from "../hooks/useSessionList";
import { cn } from "../utils/cn";
import { buildDashboardActivity } from "../utils/dashboardActivity";
import {
  buildTrackInsights,
  getDashboardResultStats,
  getSessionFormulaScopeKey,
} from "../utils/dashboardStats";
import { formatRelativeDate, sortTracksByCalendar } from "../utils/format";
import { buildRivalStats } from "../utils/rivalStats";
import { isRaceSessionType } from "../utils/sessionTypes";

const RECENT_ACTIVITY_COLLAPSED = 3;

export function DashboardPage() {
  const { sessions, loading } = useSessionList();
  const { mode, activeFormulaKey, activeFormula } = useTelemetry();
  const [showAllActivity, setShowAllActivity] = useState(false);
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
  const recentActivity = buildDashboardActivity(scopedSessions);
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
  // AND at least one clean finish; Recent Activity still surfaces the raw work.
  const showHero =
    dashboardStats.starts >= 3 &&
    dashboardStats.cleanFinishSessions.length >= 1;
  const hasRecentActivity = recentActivity.length > 0;
  const formulaLabelText = activeFormula?.label ?? "Telemetry";
  const subtitle = hasScopedData
    ? `${formulaLabelText} · ${scopedSessions.length} ${scopedSessions.length === 1 ? "session" : "sessions"} across ${uniqueTracks.length} ${uniqueTracks.length === 1 ? "track" : "tracks"}`
    : `${formulaLabelText} form across your saved sessions`;

  return (
    <div className="mx-auto max-w-5xl space-y-8 p-6">
      <div>
        <div className="min-w-0">
          <h2 className="mb-1 text-xl font-bold">
            {isDemoMode ? "Demo" : "Dashboard"}
          </h2>
          <p className="text-sm text-zinc-500">{subtitle}</p>
        </div>
      </div>

      {!hasScopedData ? (
        <section className={cn("rounded-2xl bg-zinc-900/40 px-5 py-8 text-center", cardHighlight)}>
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

          {hasRecentActivity && (
            <section>
              <SectionHeader
                title="Recent Activity"
                hint="Best representative sessions from recent driving"
              />
              <div className="space-y-4">
                {Object.entries(
                  (showAllActivity
                    ? recentActivity
                    : recentActivity.slice(0, RECENT_ACTIVITY_COLLAPSED)
                  ).reduce<Record<string, typeof recentActivity>>((acc, activity) => {
                    (acc[activity.dayKey] ??= []).push(activity);
                    return acc;
                  }, {}),
                ).map(([dayKey, activities]) => (
                  <div key={dayKey}>
                    <h3 className="mb-1.5 px-1 text-xs font-semibold uppercase tracking-wider text-zinc-500">
                      {formatRelativeDate(dayKey + "T00:00:00")}
                    </h3>
                    <div className="space-y-1.5">
                      {activities.map((activity) => (
                        <ActivityRow key={activity.key} activity={activity} />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
              {recentActivity.length >
                RECENT_ACTIVITY_COLLAPSED && (
                <button
                  type="button"
                  onClick={() => setShowAllActivity((value) => !value)}
                  className="mt-2 inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-zinc-500 transition-colors hover:text-zinc-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-zinc-600"
                >
                  {showAllActivity ? (
                    <>
                      Show less <ChevronUp className="size-3" />
                    </>
                  ) : (
                    <>
                      Show{" "}
                      {recentActivity.length -
                        RECENT_ACTIVITY_COLLAPSED}{" "}
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

          {uniqueTracks.length > 0 && (
            <section>
              <SectionHeader title="Tracks" />
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {uniqueTracks.map((track) => {
                  const trackSessions = scopedSessions.filter(
                    (session) => session.track === track,
                  );
                  return (
                    <TrackOverviewCard
                      key={track}
                      track={track}
                      sessions={trackSessions}
                      activeFormulaKey={activeFormulaKey}
                      records={buildTrackRecords(trackSessions)}
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
