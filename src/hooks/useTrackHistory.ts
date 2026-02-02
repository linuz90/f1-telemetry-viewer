import { useEffect, useState } from "react";
import { useSessionList } from "./useSessionList";
import { useTelemetry } from "../context/TelemetryContext";
import {
  findPlayer,
  getValidLaps,
  getBestLapTime,
  isRaceSession,
} from "../utils/stats";

export interface TrackPBs {
  /** All-time best qualifying lap time (ms) on this track */
  bestQualiLapMs: number;
  /** All-time best sector times (ms) across all qualifying sessions */
  bestS1Ms: number;
  bestS2Ms: number;
  bestS3Ms: number;
  /** All-time best single race lap (ms) on this track */
  bestRaceLapMs: number;
  /** Best average race pace (ms) on this track */
  bestRacePaceMs: number;
  /** Number of previous sessions on this track (excluding current) */
  sessionCount: number;
}

/**
 * Load all sessions for the same track and compute all-time PBs.
 * Excludes the current session (by slug) so comparisons are always "vs history".
 */
export function useTrackHistory(
  trackName: string | undefined,
  currentSlug: string | undefined,
): { pbs: TrackPBs | null; loading: boolean } {
  const { sessions } = useSessionList();
  const { getSession } = useTelemetry();
  const [pbs, setPbs] = useState<TrackPBs | null>(null);
  const [loading, setLoading] = useState(true);

  const trackSessions = sessions.filter(
    (s) => s.track === trackName && s.slug !== currentSlug,
  );

  useEffect(() => {
    if (!trackName || trackSessions.length === 0) {
      setLoading(false);
      setPbs(null);
      return;
    }

    setLoading(true);

    Promise.all(
      trackSessions.map(async (s) => {
        try {
          return await getSession(s.slug);
        } catch {
          return null;
        }
      }),
    ).then((results) => {
      const loaded = results.filter((r) => r !== null);

      let bestQualiLapMs = 0;
      let bestS1Ms = 0;
      let bestS2Ms = 0;
      let bestS3Ms = 0;
      let bestRaceLapMs = 0;
      let bestRacePaceMs = 0;

      for (const sessionData of loaded) {
        const player = findPlayer(sessionData);
        if (!player) continue;

        const laps = player["session-history"]["lap-history-data"];
        const valid = getValidLaps(laps);

        if (isRaceSession(sessionData)) {
          // Best single race lap
          const best = getBestLapTime(laps);
          if (best > 0 && (bestRaceLapMs === 0 || best < bestRaceLapMs)) {
            bestRaceLapMs = best;
          }
          // Best average race pace
          if (valid.length > 0) {
            const avg =
              valid.reduce((s, l) => s + l["lap-time-in-ms"], 0) /
              valid.length;
            if (bestRacePaceMs === 0 || avg < bestRacePaceMs) {
              bestRacePaceMs = avg;
            }
          }
        } else {
          // Qualifying: best lap and sectors
          const best = getBestLapTime(laps);
          if (best > 0 && (bestQualiLapMs === 0 || best < bestQualiLapMs)) {
            bestQualiLapMs = best;
          }

          if (valid.length > 0) {
            const s1 = Math.min(
              ...valid
                .map((l) => l["sector-1-time-in-ms"])
                .filter((v) => v > 0),
            );
            const s2 = Math.min(
              ...valid
                .map((l) => l["sector-2-time-in-ms"])
                .filter((v) => v > 0),
            );
            const s3 = Math.min(
              ...valid
                .map((l) => l["sector-3-time-in-ms"])
                .filter((v) => v > 0),
            );

            if (s1 > 0 && (bestS1Ms === 0 || s1 < bestS1Ms)) bestS1Ms = s1;
            if (s2 > 0 && (bestS2Ms === 0 || s2 < bestS2Ms)) bestS2Ms = s2;
            if (s3 > 0 && (bestS3Ms === 0 || s3 < bestS3Ms)) bestS3Ms = s3;
          }
        }
      }

      setPbs({
        bestQualiLapMs,
        bestS1Ms,
        bestS2Ms,
        bestS3Ms,
        bestRaceLapMs,
        bestRacePaceMs,
        sessionCount: trackSessions.length,
      });
      setLoading(false);
    });
  }, [trackName, trackSessions.length]);

  return { pbs, loading };
}
