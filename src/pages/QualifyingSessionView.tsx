import { useMemo } from "react";
import type { TelemetrySession } from "../types/telemetry";
import { findPlayer, generateQualiInsights, generateQualiHistoryInsights } from "../utils/stats";
import { useTrackHistory } from "../hooks/useTrackHistory";
import { useSessionList } from "../hooks/useSessionList";
import { SessionHeader } from "../components/SessionHeader";
import { StrategyInsightsCard } from "../components/StrategyInsightsCard";
import { QualifyingTable } from "../components/QualifyingTable";
import { SectorComparison } from "../components/SectorComparison";
import { SectorVsBest } from "../components/SectorVsBest";
import { Card } from "../components/Card";

export function QualifyingSessionView({
  session,
  slug,
}: {
  session: TelemetrySession;
  slug: string;
}) {
  const player = findPlayer(session);
  const laps = player?.["session-history"]["lap-history-data"] ?? [];
  const records = session.records?.fastest;

  // Find track name from session list to match history
  const { sessions: allSessions } = useSessionList();
  const trackName = useMemo(
    () => allSessions.find((s) => s.slug === slug)?.track,
    [allSessions, slug],
  );
  const { pbs } = useTrackHistory(trackName, slug);

  const insights = useMemo(() => {
    if (!player) return [];
    const base = generateQualiInsights(session, player);
    if (pbs) {
      base.push(...generateQualiHistoryInsights(player, pbs));
    }
    return base;
  }, [session, player, pbs]);

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-8">
      <SessionHeader session={session} />

      {/* Qualifying insights */}
      <StrategyInsightsCard insights={insights} />

      {/* Results table */}
      <Card as="section">
        <QualifyingTable session={session} />
      </Card>

      {/* Sector comparison vs session best */}
      <Card as="section">
        <SectorVsBest session={session} />
      </Card>

      {/* Player lap breakdown */}
      {laps.length > 0 && (
        <Card as="section">
          <SectorComparison laps={laps} />
        </Card>
      )}

      {/* Sector records */}
      {records && (
        <Card as="section">
          <h3 className="text-base font-semibold text-zinc-300 mb-2">
            Session Records
          </h3>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { label: "Fastest Lap", data: records.lap },
              { label: "Best S1", data: records.s1 },
              { label: "Best S2", data: records.s2 },
              { label: "Best S3", data: records.s3 },
            ].map(({ label, data: rec }) => (
              <div
                key={label}
                className="rounded-lg bg-zinc-900/50 px-3 py-2"
              >
                <div className="text-xs uppercase text-zinc-500 mb-0.5">
                  {label}
                </div>
                <div className="text-sm font-mono font-semibold">
                  {rec?.["time-str"] || "–"}
                </div>
                <div className="text-xs text-zinc-400">
                  {rec?.["driver-name"] ?? "–"}
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}
