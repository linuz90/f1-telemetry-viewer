import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import type { SessionSummary, TelemetrySession } from "../types/telemetry";
import { loadZipFile } from "./zipLoader";

type Mode = "detecting" | "api" | "upload";

interface TelemetryContextValue {
  mode: Mode;
  sessions: SessionSummary[];
  sessionsLoading: boolean;
  sessionsError: string | null;
  getSession: (slug: string) => Promise<TelemetrySession>;
  loadZip: (file: File) => Promise<void>;
  showUploadModal: boolean;
  setShowUploadModal: (show: boolean) => void;
  zipLoading: boolean;
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
  const [zipLoading, setZipLoading] = useState(false);
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
    if (import.meta.env.VITE_FORCE_UPLOAD === "true") {
      setMode("upload");
      setSessionsLoading(false);
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
      .catch((e: Error) => {
        setMode("upload");
        setSessionsError(e.message);
      })
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

  const loadZip = useCallback(
    async (file: File) => {
      setZipLoading(true);
      try {
        const result = await loadZipFile(file);
        sessionStore.clear();
        for (const [slug, data] of result.sessionData) {
          sessionStore.set(slug, data);
        }
        setSessions(result.sessions);
      } finally {
        setZipLoading(false);
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
        loadZip,
        showUploadModal,
        setShowUploadModal,
        zipLoading,
      }}
    >
      {children}
    </TelemetryContext.Provider>
  );
}
