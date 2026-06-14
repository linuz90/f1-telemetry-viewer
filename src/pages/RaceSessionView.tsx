import { useState, useMemo, useEffect } from "react";
import type { DriverData, TelemetrySession } from "../types/telemetry";
import {
  findFocusedDriver,
  calculateCumulativeDeltas,
  generateInsights,
  generateFuelInsights,
  generateRaceHistoryInsights,
  getCompletedStints,
  getDriverStints,
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
import { RaceControlTimeline } from "../components/RaceControlTimeline";
import { DamageTimeline } from "../components/DamageTimeline";
import { CarSetupCard } from "../components/CarSetupCard";
import { Card } from "../components/Card";
import { DuplicateNotice } from "../components/DuplicateNotice";
import { getRaceControlEvents, raceControlEventsToOvertakes } from "../utils/raceControl";
import { getTeamColor, getTeamName } from "../utils/colors";
import { Badge } from "../components/ui/Badge";

function timedRaceDrivers(drivers: DriverData[]): DriverData[] {
  return [...drivers]
    .filter((driver) =>
      driver["session-history"]["lap-history-data"].some(
        (lap) => lap["lap-time-in-ms"] > 0,
      ),
    )
    .sort((a, b) => {
      const positionDiff =
        (a["final-classification"]?.position ?? 999) -
        (b["final-classification"]?.position ?? 999);
      if (positionDiff !== 0) return positionDiff;
      return a.index - b.index;
    });
}

function SpectatorDriverPicker({
  drivers,
  focusedDriverIndex,
  onFocusedDriverChange,
}: {
  drivers: DriverData[];
  focusedDriverIndex: number;
  onFocusedDriverChange: (index: number) => void;
}) {
  if (drivers.length === 0) return null;

  const focusedDriver = drivers.find((driver) => driver.index === focusedDriverIndex);

  return (
    <div className="flex flex-wrap items-center gap-3">
      <span className="text-xs font-medium uppercase tracking-wide text-zinc-500">
        Driver
      </span>
      <span className="relative inline-flex items-center">
        <span
          className="mr-1.5 inline-block size-1.5 rounded-full"
          style={{
            backgroundColor: focusedDriver
              ? getTeamColor(focusedDriver.team)
              : undefined,
          }}
        />
        <select
          value={focusedDriverIndex}
          onChange={(event) => onFocusedDriverChange(Number(event.target.value))}
          className="rounded-md border border-zinc-700/50 bg-zinc-900/60 px-2 py-1.5 text-xs text-zinc-300 outline-none transition-colors hover:border-zinc-600 focus:ring-1 focus:ring-purple-500/40"
        >
          {drivers.map((driver) => {
            const position = driver["final-classification"]?.position;
            return (
              <option key={driver.index} value={driver.index}>
                {position ? `P${position} - ` : ""}
                {driver["driver-name"]} - {getTeamName(driver.team)}
              </option>
            );
          })}
        </select>
      </span>
      <Badge tone="zinc">Spectator save</Badge>
    </div>
  );
}

export function RaceSessionView({ session, slug }: { session: TelemetrySession; slug: string }) {
  const drivers = session["classification-data"] ?? [];
  const isSpectator = drivers.length > 0 && !drivers.some((driver) => driver["is-player"]);
  const selectableDrivers = useMemo(() => timedRaceDrivers(drivers), [drivers]);
  const defaultFocused = isSpectator
    ? selectableDrivers[0]
    : findFocusedDriver(session);

  const [focusedDriverIndex, setFocusedDriverIndex] = useState<number>(
    defaultFocused?.index ?? 0,
  );
  const [selectedRivalIndex, setSelectedRivalIndex] = useState<number | null>(
    null,
  );

  // Reset when session data actually changes (handles cached fast-resolve)
  useEffect(() => {
    setFocusedDriverIndex(
      (isSpectator ? selectableDrivers[0] : findFocusedDriver(session))?.index ?? 0,
    );
    setSelectedRivalIndex(null);
  }, [session, isSpectator, selectableDrivers]);

  const handleFocusedDriverChange = (index: number) => {
    setFocusedDriverIndex(index);
    if (isSpectator) setSelectedRivalIndex(null);
  };

  useEffect(() => {
    if (selectedRivalIndex === focusedDriverIndex) {
      setSelectedRivalIndex(null);
    }
  }, [focusedDriverIndex, selectedRivalIndex]);

  const focusedDriver = useMemo(
    () => drivers.find((d) => d.index === focusedDriverIndex),
    [drivers, focusedDriverIndex],
  );

  const info = session["session-info"];

  // Find track name from session list to match history
  const { sessions: allSessions } = useSessionList();
  const sessionMeta = useMemo(
    () => allSessions.find((s) => s.slug === slug),
    [allSessions, slug],
  );
  const trackName = sessionMeta?.track ?? info["track-id"];
  const { pbs } = useTrackHistory(trackName, slug, info.formula, session["game-year"]);

  const stints = getCompletedStints(
    focusedDriver ? getDriverStints(focusedDriver) : [],
  );
  const laps = focusedDriver?.["session-history"]["lap-history-data"] ?? [];
  const pitLaps = stints.slice(1).map((s) => s["start-lap"]);
  // Laps affected by pit stops (end of outgoing stint + start of incoming stint)
  const pitAffectedLaps = new Set([
    ...stints.slice(0, -1).map((s) => s["end-lap"]),
    ...stints.slice(1).map((s) => s["start-lap"]),
  ]);
  const perLapInfo = focusedDriver?.["per-lap-info"] ?? [];
  const raceControlEvents = useMemo(
    () => getRaceControlEvents(session),
    [session],
  );
  const raceControlOvertakes = useMemo(
    () => raceControlEventsToOvertakes(raceControlEvents),
    [raceControlEvents],
  );

  // Derive rival data
  const rival = useMemo(
    () =>
      !isSpectator && selectedRivalIndex !== null
        ? drivers.find((d) => d.index === selectedRivalIndex)
        : undefined,
    [isSpectator, selectedRivalIndex, drivers],
  );

  const rivalStints = getCompletedStints(
    rival ? getDriverStints(rival) : [],
  );
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
    // Fuel and historical PB insights are only relevant when NOT comparing h2h
    if (!rival) {
      base.push(
        ...generateFuelInsights(focusedDriver, session["session-info"]["total-laps"]),
      );
      if (pbs) {
        base.push(...generateRaceHistoryInsights(focusedDriver, pbs));
      }
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
    <div className="p-4 sm:p-6 max-w-5xl mx-auto space-y-6 sm:space-y-8">
      <SessionHeader
        session={session}
        focusedDriverIndex={focusedDriverIndex}
        onFocusedDriverChange={handleFocusedDriverChange}
        slug={slug}
        showDriverSelector={!isSpectator}
      />

      {isSpectator ? (
        <SpectatorDriverPicker
          drivers={selectableDrivers}
          focusedDriverIndex={focusedDriverIndex}
          onFocusedDriverChange={handleFocusedDriverChange}
        />
      ) : (
        <DriverComparisonPicker
          session={session}
          selectedIndex={selectedRivalIndex}
          onSelect={setSelectedRivalIndex}
          focusedDriverIndex={focusedDriverIndex}
        />
      )}

      {/* Strategy insights */}
      <StrategyInsightsCard insights={insights} />

      {/* Stint strategy + tyre wear */}
      {stints.length > 0 && (
        <Card as="section" className="space-y-4">
          <StintTimeline stints={stints} totalLaps={info["total-laps"]} />
          <TyreWearChart
            stints={stints}
            rivalStints={rival ? rivalStints : undefined}
            rivalName={rival?.["driver-name"]}
            perLapInfo={perLapInfo}
          />
          <StintDetailCards stints={stints} laps={laps} />
        </Card>
      )}

      {/* Stint comparison table */}
      {focusedDriver && stints.length > 0 && (
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
          stints={stints}
        />
      </Card>

      {/* Car setup */}
      {showSetup && focusedDriver["car-setup"] && (
        <Card as="section">
          <CarSetupCard setup={focusedDriver["car-setup"]} />
        </Card>
      )}

      {/* Damage timeline */}
      <Card as="section">
        <DamageTimeline perLapInfo={perLapInfo} />
      </Card>

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
      <Card as="section">
        <PositionChart
          positionHistory={session["position-history"] ?? []}
          playerName={focusedDriver?.["driver-name"] ?? ""}
          rivalName={rival?.["driver-name"]}
          overtakes={(raceControlOvertakes.length > 0 ? raceControlOvertakes : session.overtakes?.records)
            ?.filter((ot) => !pitAffectedLaps.has(ot["overtaking-driver-lap"]))}
        />
      </Card>

      {/* Race control */}
      {raceControlEvents.length > 0 && (
        <Card as="section">
          <RaceControlTimeline
            events={raceControlEvents}
            focusedDriver={focusedDriver}
          />
        </Card>
      )}

      {/* Results table */}
      <Card as="section">
        <RaceResultsTable
          session={session}
          focusedDriverIndex={focusedDriverIndex}
          raceControlEvents={raceControlEvents}
        />
      </Card>

      <DuplicateNotice count={sessionMeta?.duplicateCount ?? 0} />
    </div>
  );
}
