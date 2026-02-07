import { useState, useMemo, useEffect } from "react";
import type { TelemetrySession } from "../types/telemetry";
import {
  findFocusedDriver,
  calculateCumulativeDeltas,
  generateInsights,
  generateFuelInsights,
  generateRaceHistoryInsights,
} from "../utils/stats";
import { useTrackHistory } from "../hooks/useTrackHistory";
import { useSessionList } from "../hooks/useSessionList";
import { SessionHeader } from "../components/SessionHeader";
import { DriverComparisonPicker } from "../components/DriverComparisonPicker";
import { StrategyInsightsCard } from "../components/StrategyInsightsCard";
import { StintTimeline, StintDetailCards } from "../components/StintTimeline";
import { TyreWearChart } from "../components/TyreWearChart";
import { StintComparisonTable } from "../components/StintComparisonTable";
import { LapTimeChart } from "../components/LapTimeChart";
import { CompoundLapComparison } from "../components/CompoundLapComparison";
import { PerformanceDeltaChart } from "../components/PerformanceDeltaChart";
import { PositionChart } from "../components/PositionChart";
import { RaceResultsTable } from "../components/RaceResultsTable";
import { DamageTimeline } from "../components/DamageTimeline";
import { WeatherTimeline } from "../components/WeatherTimeline";
import { CarSetupCard } from "../components/CarSetupCard";
import { Card } from "../components/Card";

export function RaceSessionView({ session, slug }: { session: TelemetrySession; slug: string }) {
  const drivers = session["classification-data"] ?? [];
  const defaultFocused = findFocusedDriver(session);

  const [focusedDriverIndex, setFocusedDriverIndex] = useState<number>(
    defaultFocused?.index ?? 0,
  );
  const [selectedRivalIndex, setSelectedRivalIndex] = useState<number | null>(
    null,
  );

  // Reset when session data actually changes (handles cached fast-resolve)
  useEffect(() => {
    setFocusedDriverIndex(findFocusedDriver(session)?.index ?? 0);
    setSelectedRivalIndex(null);
  }, [session]);

  const focusedDriver = useMemo(
    () => drivers.find((d) => d.index === focusedDriverIndex),
    [drivers, focusedDriverIndex],
  );

  const info = session["session-info"];

  // Find track name from session list to match history
  const { sessions: allSessions } = useSessionList();
  const trackName = useMemo(
    () => allSessions.find((s) => s.slug === slug)?.track,
    [allSessions, slug],
  );
  const { pbs } = useTrackHistory(trackName, slug);

  const stints = focusedDriver?.["tyre-set-history"] ?? [];
  const laps = focusedDriver?.["session-history"]["lap-history-data"] ?? [];
  const pitLaps = stints.slice(1).map((s) => s["start-lap"]);
  // Laps affected by pit stops (end of outgoing stint + start of incoming stint)
  const pitAffectedLaps = new Set([
    ...stints.slice(0, -1).map((s) => s["end-lap"]),
    ...stints.slice(1).map((s) => s["start-lap"]),
  ]);
  const perLapInfo = focusedDriver?.["per-lap-info"] ?? [];

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
    if (!focusedDriver) return [];
    const base = generateInsights(session, focusedDriver, rival);
    base.push(
      ...generateFuelInsights(focusedDriver, session["session-info"]["total-laps"]),
    );
    if (pbs) {
      base.push(...generateRaceHistoryInsights(focusedDriver, pbs));
    }
    return base;
  }, [session, focusedDriver, rival, pbs]);

  // Show car setup only for the actual player with valid setup data
  const showSetup =
    focusedDriver?.["is-player"] &&
    focusedDriver["car-setup"]?.["is-valid"];

  // Compute laps where damage increased
  const damageLaps = useMemo(() => {
    const result: number[] = [];
    for (let i = 1; i < perLapInfo.length; i++) {
      const prev = perLapInfo[i - 1]["car-damage-data"];
      const curr = perLapInfo[i]["car-damage-data"];
      const fields = [
        "front-left-wing-damage",
        "front-right-wing-damage",
        "rear-wing-damage",
        "floor-damage",
        "diffuser-damage",
        "sidepod-damage",
        "engine-damage",
        "gear-box-damage",
      ] as const;
      for (const f of fields) {
        if (((curr as unknown as Record<string, number>)[f] ?? 0) > ((prev as unknown as Record<string, number>)[f] ?? 0)) {
          result.push(perLapInfo[i]["lap-number"]);
          break;
        }
      }
    }
    return result;
  }, [perLapInfo]);

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-8">
      <SessionHeader
        session={session}
        focusedDriverIndex={focusedDriverIndex}
        onFocusedDriverChange={setFocusedDriverIndex}
      />

      {/* Weather timeline */}
      {(info["weather-forecast-samples"]?.length ?? 0) > 1 && (
        <WeatherTimeline forecastSamples={info["weather-forecast-samples"]!} />
      )}

      {/* Driver comparison picker */}
      <DriverComparisonPicker
        session={session}
        selectedIndex={selectedRivalIndex}
        onSelect={setSelectedRivalIndex}
        focusedDriverIndex={focusedDriverIndex}
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
          perLapInfo={perLapInfo}
        />
        <StintDetailCards stints={stints} />
      </Card>

      {/* Stint comparison table */}
      {focusedDriver && (
        <Card as="section">
          <StintComparisonTable player={focusedDriver} allDrivers={drivers} />
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
          damageLaps={damageLaps}
        />
      </Card>

      {/* Car setup */}
      {showSetup && focusedDriver["car-setup"] && (
        <Card as="section">
          <CarSetupCard setup={focusedDriver["car-setup"]} />
        </Card>
      )}

      {/* Damage timeline */}
      {perLapInfo.length > 0 && (
        <Card as="section">
          <DamageTimeline perLapInfo={perLapInfo} />
        </Card>
      )}

      {/* Compound comparison (only when rival selected) */}
      {rival && (
        <Card as="section">
          <CompoundLapComparison
            playerStints={stints}
            playerLaps={laps}
            rivalStints={rivalStints}
            rivalLaps={rivalLaps}
            rivalName={rival["driver-name"]}
          />
        </Card>
      )}

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
            playerName={focusedDriver?.["driver-name"] ?? ""}
            rivalName={rival?.["driver-name"]}
            overtakes={session.overtakes?.records.filter((ot) => !pitAffectedLaps.has(ot["overtaking-driver-lap"]))}
          />
        </Card>
      )}

      {/* Results table */}
      <Card as="section">
        <RaceResultsTable session={session} focusedDriverIndex={focusedDriverIndex} />
      </Card>
    </div>
  );
}
