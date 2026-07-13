import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useLocation } from "react-router-dom";
import type { SessionSummary, TelemetrySession } from "../types/telemetry";
import {
  loadZipFile,
  loadJsonFiles,
  type LoadedSessionSummary,
} from "./zipLoader";
import { deduplicateSessions } from "../utils/deduplicateSessions";
import {
  getFormulaScopeOptions,
  resolveFormulaScopeAlias,
  resolveFormulaScopeKey,
  type FormulaScopeOption,
} from "../utils/formulaScope";
import { getFormulaScopeCandidateFromPath, isRootPath } from "../utils/routes";

type Mode = "detecting" | "api" | "demo" | "upload";

interface TelemetryContextValue {
  mode: Mode;
  sessions: SessionSummary[];
  sessionsLoading: boolean;
  sessionsError: string | null;
  formulaOptions: FormulaScopeOption[];
  activeFormulaKey: string | undefined;
  activeFormula: FormulaScopeOption | undefined;
  getSession: (slug: string) => Promise<TelemetrySession>;
  loadFiles: (files: File[]) => Promise<void>;
  showUploadModal: boolean;
  setShowUploadModal: (show: boolean) => void;
  filesLoading: boolean;
}

const TelemetryContext = createContext<TelemetryContextValue | null>(null);

// Resolves the session-list poll interval (ms), preferring the runtime config injected
// by Pits n' Giggles (window.__PNG_SAVE_VIEWER_CONFIG__, already in ms) over the build-time
// env var used by standalone/dev deployments of this submodule (in seconds). 0 or unset
// disables polling.
function getSessionPollIntervalMs(): number {
  const injected = (
    window as Window & {
      __PNG_SAVE_VIEWER_CONFIG__?: { sessionPollIntervalMs?: number | null };
    }
  ).__PNG_SAVE_VIEWER_CONFIG__?.sessionPollIntervalMs;
  if (typeof injected === "number") return injected;
  if (injected === null) return 0; // host explicitly disabled it
  const intervalSecs =
    Number(import.meta.env.VITE_SESSION_POLL_INTERVAL_S) || 0;
  return intervalSecs * 1000;
}

export function useTelemetry() {
  const ctx = useContext(TelemetryContext);
  if (!ctx)
    throw new Error("useTelemetry must be used within TelemetryProvider");
  return ctx;
}

export function TelemetryProvider({ children }: { children: ReactNode }) {
  const location = useLocation();
  const [mode, setMode] = useState<Mode>("detecting");
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(true);
  const [sessionsError, setSessionsError] = useState<string | null>(null);
  const [filesLoading, setFilesLoading] = useState(false);
  const [showUploadModal, setShowUploadModal] = useState(false);
  // In-memory store for upload mode
  const [sessionStore] = useState(() => new Map<string, TelemetrySession>());

  // API-mode session cache (mirrors the old api/client.ts cache)
  const [apiCache] = useState(
    () => new Map<string, Promise<TelemetrySession>>(),
  );

  const formulaOptions = useMemo(
    () => getFormulaScopeOptions(sessions),
    [sessions],
  );
  const isRouteRoot = isRootPath(location.pathname);
  const routeFormulaKey = getFormulaScopeCandidateFromPath(location.pathname);
  const routeFormulaKeyResolved = resolveFormulaScopeAlias(
    sessions,
    routeFormulaKey,
  );
  // Root is the only path that defaults to the newest available scope. Every
  // other URL must carry an exact first-segment scope, otherwise stale legacy
  // links or typos would quietly display data for the wrong game generation.
  // Known legacy scope aliases, such as `f1-modern`, resolve to their canonical
  // key so the route wrapper can replace the URL with `/f1-25/...`.
  const activeFormulaKey = useMemo(
    () =>
      isRouteRoot
        ? resolveFormulaScopeKey(sessions, null)
        : routeFormulaKeyResolved,
    [isRouteRoot, routeFormulaKeyResolved, sessions],
  );
  const activeFormula = useMemo(
    () => formulaOptions.find((option) => option.key === activeFormulaKey),
    [activeFormulaKey, formulaOptions],
  );
  // Re-fetch the session list from the API. Used by polling and tab-focus
  // refresh — failures are swallowed so a transient network blip doesn't
  // clobber an otherwise-working session list with an error state.
  const fetchSessions = useCallback(() => {
    fetch(`${import.meta.env.BASE_URL}api/sessions`)
      .then((res) => {
        if (!res.ok) throw new Error("API unavailable");
        return res.json() as Promise<SessionSummary[]>;
      })
      .then((data) => setSessions(data))
      .catch(() => {
        // keep the stale list; next poll/focus will retry
      });
  }, []);

  // Detect mode on mount
  useEffect(() => {
    const tryDemo = () =>
      fetch(`${import.meta.env.BASE_URL}demo/sessions.json`)
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

    fetch(`${import.meta.env.BASE_URL}api/sessions`)
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

  // Background polling — off by default in the raw submodule (VITE_SESSION_POLL_INTERVAL_S
  // unset), configured at runtime via window.__PNG_SAVE_VIEWER_CONFIG__ when served through
  // Pits n' Giggles' own settings UI. Only meaningful in "api" mode: demo/upload data has no
  // live filesystem backing it.
  useEffect(() => {
    if (mode !== "api") return;
    const intervalMs = getSessionPollIntervalMs();
    if (intervalMs <= 0) return;
    const id = setInterval(fetchSessions, intervalMs);
    return () => clearInterval(id);
  }, [mode, fetchSessions]);

  // Refetch whenever the tab regains focus/visibility, independent of polling, so a
  // session saved while the tab was backgrounded shows up as soon as the user returns.
  useEffect(() => {
    if (mode !== "api") return;
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") fetchSessions();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () =>
      document.removeEventListener("visibilitychange", onVisibilityChange);
  }, [mode, fetchSessions]);

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

        const promise = fetch(
          `${import.meta.env.BASE_URL}demo/${slug}.json`,
        ).then((res) => {
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

      const promise = fetch(
        `${import.meta.env.BASE_URL}api/sessions/${slug}`,
      ).then((res) => {
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
        const allSessions: LoadedSessionSummary[] = [];
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

        const deduplicatedSessions = deduplicateSessions(allSessions);
        deduplicatedSessions.sort(
          (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime(),
        );
        const keptSlugs = new Set(deduplicatedSessions.map((s) => s.slug));

        sessionStore.clear();
        for (const [slug, data] of allData) {
          if (keptSlugs.has(slug)) {
            sessionStore.set(slug, data);
          }
        }
        setMode("upload");
        setSessionsError(null);
        setSessions(deduplicatedSessions);
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
        formulaOptions,
        activeFormulaKey,
        activeFormula,
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
