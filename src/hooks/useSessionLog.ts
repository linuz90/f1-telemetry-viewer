import { useMemo } from "react";
import { useTelemetry } from "../context/TelemetryContext";
import { buildSessionLog, sessionLogOrder } from "../analysis/sessionLog";
import { buildTrackIndex } from "../analysis/trackIndex";
import { getSessionFormulaScopeKey } from "../utils/formulaScope";
import { getTrackId } from "../utils/tracks";
import { matchesSessionFilters, useSessionFilters } from "./useSessionFilters";

/** Sessions in the active game scope, newest first. */
export function useScopedSessions() {
  const { sessions, activeFormulaKey } = useTelemetry();
  return useMemo(
    () =>
      sessions
        .filter(
          (s) =>
            !activeFormulaKey ||
            getSessionFormulaScopeKey(s) === activeFormulaKey,
        )
        .sort((a, b) => b.date.localeCompare(a.date)),
    [sessions, activeFormulaKey],
  );
}

/** The session log as the user filtered it, plus its flat order for ‹ ›. */
export function useSessionLog() {
  const scoped = useScopedSessions();
  const [storedFilters, setFilters] = useSessionFilters();
  // The stored track filter follows you across game scopes; one this scope
  // never drove reads as "every track" instead of an empty log.
  const filters = useMemo(
    () =>
      storedFilters.track &&
      !scoped.some((s) => getTrackId(s.track) === storedFilters.track)
        ? { ...storedFilters, track: null }
        : storedFilters,
    [scoped, storedFilters],
  );
  const filtered = useMemo(
    () => scoped.filter((s) => matchesSessionFilters(s, filters)),
    [scoped, filters],
  );
  const days = useMemo(() => buildSessionLog(filtered), [filtered]);
  const order = useMemo(() => sessionLogOrder(days), [days]);
  return { scoped, filtered, days, order, filters, setFilters };
}

export function useTrackIndex() {
  const scoped = useScopedSessions();
  const { activeFormulaKey } = useTelemetry();
  return useMemo(
    () => buildTrackIndex(scoped, activeFormulaKey),
    [scoped, activeFormulaKey],
  );
}
