import type { ReactNode } from "react";
import { Link, Navigate, Routes, Route, useLocation, useParams } from "react-router-dom";
import { Analytics } from "@vercel/analytics/react";
import { Layout } from "./components/Layout";
import { DashboardPage } from "./pages/DashboardPage";
import { SessionPage } from "./pages/SessionPage";
import { TrackProgressPage } from "./pages/TrackProgressPage";
import { TelemetryProvider, useTelemetry } from "./context/TelemetryContext";
import { ZipUploadScreen } from "./components/ZipUploadScreen";
import { GlobalDropZone } from "./components/GlobalDropZone";
import { PNG_VERSION_TITLE_PREFIX } from "./config/branding";
import { dashboardPath, replaceFormulaScopeInPath } from "./utils/routes";

function AppRoutes() {
  const { mode, sessions, sessionsLoading, showUploadModal } = useTelemetry();

  if (mode === "detecting" || sessionsLoading) {
    return (
      <div className="flex h-screen items-center justify-center bg-black">
        <div className="h-10 w-10 animate-spin rounded-full border-4 border-zinc-600 border-t-red-500" />
      </div>
    );
  }

  const needsData = mode === "upload" && sessions.length === 0;

  return (
    <>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<DefaultScopeRedirect />} />
          <Route
            path=":formulaKey"
            element={
              <ScopedFormulaRoute>
                <DashboardPage />
              </ScopedFormulaRoute>
            }
          />
          <Route
            path=":formulaKey/sessions/*"
            element={
              <ScopedFormulaRoute>
                <SessionPage />
              </ScopedFormulaRoute>
            }
          />
          <Route
            path=":formulaKey/tracks/:trackId"
            element={
              <ScopedFormulaRoute>
                <TrackProgressPage />
              </ScopedFormulaRoute>
            }
          />
          <Route path="*" element={<RouteNotFound />} />
        </Route>
      </Routes>
      {(needsData || showUploadModal) && (
        <ZipUploadScreen dismissable={!needsData} />
      )}
      <GlobalDropZone />
    </>
  );
}

function DefaultScopeRedirect() {
  const { activeFormulaKey } = useTelemetry();
  if (!activeFormulaKey) return null;
  return <Navigate to={dashboardPath(activeFormulaKey)} replace />;
}

function ScopedFormulaRoute({ children }: { children: ReactNode }) {
  const { formulaKey } = useParams<{ formulaKey: string }>();
  const location = useLocation();
  const { activeFormulaKey, formulaOptions } = useTelemetry();
  const matchedFormula = formulaOptions.find((option) => option.key === formulaKey);

  if (formulaKey && activeFormulaKey && formulaKey !== activeFormulaKey) {
    return (
      <Navigate
        to={`${replaceFormulaScopeInPath(location.pathname, activeFormulaKey)}${location.search}`}
        replace
      />
    );
  }

  if (!formulaKey || formulaKey !== activeFormulaKey) {
    return (
      <EmptyRouteState
        title={
          formulaKey
            ? matchedFormula
              ? `No data for ${matchedFormula.label}`
              : "Game scope not found"
            : "Formula scope missing"
        }
        description={
          formulaOptions.length > 0
            ? "Choose one of the available game scopes. Scoped URLs are intentionally strict so the data you see always matches the URL."
            : "Load telemetry files to open a scoped dashboard."
        }
      />
    );
  }

  return children;
}

function RouteNotFound() {
  return (
    <EmptyRouteState
      title="Page not found"
      description="This app uses scoped URLs like /f1-26, /f1-26/tracks/sakhir, and /f1-26/sessions/session-slug."
    />
  );
}

function EmptyRouteState({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  const { formulaOptions } = useTelemetry();
  return (
    <div className="flex h-full items-center justify-center px-6 text-center">
      <div className="max-w-sm">
        <h2 className="text-base font-semibold text-zinc-200">{title}</h2>
        <p className="mt-2 text-sm text-zinc-500">{description}</p>
        {formulaOptions.length > 0 && (
          <div className="mt-4 flex flex-wrap justify-center gap-2">
            {formulaOptions.map((option) => (
              <Link
                key={option.key}
                to={dashboardPath(option.key)}
                className="inline-flex rounded-lg bg-zinc-800 px-4 py-2 text-sm font-medium text-zinc-200 transition-colors hover:bg-zinc-700"
              >
                {option.label}
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

const analyticsEnabled = import.meta.env.VITE_DISABLE_ANALYTICS !== "true";
const appVersion = (window as Window & { __PNG_VERSION__?: string }).__PNG_VERSION__;
if (appVersion) {
  document.title = `${PNG_VERSION_TITLE_PREFIX} v${appVersion}`;
}

export function App() {
  return (
    <TelemetryProvider>
      <AppRoutes />
      {analyticsEnabled && <Analytics />}
    </TelemetryProvider>
  );
}
