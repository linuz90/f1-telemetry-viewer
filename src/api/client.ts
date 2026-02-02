import type { SessionSummary, TelemetrySession } from "../types/telemetry";

/** Fetch list of all available sessions */
export async function listSessions(): Promise<SessionSummary[]> {
  const res = await fetch("/api/sessions");
  if (!res.ok) throw new Error("Failed to load sessions");
  return res.json();
}

const sessionCache = new Map<string, Promise<TelemetrySession>>();

/** Fetch a single session's full telemetry data (cached) */
export function getSession(slug: string): Promise<TelemetrySession> {
  const cached = sessionCache.get(slug);
  if (cached) return cached;

  const promise = fetch(`/api/sessions/${slug}`).then((res) => {
    if (!res.ok) {
      sessionCache.delete(slug);
      throw new Error(`Failed to load session: ${slug}`);
    }
    return res.json() as Promise<TelemetrySession>;
  });

  sessionCache.set(slug, promise);
  return promise;
}
