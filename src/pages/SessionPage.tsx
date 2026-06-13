import { Link, Navigate, useParams } from "react-router-dom";
import { Upload, ArrowLeft } from "lucide-react";
import { useSession } from "../hooks/useSession";
import { useTelemetry } from "../context/TelemetryContext";
import { isRaceSession } from "../utils/stats";
import { dashboardPath, sessionPath } from "../utils/routes";
import { getFormulaComparisonKey } from "../utils/sessionTypes";
import { RaceSessionView } from "./RaceSessionView";
import { QualifyingSessionView } from "./QualifyingSessionView";
import { HStack, VStack } from "../components/ui/Stack";

/**
 * Wrapper that loads session data from the URL path
 * and delegates to the correct view based on session type.
 */
export function SessionPage() {
  const params = useParams<{ "*": string }>();
  const slug = params["*"] ?? "";

  const { session, loading, error } = useSession(slug);
  const {
    mode,
    sessions,
    setShowUploadModal,
    activeFormulaKey,
  } = useTelemetry();
  const backToDashboardPath = dashboardPath(activeFormulaKey);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full text-zinc-500">
        Loading session...
      </div>
    );
  }

  if (error || !session) {
    const isUploadWithNoData = mode === "upload" && sessions.length === 0;
    // In the prod no-data demo, the dashboard renders rich synthetic summary
    // entries (rivals, recent results, etc.) that have no backing detail JSON.
    // Show a friendly "preview" panel instead of a generic 404 when one is
    // clicked, with an upload CTA that mirrors the Get Started flow.
    const isDemoPreview =
      mode === "demo" && sessions.some((s) => s.slug === slug && s.isSynthetic);

    if (isDemoPreview) {
      return (
        <div className="flex items-center justify-center h-full px-6">
          <VStack align="center" className="max-w-md text-center">
            <HStack justify="center" className="h-12 w-12 rounded-full bg-zinc-900">
              <Upload className="h-5 w-5 text-zinc-500" />
            </HStack>
            <div>
              <h3 className="text-base font-medium text-zinc-200">
                Demo session — detail not available
              </h3>
              <p className="mt-1 text-sm text-zinc-500">
                You're previewing the dashboard with sample data. Upload your
                own Pits n' Giggles telemetry to explore real per-lap charts,
                stints, sector breakdowns, and race-by-race comparisons.
              </p>
            </div>
            <HStack className="gap-2">
              <button
                onClick={() => setShowUploadModal(true)}
                className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-500 transition-colors"
              >
                Upload telemetry
              </button>
              <Link
                to={backToDashboardPath}
                className="rounded-lg bg-zinc-800 px-4 py-2 text-sm font-medium text-zinc-200 hover:bg-zinc-700 transition-colors"
              >
                Back to dashboard
              </Link>
            </HStack>
          </VStack>
        </div>
      );
    }

    return (
      <div className="flex items-center justify-center h-full">
        <VStack align="center" className="max-w-sm text-center">
          <HStack justify="center" className="h-12 w-12 rounded-full bg-zinc-900">
            {isUploadWithNoData ? (
              <Upload className="h-5 w-5 text-zinc-500" />
            ) : (
              <ArrowLeft className="h-5 w-5 text-zinc-500" />
            )}
          </HStack>
          <div>
            <h3 className="text-base font-medium text-zinc-200">
              {isUploadWithNoData
                ? "Session data not available"
                : "Session not found"}
            </h3>
            <p className="mt-1 text-sm text-zinc-500">
              {isUploadWithNoData
                ? "Uploaded telemetry is stored in memory and lost when the browser is closed. Re-upload your .zip to continue."
                : "This session doesn't exist or may have been removed."}
            </p>
          </div>
          {isUploadWithNoData ? (
            <button
              onClick={() => setShowUploadModal(true)}
              className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-500 transition-colors"
            >
              Upload telemetry
            </button>
          ) : (
            <Link
              to={backToDashboardPath}
              className="rounded-lg bg-zinc-800 px-4 py-2 text-sm font-medium text-zinc-200 hover:bg-zinc-700 transition-colors"
            >
              Back to dashboard
            </Link>
          )}
        </VStack>
      </div>
    );
  }

  const sessionFormulaKey = getFormulaComparisonKey(
    session["session-info"].formula,
    session["game-year"],
  );
  if (sessionFormulaKey !== activeFormulaKey) {
    return <Navigate to={sessionPath(sessionFormulaKey, slug)} replace />;
  }

  return isRaceSession(session) ? (
    <RaceSessionView key={slug} session={session} slug={slug} />
  ) : (
    <QualifyingSessionView key={slug} session={session} slug={slug} />
  );
}
