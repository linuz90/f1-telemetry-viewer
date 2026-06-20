import { useEffect, useMemo, useState } from "react";
import { curateSessionInsights } from "../analysis/sessionInsightCuration";
import {
  buildSessionInsightsHint,
  buildSessionSummaryInsights,
} from "../analysis/sessionInsightSummary";
import { CarSetupCard } from "../components/CarSetupCard";
import { Card } from "../components/Card";
import { DuplicateNotice } from "../components/DuplicateNotice";
import { QualifyingTable } from "../components/QualifyingTable";
import { SectorComparison } from "../components/SectorComparison";
import { SectorVsBest } from "../components/SectorVsBest";
import { SessionHeader } from "../components/SessionHeader";
import { SessionInsightsGrid } from "../components/SessionInsightsGrid";
import { useSessionList } from "../hooks/useSessionList";
import { useTrackHistory } from "../hooks/useTrackHistory";
import type { TelemetrySession } from "../types/telemetry";
import { findFocusedDriver } from "../utils/stats/drivers";
import { generateQualiHistoryInsights } from "../utils/stats/historyInsights";
import { generateQualiInsights } from "../utils/stats/qualifyingInsights";

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
  const stints =
    focusedDriver?.["session-history"]["tyre-stints-history-data"] ?? [];
  const perLapInfo = focusedDriver?.["per-lap-info"] ?? [];
  // Find track name from session list to match history
  const { sessions: allSessions } = useSessionList();
  const sessionMeta = useMemo(
    () => allSessions.find((s) => s.slug === slug),
    [allSessions, slug],
  );
  const trackName = sessionMeta?.track ?? session["session-info"]["track-id"];
  const { pbs } = useTrackHistory(
    trackName,
    slug,
    session["session-info"].formula,
    session["game-year"],
  );

  const insights = useMemo(() => {
    if (!focusedDriver) return [];
    const base = generateQualiInsights(session, focusedDriver);
    if (pbs) {
      base.push(...generateQualiHistoryInsights(focusedDriver, pbs));
    }
    return base;
  }, [session, focusedDriver, pbs]);
  const summaryInsights = useMemo(
    () => buildSessionSummaryInsights({ session, focusedDriver }),
    [focusedDriver, session],
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

  return (
    <div className="p-4 sm:p-6 max-w-5xl mx-auto space-y-6 sm:space-y-8">
      <SessionHeader
        session={session}
        focusedDriverIndex={focusedDriverIndex}
        onFocusedDriverChange={setFocusedDriverIndex}
        slug={slug}
      />

      <SessionInsightsGrid insights={sessionInsights} hint={insightsHint} />

      {/* Results table */}
      <Card as="section">
        <QualifyingTable
          session={session}
          focusedDriverIndex={focusedDriverIndex}
        />
      </Card>

      {/* Sector comparison vs session best */}
      <Card as="section">
        <SectorVsBest
          session={session}
          focusedDriverIndex={focusedDriverIndex}
        />
      </Card>

      {/* Player lap breakdown */}
      {laps.length > 0 && (
        <Card as="section">
          <SectorComparison
            laps={laps}
            stints={stints}
            perLapInfo={perLapInfo}
          />
        </Card>
      )}

      {/* Car setup */}
      {showSetup && focusedDriver["car-setup"] && (
        <Card as="section">
          <CarSetupCard setup={focusedDriver["car-setup"]} />
        </Card>
      )}

      <DuplicateNotice
        count={sessionMeta?.duplicateCount ?? 0}
        isAutoSave={sessionMeta?.isAutoSave}
      />
    </div>
  );
}
