import { Link, Navigate, useParams } from "react-router-dom";
import { Upload, ArrowLeft } from "lucide-react";
import { useSession } from "../hooks/useSession";
import { useTelemetry } from "../context/TelemetryContext";
import { isRaceSession } from "../utils/stats/drivers";
import { dashboardPath, sessionPath } from "../utils/routes";
import { getFormulaComparisonKey } from "../utils/sessionTypes";
import { ActionEmptyState } from "../components/ActionEmptyState";
import { RaceSessionView } from "./RaceSessionView";
import { QualifyingSessionView } from "./QualifyingSessionView";
import { Button, buttonVariants } from "../components/ui/Button";
import { HStack } from "../components/ui/Stack";

/**
 * Wrapper that loads session data from the URL path
 * and delegates to the correct view based on session type.
 */
export function SessionPage() {
  const params = useParams<{ "*": string }>();
  const slug = params["*"] ?? "";

  const { session, loading, error } = useSession(slug);
  const { mode, sessions, setShowUploadModal, activeFormulaKey } =
    useTelemetry();
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
          <ActionEmptyState
            icon={Upload}
            className="max-w-md"
            title="Demo session — detail not available"
            message="You're previewing the dashboard with sample data. Upload your own Pits n' Giggles telemetry to explore real per-lap charts, stints, sector breakdowns, and race-by-race comparisons."
            actions={
              <HStack className="gap-2">
                <Button
                  variant="primary"
                  onClick={() => setShowUploadModal(true)}
                >
                  Upload telemetry
                </Button>
                <Link
                  to={backToDashboardPath}
                  className={buttonVariants({ variant: "secondary" })}
                >
                  Back to dashboard
                </Link>
              </HStack>
            }
          />
        </div>
      );
    }

    return (
      <div className="flex items-center justify-center h-full">
        <ActionEmptyState
          icon={isUploadWithNoData ? Upload : ArrowLeft}
          title={
            isUploadWithNoData
              ? "Session data not available"
              : "Session not found"
          }
          message={
            isUploadWithNoData
              ? "Uploaded telemetry is stored in memory and lost when the browser is closed. Re-upload your .zip to continue."
              : "This session doesn't exist or may have been removed."
          }
          actions={
            isUploadWithNoData ? (
              <Button
                variant="primary"
                onClick={() => setShowUploadModal(true)}
              >
                Upload telemetry
              </Button>
            ) : (
              <Link
                to={backToDashboardPath}
                className={buttonVariants({ variant: "secondary" })}
              >
                Back to dashboard
              </Link>
            )
          }
        />
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
