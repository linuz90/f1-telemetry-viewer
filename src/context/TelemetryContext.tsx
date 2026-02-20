import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import type { SessionSummary, TelemetrySession } from "../types/telemetry";
import { loadZipFile, loadJsonFiles } from "./zipLoader";

type Mode = "detecting" | "api" | "demo" | "upload";

interface TelemetryContextValue {
  mode: Mode;
  sessions: SessionSummary[];
  sessionsLoading: boolean;
  sessionsError: string | null;
  getSession: (slug: string) => Promise<TelemetrySession>;
  loadFiles: (files: File[]) => Promise<void>;
  showUploadModal: boolean;
  setShowUploadModal: (show: boolean) => void;
  filesLoading: boolean;
}

const TelemetryContext = createContext<TelemetryContextValue | null>(null);

export function useTelemetry() {
  const ctx = useContext(TelemetryContext);
  if (!ctx) throw new Error("useTelemetry must be used within TelemetryProvider");
  return ctx;
}

export function TelemetryProvider({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState<Mode>("detecting");
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(true);
  const [sessionsError, setSessionsError] = useState<string | null>(null);
  const [filesLoading, setFilesLoading] = useState(false);
  const [showUploadModal, setShowUploadModal] = useState(false);

  // In-memory store for upload mode
  const [sessionStore] = useState(
    () => new Map<string, TelemetrySession>(),
  );

  // API-mode session cache (mirrors the old api/client.ts cache)
  const [apiCache] = useState(
    () => new Map<string, Promise<TelemetrySession>>(),
  );

  // Detect mode on mount
  useEffect(() => {
    const tryDemo = () =>
      fetch("/demo/sessions.json")
        .then((res) => {
          if (!res.ok) throw new Error("No demo data");
          return res.json() as Promise<SessionSummary[]>;
        })
        .then((data) => {
          setMode("demo");
          setSessions(data);
        })
        .catch(() => {
          setMode("upload");
        });

    // Skip API in prod-like dev mode — run the same demo → upload fallback as production
    if (import.meta.env.VITE_SKIP_API === "true") {
      tryDemo().finally(() => setSessionsLoading(false));
      return;
    }

    fetch("/api/sessions")
      .then((res) => {
        if (!res.ok) throw new Error("API unavailable");
        return res.json() as Promise<SessionSummary[]>;
      })
      .then((data) => {
        setMode("api");
        setSessions(data);
      })
      .catch(() => tryDemo())
      .finally(() => setSessionsLoading(false));
  }, []);

  const getSession = useCallback(
    (slug: string): Promise<TelemetrySession> => {
      // Upload mode — read from in-memory store
      if (mode === "upload") {
        const data = sessionStore.get(slug);
        if (!data)
          return Promise.reject(new Error(`Session not found: ${slug}`));
        return Promise.resolve(data);
      }

      // Demo mode — fetch from /demo/<slug>.json with cache
      if (mode === "demo") {
        const cached = apiCache.get(slug);
        if (cached) return cached;

        const promise = fetch(`/demo/${slug}.json`).then((res) => {
          if (!res.ok) {
            apiCache.delete(slug);
            throw new Error(`Failed to load demo session: ${slug}`);
          }
          return res.json() as Promise<TelemetrySession>;
        });

        apiCache.set(slug, promise);
        return promise;
      }

      // API mode — fetch with cache
      const cached = apiCache.get(slug);
      if (cached) return cached;

      const promise = fetch(`/api/sessions/${slug}`).then((res) => {
        if (!res.ok) {
          apiCache.delete(slug);
          throw new Error(`Failed to load session: ${slug}`);
        }
        return res.json() as Promise<TelemetrySession>;
      });

      apiCache.set(slug, promise);
      return promise;
    },
    [mode, sessionStore, apiCache],
  );

  const loadFiles = useCallback(
    async (files: File[]) => {
      setFilesLoading(true);
      try {
        const zips = files.filter((f) => f.name.endsWith(".zip"));
        const jsons = files.filter((f) => f.name.endsWith(".json"));

        // Load zip(s) first, then JSON files on top
        const allSessions: SessionSummary[] = [];
        const allData = new Map<string, TelemetrySession>();

        for (const zip of zips) {
          const result = await loadZipFile(zip);
          allSessions.push(...result.sessions);
          for (const [slug, data] of result.sessionData) {
            allData.set(slug, data);
          }
        }

        if (jsons.length > 0) {
          const result = await loadJsonFiles(jsons);
          allSessions.push(...result.sessions);
          for (const [slug, data] of result.sessionData) {
            allData.set(slug, data);
          }
        }

        sessionStore.clear();
        for (const [slug, data] of allData) {
          sessionStore.set(slug, data);
        }
        setMode("upload");
        setSessionsError(null);
        setSessions(allSessions);
      } finally {
        setFilesLoading(false);
      }
    },
    [sessionStore],
  );

  return (
    <TelemetryContext.Provider
      value={{
        mode,
        sessions,
        sessionsLoading,
        sessionsError,
        getSession,
        loadFiles,
        showUploadModal,
        setShowUploadModal,
        filesLoading,
      }}
    >
      {children}
    </TelemetryContext.Provider>
  );
}
