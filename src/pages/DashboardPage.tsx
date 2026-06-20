import { ChevronDown, ChevronUp, Timer } from "lucide-react";
import { useState } from "react";
import { cardHighlight } from "../components/Card";
import { ActivityRow } from "../components/dashboard/ActivityRow";
import { InsightCard } from "../components/dashboard/InsightCard";
import { QualifyingPaceCard } from "../components/dashboard/QualifyingPaceCard";
import { RaceResultsHero } from "../components/dashboard/RaceResultsHero";
import { RivalCard } from "../components/dashboard/RivalCard";
import { TrackOverviewCard } from "../components/dashboard/TrackOverviewCard";
import { Button } from "../components/ui/Button";
import { Eyebrow } from "../components/ui/Eyebrow";
import {
  type SessionStats,
  buildQualifyingPaceData,
  buildTrackGroups,
  buildTrackRecords,
} from "../components/dashboard/helpers";
import { SectionHeader } from "../components/ui/SectionHeader";
import { useTelemetry } from "../context/TelemetryContext";
import { buildDashboardActivity } from "../analysis/dashboardActivity";
import { buildTrackInsights } from "../analysis/dashboardInsights";
import { getDashboardResultStats } from "../analysis/dashboardResultStats";
import { buildRivalStats } from "../analysis/rivalStats";
import {
  areSessionFiltersDefault,
  DEFAULT_FILTERS,
  matchesSessionFilters,
  useSessionFilters,
} from "../hooks/useSessionFilters";
import { useSessionList } from "../hooks/useSessionList";
import { cn } from "../utils/cn";
import { getSessionFormulaScopeKey } from "../utils/formulaScope";
import { formatRelativeDate } from "../utils/format";
import { sortTracksByCalendar } from "../utils/tracks";
import { isRaceSessionType } from "../utils/sessionTypes";

const RECENT_ACTIVITY_COLLAPSED = 3;

export function DashboardPage() {
  const { sessions, loading } = useSessionList();
  const { mode, activeFormulaKey, activeFormula } = useTelemetry();
  const [filters, setFilters] = useSessionFilters();
  const [showAllActivity, setShowAllActivity] = useState(false);
  const isDemoMode = mode === "demo";

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full text-zinc-500">
        Loading sessions...
      </div>
    );
  }

  // Dashboard result stats should count classified race outcomes even when the
  // player retired before logging a timed lap. Lap/pace sections below still
  // self-filter to sessions with actual lap data before charting.
  const dashboardSessions = sessions.filter(
    (session) => session.validLapCount > 0 || session.playerRaceResult != null,
  );
  const isFiltered = !areSessionFiltersDefault(filters);
  const visibleSessions = dashboardSessions.filter((session) =>
    matchesSessionFilters(session, filters),
  );
  // Synthetic entries are demo-only summary stubs with no backing detail JSON.
  // They flow into every dashboard section (hero, recent results, insights,
  // rivals, tracks) so the prod no-data preview looks like a real dashboard.
  // List/card surfaces either render them as static demo rows or rely on the
  // SessionPage's friendly "demo preview" placeholder when a chart links to one.
  const dashboardStats = getDashboardResultStats(
    visibleSessions,
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
    visibleSessions,
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
  const unfilteredScopedSessionCount = activeFormulaKey
    ? dashboardSessions.filter(
        (session) => getSessionFormulaScopeKey(session) === activeFormulaKey,
      ).length
    : dashboardSessions.length;
  const hasUnfilteredScopedData = unfilteredScopedSessionCount > 0;
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
    ? `${formulaLabelText} · ${scopedSessions.length} ${isFiltered ? "filtered " : ""}${scopedSessions.length === 1 ? "session" : "sessions"} across ${uniqueTracks.length} ${uniqueTracks.length === 1 ? "track" : "tracks"}`
    : `${formulaLabelText} form across your saved sessions`;
  const emptyTitle =
    isFiltered && hasUnfilteredScopedData
      ? "No sessions match these filters"
      : "No sessions in this scope";
  const emptyHint =
    isFiltered && hasUnfilteredScopedData
      ? "Reset filters or choose a different game scope."
      : "Try a different formula or load more telemetry files.";

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
        <section
          className={cn(
            "rounded-2xl bg-zinc-900/40 px-5 py-8 text-center",
            cardHighlight,
          )}
        >
          <h3 className="text-sm font-semibold text-zinc-300">{emptyTitle}</h3>
          <p className="mt-1 text-sm text-zinc-500">{emptyHint}</p>
          {isFiltered && (
            <Button
              size="sm"
              variant="secondary"
              onClick={() => setFilters(DEFAULT_FILTERS)}
              className="mt-4"
            >
              Reset filters
            </Button>
          )}
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
              <SectionHeader title="Recent Activity" />
              <div className="space-y-4">
                {Object.entries(
                  (showAllActivity
                    ? recentActivity
                    : recentActivity.slice(0, RECENT_ACTIVITY_COLLAPSED)
                  ).reduce<Record<string, typeof recentActivity>>(
                    (acc, activity) => {
                      (acc[activity.dayKey] ??= []).push(activity);
                      return acc;
                    },
                    {},
                  ),
                ).map(([dayKey, activities]) => (
                  <div key={dayKey}>
                    <h3 className="mb-1.5 px-1">
                      <Eyebrow>
                        {formatRelativeDate(dayKey + "T00:00:00")}
                      </Eyebrow>
                    </h3>
                    <div className="space-y-1.5">
                      {activities.map((activity) => (
                        <ActivityRow key={activity.key} activity={activity} />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
              {recentActivity.length > RECENT_ACTIVITY_COLLAPSED && (
                <Button
                  size="xs"
                  variant="ghost"
                  onClick={() => setShowAllActivity((value) => !value)}
                  className="mt-2"
                >
                  {showAllActivity ? (
                    <>
                      Show less <ChevronUp className="size-3" />
                    </>
                  ) : (
                    <>
                      Show {recentActivity.length - RECENT_ACTIVITY_COLLAPSED}{" "}
                      more <ChevronDown className="size-3" />
                    </>
                  )}
                </Button>
              )}
            </section>
          )}

          {insights.length > 0 && (
            <section>
              <SectionHeader title="Insights" />
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
              <SectionHeader title="Rivals & Teammates" />
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {rivalStats.cards.map((card) => (
                  <RivalCard
                    key={`${card.kind}-${card.driverName}`}
                    card={card}
                  />
                ))}
              </div>
            </section>
          )}

          {sparklineGroups.length > 0 && (
            <section>
              <SectionHeader
                title="Qualifying Pace"
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
