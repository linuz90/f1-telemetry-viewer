import { Routes, Route } from "react-router-dom";
import { Analytics } from "@vercel/analytics/react";
import { Layout } from "./components/Layout";
import { DashboardPage } from "./pages/DashboardPage";
import { SessionPage } from "./pages/SessionPage";
import { TrackProgressPage } from "./pages/TrackProgressPage";
import { TelemetryProvider, useTelemetry } from "./context/TelemetryContext";
import { ZipUploadScreen } from "./components/ZipUploadScreen";
import { GlobalDropZone } from "./components/GlobalDropZone";
import { PNG_VERSION_TITLE_PREFIX } from "./config/branding";

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
          <Route index element={<DashboardPage />} />
          <Route path="session/*" element={<SessionPage />} />
          <Route path="track/:trackId" element={<TrackProgressPage />} />
        </Route>
      </Routes>
      {(needsData || showUploadModal) && (
        <ZipUploadScreen dismissable={!needsData} />
      )}
      <GlobalDropZone />
    </>
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
