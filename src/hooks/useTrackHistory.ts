import { useEffect, useState } from "react";
import { useSessionList } from "./useSessionList";
import { useTelemetry } from "../context/TelemetryContext";
import { findPlayer, isRaceSession } from "../utils/stats/drivers";
import {
  getBestLapTime,
  getRacePaceLaps,
  getValidLaps,
} from "../utils/stats/laps";
import { bestSectorTimeMs } from "../utils/format";
import {
  getFormulaComparisonKey,
  isTimeTrialSessionType,
} from "../utils/sessionTypes";

export interface TrackPBs {
  /** All-time best qualifying-style lap time (ms) on this track. */
  bestQualiLapMs: number;
  /** All-time best sector times (ms) across all qualifying-style sessions. */
  bestS1Ms: number;
  bestS2Ms: number;
  bestS3Ms: number;
  /** All-time Time Trial lap and sector PBs, kept separate from qualifying. */
  bestTimeTrialLapMs: number;
  bestTimeTrialS1Ms: number;
  bestTimeTrialS2Ms: number;
  bestTimeTrialS3Ms: number;
  /** Number of previous Time Trial sessions on this track/formula. */
  timeTrialSessionCount: number;
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
  formula: string | undefined,
  gameYear: number | undefined,
): { pbs: TrackPBs | null; loading: boolean } {
  const { sessions } = useSessionList();
  const { getSession } = useTelemetry();
  const [pbs, setPbs] = useState<TrackPBs | null>(null);
  const [loading, setLoading] = useState(true);

  const trackSessions = sessions.filter(
    (s) =>
      s.track === trackName &&
      s.slug !== currentSlug &&
      getFormulaComparisonKey(s.formula, s.gameYear) ===
        getFormulaComparisonKey(formula, gameYear),
  );
  const trackSessionKey = trackSessions.map((s) => s.slug).join("|");

  useEffect(() => {
    if (!trackName) {
      setLoading(false);
      setPbs(null);
      return;
    }

    setLoading(true);
    let cancelled = false;

    if (trackSessions.length === 0) {
      setLoading(false);
      setPbs(null);
      return () => {
        cancelled = true;
      };
    }

    computeFromSessions();

    function computeFromSessions() {
      if (trackSessions.length === 0) {
        setLoading(false);
        setPbs(null);
        return;
      }
      Promise.all(
        trackSessions.map(async (s) => {
          try {
            return await getSession(s.slug);
          } catch {
            return null;
          }
        }),
      ).then((results) => {
        if (cancelled) return;

        const loaded = results.filter((r) => r !== null);

        let bestQualiLapMs = 0;
        let bestS1Ms = 0;
        let bestS2Ms = 0;
        let bestS3Ms = 0;
        let bestTimeTrialLapMs = 0;
        let bestTimeTrialS1Ms = 0;
        let bestTimeTrialS2Ms = 0;
        let bestTimeTrialS3Ms = 0;
        let timeTrialSessionCount = 0;
        let bestRaceLapMs = 0;
        let bestRacePaceMs = 0;

        for (const sessionData of loaded) {
          const player = findPlayer(sessionData);
          if (!player) continue;

          const laps = player["session-history"]["lap-history-data"];
          const valid = getValidLaps(laps);

          const isTimeTrial = isTimeTrialSessionType(
            sessionData["session-info"]["session-type"],
          );

          if (isRaceSession(sessionData)) {
            // Best single race lap
            const best = getBestLapTime(laps);
            if (best > 0 && (bestRaceLapMs === 0 || best < bestRaceLapMs)) {
              bestRaceLapMs = best;
            }
            // Best average race pace (race-pace laps — SC/pit/outlier excluded)
            const racePaceLaps = getRacePaceLaps(player);
            if (racePaceLaps.length > 0) {
              const avg =
                racePaceLaps.reduce((s, l) => s + l["lap-time-in-ms"], 0) /
                racePaceLaps.length;
              if (bestRacePaceMs === 0 || avg < bestRacePaceMs) {
                bestRacePaceMs = avg;
              }
            }
          } else {
            // Keep the long-standing qualifying-style bucket for existing
            // history cards, then mirror TT into dedicated fields so TT-only
            // cards avoid quali laps with different fuel/traffic assumptions.
            const best = getBestLapTime(laps);
            if (best > 0 && (bestQualiLapMs === 0 || best < bestQualiLapMs)) {
              bestQualiLapMs = best;
            }
            if (isTimeTrial && best > 0) timeTrialSessionCount += 1;
            if (
              isTimeTrial &&
              best > 0 &&
              (bestTimeTrialLapMs === 0 || best < bestTimeTrialLapMs)
            ) {
              bestTimeTrialLapMs = best;
            }

            if (valid.length > 0) {
              const s1 = bestSectorTimeMs(valid, 1);
              const s2 = bestSectorTimeMs(valid, 2);
              const s3 = bestSectorTimeMs(valid, 3);

              if (s1 > 0 && (bestS1Ms === 0 || s1 < bestS1Ms)) bestS1Ms = s1;
              if (s2 > 0 && (bestS2Ms === 0 || s2 < bestS2Ms)) bestS2Ms = s2;
              if (s3 > 0 && (bestS3Ms === 0 || s3 < bestS3Ms)) bestS3Ms = s3;

              if (isTimeTrial) {
                if (
                  s1 > 0 &&
                  (bestTimeTrialS1Ms === 0 || s1 < bestTimeTrialS1Ms)
                )
                  bestTimeTrialS1Ms = s1;
                if (
                  s2 > 0 &&
                  (bestTimeTrialS2Ms === 0 || s2 < bestTimeTrialS2Ms)
                )
                  bestTimeTrialS2Ms = s2;
                if (
                  s3 > 0 &&
                  (bestTimeTrialS3Ms === 0 || s3 < bestTimeTrialS3Ms)
                )
                  bestTimeTrialS3Ms = s3;
              }
            }
          }
        }

        setPbs({
          bestQualiLapMs,
          bestS1Ms,
          bestS2Ms,
          bestS3Ms,
          bestTimeTrialLapMs,
          bestTimeTrialS1Ms,
          bestTimeTrialS2Ms,
          bestTimeTrialS3Ms,
          timeTrialSessionCount,
          bestRaceLapMs,
          bestRacePaceMs,
          sessionCount: trackSessions.length,
        });
        setLoading(false);
      });
    }

    return () => {
      cancelled = true;
    };
  }, [trackName, formula, gameYear, trackSessionKey, getSession]);

  return { pbs, loading };
}
