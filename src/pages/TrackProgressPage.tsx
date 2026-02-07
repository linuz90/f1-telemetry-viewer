import { useEffect, useState, useMemo } from "react";
import { useParams, Link } from "react-router-dom";
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
import { msToLapTime, msToSectorTime, formatSessionType, formatTime, formatDate, isLapValid, getSessionIcon } from "../utils/format";
import { TrackFlag } from "../components/TrackFlag";
import { CompoundStatCard } from "../components/CompoundStatCard";
import { CHART_THEME, TOOLTIP_STYLE } from "../utils/colors";
import { cardClass, cardClassCompact } from "../components/Card";
import { Upload, ArrowLeft } from "lucide-react";

interface LapPoint {
  timeSec: number;
  valid: boolean;
  lapNum: number;
}

interface TrackSessionData {
  summary: SessionSummary;
  session: TelemetrySession;
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
    // Only deduplicate qualifying (non-race) sessions
    if (earlier.isRace || later.isRace) return false;

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

export function TrackProgressPage() {
  const { trackId } = useParams<{ trackId: string }>();
  const { sessions } = useSessionList();
  const { getSession, mode, setShowUploadModal } = useTelemetry();
  const [data, setData] = useState<TrackSessionData[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<"qualifying" | "race">("race");

  // Case-insensitive match: slug is lowercase, track names from data may be capitalized
  const trackSessions = sessions.filter(
    (s) => s.track.toLowerCase() === (trackId ?? ""),
  );

  // Resolve the original (display) track name from session data
  const displayTrackName = trackSessions.length > 0 ? trackSessions[0].track : trackId ?? "";

  useEffect(() => {
    if (!trackSessions.length) {
      setLoading(false);
      return;
    }

    setLoading(true);
    Promise.all(
      trackSessions.map(async (s) => {
        try {
          const sessionData = await getSession(s.slug);
          const player = findPlayer(sessionData);
          if (!player) return null;

          const laps = player["session-history"]["lap-history-data"];
          const valid = getValidLaps(laps);

          // Best sector times from valid laps
          const bestS1 = valid.length
            ? Math.min(...valid.map((l) => l["sector-1-time-in-ms"]).filter((v) => v > 0))
            : 0;
          const bestS2 = valid.length
            ? Math.min(...valid.map((l) => l["sector-2-time-in-ms"]).filter((v) => v > 0))
            : 0;
          const bestS3 = valid.length
            ? Math.min(...valid.map((l) => l["sector-3-time-in-ms"]).filter((v) => v > 0))
            : 0;

          const allLaps: LapPoint[] = laps
            .filter((l) => l["lap-time-in-ms"] > 0)
            .map((l, li) => ({
              timeSec: l["lap-time-in-ms"] / 1000,
              valid: isLapValid(l["lap-valid-bit-flags"]),
              lapNum: li + 1,
            }));

          const info = sessionData["session-info"];

          return {
            summary: s,
            session: sessionData,
            isRace: isRaceSession(sessionData),
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
      setData(deduplicateRuns(valid));
      setLoading(false);
    });
  }, [trackSessions.length]);

  // Compound life + fuel aggregations (race only) — must be before early returns
  const raceSessions = useMemo(
    () => data.filter((d) => d.isRace).map((d) => d.session),
    [data],
  );
  const compoundLifeStats = useMemo(
    () => aggregateCompoundLife(raceSessions),
    [raceSessions],
  );
  const trackFuelStats = useMemo(
    () => aggregateFuelData(raceSessions),
    [raceSessions],
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

    return (
      <div className="flex items-center justify-center h-full">
        <div className="flex flex-col items-center gap-4 text-center max-w-sm">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-zinc-900">
            {isUploadWithNoData ? (
              <Upload className="h-5 w-5 text-zinc-500" />
            ) : (
              <ArrowLeft className="h-5 w-5 text-zinc-500" />
            )}
          </div>
          <div>
            <h3 className="text-base font-medium text-zinc-200">
              {isUploadWithNoData
                ? "Track data not available"
                : "No sessions found"}
            </h3>
            <p className="mt-1 text-sm text-zinc-500">
              {isUploadWithNoData
                ? "Uploaded telemetry is stored in memory and lost when the browser is closed. Re-upload your .zip to continue."
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
          ) : (
            <Link
              to="/"
              className="rounded-lg bg-zinc-800 px-4 py-2 text-sm font-medium text-zinc-200 hover:bg-zinc-700 transition-colors"
            >
              Back to dashboard
            </Link>
          )}
        </div>
      </div>
    );
  }

  // Split into qualifying and race sessions
  const qualiData = data.filter((d) => !d.isRace);
  const raceData = data.filter((d) => d.isRace);

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
      label: `${formatSessionType(d.summary.sessionType)} · ${formatTime(d.summary.date)}`,
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
    { label: "S1", color: "#3b82f6", bestMs: theoreticalBestS1, latestMs: latestQuali?.bestS1 ?? 0 },
    { label: "S2", color: "#8b5cf6", bestMs: theoreticalBestS2, latestMs: latestQuali?.bestS2 ?? 0 },
    { label: "S3", color: "#ec4899", bestMs: theoreticalBestS3, latestMs: latestQuali?.bestS3 ?? 0 },
  ];

  // Date range for subtitle
  const firstDate = formatDate(data[0].summary.date);
  const lastDate = formatDate(data[data.length - 1].summary.date);
  const dateRange = data.length > 1 ? `${firstDate} — ${lastDate}` : firstDate;

  // Session history sorted newest first
  const sessionHistory = [...data].reverse();

  const hasBoth = qualiData.length > 0 && raceData.length > 0;

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-8">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-2xl font-bold mb-1">
            <TrackFlag track={displayTrackName} className="mr-2" />
            {displayTrackName}
          </h2>
          <p className="text-sm text-zinc-500">
            {data.length} session{data.length !== 1 ? "s" : ""}{(() => {
              const totalAttempts = data.reduce((sum, d) => sum + d.attemptCount, 0);
              return totalAttempts > data.length ? ` (${totalAttempts} total attempts)` : "";
            })()} · {dateRange}
          </p>
        </div>

        {/* Tab switcher — only when both qualifying and race data exist */}
        {hasBoth && (
          <div className="flex gap-1 p-1 rounded-lg bg-zinc-900/80 shrink-0">
            {(["qualifying", "race"] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`px-4 py-1.5 rounded-md text-xs font-medium capitalize transition-colors ${
                  activeTab === tab
                    ? "bg-zinc-800 text-zinc-100"
                    : "text-zinc-500 hover:text-zinc-300"
                }`}
              >
                {tab}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* ── Qualifying Section ── */}
      {qualiData.length > 0 && (!hasBoth || activeTab === "qualifying") && (
        <>
          <div className="flex items-center gap-3">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">Qualifying Progress</h3>
            <div className="flex-1 h-px bg-zinc-900" />
          </div>

          {/* Stat cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className={cardClass}>
              <div className="text-xs text-zinc-500 mb-1">Best Lap</div>
              <div className="font-mono text-lg text-cyan-400">
                {actualBestQualiMs > 0 ? msToLapTime(actualBestQualiMs) : "–"}
              </div>
            </div>
            <div className={cardClass}>
              <div className="text-xs text-zinc-500 mb-1">Theoretical Best</div>
              <div className="font-mono text-lg text-green-400">
                {theoreticalBestMs > 0 ? msToLapTime(theoreticalBestMs) : "–"}
              </div>
            </div>
            <div className={cardClass}>
              <div className="text-xs text-zinc-500 mb-1">Gap to Theoretical</div>
              <div className="font-mono text-lg text-amber-400">
                {gapMs > 0 ? `+${(gapMs / 1000).toFixed(3)}s` : "–"}
              </div>
            </div>
            <div className={cardClass}>
              <div className="text-xs text-zinc-500 mb-1">Sessions</div>
              <div className="text-lg text-zinc-200">
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
                      stroke="#22c55e"
                      strokeDasharray="6 4"
                      strokeWidth={1.5}
                      label={{ value: "Theoretical", fill: "#22c55e", fontSize: 10, position: "right" }}
                    />
                  )}
                  <Line type="monotone" dataKey="bestLap" stroke="#a855f7" strokeWidth={2} dot={{ fill: "#a855f7", r: 4 }} />
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
                          <span className="font-mono text-amber-400 ml-1">
                            +{(deltaMs / 1000).toFixed(3)}
                          </span>
                        )}
                        {deltaMs === 0 && s.latestMs > 0 && s.bestMs > 0 && (
                          <span className="font-mono text-green-400 ml-1">PB</span>
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
                  <Line type="monotone" dataKey="S1" stroke="#3b82f6" strokeWidth={2} dot={{ fill: "#3b82f6", r: 3 }} />
                  <Line type="monotone" dataKey="S2" stroke="#8b5cf6" strokeWidth={2} dot={{ fill: "#8b5cf6", r: 3 }} />
                  <Line type="monotone" dataKey="S3" stroke="#ec4899" strokeWidth={2} dot={{ fill: "#ec4899", r: 3 }} />
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
              const sessionLabel = `${formatSessionType(d.summary.sessionType)} · ${formatTime(d.summary.date)}`;
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
                    <Scatter data={invalidPoints} fill="#ef4444" fillOpacity={0.4} shape="circle" />
                    <Scatter data={validPoints} fill="#22d3ee" fillOpacity={0.6} shape="circle" />
                    <Scatter data={bestPoints} fill="#a855f7" fillOpacity={1} shape="circle" />
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
        </>
      )}

      {/* ── Race Section ── */}
      {raceData.length > 0 && (!hasBoth || activeTab === "race") && (
        <>
          <div className="flex items-center gap-3">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">Race Performance</h3>
            <div className="flex-1 h-px bg-zinc-900" />
          </div>

          {/* Race stat cards */}
          <div className="grid grid-cols-2 gap-3">
            <div className={cardClass}>
              <div className="text-xs text-zinc-500 mb-1">Best Race Lap</div>
              <div className="font-mono text-lg text-cyan-400">
                {bestRaceLapMs > 0 ? msToLapTime(bestRaceLapMs) : "–"}
              </div>
            </div>
            <div className={cardClass}>
              <div className="text-xs text-zinc-500 mb-1">Races</div>
              <div className="text-lg text-zinc-200">
                {raceData.length}
              </div>
            </div>
          </div>

          {/* Compound tyre life cards */}
          {compoundLifeStats.length > 0 && (
            <div>
              <h4 className="text-sm font-semibold text-zinc-300 mb-2">Compound Tyre Life</h4>
              <div
                className="grid gap-2"
                style={{ gridTemplateColumns: `repeat(${Math.min(compoundLifeStats.length, 4)}, minmax(0, 1fr))` }}
              >
                {compoundLifeStats.map((cs) => (
                  <CompoundStatCard
                    key={cs.compound}
                    compound={cs.compound}
                    hero={{ value: `~${cs.estMaxLife}`, label: "pit by lap" }}
                    rows={[
                      { label: "Avg wear", value: `${cs.avgWearRatePerLap.toFixed(1)}%/lap` },
                      { label: "Stints", value: `${cs.avgStintLength}–${cs.longestStint} laps` },
                    ]}
                  />
                ))}
              </div>
              <p className="text-xs text-zinc-600 mt-1.5">
                Pit lap estimated at {75}% worst-wheel wear (puncture risk threshold), based on {compoundLifeStats.reduce((s, c) => s + c.stintCount, 0)} stints across {raceData.length} race{raceData.length !== 1 ? "s" : ""}.
              </p>
            </div>
          )}

          {/* Fuel summary */}
          {trackFuelStats && (
            <div>
              <h4 className="text-sm font-semibold text-zinc-300 mb-2">Fuel Management</h4>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className={cardClass}>
                  <div className="text-xs text-zinc-500 mb-1">Avg Burn Rate</div>
                  <div className="font-mono text-lg text-amber-400">
                    {trackFuelStats.avgBurnRateKgPerLap.toFixed(2)} kg/lap
                  </div>
                </div>
                <div className={cardClass}>
                  <div className="text-xs text-zinc-500 mb-1">Recommended Fuel</div>
                  <div className="font-mono text-lg text-cyan-400">
                    {Math.round(trackFuelStats.suggestedFuelKg)} kg
                  </div>
                  <div className="text-xs text-zinc-500 mt-0.5">
                    ~{trackFuelStats.suggestedFuelLaps.toFixed(1)} laps
                  </div>
                </div>
                <div className={cardClass}>
                  <div className="text-xs text-zinc-500 mb-1">Avg Excess at Finish</div>
                  <div className={`font-mono text-lg ${
                    trackFuelStats.avgFuelRemainingLaps > 1
                      ? "text-amber-400"
                      : trackFuelStats.avgFuelRemainingLaps < 0
                        ? "text-red-400"
                        : "text-emerald-400"
                  }`}>
                    {trackFuelStats.avgFuelRemainingLaps.toFixed(1)} laps
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
        </>
      )}

      {/* ── Session History ── */}
      <div>
        <div className="flex items-center gap-3 mb-3">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">Session History</h3>
          <div className="flex-1 h-px bg-zinc-900" />
        </div>
        <div className="space-y-1">
          {sessionHistory.map((d) => (
            <Link
              key={d.summary.relativePath}
              to={`/session/${d.summary.slug}`}
              className={`flex items-center gap-4 ${cardClassCompact} !px-4 !py-2.5 hover:bg-zinc-900/70 transition-colors text-sm`}
            >
              <span className="text-zinc-500 w-36 shrink-0">
                {formatDate(d.summary.date)}
              </span>
              <span className="text-zinc-400 w-32 shrink-0 flex items-center gap-1.5">
                <span className="text-xs">{getSessionIcon(d.summary.sessionType)}</span>
                {formatSessionType(d.summary.sessionType)}
                {d.attemptCount > 1 && (
                  <span className="ml-1 text-[10px] font-medium text-amber-400/80 bg-amber-400/10 rounded px-1 py-0.5">
                    x{d.attemptCount}
                  </span>
                )}
              </span>
              <span className="font-mono text-cyan-400 w-20 shrink-0">
                {d.bestLapMs > 0 ? msToLapTime(d.bestLapMs) : "–"}
              </span>
              <span className="text-xs text-zinc-500 w-20 shrink-0">
                {d.weather}
              </span>
              {d.trackTemp > 0 && (
                <span className="text-xs text-zinc-500 shrink-0">
                  T:{d.trackTemp}° A:{d.airTemp}°
                </span>
              )}
              {d.aiDifficulty > 0 && (
                <span className="text-xs text-zinc-500 shrink-0">
                  AI {d.aiDifficulty}
                </span>
              )}
              {d.topSpeed > 0 && (
                <span className="text-xs text-zinc-500 shrink-0">
                  {d.topSpeed} km/h
                </span>
              )}
              {d.wearRate > 0 && (
                <span className="text-xs text-zinc-500">
                  {d.wearRate.toFixed(1)}%/lap wear
                </span>
              )}
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
