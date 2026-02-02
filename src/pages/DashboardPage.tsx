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
import { findPlayer, getBestLapTime, lapTimeStdDev, avgWearRate, isRaceSession } from "../utils/stats";
import { msToLapTime, formatSessionType, formatTime, toTrackSlug } from "../utils/format";
import { CHART_THEME, TOOLTIP_STYLE } from "../utils/colors";
import { Card, cardClassCompact } from "../components/Card";

interface SessionStats {
  summary: SessionSummary;
  isRace: boolean;
  bestLapMs: number;
  stdDevMs: number;
  wearRate: number;
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
          return {
            summary: s,
            isRace: isRaceSession(data),
            bestLapMs: getBestLapTime(laps),
            stdDevMs: lapTimeStdDev(laps),
            wearRate: avgWearRate(player),
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

  // Trend data sorted chronologically
  const chronological = [...stats].sort(
    (a, b) => new Date(a.summary.date).getTime() - new Date(b.summary.date).getTime(),
  );

  // Only qualifying sessions for pace comparison (race laps aren't comparable)
  const paceTrend = chronological
    .filter((s) => !s.isRace && s.bestLapMs > 0)
    .map((s, i) => ({
      idx: i + 1,
      label: `${formatSessionType(s.summary.sessionType)}\n${formatTime(s.summary.date)}`,
      bestLap: s.bestLapMs / 1000,
    }));

  const consistencyTrend = chronological
    .filter((s) => s.stdDevMs > 0)
    .map((s, i) => ({
      idx: i + 1,
      stdDev: s.stdDevMs / 1000,
    }));

  const wearTrend = chronological
    .filter((s) => s.wearRate > 0)
    .map((s, i) => ({
      idx: i + 1,
      rate: +s.wearRate.toFixed(2),
    }));

  const tooltipStyle = TOOLTIP_STYLE;

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-8">
      <div>
        <h2 className="text-2xl font-bold mb-1">Dashboard</h2>
        <p className="text-sm text-zinc-500">
          {stats.length} sessions across {Object.keys(trackGroups).length} track
          {Object.keys(trackGroups).length !== 1 ? "s" : ""}
        </p>
      </div>

      {/* Recent sessions */}
      <section>
        <h3 className="text-sm font-semibold text-zinc-300 mb-2">
          Recent Sessions
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {stats.slice(0, 6).map((s) => (
            <Link
              key={s.summary.relativePath}
              to={`/session/${s.summary.slug}`}
              className={`${cardClassCompact} hover:bg-zinc-900/70 transition-colors`}
            >
              <div className="text-sm font-medium">{s.summary.track}</div>
              <div className="text-xs text-zinc-500">
                {formatSessionType(s.summary.sessionType)} ·{" "}
                {formatTime(s.summary.date)}
              </div>
              {s.bestLapMs > 0 && (
                <div className="mt-1 text-sm font-mono text-cyan-400">
                  {msToLapTime(s.bestLapMs)}
                </div>
              )}
            </Link>
          ))}
        </div>
      </section>

      {/* Pace improvement trend */}
      {paceTrend.length > 1 && (
        <Card as="section">
          <h3 className="text-sm font-semibold text-zinc-300 mb-2">
            Pace Improvement
          </h3>
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={paceTrend} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={CHART_THEME.grid} />
              <XAxis dataKey="idx" stroke={CHART_THEME.axis} fontSize={11} label={{ value: "Session", position: "insideBottom", offset: -2, fill: CHART_THEME.axis, fontSize: 11 }} />
              <YAxis stroke={CHART_THEME.axis} fontSize={11} tickFormatter={(v) => msToLapTime(v * 1000)} domain={["auto", "auto"]} />
              <Tooltip {...tooltipStyle} formatter={(value: number | undefined) => [value ? msToLapTime(value * 1000) : "–", "Best Lap"]} labelFormatter={(v) => `Session ${v}`} />
              <Line type="monotone" dataKey="bestLap" stroke="#a855f7" strokeWidth={2} dot={{ fill: "#a855f7", r: 4 }} />
            </LineChart>
          </ResponsiveContainer>
        </Card>
      )}

      {/* Consistency trend */}
      {consistencyTrend.length > 1 && (
        <Card as="section">
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
              <Tooltip {...tooltipStyle} formatter={(value: number | undefined) => [`${value?.toFixed(3) ?? "–"}s`, "Std Dev"]} labelFormatter={(v) => `Session ${v}`} />
              <Line type="monotone" dataKey="stdDev" stroke="#a78bfa" strokeWidth={2} dot={{ fill: "#a78bfa", r: 4 }} />
            </LineChart>
          </ResponsiveContainer>
        </Card>
      )}

      {/* Tyre management trend */}
      {wearTrend.length > 1 && (
        <Card as="section">
          <h3 className="text-sm font-semibold text-zinc-300 mb-2">
            Tyre Management
            <span className="font-normal text-zinc-500 ml-2">
              Lower = gentler on tyres
            </span>
          </h3>
          <ResponsiveContainer width="100%" height={180}>
            <LineChart data={wearTrend} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={CHART_THEME.grid} />
              <XAxis dataKey="idx" stroke={CHART_THEME.axis} fontSize={11} />
              <YAxis stroke={CHART_THEME.axis} fontSize={11} tickFormatter={(v) => `${v}%`} />
              <Tooltip {...tooltipStyle} formatter={(value: number | undefined) => [`${value ?? "–"}%/lap`, "Wear Rate"]} labelFormatter={(v) => `Session ${v}`} />
              <Line type="monotone" dataKey="rate" stroke="#f59e0b" strokeWidth={2} dot={{ fill: "#f59e0b", r: 4 }} />
            </LineChart>
          </ResponsiveContainer>
        </Card>
      )}

      {/* Track summary cards */}
      <section>
        <h3 className="text-sm font-semibold text-zinc-300 mb-2">Tracks</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {Object.entries(trackGroups).map(([track, trackStats]) => {
            const bestEver = Math.min(
              ...trackStats.filter((s) => s.bestLapMs > 0).map((s) => s.bestLapMs),
            );
            return (
              <Link
                key={track}
                to={`/track/${toTrackSlug(track)}`}
                className={`${cardClassCompact} !p-4 hover:bg-zinc-900/70 transition-colors`}
              >
                <div className="text-base font-semibold">{track}</div>
                <div className="flex gap-4 mt-1 text-xs text-zinc-400">
                  <span>{trackStats.length} sessions</span>
                  {bestEver > 0 && bestEver < Infinity && (
                    <span className="font-mono text-purple-400">
                      Best: {msToLapTime(bestEver)}
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
