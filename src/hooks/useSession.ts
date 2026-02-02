import { useEffect, useState } from "react";
import type { TelemetrySession } from "../types/telemetry";
import { useTelemetry } from "../context/TelemetryContext";

export function useSession(slug: string | undefined) {
  const { getSession } = useTelemetry();
  const [session, setSession] = useState<TelemetrySession | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!slug) return;

    setLoading(true);
    setError(null);
    setSession(null);

    getSession(slug)
      .then(setSession)
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [slug, getSession]);

  return { session, loading, error };
}
