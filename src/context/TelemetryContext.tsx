import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useLocation } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { SessionSummary, TelemetrySession } from "../types/telemetry";
import {
  detectDataSource,
  fetchSessionList,
  getSessionPollIntervalMs,
  sessionDetailQueryOptions,
  telemetryKeys,
  type Mode,
  type SessionDetailQueryOptions,
} from "../queries/telemetry";
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

interface TelemetryContextValue {
  mode: Mode;
  sessions: SessionSummary[];
  sessionsLoading: boolean;
  sessionsError: string | null;
  formulaOptions: FormulaScopeOption[];
  activeFormulaKey: string | undefined;
  activeFormula: FormulaScopeOption | undefined;
  getSession: (slug: string) => Promise<TelemetrySession>;
  getSessionQueryOptions: (slug: string) => SessionDetailQueryOptions;
  loadFiles: (files: File[]) => Promise<void>;
  showUploadModal: boolean;
  setShowUploadModal: (show: boolean) => void;
  filesLoading: boolean;
}

const TelemetryContext = createContext<TelemetryContextValue | null>(null);

// Stable fallback so consumers memoized on `sessions` don't recompute while empty.
const EMPTY_SESSIONS: SessionSummary[] = [];

export function useTelemetry() {
  const ctx = useContext(TelemetryContext);
  if (!ctx)
    throw new Error("useTelemetry must be used within TelemetryProvider");
  return ctx;
}

export function TelemetryProvider({ children }: { children: ReactNode }) {
  const location = useLocation();
  const queryClient = useQueryClient();
  const [filesLoading, setFilesLoading] = useState(false);
  const [showUploadModal, setShowUploadModal] = useState(false);
  // Upload mode overrides whatever the startup probe detected, permanently for
  // this visit — dropping files while browsing api/demo data switches sources.
  const [uploadedSessions, setUploadedSessions] = useState<
    SessionSummary[] | null
  >(null);
  // In-memory store for upload mode
  const [sessionStore] = useState(() => new Map<string, TelemetrySession>());

  const detectionQuery = useQuery({
    queryKey: telemetryKeys.dataSource,
    queryFn: () => detectDataSource(queryClient),
    // Detection is a one-shot startup decision. Never refetch it: a transient
    // API blip on refocus must not flip a working api-mode UI into demo mode.
    staleTime: Infinity,
    gcTime: Infinity,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });

  const mode: Mode = uploadedSessions
    ? "upload"
    : (detectionQuery.data?.mode ?? "detecting");

  const sessionListQuery = useQuery({
    queryKey: telemetryKeys.sessionList,
    queryFn: () => fetchSessionList(`${import.meta.env.BASE_URL}api/sessions`),
    // Only the local API has a live filesystem behind it — demo and uploaded
    // lists are static, so background refresh is api-mode only.
    enabled: mode === "api",
    // The detection probe seeds this cache; a short freshness window stops the
    // query from re-fetching the identical payload the moment it's enabled.
    staleTime: 5_000,
    // Polling is opt-in (PnG runtime config or VITE_SESSION_POLL_INTERVAL_S).
    // TanStack pauses the interval while the tab is hidden; the focus refetch
    // below catches up as soon as the user returns.
    refetchInterval: getSessionPollIntervalMs() || false,
    // A session saved while the tab was backgrounded shows up on return even
    // with polling disabled. On refetch failure TanStack keeps the previous
    // data, so a transient blip never clobbers a working session list.
    refetchOnWindowFocus: true,
  });

  const sessions =
    uploadedSessions ??
    (mode === "api" ? sessionListQuery.data : detectionQuery.data?.sessions) ??
    EMPTY_SESSIONS;
  const sessionsLoading = uploadedSessions ? false : detectionQuery.isPending;
  // Detection already proved the API once, and refetch failures keep previous
  // data — so this only surfaces when the list truly has nothing to show.
  const sessionsError =
    mode === "api" && sessionListQuery.isError && !sessionListQuery.data
      ? sessionListQuery.error.message
      : null;

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

  const getSessionQueryOptions = useCallback(
    (slug: string) => sessionDetailQueryOptions(mode, slug, sessionStore),
    [mode, sessionStore],
  );

  const getSession = useCallback(
    (slug: string): Promise<TelemetrySession> =>
      queryClient.fetchQuery(getSessionQueryOptions(slug)),
    [queryClient, getSessionQueryOptions],
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
        // Re-uploading replaces the store, so cached upload-mode detail queries
        // (staleTime: Infinity) would otherwise keep serving the old files.
        queryClient.removeQueries({
          queryKey: telemetryKeys.sessionDetailsByMode("upload"),
        });
        setUploadedSessions(deduplicatedSessions);
      } finally {
        setFilesLoading(false);
      }
    },
    [sessionStore, queryClient],
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
        getSessionQueryOptions,
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
