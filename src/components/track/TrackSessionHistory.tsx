import { useState } from "react";
import type {
  TrackSessionData,
  TrackSessionKind,
} from "../../analysis/trackAnalysis";
import type { SessionSummary } from "../../types/telemetry";
import {
  formatRelativeDate,
  formatTime,
  joinMetaParts,
  msToLapTime,
} from "../../utils/format";
import { sessionSummaryPath, trackTabForSessionType } from "../../utils/routes";
import { SessionModeLabel } from "../SessionModeLabel";
import { SessionResultMetric } from "../SessionResultMetric";
import { SessionRow } from "../SessionRow";
import { SessionTypeBadge } from "../SessionTypeBadge";
import { SESSION_TYPE_FILTER_META } from "../sessionTypeMeta";
import { Badge } from "../ui/Badge";
import { SectionHeader } from "../ui/SectionHeader";
import { SegmentedControl, type SegmentedOption } from "../ui/SegmentedControl";

type HistoryFilter = "all" | TrackSessionKind;

const HISTORY_KIND_ORDER: readonly TrackSessionKind[] = [
  "race",
  "qualifying",
  "time-trial",
];

const HISTORY_KIND_META = {
  race: SESSION_TYPE_FILTER_META.race,
  qualifying: SESSION_TYPE_FILTER_META.quali,
  "time-trial": SESSION_TYPE_FILTER_META.tt,
} satisfies Record<TrackSessionKind, (typeof SESSION_TYPE_FILTER_META)["race"]>;

interface TrackSessionHistoryProps {
  sessions?: readonly TrackSessionData[];
  /** Summary-only rows let detail pages render immediately from the session index. */
  summarySessions?: readonly SessionSummary[];
  spectatorSessions?: readonly SessionSummary[];
  activeKind: TrackSessionKind;
}

interface HistoryRow {
  summary: SessionSummary;
  kind: TrackSessionKind;
  attemptCount: number;
  bestLapMs: number;
  bestLapLabel: string;
  weather?: string;
  topSpeed?: number;
  wearRate?: number;
}

function spectatorKind(summary: SessionSummary): TrackSessionKind {
  return trackTabForSessionType(summary.sessionType);
}

function HistoryDateTime({ date }: { date: string }) {
  return (
    <span className="shrink-0 text-sm font-medium text-zinc-200">
      {formatRelativeDate(date)}
      <span className="ml-1.5 font-mono text-xs font-normal tabular-nums text-zinc-500">
        {formatTime(date)}
      </span>
    </span>
  );
}

function historyComparisonLabel(session: HistoryRow): string | null {
  if (session.kind === "race") {
    return session.wearRate != null && session.wearRate > 0
      ? `${session.wearRate.toFixed(1)}% wear/lap`
      : null;
  }

  return session.topSpeed != null && session.topSpeed > 0
    ? `${session.topSpeed} km/h`
    : null;
}

function summaryHistoryRow(summary: SessionSummary): HistoryRow {
  const kind = trackTabForSessionType(summary.sessionType);
  // Race summaries keep the player's best lap with the classification result,
  // while qualifying and Time Trial expose it at the summary's top level.
  const bestLapMs =
    kind === "race"
      ? (summary.playerRaceResult?.bestLapTimeMs ?? 0)
      : (summary.bestLapTimeMs ?? 0);
  const exportedBestLap =
    kind === "race"
      ? summary.playerRaceResult?.bestLapTime
      : summary.bestLapTime;

  return {
    summary,
    kind,
    attemptCount: 1,
    bestLapMs,
    bestLapLabel:
      bestLapMs > 0 ? msToLapTime(bestLapMs) : (exportedBestLap ?? "—"),
    weather: summary.weather,
  };
}

function detailedHistoryRow(session: TrackSessionData): HistoryRow {
  return {
    summary: session.summary,
    kind: session.kind,
    attemptCount: session.attemptCount,
    bestLapMs: session.bestLapMs,
    bestLapLabel: session.bestLapMs > 0 ? msToLapTime(session.bestLapMs) : "—",
    weather: session.weather,
    topSpeed: session.topSpeed,
    wearRate: session.wearRate,
  };
}

/** Track-scoped history with a contextual session-type default and local override. */
export function TrackSessionHistory({
  sessions = [],
  summarySessions = [],
  spectatorSessions = [],
  activeKind,
}: TrackSessionHistoryProps) {
  // `null` keeps the history following the page's active analysis tab. Once
  // the user chooses All or another kind, that explicit local choice wins.
  const [filterOverride, setFilterOverride] = useState<HistoryFilter | null>(
    null,
  );

  const detailedPaths = new Set(
    sessions.map((session) => session.summary.relativePath),
  );
  const sessionRows = [
    ...sessions.map(detailedHistoryRow),
    ...summarySessions
      .filter(
        (summary) =>
          !summary.isSpectator && !detailedPaths.has(summary.relativePath),
      )
      .map(summaryHistoryRow),
  ].sort((a, b) => Date.parse(b.summary.date) - Date.parse(a.summary.date));
  const spectatorRows = new Map<string, SessionSummary>();
  for (const summary of summarySessions) {
    if (summary.isSpectator) spectatorRows.set(summary.relativePath, summary);
  }
  for (const summary of spectatorSessions) {
    spectatorRows.set(summary.relativePath, summary);
  }
  const allSpectatorSessions = [...spectatorRows.values()].sort(
    (a, b) => Date.parse(b.date) - Date.parse(a.date),
  );

  const availableKinds = HISTORY_KIND_ORDER.filter(
    (kind) =>
      sessionRows.some((session) => session.kind === kind) ||
      allSpectatorSessions.some((summary) => spectatorKind(summary) === kind),
  );
  const contextualKind = availableKinds.includes(activeKind)
    ? activeKind
    : availableKinds.includes("race")
      ? "race"
      : (availableKinds[0] ?? activeKind);
  const requestedFilter = filterOverride ?? contextualKind;
  const filter =
    requestedFilter === "all" || availableKinds.includes(requestedFilter)
      ? requestedFilter
      : contextualKind;

  const kindCount = (kind: TrackSessionKind) =>
    sessionRows
      .filter((session) => session.kind === kind)
      .reduce((total, session) => total + session.attemptCount, 0) +
    allSpectatorSessions.filter((summary) => spectatorKind(summary) === kind)
      .length;
  // Deduplicated qualifying rows retain the number of source saves in
  // `attemptCount`; include those attempts so the control agrees with the
  // track header's session total while the row badge explains the grouping.
  const totalCount =
    sessionRows.reduce((total, session) => total + session.attemptCount, 0) +
    allSpectatorSessions.length;
  const totalRowCount = sessionRows.length + allSpectatorSessions.length;
  const filterOptions: SegmentedOption<HistoryFilter>[] = [
    { value: "all", label: "All", meta: totalCount },
    ...availableKinds.map((kind) => ({
      value: kind,
      label: HISTORY_KIND_META[kind].label,
      icon: HISTORY_KIND_META[kind].icon,
      meta: kindCount(kind),
    })),
  ];

  const filteredSessions =
    filter === "all"
      ? sessionRows
      : sessionRows.filter((session) => session.kind === filter);
  const filteredSpectatorSessions =
    filter === "all"
      ? allSpectatorSessions
      : allSpectatorSessions.filter(
          (summary) => spectatorKind(summary) === filter,
        );

  // PB tinting remains all-time within each category, even while another
  // category is hidden, so toggling the filter never changes what "best" means.
  const bestLapMsByKind: Record<TrackSessionKind, number> = {
    race: 0,
    qualifying: 0,
    "time-trial": 0,
  };
  for (const session of sessionRows) {
    if (session.bestLapMs <= 0) continue;
    const currentBest = bestLapMsByKind[session.kind];
    if (currentBest === 0 || session.bestLapMs < currentBest) {
      bestLapMsByKind[session.kind] = session.bestLapMs;
    }
  }

  if (totalRowCount === 0) return null;

  return (
    <section>
      <SectionHeader
        title="Session History"
        action={
          availableKinds.length > 1 ? (
            <SegmentedControl<HistoryFilter>
              ariaLabel="Filter session history"
              size="sm"
              scrollable
              options={filterOptions}
              value={filter}
              onChange={(next) =>
                setFilterOverride(next === contextualKind ? null : next)
              }
            />
          ) : undefined
        }
      />

      <div className="space-y-1.5">
        {filteredSessions.map((session) => {
          const isAllTimeBest =
            session.bestLapMs > 0 &&
            session.bestLapMs === bestLapMsByKind[session.kind];
          const showOffline = session.kind !== "time-trial";

          return (
            <SessionRow
              key={session.summary.relativePath}
              to={
                session.summary.isSynthetic
                  ? null
                  : sessionSummaryPath(session.summary)
              }
              leading={
                <>
                  <HistoryDateTime date={session.summary.date} />
                  <SessionTypeBadge
                    sessionType={session.summary.sessionType}
                    formula={session.summary.formula}
                  />
                  {session.attemptCount > 1 && (
                    <Badge tone="amber">×{session.attemptCount}</Badge>
                  )}
                  <SessionModeLabel
                    isOnline={session.summary.isOnline}
                    aiDifficulty={session.summary.aiDifficulty}
                    showOffline={showOffline}
                    className="shrink-0 text-xs"
                  />
                </>
              }
              meta={joinMetaParts([
                session.weather || null,
                historyComparisonLabel(session),
              ])}
              trailing={
                <SessionResultMetric
                  session={session.summary}
                  kind={session.kind}
                  lapTime={session.bestLapLabel}
                  lapTimeMs={session.bestLapMs}
                  lapTone={
                    session.bestLapMs <= 0
                      ? "muted"
                      : isAllTimeBest
                        ? "purple"
                        : "cyan"
                  }
                />
              }
            />
          );
        })}

        {filteredSpectatorSessions.length > 0 && sessionRows.length > 0 && (
          <div className="px-3 pb-1 pt-4 text-xs text-zinc-600">
            Spectator saves are shown for inspection only and do not affect
            player PBs, setup picks, tyre life, fuel, or race-result
            calculations.
          </div>
        )}

        {filteredSpectatorSessions.map((summary) => {
          const kind = spectatorKind(summary);
          const showOffline = kind !== "time-trial";
          const trailingValue =
            summary.bestLapTime ?? `${summary.validLapCount} laps`;

          return (
            <SessionRow
              key={summary.relativePath}
              to={summary.isSynthetic ? null : sessionSummaryPath(summary)}
              leading={
                <>
                  <HistoryDateTime date={summary.date} />
                  <SessionTypeBadge
                    sessionType={summary.sessionType}
                    formula={summary.formula}
                  />
                  <Badge tone="zinc">Spectator</Badge>
                  <SessionModeLabel
                    isOnline={summary.isOnline}
                    aiDifficulty={summary.aiDifficulty}
                    showOffline={showOffline}
                    className="shrink-0 text-xs"
                  />
                </>
              }
              meta={joinMetaParts([
                summary.weather || null,
                summary.classifiedDriverCount
                  ? `${summary.classifiedDriverCount} drivers`
                  : null,
              ])}
              trailing={
                <div className="inline-flex h-9 items-center justify-center rounded-lg bg-zinc-900/70 px-2.5 font-mono text-sm font-bold tabular-nums text-zinc-400 ring-1 ring-inset ring-white/[0.06]">
                  {trailingValue}
                </div>
              }
            />
          );
        })}
      </div>
    </section>
  );
}
