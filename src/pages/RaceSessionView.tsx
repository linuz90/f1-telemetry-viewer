import { useEffect, useMemo, useState, type ReactNode } from "react";
import { buildDamageIncreaseLaps } from "../analysis/damageAnalysis";
import { curateSessionInsights } from "../analysis/sessionInsightCuration";
import {
  buildSessionInsightsHint,
  buildSessionSummaryInsights,
} from "../analysis/sessionInsightSummary";
import { CarSetupCard } from "../components/CarSetupCard";
import { Card } from "../components/Card";
import { CompoundLapComparison } from "../components/CompoundLapComparison";
import { DamageTimeline } from "../components/DamageTimeline";
import { DriverComparisonPicker } from "../components/DriverComparisonPicker";
import { DuplicateNotice } from "../components/DuplicateNotice";
import { LapTimeChart } from "../components/LapTimeChart";
import { PerformanceDeltaChart } from "../components/PerformanceDeltaChart";
import { PositionChart } from "../components/PositionChart";
import { RaceControlTimeline } from "../components/RaceControlTimeline";
import { RaceResultsTable } from "../components/RaceResultsTable";
import { SessionDriverSelect } from "../components/SessionDriverSelect";
import { SessionHeader } from "../components/SessionHeader";
import { SessionInsightsGrid } from "../components/SessionInsightsGrid";
import { StintComparisonTable } from "../components/StintComparisonTable";
import { StintDetailCards, StintTimeline } from "../components/StintTimeline";
import { TyreWearChart } from "../components/TyreWearChart";
import { Badge } from "../components/ui/Badge";
import {
  PillSelect,
  type PillSelectSize,
  type PillSelectWidth,
} from "../components/ui/PillSelect";
import { HStack, VStack } from "../components/ui/Stack";
import { useSessionList } from "../hooks/useSessionList";
import { useTrackHistory } from "../hooks/useTrackHistory";
import type { DriverData, TelemetrySession } from "../types/telemetry";
import { getTeamColor, getTeamName } from "../utils/colors";
import {
  getRaceControlEvents,
  raceControlEventsToOvertakes,
} from "../utils/raceControl";
import { findFocusedDriver } from "../utils/stats/drivers";
import { generateFuelInsights } from "../utils/stats/energy";
import { generateRaceHistoryInsights } from "../utils/stats/historyInsights";
import { calculateCumulativeDeltas } from "../utils/stats/laps";
import { generateInsights } from "../utils/stats/raceInsights";
import { getCompletedStints, getDriverStints } from "../utils/stats/tyres";

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
  size = "md",
  width = "session",
}: {
  drivers: DriverData[];
  focusedDriverIndex: number;
  onFocusedDriverChange: (index: number) => void;
  size?: PillSelectSize;
  width?: PillSelectWidth;
}) {
  if (drivers.length === 0) return null;

  const focusedDriver = drivers.find(
    (driver) => driver.index === focusedDriverIndex,
  );
  const driverOptions = drivers.map((driver) => {
    const position = driver["final-classification"]?.position;
    return {
      value: driver.index,
      label: `${position ? `P${position} ` : ""}${driver["driver-name"]} — ${getTeamName(driver.team)}`,
    };
  });

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-2">
      <PillSelect
        value={focusedDriverIndex}
        onChange={(value) => onFocusedDriverChange(Number(value))}
        options={driverOptions}
        ariaLabel="Focused driver"
        dotColor={focusedDriver ? getTeamColor(focusedDriver.team) : undefined}
        size={size}
        width={width}
      />
      <Badge tone="zinc">Spectator save</Badge>
    </div>
  );
}

function StickySessionContextBar({ children }: { children: ReactNode }) {
  return (
    <div className="sticky top-0 z-30 -mx-4 border-b border-zinc-900/80 bg-canvas/90 px-4 py-3 shadow-lg shadow-black/20 backdrop-blur-md sm:-mx-6 sm:px-6">
      <HStack align="center" wrap={false} className="gap-2">
        {children}
      </HStack>
    </div>
  );
}

export function RaceSessionView({
  session,
  slug,
}: {
  session: TelemetrySession;
  slug: string;
}) {
  const drivers = session["classification-data"] ?? [];
  const isSpectator =
    drivers.length > 0 && !drivers.some((driver) => driver["is-player"]);
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
      (isSpectator ? selectableDrivers[0] : findFocusedDriver(session))
        ?.index ?? 0,
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
  const { pbs } = useTrackHistory(
    trackName,
    slug,
    info.formula,
    session["game-year"],
  );

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
  const filteredOvertakes = useMemo(
    () =>
      (raceControlOvertakes.length > 0
        ? raceControlOvertakes
        : session.overtakes?.records
      )?.filter((ot) => !pitAffectedLaps.has(ot["overtaking-driver-lap"])) ??
      [],
    [pitAffectedLaps, raceControlOvertakes, session.overtakes?.records],
  );

  // Derive rival data
  const rival = useMemo(
    () =>
      !isSpectator && selectedRivalIndex !== null
        ? drivers.find((d) => d.index === selectedRivalIndex)
        : undefined,
    [isSpectator, selectedRivalIndex, drivers],
  );

  const rivalStints = getCompletedStints(rival ? getDriverStints(rival) : []);
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
        ...generateFuelInsights(
          focusedDriver,
          session["session-info"]["total-laps"],
        ),
      );
      if (pbs) {
        base.push(...generateRaceHistoryInsights(focusedDriver, pbs));
      }
    }
    return base;
  }, [session, focusedDriver, rival, pbs]);
  const summaryInsights = useMemo(
    () =>
      buildSessionSummaryInsights({
        session,
        focusedDriver,
        overtakes: filteredOvertakes,
        raceControlEvents,
      }),
    [filteredOvertakes, focusedDriver, raceControlEvents, session],
  );
  const sessionInsights = useMemo(
    () => curateSessionInsights(session, [...summaryInsights, ...insights]),
    [insights, session, summaryInsights],
  );
  const insightsHint = useMemo(
    () => buildSessionInsightsHint(session),
    [session],
  );

  // Show car setup only for the actual player with valid setup data
  const showSetup =
    focusedDriver?.["is-player"] && focusedDriver["car-setup"]?.["is-valid"];

  const sessionContextControls = isSpectator ? (
    <SpectatorDriverPicker
      drivers={selectableDrivers}
      focusedDriverIndex={focusedDriverIndex}
      onFocusedDriverChange={handleFocusedDriverChange}
      size="md"
      width="compact"
    />
  ) : (
    <>
      <SessionDriverSelect
        session={session}
        focusedDriverIndex={focusedDriverIndex}
        onFocusedDriverChange={handleFocusedDriverChange}
        size="md"
        width="compact"
      />
      <DriverComparisonPicker
        session={session}
        selectedIndex={selectedRivalIndex}
        onSelect={setSelectedRivalIndex}
        focusedDriverIndex={focusedDriverIndex}
        size="md"
        width="compact"
      />
    </>
  );

  const damageLaps = useMemo(
    () => buildDamageIncreaseLaps(perLapInfo),
    [perLapInfo],
  );

  return (
    <div className="p-4 sm:p-6 max-w-5xl mx-auto">
      <SessionHeader
        session={session}
        focusedDriverIndex={focusedDriverIndex}
        onFocusedDriverChange={handleFocusedDriverChange}
        slug={slug}
        showDriverSelector={false}
        showTrackLayout={false}
      />
      <StickySessionContextBar>
        {sessionContextControls}
      </StickySessionContextBar>

      <VStack className="mt-6 gap-6 sm:gap-8">
        <SessionInsightsGrid insights={sessionInsights} hint={insightsHint} />

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
            rivalPitLaps={rival ? rivalPitLaps : undefined}
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
            overtakes={filteredOvertakes}
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

        <DuplicateNotice
          count={sessionMeta?.duplicateCount ?? 0}
          isAutoSave={sessionMeta?.isAutoSave}
        />
      </VStack>
    </div>
  );
}
