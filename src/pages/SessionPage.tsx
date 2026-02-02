import { useLocation } from "react-router-dom";
import { useSession } from "../hooks/useSession";
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

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full text-zinc-500">
        Loading session...
      </div>
    );
  }

  if (error || !session) {
    return (
      <div className="flex items-center justify-center h-full text-red-400">
        {error ?? "Session not found"}
      </div>
    );
  }

  return isRaceSession(session) ? (
    <RaceSessionView session={session} slug={slug} />
  ) : (
    <QualifyingSessionView session={session} slug={slug} />
  );
}
