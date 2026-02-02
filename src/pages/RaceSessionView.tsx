import { useState, useMemo } from "react";
import type { TelemetrySession } from "../types/telemetry";
import {
  findPlayer,
  calculateCumulativeDeltas,
  generateInsights,
  generateRaceHistoryInsights,
} from "../utils/stats";
import { useTrackHistory } from "../hooks/useTrackHistory";
import { useSessionList } from "../hooks/useSessionList";
import { SessionHeader } from "../components/SessionHeader";
import { DriverComparisonPicker } from "../components/DriverComparisonPicker";
import { StrategyInsightsCard } from "../components/StrategyInsightsCard";
import { StintTimeline } from "../components/StintTimeline";
import { TyreWearChart } from "../components/TyreWearChart";
import { StintComparisonTable } from "../components/StintComparisonTable";
import { LapTimeChart } from "../components/LapTimeChart";
import { PerformanceDeltaChart } from "../components/PerformanceDeltaChart";
import { PositionChart } from "../components/PositionChart";
import { RaceResultsTable } from "../components/RaceResultsTable";
import { Card } from "../components/Card";

export function RaceSessionView({ session, slug }: { session: TelemetrySession; slug: string }) {
  const [selectedRivalIndex, setSelectedRivalIndex] = useState<number | null>(
    null,
  );

  const player = findPlayer(session);
  const info = session["session-info"];
  const drivers = session["classification-data"] ?? [];

  // Find track name from session list to match history
  const { sessions: allSessions } = useSessionList();
  const trackName = useMemo(
    () => allSessions.find((s) => s.slug === slug)?.track,
    [allSessions, slug],
  );
  const { pbs } = useTrackHistory(trackName, slug);

  const stints = player?.["tyre-set-history"] ?? [];
  const laps = player?.["session-history"]["lap-history-data"] ?? [];
  const pitLaps = stints.slice(1).map((s) => s["start-lap"]);
  const perLapInfo = player?.["per-lap-info"] ?? [];

  // Derive rival data
  const rival = useMemo(
    () =>
      selectedRivalIndex !== null
        ? drivers.find((d) => d.index === selectedRivalIndex)
        : undefined,
    [selectedRivalIndex, drivers],
  );

  const rivalStints = rival?.["tyre-set-history"] ?? [];
  const rivalLaps = rival?.["session-history"]["lap-history-data"] ?? [];
  const rivalPitLaps = rivalStints.slice(1).map((s) => s["start-lap"]);

  // Cumulative deltas (only when rival selected)
  const deltas = useMemo(() => {
    if (!rival || !laps.length || !rivalLaps.length) return [];
    return calculateCumulativeDeltas(laps, rivalLaps, pitLaps, rivalPitLaps);
  }, [rival, laps, rivalLaps, pitLaps, rivalPitLaps]);

  // Strategy insights
  const insights = useMemo(() => {
    if (!player) return [];
    const base = generateInsights(session, player, rival);
    if (pbs) {
      base.push(...generateRaceHistoryInsights(player, pbs));
    }
    return base;
  }, [session, player, rival, pbs]);

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-8">
      <SessionHeader session={session} />

      {/* Driver comparison picker */}
      <DriverComparisonPicker
        session={session}
        selectedIndex={selectedRivalIndex}
        onSelect={setSelectedRivalIndex}
      />

      {/* Strategy insights */}
      <StrategyInsightsCard insights={insights} />

      {/* Stint strategy + tyre wear */}
      <Card as="section" className="space-y-4">
        <StintTimeline stints={stints} totalLaps={info["total-laps"]} />
        <TyreWearChart
          stints={stints}
          rivalStints={rival ? rivalStints : undefined}
          rivalName={rival?.["driver-name"]}
        />
      </Card>

      {/* Stint comparison table */}
      {player && (
        <Card as="section">
          <StintComparisonTable player={player} allDrivers={drivers} />
        </Card>
      )}

      {/* Lap times */}
      <Card as="section">
        <LapTimeChart
          laps={laps}
          pitLaps={pitLaps}
          rivalLaps={rival ? rivalLaps : undefined}
          rivalName={rival?.["driver-name"]}
          perLapInfo={perLapInfo}
        />
      </Card>

      {/* Performance delta (only when rival selected) */}
      {rival && deltas.length > 0 && (
        <Card as="section">
          <PerformanceDeltaChart
            deltas={deltas}
            rivalName={rival["driver-name"]}
          />
        </Card>
      )}

      {/* Position changes */}
      {session["position-history"]?.length > 0 && (
        <Card as="section">
          <PositionChart
            positionHistory={session["position-history"]}
            playerName={player?.["driver-name"] ?? ""}
            rivalName={rival?.["driver-name"]}
          />
        </Card>
      )}

      {/* Results table */}
      <Card as="section">
        <RaceResultsTable session={session} />
      </Card>
    </div>
  );
}
