import { useLocation, Link } from "react-router-dom";
import { Upload, ArrowLeft } from "lucide-react";
import { useSession } from "../hooks/useSession";
import { useTelemetry } from "../context/TelemetryContext";
import { isRaceSession } from "../utils/stats";
import { RaceSessionView } from "./RaceSessionView";
import { QualifyingSessionView } from "./QualifyingSessionView";

/**
 * Wrapper that loads session data from the URL path
 * and delegates to the correct view based on session type.
 */
export function SessionPage() {
  const location = useLocation();
  const slug = location.pathname.replace("/session/", "");

  const { session, loading, error } = useSession(slug);
  const { mode, sessions, setShowUploadModal } = useTelemetry();

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full text-zinc-500">
        Loading session...
      </div>
    );
  }

  if (error || !session) {
    const isUploadWithNoData = mode === "upload" && sessions.length === 0;

    return (
      <div className="flex items-center justify-center h-full">
        <div className="flex flex-col items-center gap-4 text-center max-w-sm">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-zinc-900">
            {isUploadWithNoData ? (
              <Upload className="h-5 w-5 text-zinc-500" />
            ) : (
              <ArrowLeft className="h-5 w-5 text-zinc-500" />
            )}
          </div>
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
              to="/"
              className="rounded-lg bg-zinc-800 px-4 py-2 text-sm font-medium text-zinc-200 hover:bg-zinc-700 transition-colors"
            >
              Back to dashboard
            </Link>
          )}
        </div>
      </div>
    );
  }

  return isRaceSession(session) ? (
    <RaceSessionView key={slug} session={session} slug={slug} />
  ) : (
    <QualifyingSessionView key={slug} session={session} slug={slug} />
  );
}
