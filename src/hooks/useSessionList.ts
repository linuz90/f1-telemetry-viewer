import { useTelemetry } from "../context/TelemetryContext";

export function useSessionList() {
  const { sessions, sessionsLoading: loading, sessionsError: error } = useTelemetry();
  return { sessions, loading, error };
}
