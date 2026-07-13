import { useQuery } from "@tanstack/react-query";
import { useTelemetry } from "../context/TelemetryContext";

export function useSession(slug: string | undefined) {
  const { mode, getSessionQueryOptions } = useTelemetry();

  const query = useQuery({
    ...getSessionQueryOptions(slug ?? ""),
    // Wait for data-source detection so a deep link doesn't fetch against the
    // wrong endpoint while the api → demo fallback is still resolving.
    enabled: Boolean(slug) && mode !== "detecting",
  });

  return {
    session: query.data ?? null,
    // Count detection as loading too — the query is disabled during it, and
    // SessionPage would otherwise flash "Session not found" on deep links.
    loading: Boolean(slug) && (mode === "detecting" || query.isLoading),
    error: query.error ? query.error.message : null,
  };
}
