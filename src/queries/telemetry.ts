import { queryOptions, type QueryClient } from "@tanstack/react-query";
import type { SessionSummary, TelemetrySession } from "../types/telemetry";

export type Mode = "detecting" | "api" | "demo" | "upload";
export type DataSourceMode = Exclude<Mode, "detecting">;

export interface DataSourceDetection {
  mode: DataSourceMode;
  sessions: SessionSummary[];
}

// Centralized query keys so cache reads, writes, and evictions can't drift out
// of sync. Session-detail keys are hierarchical (["session", mode, slug]) so a
// mode-level prefix evicts every detail query for that source in one call —
// see loadFiles() replacing the upload store.
export const telemetryKeys = {
  dataSource: ["data-source"] as const,
  sessionList: ["sessions"] as const,
  sessionDetailsByMode: (mode: Mode) => ["session", mode] as const,
  sessionDetail: (mode: Mode, slug: string) => ["session", mode, slug] as const,
};

// Resolves the session-list poll interval (ms), preferring the runtime config
// injected by Pits n' Giggles (window.__PNG_SAVE_VIEWER_CONFIG__, already in ms)
// over the build-time env var used by standalone/dev deployments of this
// submodule (in seconds). 0 or unset disables polling.
export function getSessionPollIntervalMs(): number {
  const injected = (
    window as Window & {
      __PNG_SAVE_VIEWER_CONFIG__?: { sessionPollIntervalMs?: number | null };
    }
  ).__PNG_SAVE_VIEWER_CONFIG__?.sessionPollIntervalMs;
  // Guard against NaN/Infinity from a bad host-config serialization — an
  // invalid number must disable polling, not turn into a ~0ms interval.
  if (typeof injected === "number")
    return Number.isFinite(injected) && injected > 0 ? injected : 0;
  if (injected === null) return 0; // host explicitly disabled it
  const intervalSecs =
    Number(import.meta.env.VITE_SESSION_POLL_INTERVAL_S) || 0;
  // Same finite-guard as the injected path: a non-finite env value (e.g.
  // "Infinity") must disable polling, not coerce into a ~0ms refetch loop.
  return Number.isFinite(intervalSecs) && intervalSecs > 0
    ? intervalSecs * 1000
    : 0;
}

export async function fetchSessionList(url: string): Promise<SessionSummary[]> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to load session list: ${url}`);
  return res.json() as Promise<SessionSummary[]>;
}

// One-shot startup probe deciding where session data comes from: the local dev
// API when available, the committed demo data otherwise, and finally in-browser
// uploads. VITE_SKIP_API (dev:prod) forces the production demo → upload path.
export async function detectDataSource(
  queryClient: QueryClient,
): Promise<DataSourceDetection> {
  if (import.meta.env.VITE_SKIP_API !== "true") {
    try {
      const sessions = await fetchSessionList(
        `${import.meta.env.BASE_URL}api/sessions`,
      );
      // Seed the list query so api mode doesn't immediately re-download what
      // this probe just fetched — the dev server re-reads every telemetry JSON
      // on disk per request, so duplicate hits are not free.
      queryClient.setQueryData(telemetryKeys.sessionList, sessions);
      return { mode: "api", sessions };
    } catch {
      // API unavailable — fall through to demo data
    }
  }
  try {
    const sessions = await fetchSessionList(
      `${import.meta.env.BASE_URL}demo/sessions.json`,
    );
    return { mode: "demo", sessions };
  } catch {
    return { mode: "upload", sessions: [] };
  }
}

// Query definition for one session's full telemetry JSON. Shared by the
// imperative getSession() (queryClient.fetchQuery) and the useSession() hook
// (useQuery) so both paths dedupe into the same cache entry.
export function sessionDetailQueryOptions(
  mode: Mode,
  slug: string,
  uploadStore: Map<string, TelemetrySession>,
) {
  return queryOptions({
    queryKey: telemetryKeys.sessionDetail(mode, slug),
    queryFn: async (): Promise<TelemetrySession> => {
      // Upload mode — read from the in-memory store filled by loadFiles()
      if (mode === "upload") {
        const data = uploadStore.get(slug);
        if (!data) throw new Error(`Session not found: ${slug}`);
        return data;
      }
      const url =
        mode === "demo"
          ? `${import.meta.env.BASE_URL}demo/${slug}.json`
          : `${import.meta.env.BASE_URL}api/sessions/${slug}`;
      const res = await fetch(url);
      if (!res.ok)
        throw new Error(
          mode === "demo"
            ? `Failed to load demo session: ${slug}`
            : `Failed to load session: ${slug}`,
        );
      return res.json() as Promise<TelemetrySession>;
    },
    // Session JSON is immutable once exported, so cache entries live for the
    // whole visit (parity with the old permanent in-memory Promise cache).
    // Upload-mode entries are evicted explicitly when files are replaced.
    staleTime: Infinity,
    gcTime: Infinity,
  });
}

export type SessionDetailQueryOptions = ReturnType<
  typeof sessionDetailQueryOptions
>;
