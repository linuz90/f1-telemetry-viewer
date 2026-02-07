import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { useSessionList } from "../hooks/useSessionList";
import { useTelemetry } from "../context/TelemetryContext";
import type { SessionSummary } from "../types/telemetry";
import { findPlayer, getBestLapTime, isRaceSession } from "../utils/stats";
import { msToLapTime, formatSessionType, formatDate, formatShortDate, toTrackSlug, sortTracksByCalendar } from "../utils/format";
import { CHART_THEME, TOOLTIP_STYLE } from "../utils/colors";
import { Card, cardClassCompact } from "../components/Card";
import { TrackFlag } from "../components/TrackFlag";

interface SessionStats {
  summary: SessionSummary;
  isRace: boolean;
  bestLapMs: number;
  validLapCount: number;
}

export function DashboardPage() {
  const { sessions, loading: listLoading } = useSessionList();
  const { getSession } = useTelemetry();
  const [stats, setStats] = useState<SessionStats[]>([]);
  const [loading, setLoading] = useState(false);

  // Load all sessions to compute cross-session stats
  useEffect(() => {
    if (!sessions.length) return;

    setLoading(true);
    Promise.all(
      sessions.map(async (s) => {
        try {
          const data = await getSession(s.slug);
          const player = findPlayer(data);
          if (!player) return null;

          const laps = player["session-history"]["lap-history-data"];
          const validLaps = laps.filter(
            (l) => l["lap-valid-bit-flags"] === 15 && l["lap-time-in-ms"] > 0,
          );
          return {
            summary: s,
            isRace: isRaceSession(data),
            bestLapMs: getBestLapTime(laps),
            validLapCount: validLaps.length,
          } satisfies SessionStats;
        } catch {
          return null;
        }
      }),
    ).then((results) => {
      setStats(results.filter((r): r is SessionStats => r !== null));
      setLoading(false);
    });
  }, [sessions]);

  if (listLoading || loading) {
    return (
      <div className="flex items-center justify-center h-full text-zinc-500">
        Loading dashboard...
      </div>
    );
  }

  // Group stats by track
  const trackGroups: Record<string, SessionStats[]> = {};
  for (const s of stats) {
    const t = s.summary.track;
    if (!trackGroups[t]) trackGroups[t] = [];
    trackGroups[t].push(s);
  }

  // Compute per-track best qualifying lap times
  const trackBestQuali: Record<string, number> = {};
  for (const [track, trackStats] of Object.entries(trackGroups)) {
    const qualiBests = trackStats
      .filter((s) => !s.isRace && s.bestLapMs > 0)
      .map((s) => s.bestLapMs);
    if (qualiBests.length > 0) {
      trackBestQuali[track] = Math.min(...qualiBests);
    }
  }

  // --- Headline stats ---
  const allTimeBestEntry = stats
    .filter((s) => !s.isRace && s.bestLapMs > 0)
    .sort((a, b) => a.bestLapMs - b.bestLapMs)[0];
  const totalLaps = stats.reduce((sum, s) => sum + s.validLapCount, 0);
  const trackCount = Object.keys(trackGroups).length;

  // --- Recent sessions (first 6, already sorted most-recent-first from API) ---
  const recentSessions = stats.slice(0, 6);

  // --- Per-track pace chart: find the most-driven track (qualifying sessions only) ---
  const trackQualiCounts: Record<string, number> = {};
  for (const s of stats) {
    if (!s.isRace) {
      trackQualiCounts[s.summary.track] = (trackQualiCounts[s.summary.track] || 0) + 1;
    }
  }
  const mostDrivenTrack = Object.entries(trackQualiCounts).sort(
    (a, b) => b[1] - a[1],
  )[0]?.[0];

  const paceChartData = mostDrivenTrack
    ? stats
        .filter(
          (s) =>
            !s.isRace &&
            s.summary.track === mostDrivenTrack &&
            s.bestLapMs > 0,
        )
        .sort(
          (a, b) =>
            new Date(a.summary.date).getTime() -
            new Date(b.summary.date).getTime(),
        )
        .map((s) => ({
          date: formatShortDate(s.summary.date),
          bestLap: s.bestLapMs / 1000,
          bestLapMs: s.bestLapMs,
        }))
    : [];

  // --- Tracks sorted by calendar order ---
  const sortedTracks = sortTracksByCalendar(Object.keys(trackGroups));

  const tooltipStyle = TOOLTIP_STYLE;

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-8">
      <div>
        <h2 className="text-2xl font-bold mb-1">Dashboard</h2>
        <p className="text-sm text-zinc-500">
          Your F1 telemetry at a glance
        </p>
      </div>

      {/* Headline Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className={cardClassCompact}>
          <div className="text-xs text-zinc-500 mb-1">All-time Best</div>
          {allTimeBestEntry ? (
            <>
              <div className="text-lg font-mono font-semibold text-cyan-400">
                {msToLapTime(allTimeBestEntry.bestLapMs)}
              </div>
              <div className="text-xs text-zinc-500">
                {allTimeBestEntry.summary.track}
              </div>
            </>
          ) : (
            <div className="text-lg font-mono text-zinc-600">-</div>
          )}
        </div>
        <div className={cardClassCompact}>
          <div className="text-xs text-zinc-500 mb-1">Sessions</div>
          <div className="text-lg font-semibold text-zinc-100">
            {stats.length}
          </div>
        </div>
        <div className={cardClassCompact}>
          <div className="text-xs text-zinc-500 mb-1">Laps Driven</div>
          <div className="text-lg font-semibold text-zinc-100">
            {totalLaps.toLocaleString()}
          </div>
        </div>
        <div className={cardClassCompact}>
          <div className="text-xs text-zinc-500 mb-1">Tracks</div>
          <div className="text-lg font-semibold text-zinc-100">
            {trackCount}
          </div>
        </div>
      </div>

      {/* Recent sessions */}
      <section>
        <h3 className="text-sm font-semibold text-zinc-300 mb-2">
          Recent Sessions
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {recentSessions.map((s) => {
            const pb = trackBestQuali[s.summary.track];
            const hasDelta = !s.isRace && s.bestLapMs > 0 && pb != null && pb > 0;
            const isPB = hasDelta && s.bestLapMs <= pb;
            const deltaMs = hasDelta ? s.bestLapMs - pb : 0;

            return (
              <Link
                key={s.summary.relativePath}
                to={`/session/${s.summary.slug}`}
                className={`${cardClassCompact} hover:bg-zinc-900/70 transition-colors`}
              >
                <div className="text-sm font-medium flex items-center gap-1.5"><TrackFlag track={s.summary.track} />{s.summary.track}</div>
                <div className="text-xs text-zinc-500">
                  {formatSessionType(s.summary.sessionType)} ·{" "}
                  {formatDate(s.summary.date)}
                </div>
                {s.bestLapMs > 0 && (
                  <div className="mt-1 flex items-center gap-2">
                    <span className="text-sm font-mono text-cyan-400">
                      {msToLapTime(s.bestLapMs)}
                    </span>
                    {hasDelta && (
                      <span
                        className={`text-xs font-mono font-semibold ${
                          isPB
                            ? "text-emerald-400"
                            : "text-red-400"
                        }`}
                      >
                        {isPB
                          ? "PB"
                          : `+${(deltaMs / 1000).toFixed(3)}s`}
                      </span>
                    )}
                  </div>
                )}
              </Link>
            );
          })}
        </div>
      </section>

      {/* Per-track pace chart */}
      {mostDrivenTrack && paceChartData.length > 1 && (
        <Card as="section">
          <h3 className="text-sm font-semibold text-zinc-300 mb-2 flex items-center gap-1.5">
            <TrackFlag track={mostDrivenTrack} />
            Pace at {mostDrivenTrack}
            <span className="font-normal text-zinc-500 ml-2">
              {paceChartData.length} qualifying sessions
            </span>
          </h3>
          <ResponsiveContainer width="100%" height={220}>
            <LineChart
              data={paceChartData}
              margin={{ top: 5, right: 20, bottom: 5, left: 0 }}
            >
              <CartesianGrid
                strokeDasharray="3 3"
                stroke={CHART_THEME.grid}
              />
              <XAxis
                dataKey="date"
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
              />
              <Line
                type="monotone"
                dataKey="bestLap"
                stroke="#a855f7"
                strokeWidth={2}
                dot={{ fill: "#a855f7", r: 4 }}
              />
            </LineChart>
          </ResponsiveContainer>
        </Card>
      )}

      {/* Track summary cards */}
      <section>
        <h3 className="text-sm font-semibold text-zinc-300 mb-2">Tracks</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {sortedTracks.map((track) => {
            const trackStats = trackGroups[track];
            const bestEver = Math.min(
              ...trackStats.filter((s) => s.bestLapMs > 0).map((s) => s.bestLapMs),
            );
            const lastDriven = trackStats
              .map((s) => new Date(s.summary.date).getTime())
              .sort((a, b) => b - a)[0];

            return (
              <Link
                key={track}
                to={`/track/${toTrackSlug(track)}`}
                className={`${cardClassCompact} !p-4 hover:bg-zinc-900/70 transition-colors`}
              >
                <div className="text-base font-semibold flex items-center gap-1.5"><TrackFlag track={track} />{track}</div>
                <div className="flex gap-4 mt-1 text-xs text-zinc-400">
                  <span>{trackStats.length} sessions</span>
                  {bestEver > 0 && bestEver < Infinity && (
                    <span className="font-mono text-purple-400">
                      Best: {msToLapTime(bestEver)}
                    </span>
                  )}
                  {lastDriven && (
                    <span>
                      Last: {formatShortDate(new Date(lastDriven).toISOString())}
                    </span>
                  )}
                </div>
              </Link>
            );
          })}
        </div>
      </section>
    </div>
  );
}
