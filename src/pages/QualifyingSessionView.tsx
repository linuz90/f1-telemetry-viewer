import { useState, useMemo, useEffect } from "react";
import type { TelemetrySession } from "../types/telemetry";
import { findFocusedDriver, generateQualiInsights, generateQualiHistoryInsights } from "../utils/stats";
import { useTrackHistory } from "../hooks/useTrackHistory";
import { useSessionList } from "../hooks/useSessionList";
import { SessionHeader } from "../components/SessionHeader";
import { StrategyInsightsCard } from "../components/StrategyInsightsCard";
import { QualifyingTable } from "../components/QualifyingTable";
import { SectorComparison } from "../components/SectorComparison";
import { SectorVsBest } from "../components/SectorVsBest";
import { CarSetupCard } from "../components/CarSetupCard";
import { Card } from "../components/Card";

export function QualifyingSessionView({
  session,
  slug,
}: {
  session: TelemetrySession;
  slug: string;
}) {
  const drivers = session["classification-data"] ?? [];
  const defaultFocused = findFocusedDriver(session);

  const [focusedDriverIndex, setFocusedDriverIndex] = useState<number>(
    defaultFocused?.index ?? 0,
  );

  // Reset when session data actually changes (handles cached fast-resolve)
  useEffect(() => {
    setFocusedDriverIndex(findFocusedDriver(session)?.index ?? 0);
  }, [session]);

  const focusedDriver = useMemo(
    () => drivers.find((d) => d.index === focusedDriverIndex),
    [drivers, focusedDriverIndex],
  );

  const laps = focusedDriver?.["session-history"]["lap-history-data"] ?? [];
  const stints = focusedDriver?.["session-history"]["tyre-stints-history-data"] ?? [];
  const records = session.records?.fastest;

  // Find track name from session list to match history
  const { sessions: allSessions } = useSessionList();
  const trackName = useMemo(
    () => allSessions.find((s) => s.slug === slug)?.track,
    [allSessions, slug],
  );
  const { pbs } = useTrackHistory(trackName, slug);

  const insights = useMemo(() => {
    if (!focusedDriver) return [];
    const base = generateQualiInsights(session, focusedDriver);
    if (pbs) {
      base.push(...generateQualiHistoryInsights(focusedDriver, pbs));
    }
    return base;
  }, [session, focusedDriver, pbs]);

  // Show car setup only for the actual player with valid setup data
  const showSetup =
    focusedDriver?.["is-player"] &&
    focusedDriver["car-setup"]?.["is-valid"];

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-8">
      <SessionHeader
        session={session}
        focusedDriverIndex={focusedDriverIndex}
        onFocusedDriverChange={setFocusedDriverIndex}
      />

      {/* Qualifying insights */}
      <StrategyInsightsCard insights={insights} />

      {/* Car setup */}
      {showSetup && focusedDriver["car-setup"] && (
        <Card as="section">
          <CarSetupCard setup={focusedDriver["car-setup"]} />
        </Card>
      )}

      {/* Results table */}
      <Card as="section">
        <QualifyingTable session={session} focusedDriverIndex={focusedDriverIndex} />
      </Card>

      {/* Sector comparison vs session best */}
      <Card as="section">
        <SectorVsBest session={session} focusedDriverIndex={focusedDriverIndex} />
      </Card>

      {/* Player lap breakdown */}
      {laps.length > 0 && (
        <Card as="section">
          <SectorComparison laps={laps} stints={stints} />
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
