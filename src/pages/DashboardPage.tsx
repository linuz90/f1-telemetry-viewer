import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  ResponsiveContainer,
} from "recharts";
import { useSessionList } from "../hooks/useSessionList";
import { useTelemetry } from "../context/TelemetryContext";
import type { SessionSummary } from "../types/telemetry";
import { findPlayer, getBestLapTime, isRaceSession } from "../utils/stats";
import { msToLapTime, formatSessionType, formatDate, formatShortDate, toTrackSlug, sortTracksByCalendar } from "../utils/format";
import { CHART_THEME } from "../utils/colors";
import { cardClassCompact } from "../components/Card";
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

  // --- Per-track sparkline data: group qualifying sessions by day, best lap per day ---
  const sparklineData: Record<string, { points: { day: string; bestLap: number }[]; pbMs: number }> = {};
  for (const [track, trackStats] of Object.entries(trackGroups)) {
    const qualiSessions = trackStats.filter((s) => !s.isRace && s.bestLapMs > 0);
    const byDay: Record<string, number> = {};
    for (const s of qualiSessions) {
      const dayKey = s.summary.date.split("T")[0];
      const prev = byDay[dayKey];
      if (!prev || s.bestLapMs < prev) {
        byDay[dayKey] = s.bestLapMs;
      }
    }
    const dayEntries = Object.entries(byDay).sort(([a], [b]) => a.localeCompare(b));
    if (dayEntries.length < 3) continue;
    sparklineData[track] = {
      points: dayEntries.map(([dayKey, ms]) => ({
        day: new Date(dayKey).toLocaleDateString("en-GB", { day: "numeric", month: "short" }),
        bestLap: ms / 1000,
      })),
      pbMs: Math.min(...Object.values(byDay)),
    };
  }
  const sparklineTracks = sortTracksByCalendar(Object.keys(sparklineData));

  // --- Tracks sorted by calendar order ---
  const sortedTracks = sortTracksByCalendar(Object.keys(trackGroups));

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

      {/* Per-track qualifying pace sparklines */}
      {sparklineTracks.length > 0 && (
        <section>
          <h3 className="text-sm font-semibold text-zinc-300 mb-1">
            Qualifying Pace
          </h3>
          <p className="text-xs text-zinc-500 mb-3">Best lap per day</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {sparklineTracks.map((track) => {
              const { points, pbMs } = sparklineData[track];
              return (
                <Link
                  key={track}
                  to={`/track/${toTrackSlug(track)}`}
                  className={`${cardClassCompact} !p-3 hover:bg-zinc-900/70 transition-colors block`}
                >
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-1.5">
                      <TrackFlag track={track} />
                      <span className="text-sm font-medium">{track}</span>
                      <span className="text-[11px] text-zinc-500 ml-1">{points.length} days</span>
                    </div>
                    <span className="text-sm font-mono text-purple-400">{msToLapTime(pbMs)}</span>
                  </div>
                  <ResponsiveContainer width="100%" height={120}>
                    <LineChart data={points} margin={{ top: 5, right: 5, bottom: 0, left: -10 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke={CHART_THEME.grid} />
                      <XAxis dataKey="day" stroke={CHART_THEME.axis} fontSize={10} tickLine={false} />
                      <YAxis
                        stroke={CHART_THEME.axis}
                        fontSize={10}
                        tickLine={false}
                        tickFormatter={(v: number) => {
                          const ms = v * 1000;
                          const minutes = Math.floor(ms / 60000);
                          const seconds = ((ms % 60000) / 1000).toFixed(1);
                          return minutes > 0 ? `${minutes}:${seconds.padStart(4, "0")}` : seconds;
                        }}
                        domain={["dataMin - 0.5", "dataMax + 0.5"]}
                        width={50}
                      />
                      <Line
                        type="monotone"
                        dataKey="bestLap"
                        stroke="#a855f7"
                        strokeWidth={2}
                        dot={{ fill: "#a855f7", r: 3 }}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </Link>
              );
            })}
          </div>
        </section>
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
